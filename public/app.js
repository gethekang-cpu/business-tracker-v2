// app.js - Business Tracker (FINAL PRODUCTION READY)
import { initOfflineDB, getCachedItems, getCachedParties, addConnectivityListeners, addToSyncQueue, cacheTransaction } from './db-offline.js';
import { syncPendingData } from './sync.js';


const API_BASE = 'https://kuyu-business-tracker-001.vercel.app';

// ==================== GLOBAL VARIABLES ====================
let currentMode = 'stock';
let isOnlineFlag = navigator.onLine;
let offlineReady = false;
let currentEditId = null;
let currentEditType = null;
let db = null;  // Store IndexedDB instance for offline history
let cachedHistoryData = null;  // Cache for single history fetch

// ==================== HELPER FUNCTIONS ====================
function safeFormat(value, decimals = 2) {
    return Number(value || 0).toFixed(decimals);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== HISTORY CACHE (Single Fetch) ====================
async function getHistoryData() {
    if (isOnlineFlag) {
        try {
            const response = await fetch(`${API_BASE}/api/history?limit=100`);
            const result = await response.json();
            if (result.success) {
                cachedHistoryData = result.data;
                return cachedHistoryData;
            }
        } catch (error) {
            console.log('Online history failed, trying cache');
        }
    }
    
    if (offlineReady && !cachedHistoryData) {
        cachedHistoryData = await loadHistoryFromCache();
    }
    return cachedHistoryData;
}

async function loadHistoryFromCache() {
    if (!offlineReady || !db) return [];
    try {
        const stockIn = await db.getAll('stockIn').catch(() => []);
        const orders = await db.getAll('orders').catch(() => []);
        const payments = await db.getAll('payments').catch(() => []);
        const sales = await db.getAll('sales').catch(() => []);
        
        const all = [
            ...(stockIn || []).map(t => ({ ...t, type: 'stock_in' })),
            ...(orders || []).map(t => ({ ...t, type: 'order' })),
            ...(payments || []).map(t => ({ ...t, type: 'payment' })),
            ...(sales || []).map(t => ({ ...t, type: 'sale' }))
        ];
        all.sort((a, b) => new Date(b.date) - new Date(a.date));
        return all;
    } catch (error) {
        console.error('Failed to load history from cache:', error);
        return [];
    }
}

// ==================== INITIALIZATION ====================
async function init() {
    console.log('🚀 Initializing Business Tracker...');
    
    try {
        db = await initOfflineDB();
        offlineReady = !!db;
        console.log(offlineReady ? '✅ Offline mode ready' : '⚠️ Running in online-only mode');
    } catch (error) {
        console.log('⚠️ Offline mode not available, running online-only');
        offlineReady = false;
    }
    
    if (offlineReady) {
        addConnectivityListeners(async (online) => {
            isOnlineFlag = online;
            updateConnectivityStatus(online);
            if (online) {
                console.log('🟢 Back online! Syncing data...');
                cachedHistoryData = null;  // Clear cache on reconnect
                await syncPendingData();
                await refreshAllDisplays();
                await loadMasterData();
            }
        });
    }
    
    const todayInput = document.getElementById('txtDate');
    if (todayInput) todayInput.value = new Date().toISOString().split('T')[0];
    
    await loadMasterData();
    await refreshAllDisplays();
    updateConnectivityStatus(isOnlineFlag);
    setupEventListeners();
    setupModalEventListeners();
    
    console.log('✅ Business Tracker Ready');
}

function updateConnectivityStatus(online) {
    let statusDiv = document.getElementById('onlineStatus');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'onlineStatus';
        statusDiv.style.position = 'fixed';
        statusDiv.style.bottom = '10px';
        statusDiv.style.right = '10px';
        statusDiv.style.background = online ? '#e8f5e9' : '#ffebee';
        statusDiv.style.padding = '6px 12px';
        statusDiv.style.borderRadius = '20px';
        statusDiv.style.fontSize = '11px';
        statusDiv.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        statusDiv.style.zIndex = '9999';
        document.body.appendChild(statusDiv);
    }
    statusDiv.innerHTML = online ? '🟢 Cloud Sync Active' : '🔴 Offline Mode - Will sync when online';
    statusDiv.style.background = online ? '#e8f5e9' : '#ffebee';
}

