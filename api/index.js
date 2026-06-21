// api/index.js - Complete working API
const express = require('express');
const cors = require('cors');
const { supabase } = require('./db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'API is running'
    });
});

// Stock endpoint
app.post('/api/stock', async (req, res) => {
    try {
        const { date, supplier, item, quantity, costPerUnit } = req.body;
        
        if (!supplier || !item || !quantity || !costPerUnit) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
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
        res.json({ success: true, data: data[0], message: 'Stock recorded' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Orders endpoint
app.post('/api/orders', async (req, res) => {
    try {
        const { date, client, item, quantity, pricePerUnit, paymentRef } = req.body;
        
        if (!client || !item || !quantity || !pricePerUnit) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
        }
        
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

// Payments endpoint
app.post('/api/payments', async (req, res) => {
    try {
        const { date, client, paymentAmount, paymentRef } = req.body;
        
        if (!client || !paymentAmount) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
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

// Sales endpoint
app.post('/api/sales', async (req, res) => {
    try {
        const { date, client, item, quantity, pricePerUnit } = req.body;
        
        if (!client || !item || !quantity || !pricePerUnit) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
        }
        
        const orderId = Date.now().toString();
        const paymentId = (Date.now() + 1).toString();
        const orderValue = quantity * pricePerUnit;
        const saleDate = date || new Date().toISOString().split('T')[0];
        const ref = `SALE-${orderId.slice(-8)}`;
        
        await supabase.from('orders').insert([{
            id: orderId, date: saleDate, client, item,
            quantity, price_per_unit: pricePerUnit,
            order_value: orderValue, payment_ref: ref
        }]);
        
        await supabase.from('settlements').insert([{
            id: paymentId, date: saleDate, client,
            payment_ref: ref, payment_amount: orderValue
        }]);
        
        res.json({ success: true, message: 'Cash sale recorded', data: { order_id: orderId, amount: orderValue } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// History endpoint
app.get('/api/history', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const parsedLimit = parseInt(limit);
        
        const { data: stock } = await supabase
            .from('stock_in')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        const { data: orders } = await supabase
            .from('orders')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        const { data: payments } = await supabase
            .from('settlements')
            .select('*')
            .order('date', { ascending: false })
            .limit(parsedLimit);
        
        const all = [
            ...(stock || []).map(t => ({ ...t, type: 'stock_in' })),
            ...(orders || []).map(t => ({ ...t, type: 'order' })),
            ...(payments || []).map(t => ({ ...t, type: 'payment' }))
        ];
        all.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        res.json({ success: true, data: all.slice(0, parsedLimit) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dashboard endpoint
app.get('/api/dashboard', async (req, res) => {
    try {
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
                stockLevels[o.item].out += o.quantity;
            }
        });
        
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

// Items endpoint
app.get('/api/items', async (req, res) => {
    try {
        const { data, error } = await supabase.from('master_items').select('*').order('name');
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Parties endpoint
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

// Delete endpoints
app.delete('/api/stock/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('stock_in').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Stock entry deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Order deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/payments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('settlements').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Payment deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update endpoints
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
        const { error } = await supabase.from('stock_in').update(updateData).eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Stock entry updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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
        const { error } = await supabase.from('orders').update(updateData).eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Order updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/payments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, client, paymentRef, paymentAmount } = req.body;
        const updateData = {};
        if (date) updateData.date = date;
        if (client) updateData.client = client;
        if (paymentRef !== undefined) updateData.payment_ref = paymentRef;
        if (paymentAmount) updateData.payment_amount = paymentAmount;
        const { error } = await supabase.from('settlements').update(updateData).eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Payment updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset endpoint
app.delete('/api/reset', async (req, res) => {
    try {
        await supabase.from('stock_in').delete().neq('id', '0');
        await supabase.from('orders').delete().neq('id', '0');
        await supabase.from('settlements').delete().neq('id', '0');
        res.json({ success: true, message: 'Transaction data reset. Master data preserved.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export for Vercel
const serverless = require('serverless-http');

// Start server locally
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    });
}

module.exports = serverless(app);