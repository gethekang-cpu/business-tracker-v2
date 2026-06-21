// api/index.js - Complete Phase 2 API with all endpoints
const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { supabase } = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ==================== STOCK IN ====================
app.post('/api/stock', async (req, res) => {
    try {
        const { date, supplier, item, quantity, costPerUnit } = req.body;
        
        if (!supplier || !item || !quantity || !costPerUnit) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const id = Date.now().toString();
        const totalCost = quantity * costPerUnit;
        const stockDate = date || new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('stock_in')
            .insert([{
                id, date: stockDate, supplier, item,
                quantity, cost_per_unit: costPerUnit, total_cost: totalCost
            }])
            .select();
        
        if (error) throw error;
        
        res.json({ success: true, data: data[0], message: 'Stock entry recorded' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ORDERS ====================
app.post('/api/orders', async (req, res) => {
    try {
        const { date, client, item, quantity, pricePerUnit, paymentRef } = req.body;
        
        if (!client || !item || !quantity || !pricePerUnit) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        // ===== NEW: Validate price against cost =====
        // Get latest cost price for this item
        const { data: stockData } = await supabase
            .from('stock_in')
            .select('cost_per_unit')
            .eq('item', item)
            .order('date', { ascending: false })
            .limit(1);
        
        const costPrice = stockData && stockData.length > 0 ? stockData[0].cost_per_unit : 0;
        
        if (costPrice > 0 && pricePerUnit < costPrice) {
            return res.status(400).json({ 
                success: false, 
                error: `Cannot sell below cost. Cost price: ${costPrice}. Your price: ${pricePerUnit}`,
                cost_price: costPrice
            });
        }
        // ===== END VALIDATION =====
        
        const id = Date.now().toString();
        const orderValue = quantity * pricePerUnit;
        const orderDate = date || new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('orders')
            .insert([{
                id, date: orderDate, client, item,
                quantity, price_per_unit: pricePerUnit,
                order_value: orderValue, payment_ref: paymentRef || null
            }])
            .select();
        
        if (error) throw error;
        
        res.json({ success: true, data: data[0], message: 'Order recorded' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PAYMENTS ====================
app.post('/api/payments', async (req, res) => {
    try {
        const { date, client, paymentAmount, paymentRef } = req.body;
        
        if (!client || !paymentAmount) {
            return res.status(400).json({ success: false, error: 'Client and amount required' });
        }
        
        const id = Date.now().toString();
        const paymentDate = date || new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('settlements')
            .insert([{
                id, date: paymentDate, client,
                payment_ref: paymentRef || `PAY-${id.slice(-8)}`,
                payment_amount: paymentAmount
            }])
            .select();
        
        if (error) throw error;
        
        res.json({ success: true, data: data[0], message: 'Payment recorded' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CASH SALE (Order + Payment Combined) ====================
app.post('/api/sales', async (req, res) => {
    try {
        const { date, client, item, quantity, pricePerUnit, paymentRef } = req.body;
        
        if (!client || !item || !quantity || !pricePerUnit) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const orderId = Date.now().toString();
        const paymentId = (Date.now() + 1).toString();
        const orderValue = quantity * pricePerUnit;
        const saleDate = date || new Date().toISOString().split('T')[0];
        const ref = paymentRef || `SALE-${orderId.slice(-8)}`;
        
        // Create order
        const { error: orderError } = await supabase
            .from('orders')
            .insert([{
                id: orderId, date: saleDate, client, item,
                quantity, price_per_unit: pricePerUnit,
                order_value: orderValue, payment_ref: ref
            }]);
        
        if (orderError) throw orderError;
        
        // Create payment
        const { error: paymentError } = await supabase
            .from('settlements')
            .insert([{
                id: paymentId, date: saleDate, client,
                payment_ref: ref, payment_amount: orderValue
            }]);
        
        if (paymentError) throw paymentError;
        
        res.json({ success: true, message: 'Cash sale recorded', data: { order_id: orderId, amount: orderValue } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== HISTORY ====================
app.get('/api/history', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const parsedLimit = parseInt(limit);
        
        // Get all three transaction types
        const { data: stock, error: stockError } = await supabase
            .from('stock_in')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        const { data: payments, error: paymentsError } = await supabase
            .from('settlements')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        // Combine and add type labels
        const allTransactions = [
            ...(stock || []).map(t => ({ ...t, type: 'stock_in' })),
            ...(orders || []).map(t => ({ ...t, type: 'order' })),
            ...(payments || []).map(t => ({ ...t, type: 'payment' }))
        ];
        
        // Sort by date (newest first)
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.json({ success: true, data: allTransactions.slice(0, parsedLimit), total: allTransactions.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DASHBOARD ====================
app.get('/api/dashboard', async (req, res) => {
    try {
        // Get all data
        const { data: stock } = await supabase.from('stock_in').select('*');
        const { data: orders } = await supabase.from('orders').select('*');
        const { data: payments } = await supabase.from('settlements').select('*');
        
        // Calculate stock levels
        const stockLevels = {};
        stock?.forEach(s => {
            if (!stockLevels[s.item]) stockLevels[s.item] = { in: 0, out: 0 };
            stockLevels[s.item].in += s.quantity;
        });
        
        orders?.forEach(o => {
            if (stockLevels[o.item]) {
                stockLevels[o.item].out = (stockLevels[o.item].out || 0) + o.quantity;
            }
        });
        
        // Add balance to stock levels
        const inventory = Object.entries(stockLevels).map(([item, data]) => ({
            item,
            stock_in: data.in,
            stock_out: data.out || 0,
            balance: data.in - (data.out || 0)
        }));
        
        // Calculate client balances
        const clientBalances = {};
        orders?.forEach(o => {
            if (!clientBalances[o.client]) clientBalances[o.client] = { orders: 0, payments: 0 };
            clientBalances[o.client].orders += (o.order_value || 0);
        });
        
        payments?.forEach(p => {
            if (!clientBalances[p.client]) clientBalances[p.client] = { orders: 0, payments: 0 };
            clientBalances[p.client].payments += (p.payment_amount || 0);
        });
        
        const clients = Object.entries(clientBalances).map(([name, data]) => ({
            name,
            total_orders: data.orders,
            total_payments: data.payments,
            balance: data.orders - data.payments
        }));
        
        // Summary
        const totalSales = orders?.reduce((sum, o) => sum + (o.order_value || 0), 0) || 0;
        const totalPaymentsReceived = payments?.reduce((sum, p) => sum + (p.payment_amount || 0), 0) || 0;
        
        res.json({
            success: true,
            data: {
                inventory,
                clients,
                summary: {
                    total_sales: totalSales,
                    total_payments: totalPaymentsReceived,
                    outstanding_debt: totalSales - totalPaymentsReceived,
                    total_orders: orders?.length || 0,
                    total_stock_entries: stock?.length || 0
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== STATEMENT ====================
app.get('/api/statement', async (req, res) => {
    try {
        const { client } = req.query;
        
        if (!client) {
            return res.status(400).json({ success: false, error: 'Client name required' });
        }
        
        // Get orders for this client
        const { data: orders } = await supabase
            .from('orders')
            .select('*')
            .eq('client', client)
            .order('date', { ascending: true });
        
        // Get payments for this client
        const { data: payments } = await supabase
            .from('settlements')
            .select('*')
            .eq('client', client)
            .order('date', { ascending: true });
        
        const totalOrders = orders?.reduce((sum, o) => sum + (o.order_value || 0), 0) || 0;
        const totalPayments = payments?.reduce((sum, p) => sum + (p.payment_amount || 0), 0) || 0;
        const balance = totalOrders - totalPayments;
        
        res.json({
            success: true,
            data: {
                client,
                orders: orders || [],
                payments: payments || [],
                summary: {
                    total_orders: totalOrders,
                    total_payments: totalPayments,
                    outstanding_balance: balance,
                    status: balance === 0 ? 'Settled' : balance > 0 ? 'Owing' : 'Credit'
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ITEMS (Master Data) ====================
app.get('/api/items', async (req, res) => {
    try {
        const { data, error } = await supabase.from('master_items').select('*').order('name');
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/items', async (req, res) => {
    try {
        const { name, weight } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Name required' });
        
        const id = Date.now().toString();
        const { data, error } = await supabase
            .from('master_items')
            .insert([{ id, name, weight: weight || 0 }])
            .select();
        
        if (error) throw error;
        res.json({ success: true, data: data[0], message: 'Item added' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== PARTIES (Master Data) ====================
app.get('/api/parties', async (req, res) => {
    try {
        const { role } = req.query;
        let query = supabase.from('master_parties').select('*').order('name');
        if (role) query = query.eq('role', role);
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/parties', async (req, res) => {
    try {
        const { name, role } = req.body;
        if (!name || !role) return res.status(400).json({ success: false, error: 'Name and role required' });
        
        const id = Date.now().toString();
        const { data, error } = await supabase
            .from('master_parties')
            .insert([{ id, name, role }])
            .select();
        
        if (error) throw error;
        res.json({ success: true, data: data[0], message: 'Party added' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==================== DELETE STOCK ENTRY ====================
app.delete('/api/stock/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('stock_in')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Stock entry deleted successfully' });
    } catch (error) {
        console.error('Delete stock error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DELETE ORDER ====================
app.delete('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== DELETE PAYMENT ====================
app.delete('/api/payments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('settlements')
            .delete()
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Payment deleted successfully' });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== UPDATE STOCK ENTRY ====================
app.put('/api/stock/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, supplier, item, quantity, costPerUnit } = req.body;
        
        const updateData = {};
        if (date) updateData.date = date;
        if (supplier) updateData.supplier = supplier;
        if (item) updateData.item = item;
        if (quantity) updateData.quantity = quantity;
        if (costPerUnit) {
            updateData.cost_per_unit = costPerUnit;
            updateData.total_cost = quantity * costPerUnit;
        }
        
        const { error } = await supabase
            .from('stock_in')
            .update(updateData)
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Stock entry updated successfully' });
    } catch (error) {
        console.error('Update stock error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== UPDATE ORDER ====================
app.put('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, client, item, quantity, pricePerUnit, paymentRef } = req.body;
        
        const updateData = {};
        if (date) updateData.date = date;
        if (client) updateData.client = client;
        if (item) updateData.item = item;
        if (quantity) updateData.quantity = quantity;
        if (pricePerUnit) {
            updateData.price_per_unit = pricePerUnit;
            updateData.order_value = quantity * pricePerUnit;
        }
        if (paymentRef !== undefined) updateData.payment_ref = paymentRef;
        
        const { error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Order updated successfully' });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== UPDATE PAYMENT ====================
app.put('/api/payments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, client, paymentRef, paymentAmount } = req.body;
        
        const updateData = {};
        if (date) updateData.date = date;
        if (client) updateData.client = client;
        if (paymentRef !== undefined) updateData.payment_ref = paymentRef;
        if (paymentAmount) updateData.payment_amount = paymentAmount;
        
        const { error } = await supabase
            .from('settlements')
            .update(updateData)
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Payment updated successfully' });
    } catch (error) {
        console.error('Update payment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== UPDATE ITEM (MASTER) ====================
app.put('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, weight } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (weight !== undefined) updateData.weight = weight;
        
        const { error } = await supabase
            .from('master_items')
            .update(updateData)
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Item updated successfully' });
    } catch (error) {
        console.error('Update item error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== UPDATE PARTY (MASTER) ====================
app.put('/api/parties/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (role) updateData.role = role;
        
        const { error } = await supabase
            .from('master_parties')
            .update(updateData)
            .eq('id', id);
        
        if (error) throw error;
        
        res.json({ success: true, message: 'Party updated successfully' });
    } catch (error) {
        console.error('Update party error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== RESET ALL DATA ====================
app.delete('/api/reset', async (req, res) => {
    try {
        // Delete all transaction data (keep master data)
        await supabase.from('stock_in').delete().neq('id', '0');
        await supabase.from('orders').delete().neq('id', '0');
        await supabase.from('settlements').delete().neq('id', '0');
        
        res.json({ success: true, message: 'All transaction data has been reset. Master data preserved.' });
    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== COMPLETE RESET (Including Master Data) ====================
app.delete('/api/reset/all', async (req, res) => {
    try {
        // Delete ALL data
        await supabase.from('stock_in').delete().neq('id', '0');
        await supabase.from('orders').delete().neq('id', '0');
        await supabase.from('settlements').delete().neq('id', '0');
        await supabase.from('master_items').delete().neq('id', '0');
        await supabase.from('master_parties').delete().neq('id', '0');
        
        // Re-insert default data
        const defaultItems = [
            { id: '1', name: 'Product A', weight: 1 },
            { id: '2', name: 'Product B', weight: 0.5 },
            { id: '3', name: 'Product C', weight: 2 }
        ];
        const defaultParties = [
            { id: '1', name: 'Walk-In', role: 'Client' },
            { id: '2', name: 'ABC Corp', role: 'Client' },
            { id: '3', name: 'XYZ Supplies', role: 'Supplier' }
        ];
        
        await supabase.from('master_items').insert(defaultItems);
        await supabase.from('master_parties').insert(defaultParties);
        
        res.json({ success: true, message: 'Complete reset performed. Default data restored.' });
    } catch (error) {
        console.error('Complete reset error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==================== 404 HANDLER ====================
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        requested: req.originalUrl
    });
});

// ==================== LOCAL DEVELOPMENT ====================
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
        console.log(`📦 Stock endpoint: POST http://localhost:${PORT}/api/stock`);
        console.log(`🛒 Orders endpoint: POST http://localhost:${PORT}/api/orders`);
        console.log(`💰 Payments endpoint: POST http://localhost:${PORT}/api/payments`);
        console.log(`💵 Sales endpoint: POST http://localhost:${PORT}/api/sales`);
        console.log(`📜 History endpoint: GET http://localhost:${PORT}/api/history`);
        console.log(`📈 Dashboard endpoint: GET http://localhost:${PORT}/api/dashboard`);
    });
}

const serverless = require('serverless-http');
module.exports = serverless(app);