// ==================== LOAD MASTER DATA ====================
async function loadMasterData() {
    if (isOnlineFlag) {
        try {
            const itemsRes = await fetch(`${API_BASE}/api/items`);
            const itemsData = await itemsRes.json();
            if (itemsData.success) populateItems(itemsData.data);
            
            const partiesRes = await fetch(`${API_BASE}/api/parties`);
            const partiesData = await partiesRes.json();
            if (partiesData.success) populateParties(partiesData.data);
            return;
        } catch (error) {
            console.log('API unavailable, trying cache');
        }
    }
    
    if (offlineReady) {
        let items = await getCachedItems();
        let parties = await getCachedParties();
        if (items.length > 0) populateItems(items);
        if (parties.length > 0) populateParties(parties);
    }
}

function populateItems(items) {
    const select = document.getElementById('cmbItem');
    if (!select) return;
    select.innerHTML = '<option value="">Select Item</option>';
    items.forEach(item => {
        select.innerHTML += `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${item.weight}kg)</option>`;
    });
}

function populateParties(parties) {
    const role = currentMode === 'stock' ? 'Supplier' : 'Client';
    const filtered = parties.filter(p => p.role === role);
    const select = document.getElementById('cmbParty');
    if (!select) return;
    select.innerHTML = `<option value="">Select ${escapeHtml(role)}</option>`;
    filtered.forEach(party => {
        select.innerHTML += `<option value="${escapeHtml(party.name)}">${escapeHtml(party.name)}</option>`;
    });
}

// ==================== SUBMIT TRANSACTION ====================
async function submitTransaction() {
    const date = document.getElementById('txtDate')?.value || new Date().toISOString().split('T')[0];
    const party = document.getElementById('cmbParty')?.value;
    const item = document.getElementById('cmbItem')?.value;
    const quantity = parseFloat(document.getElementById('txtQuantity')?.value);
    const price = parseFloat(document.getElementById('txtPrice')?.value);
    const paymentRef = document.getElementById('txtPaymentRef')?.value;

    if (!party) {
        alert('Please select a party!');
        return;
    }

    let endpoint = '';
    let body = { date };
    let storeName = '';

    switch(currentMode) {
        case 'stock':
            if (!item || !quantity || !price) {
                alert('Please fill all fields!');
                return;
            }
            endpoint = '/api/stock';
            body = { ...body, supplier: party, item, quantity, costPerUnit: price };
            storeName = 'stockIn';
            break;
        case 'order':
            if (!item || !quantity || !price) {
                alert('Please fill all fields!');
                return;
            }
            endpoint = '/api/orders';
            body = { ...body, client: party, item, quantity, pricePerUnit: price, paymentRef };
            storeName = 'orders';
            break;
        case 'payment':
            if (!price) {
                alert('Please enter amount!');
                return;
            }
            endpoint = '/api/payments';
            body = { ...body, client: party, paymentAmount: price, paymentRef };
            storeName = 'payments';
            break;
        case 'sale':
            if (!item || !quantity || !price) {
                alert('Please fill all fields!');
                return;
            }
            endpoint = '/api/sales';
            body = { ...body, client: party, item, quantity, pricePerUnit: price };
            storeName = 'sales';
            break;
    }

    if (isOnlineFlag) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await response.json();
            if (result.success) {
                alert(result.message || 'Transaction recorded!');
                clearForm();
                cachedHistoryData = null;
                await refreshAllDisplays();
                await loadMasterData();
                return;
            }
        } catch (error) {
            console.log('Online save failed, falling back to offline');
        }
    }
    
    // Offline fallback - Normalize field names to match API response format
    if (offlineReady) {
        const transactionId = Date.now().toString();
        
        let normalizedBody = { ...body, id: transactionId };
        
        // Convert camelCase to snake_case for offline storage
        if (normalizedBody.costPerUnit) {
            normalizedBody.cost_per_unit = normalizedBody.costPerUnit;
            delete normalizedBody.costPerUnit;
        }
        if (normalizedBody.pricePerUnit) {
            normalizedBody.price_per_unit = normalizedBody.pricePerUnit;
            delete normalizedBody.pricePerUnit;
        }
        if (normalizedBody.paymentAmount) {
            normalizedBody.payment_amount = normalizedBody.paymentAmount;
            delete normalizedBody.paymentAmount;
        }
        
        await addToSyncQueue(endpoint, 'POST', body);
        await cacheTransaction(storeName, normalizedBody);
        
        alert('📱 Saved locally! Will sync to cloud when online.');
        clearForm();
        cachedHistoryData = null;
        await refreshAllDisplays();
    } else {
        alert('Failed to save. Please check your connection.');
    }
}

function clearForm() {
    const qtyInput = document.getElementById('txtQuantity');
    const priceInput = document.getElementById('txtPrice');
    const refInput = document.getElementById('txtPaymentRef');
    if (qtyInput) qtyInput.value = '1';
    if (priceInput) priceInput.value = '';
    if (refInput) refInput.value = '';
}

// ==================== DASHBOARD DATA ====================
async function getDashboardData() {
    try {
        const response = await fetch(`${API_BASE}/api/dashboard`);
        const result = await response.json();
        if (result.success) return result.data;
    } catch (error) {
        console.error('Failed to fetch dashboard:', error);
    }
    return null;
}

// ==================== REFRESH DISPLAYS ====================
async function refreshAllDisplays() {
    const dashboardData = await getDashboardData();
    if (dashboardData) {
        refreshStockDisplayWithData(dashboardData);
        refreshClientDisplayWithData(dashboardData);
        refreshInsightsDisplayWithData(dashboardData);
    }
    await refreshStockHistory();
    await refreshOrderHistory();
    await refreshPaymentHistory();
}

function refreshStockDisplayWithData(data) {
    const tbody = document.getElementById('stockList');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.inventory) {
        data.inventory.forEach(item => {
            if (item.balance > 0) {
                const row = tbody.insertRow();
                row.insertCell(0).innerText = escapeHtml(item.item);
                row.insertCell(1).innerText = item.stock_in;
                row.insertCell(2).innerText = item.stock_out || 0;
                row.insertCell(3).innerText = item.balance;
                row.insertCell(4).innerText = '-';
            }
        });
    }
}

function refreshClientDisplayWithData(data) {
    const tbody = document.getElementById('clientList');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.clients) {
        data.clients.forEach(client => {
            const row = tbody.insertRow();
            row.insertCell(0).innerText = escapeHtml(client.name);
            row.insertCell(1).innerText = safeFormat(client.total_orders);
            row.insertCell(2).innerText = safeFormat(client.total_payments);
            row.insertCell(3).innerText = safeFormat(client.balance);
            row.insertCell(4).innerHTML = client.balance > 0 ? 
                '<span style="color:#dc3545">Owing</span>' : 
                client.balance < 0 ?
                '<span style="color:#28a745">Credit</span>' :
                '<span style="color:#6c757d">Settled</span>';
        });
    }
}

function refreshInsightsDisplayWithData(data) {
    const tbody = document.getElementById('insightList');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.summary) {
        const s = data.summary;
        const metrics = [
            { label: 'Total Sales', value: safeFormat(s.total_sales) },
            { label: 'Total Payments', value: safeFormat(s.total_payments) },
            { label: 'Outstanding Debt', value: safeFormat(s.outstanding_debt) },
            { label: 'Total Orders', value: s.total_orders || 0 }
        ];
        metrics.forEach(m => {
            const row = tbody.insertRow();
            row.insertCell(0).innerText = m.label;
            row.insertCell(1).innerHTML = `<strong>${m.value}</strong>`;
        });
    }
}

// ==================== HISTORY DISPLAYS (Single Fetch) ====================
async function refreshStockHistory() {
    const historyData = await getHistoryData();
    if (!historyData) return;
    
    const filter = document.getElementById('filterStock')?.value.toLowerCase() || '';
    const stockTx = historyData.filter(t => t.type === 'stock_in');
    const filtered = stockTx.filter(t => 
        (t.item && t.item.toLowerCase().includes(filter)) ||
        (t.supplier && t.supplier.toLowerCase().includes(filter))
    );
    const tbody = document.getElementById('stockHistoryList');
    if (!tbody) return;
    tbody.innerHTML = '';
    filtered.forEach(t => {
        const row = tbody.insertRow();
        row.insertCell(0).innerHTML = `<code>${escapeHtml(t.id?.slice(-8) || '-')}</code>`;
        row.insertCell(1).innerText = t.date || '-';
        row.insertCell(2).innerText = escapeHtml(t.supplier || '-');
        row.insertCell(3).innerText = escapeHtml(t.item || '-');
        row.insertCell(4).innerText = t.quantity || 0;
        row.insertCell(5).innerText = safeFormat(t.cost_per_unit);
        row.insertCell(6).innerText = safeFormat(t.total_cost);
        row.insertCell(7).innerHTML = `<button class="edit-btn" onclick="window.editTransaction('stock', '${t.id}')">✎</button> <button class="delete-btn" onclick="window.deleteTransaction('stock', '${t.id}')">🗑</button>`;
    });
}

async function refreshOrderHistory() {
    const historyData = await getHistoryData();
    if (!historyData) return;
    
    const filter = document.getElementById('filterOrder')?.value.toLowerCase() || '';
    const orderTx = historyData.filter(t => t.type === 'order');
    const filtered = orderTx.filter(t => 
        (t.item && t.item.toLowerCase().includes(filter)) ||
        (t.client && t.client.toLowerCase().includes(filter))
    );
    const tbody = document.getElementById('orderHistoryList');
    if (!tbody) return;
    tbody.innerHTML = '';
    filtered.forEach(t => {
        const row = tbody.insertRow();
        row.insertCell(0).innerHTML = `<code>${escapeHtml(t.id?.slice(-8) || '-')}</code>`;
        row.insertCell(1).innerText = t.date || '-';
        row.insertCell(2).innerText = escapeHtml(t.client || '-');
        row.insertCell(3).innerText = escapeHtml(t.item || '-');
        row.insertCell(4).innerText = t.quantity || 0;
        row.insertCell(5).innerText = safeFormat(t.price_per_unit);
        row.insertCell(6).innerText = safeFormat(t.order_value);
        row.insertCell(7).innerText = escapeHtml(t.payment_ref || '-');
        row.insertCell(8).innerHTML = `<button class="edit-btn" onclick="window.editTransaction('order', '${t.id}')">✎</button> <button class="delete-btn" onclick="window.deleteTransaction('order', '${t.id}')">🗑</button>`;
    });
}

async function refreshPaymentHistory() {
    const historyData = await getHistoryData();
    if (!historyData) return;
    
    const filter = document.getElementById('filterPayment')?.value.toLowerCase() || '';
    const paymentTx = historyData.filter(t => t.type === 'payment');
    const filtered = paymentTx.filter(t => 
        (t.client && t.client.toLowerCase().includes(filter)) ||
        (t.payment_ref && t.payment_ref.toLowerCase().includes(filter))
    );
    const tbody = document.getElementById('paymentHistoryList');
    if (!tbody) return;
    tbody.innerHTML = '';
    filtered.forEach(t => {
        const row = tbody.insertRow();
        row.insertCell(0).innerHTML = `<code>${escapeHtml(t.id?.slice(-8) || '-')}</code>`;
        row.insertCell(1).innerText = t.date || '-';
        row.insertCell(2).innerText = escapeHtml(t.client || '-');
        row.insertCell(3).innerText = escapeHtml(t.payment_ref || '-');
        row.insertCell(4).innerText = safeFormat(t.payment_amount);
        row.insertCell(5).innerHTML = `<button class="edit-btn" onclick="window.editTransaction('payment', '${t.id}')">✎</button> <button class="delete-btn" onclick="window.deleteTransaction('payment', '${t.id}')">🗑</button>`;
    });
}

async function filterStockHistory() { await refreshStockHistory(); }
async function filterOrderHistory() { await refreshOrderHistory(); }
async function filterPaymentHistory() { await refreshPaymentHistory(); }

// ==================== EDIT/DELETE TRANSACTIONS ====================
window.editTransaction = async (type, id) => {
    currentEditType = type;
    currentEditId = id;
    
    const historyData = await getHistoryData();
    const transaction = historyData?.find(t => t.id === id);
    
    if (!transaction) {
        alert('Transaction not found!');
        return;
    }
    
    document.getElementById('modalTitle').innerText = `Edit ${type.toUpperCase()} Transaction`;
    
    let html = '';
    if (type === 'stock') {
        html = `
            <div class="transaction-detail-row"><label>ID:</label><span><code>${escapeHtml(transaction.id)}</code></span></div>
            <div class="transaction-detail-row"><label>Date:</label><input type="date" id="editDate" value="${transaction.date}"></div>
            <div class="transaction-detail-row"><label>Supplier:</label><input type="text" id="editParty" value="${escapeHtml(transaction.supplier)}"></div>
            <div class="transaction-detail-row"><label>Item:</label><input type="text" id="editItem" value="${escapeHtml(transaction.item)}"></div>
            <div class="transaction-detail-row"><label>Quantity:</label><input type="number" id="editQty" step="0.01" value="${transaction.quantity}"></div>
            <div class="transaction-detail-row"><label>Cost/Unit:</label><input type="number" id="editPrice" step="0.01" value="${transaction.cost_per_unit}"></div>
        `;
    } else if (type === 'order') {
        html = `
            <div class="transaction-detail-row"><label>ID:</label><span><code>${escapeHtml(transaction.id)}</code></span></div>
            <div class="transaction-detail-row"><label>Date:</label><input type="date" id="editDate" value="${transaction.date}"></div>
            <div class="transaction-detail-row"><label>Client:</label><input type="text" id="editParty" value="${escapeHtml(transaction.client)}"></div>
            <div class="transaction-detail-row"><label>Item:</label><input type="text" id="editItem" value="${escapeHtml(transaction.item)}"></div>
            <div class="transaction-detail-row"><label>Quantity:</label><input type="number" id="editQty" step="0.01" value="${transaction.quantity}"></div>
            <div class="transaction-detail-row"><label>Price/Unit:</label><input type="number" id="editPrice" step="0.01" value="${transaction.price_per_unit}"></div>
            <div class="transaction-detail-row"><label>Payment Ref:</label><input type="text" id="editRef" value="${escapeHtml(transaction.payment_ref || '')}"></div>
        `;
    } else if (type === 'payment') {
        html = `
            <div class="transaction-detail-row"><label>ID:</label><span><code>${escapeHtml(transaction.id)}</code></span></div>
            <div class="transaction-detail-row"><label>Date:</label><input type="date" id="editDate" value="${transaction.date}"></div>
            <div class="transaction-detail-row"><label>Client:</label><input type="text" id="editParty" value="${escapeHtml(transaction.client)}"></div>
            <div class="transaction-detail-row"><label>Payment Ref:</label><input type="text" id="editRef" value="${escapeHtml(transaction.payment_ref || '')}"></div>
            <div class="transaction-detail-row"><label>Amount:</label><input type="number" id="editAmount" step="0.01" value="${transaction.payment_amount}"></div>
        `;
    }
    
    document.getElementById('editFormContent').innerHTML = html;
    document.getElementById('editModal').style.display = 'flex';
};

window.deleteTransaction = async (type, id) => {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    
    let endpoint = '';
    if (type === 'stock') endpoint = `/api/stock/${id}`;
    else if (type === 'order') endpoint = `/api/orders/${id}`;
    else if (type === 'payment') endpoint = `/api/payments/${id}`;
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            alert('Transaction deleted successfully!');
            await refreshAllDisplays();
        } else {
            alert('Error: ' + (result.error || 'Delete failed'));
        }
    } catch (error) {
        alert('Failed to delete: ' + error.message);
    }
};

async function saveEdit() {
    const type = currentEditType;
    const id = currentEditId;
    
    let endpoint = '';
    let body = {};
    
    if (type === 'stock') {
        endpoint = `/api/stock/${id}`;
        body = {
            date: document.getElementById('editDate').value,
            supplier: document.getElementById('editParty').value,
            item: document.getElementById('editItem').value,
            quantity: parseFloat(document.getElementById('editQty').value),
            costPerUnit: parseFloat(document.getElementById('editPrice').value)
        };
    } else if (type === 'order') {
        endpoint = `/api/orders/${id}`;
        body = {
            date: document.getElementById('editDate').value,
            client: document.getElementById('editParty').value,
            item: document.getElementById('editItem').value,
            quantity: parseFloat(document.getElementById('editQty').value),
            pricePerUnit: parseFloat(document.getElementById('editPrice').value),
            paymentRef: document.getElementById('editRef')?.value || ''
        };
    } else if (type === 'payment') {
        endpoint = `/api/payments/${id}`;
        body = {
            date: document.getElementById('editDate').value,
            client: document.getElementById('editParty').value,
            paymentRef: document.getElementById('editRef')?.value || '',
            paymentAmount: parseFloat(document.getElementById('editAmount').value)
        };
    }
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        
        if (result.success) {
            alert('Transaction updated successfully!');
            closeEditModal();
            await refreshAllDisplays();
        } else {
            alert('Error: ' + (result.error || 'Update failed'));
        }
    } catch (error) {
        alert('Failed to update: ' + error.message);
    }
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    currentEditId = null;
    currentEditType = null;
}

// ==================== MASTER EDIT ====================
function editMaster() {
    document.getElementById('editMasterModal').style.display = 'flex';
}

function closeMasterModal() {
    document.getElementById('editMasterModal').style.display = 'none';
}

async function saveMasterEdit() {
    const type = document.getElementById('editMasterType').value;
    const oldValue = document.getElementById('editOldValue').value;
    const newValue = document.getElementById('editNewValue').value;
    
    if (!oldValue || !newValue) {
        alert('Please fill both fields');
        return;
    }
    
    // Find the item/party by name
    let endpoint = '';
    let id = null;
    
    if (type === 'product') {
        const weight = document.getElementById('editWeight').value;
        const itemsRes = await fetch(`${API_BASE}/api/items`);
        const itemsData = await itemsRes.json();
        const item = itemsData.data.find(i => i.name === oldValue);
        if (!item) {
            alert('Item not found');
            return;
        }
        id = item.id;
        endpoint = `/api/items/${id}`;
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newValue, weight: parseFloat(weight) })
        });
        const result = await response.json();
        if (result.success) {
            alert('Product updated successfully!');
            closeMasterModal();
            await loadMasterData();
        } else {
            alert('Error: ' + (result.error || 'Update failed'));
        }
    } else {
        // Client or Supplier
        const role = type === 'client' ? 'Client' : 'Supplier';
        const partiesRes = await fetch(`${API_BASE}/api/parties`);
        const partiesData = await partiesRes.json();
        const party = partiesData.data.find(p => p.name === oldValue && p.role === role);
        if (!party) {
            alert('Party not found');
            return;
        }
        id = party.id;
        endpoint = `/api/parties/${id}`;
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newValue })
        });
        const result = await response.json();
        if (result.success) {
            alert('Party updated successfully!');
            closeMasterModal();
            await loadMasterData();
        } else {
            alert('Error: ' + (result.error || 'Update failed'));
        }
    }
}
// ==================== RESET & CLOSE ====================
async function resetAllData() {
    if (!confirm('⚠️ WARNING: This will DELETE ALL transaction data!\nType "DELETE" to confirm:')) return;
    const confirmText = prompt('Type "DELETE" to confirm:');
    if (confirmText !== 'DELETE') {
        alert('Reset cancelled');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/reset`, {
            method: 'DELETE'
        });
        const result = await response.json();
        
        if (result.success) {
            alert('All transaction data has been reset!');
            await refreshAllDisplays();
        } else {
            alert('Error: ' + (result.error || 'Reset failed'));
        }
    } catch (error) {
        alert('Failed to reset: ' + error.message);
    }
}

function closeApp() {
    alert('Please close this tab manually to exit Business Tracker.');
}

// ==================== STATEMENT & EXPORT ====================
async function generateStatement() {
    const client = prompt('Enter client name:');
    if (!client) return;
    try {
        const response = await fetch(`${API_BASE}/api/statement?client=${encodeURIComponent(client)}`);
        const result = await response.json();
        if (result.success) {
            const s = result.data.summary;
            alert(`Client: ${client}\nTotal Orders: ${safeFormat(s.total_orders)}\nTotal Payments: ${safeFormat(s.total_payments)}\nBalance: ${safeFormat(s.outstanding_balance)}\nStatus: ${s.status}`);
        } else {
            alert('No data found for this client');
        }
    } catch (error) {
        alert('Failed to generate statement');
    }
}

async function exportData() {
    try {
        const response = await fetch(`${API_BASE}/api/history?limit=1000`);
        const result = await response.json();
        const dataStr = JSON.stringify(result, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `business_data_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert('Data exported!');
    } catch (error) {
        alert('Failed to export data');
    }
}

// ==================== ADD NEW PARTY/PRODUCT (With Offline Queue) ====================
async function addNewProduct() {
    const name = prompt('Enter product name:');
    if (!name || name.trim() === '') return;
    
    const weight = prompt('Enter weight in KG:');
    if (!weight || isNaN(weight)) {
        alert('Invalid weight!');
        return;
    }
    
    const productData = { name: name.trim(), weight: parseFloat(weight) };
    
    if (isOnlineFlag) {
        try {
            const response = await fetch(`${API_BASE}/api/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData)
            });
            const result = await response.json();
            if (result.success) {
                alert('Product added successfully!');
                await loadMasterData();
                return;
            }
        } catch (error) {
            console.log('Online add failed, falling back to offline');
        }
    }
    
    if (offlineReady) {
        await addToSyncQueue('/api/items', 'POST', productData);
        const newId = Date.now().toString();
        if (db) {
            try {
                await cacheTransaction('masterItems', { id: newId, ...productData });
            } catch(e) { console.log('Cache failed'); }
        }
        alert('📱 Product saved locally! Will sync to cloud when online.');
        await loadMasterData();
    } else {
        alert('Failed to add product. Please check your connection.');
    }
}

async function addNewParty() {
    const role = currentMode === 'stock' ? 'Supplier' : 'Client';
    const name = prompt(`Enter new ${role} name:`);
    if (!name || name.trim() === '') return;
    
    const partyData = { name: name.trim(), role: role };
    
    if (isOnlineFlag) {
        try {
            const response = await fetch(`${API_BASE}/api/parties`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(partyData)
            });
            const result = await response.json();
            if (result.success) {
                alert(`${role} added successfully!`);
                await loadMasterData();
                return;
            }
        } catch (error) {
            console.log('Online add failed, falling back to offline');
        }
    }
    
    if (offlineReady) {
        await addToSyncQueue('/api/parties', 'POST', partyData);
        const newId = Date.now().toString();
        if (db) {
            try {
                await cacheTransaction('masterParties', { id: newId, ...partyData });
            } catch(e) { console.log('Cache failed'); }
        }
        alert(`📱 ${role} saved locally! Will sync to cloud when online.`);
        await loadMasterData();
    } else {
        alert('Failed to add party. Please check your connection.');
    }
}

// ==================== MODE SWITCHING ====================
function setMode(mode) {
    currentMode = mode;
    const formTitle = document.getElementById('formTitle');
    const partyLabel = document.getElementById('partyLabel');
    const qtyLabel = document.getElementById('qtyLabel');
    const priceLabel = document.getElementById('priceLabel');
    const cmbItem = document.getElementById('cmbItem');
    
    const qtyGroup = document.getElementById('txtQuantity')?.parentElement?.parentElement;
    if (qtyGroup) qtyGroup.style.display = 'flex';
    
    if (!formTitle) return;
    
    switch(mode) {
        case 'stock':
            formTitle.innerText = '📦 Stock In Entry';
            partyLabel.innerText = 'Supplier:';
            qtyLabel.innerText = 'Quantity:';
            priceLabel.innerText = 'Cost per Unit:';
            if (cmbItem) cmbItem.disabled = false;
            break;
        case 'order':
            formTitle.innerText = '🛒 Order Entry';
            partyLabel.innerText = 'Client:';
            qtyLabel.innerText = 'Quantity:';
            priceLabel.innerText = 'Price per Unit:';
            if (cmbItem) cmbItem.disabled = false;
            break;
        case 'payment':
            formTitle.innerText = '💰 Payment Entry';
            partyLabel.innerText = 'Client:';
            qtyLabel.innerText = 'Reference:';
            priceLabel.innerText = 'Amount:';
            if (cmbItem) {
                cmbItem.disabled = true;
                cmbItem.value = '';
            }
            if (qtyGroup) qtyGroup.style.display = 'none';
            break;
        case 'sale':
            formTitle.innerText = '💵 Cash Sale';
            partyLabel.innerText = 'Client:';
            qtyLabel.innerText = 'Quantity:';
            priceLabel.innerText = 'Price per Unit:';
            if (cmbItem) cmbItem.disabled = false;
            break;
    }
    loadMasterData();
    clearForm();
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setMode(btn.dataset.mode);
        });
    });
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const mode = item.dataset.mode;
            if (mode === 'insights') {
                document.querySelector('.dashboard')?.scrollIntoView({ behavior: 'smooth' });
                return;
            }
            const modeBtn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
            if (modeBtn) modeBtn.click();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });
    
    const btnSubmit = document.getElementById('btnSubmit');
    if (btnSubmit) btnSubmit.addEventListener('click', submitTransaction);
    
    const btnStatement = document.getElementById('btnStatement');
    if (btnStatement) btnStatement.addEventListener('click', generateStatement);
    
    const btnExport = document.getElementById('btnExportData');
    if (btnExport) btnExport.addEventListener('click', exportData);
    
    const btnNewParty = document.getElementById('btnNewParty');
    if (btnNewParty) btnNewParty.addEventListener('click', addNewParty);
    
    const btnAddProduct = document.getElementById('btnAddProduct');
    if (btnAddProduct) btnAddProduct.addEventListener('click', addNewProduct);
    
    const btnEditMaster = document.getElementById('btnEditMaster');
    if (btnEditMaster) btnEditMaster.addEventListener('click', editMaster);
    
    const btnResetAll = document.getElementById('btnResetAll');
    if (btnResetAll) btnResetAll.addEventListener('click', resetAllData);
    
    const btnClose = document.getElementById('btnClose');
    if (btnClose) btnClose.addEventListener('click', closeApp);
    
    const refreshStock = document.getElementById('refreshStock');
    if (refreshStock) refreshStock.addEventListener('click', async () => {
        const data = await getDashboardData();
        if (data) refreshStockDisplayWithData(data);
    });
    
    const refreshClients = document.getElementById('refreshClients');
    if (refreshClients) refreshClients.addEventListener('click', async () => {
        const data = await getDashboardData();
        if (data) refreshClientDisplayWithData(data);
    });
    
    const refreshInsights = document.getElementById('refreshInsights');
    if (refreshInsights) refreshInsights.addEventListener('click', async () => {
        const data = await getDashboardData();
        if (data) refreshInsightsDisplayWithData(data);
    });
    
    const refreshStockHistoryBtn = document.getElementById('refreshStockHistory');
    if (refreshStockHistoryBtn) refreshStockHistoryBtn.addEventListener('click', refreshStockHistory);
    
    const refreshOrderHistoryBtn = document.getElementById('refreshOrderHistory');
    if (refreshOrderHistoryBtn) refreshOrderHistoryBtn.addEventListener('click', refreshOrderHistory);
    
    const refreshPaymentHistoryBtn = document.getElementById('refreshPaymentHistory');
    if (refreshPaymentHistoryBtn) refreshPaymentHistoryBtn.addEventListener('click', refreshPaymentHistory);
    
    const filterStock = document.getElementById('filterStock');
    if (filterStock) filterStock.addEventListener('input', filterStockHistory);
    
    const filterOrder = document.getElementById('filterOrder');
    if (filterOrder) filterOrder.addEventListener('input', filterOrderHistory);
    
    const filterPayment = document.getElementById('filterPayment');
    if (filterPayment) filterPayment.addEventListener('input', filterPaymentHistory);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            const activeTab = document.getElementById(tabId);
            if (activeTab) activeTab.classList.add('active');
            if (tabId === 'stock-tab') refreshStockHistory();
            if (tabId === 'order-tab') refreshOrderHistory();
            if (tabId === 'payment-tab') refreshPaymentHistory();
        });
    });
}

function setupModalEventListeners() {
    const editModalCloseBtn = document.querySelector('#editModal .close');
    if (editModalCloseBtn) editModalCloseBtn.addEventListener('click', closeEditModal);
    
    const masterModalCloseBtn = document.querySelector('#editMasterModal .close-master');
    if (masterModalCloseBtn) masterModalCloseBtn.addEventListener('click', closeMasterModal);
    
    const saveEditBtn = document.getElementById('saveEdit');
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEdit);
    
    const saveMasterEditBtn = document.getElementById('saveMasterEdit');
    if (saveMasterEditBtn) saveMasterEditBtn.addEventListener('click', saveMasterEdit);

    
    const cancelMasterEdit = document.getElementById('cancelMasterEdit');
    if (cancelMasterEdit) cancelMasterEdit.addEventListener('click', closeMasterModal);

    
    
    window.addEventListener('click', (e) => {
        const editModal = document.getElementById('editModal');
        const masterModal = document.getElementById('editMasterModal');
        if (e.target === editModal) closeEditModal();
        if (e.target === masterModal) closeMasterModal();
    });
    
    const editMasterType = document.getElementById('editMasterType');
    if (editMasterType) {
        editMasterType.addEventListener('change', (e) => {
            const weightField = document.getElementById('editWeight');
            const roleField = document.getElementById('editRole');
            if (e.target.value === 'product') {
                if (weightField) weightField.style.display = 'block';
                if (roleField) roleField.style.display = 'none';
            } else {
                if (weightField) weightField.style.display = 'none';
                if (roleField) roleField.style.display = 'block';
            }
        });
    
    
    }
}

// Make functions available globally for onclick handlers
window.editTransaction = window.editTransaction;
window.deleteTransaction = window.deleteTransaction;

// ==================== START APP ====================
init();