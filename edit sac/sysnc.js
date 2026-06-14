// public/sync.js - Sync service for offline/online coordination
import { 
    getPendingSync, 
    removeFromSyncQueue,
    initOfflineDB,
    cacheItems,
    cacheParties,
    cacheTransaction
} from './db-offline.js';

const API_BASE = 'http://localhost:3001';

// Sync pending items when online
export async function syncPendingData() {
    const pending = await getPendingSync();
    
    if (pending.length === 0) {
        console.log('📭 No pending items to sync');
        return { synced: 0, failed: 0 };
    }
    
    console.log(`🔄 Syncing ${pending.length} pending items...`);
    
    let synced = 0;
    let failed = 0;
    
    for (const item of pending) {
        try {
            const response = await fetch(`${API_BASE}${item.endpoint}`, {
                method: item.method,
                headers: { 'Content-Type': 'application/json' },
                body: item.body
            });
            
            if (response.ok) {
                await removeFromSyncQueue(item.id);
                synced++;
                console.log(`✅ Synced: ${item.endpoint}`);
            } else {
                failed++;
                console.warn(`⚠️ Failed to sync: ${item.endpoint} (${response.status})`);
            }
        } catch (error) {
            failed++;
            console.error(`❌ Sync error for ${item.endpoint}:`, error);
        }
    }
    
    console.log(`📊 Sync complete: ${synced} succeeded, ${failed} failed`);
    return { synced, failed };
}

// Cache fresh data from API
export async function refreshCache() {
    try {
        // Fetch and cache items
        const itemsRes = await fetch(`${API_BASE}/api/items`);
        const itemsData = await itemsRes.json();
        if (itemsData.success) {
            await cacheItems(itemsData.data);
            console.log(`📦 Cached ${itemsData.data.length} items`);
        }
        
        // Fetch and cache parties
        const partiesRes = await fetch(`${API_BASE}/api/parties`);
        const partiesData = await partiesRes.json();
        if (partiesData.success) {
            await cacheParties(partiesData.data);
            console.log(`👥 Cached ${partiesData.data.length} parties`);
        }
        
        // Fetch and cache recent history
        const historyRes = await fetch(`${API_BASE}/api/history?limit=200`);
        const historyData = await historyRes.json();
        if (historyData.success) {
            for (const tx of historyData.data) {
                if (tx.type === 'stock_in') {
                    await cacheTransaction('stockIn', tx);
                } else if (tx.type === 'order') {
                    await cacheTransaction('orders', tx);
                } else if (tx.type === 'payment') {
                    await cacheTransaction('payments', tx);
                }
            }
            console.log(`📜 Cached ${historyData.data.length} transactions`);
        }
        
        return { success: true };
    } catch (error) {
        console.error('Failed to refresh cache:', error);
        return { success: false, error: error.message };
    }
}

// Universal save function (works offline/online)
export async function saveWithOfflineSupport(endpoint, method, body, storeName = null, transactionId = null) {
    const isOnline = navigator.onLine;
    
    if (isOnline) {
        try {
            // Try to save online
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Cache the successful transaction locally
                if (storeName && result.data) {
                    await cacheTransaction(storeName, result.data);
                }
                
                return { success: true, online: true, data: result.data, message: 'Saved to cloud' };
            } else {
                // If API fails, queue for later
                const { addToSyncQueue } = await import('./db-offline.js');
                await addToSyncQueue(endpoint, method, body);
                
                // Still save locally
                if (storeName && transactionId) {
                    await cacheTransaction(storeName, { id: transactionId, ...body, synced: false });
                }
                
                return { success: true, online: false, queued: true, message: 'Saved locally (will sync later)' };
            }
        } catch (error) {
            // Network error - queue for later
            const { addToSyncQueue } = await import('./db-offline.js');
            await addToSyncQueue(endpoint, method, body);
            
            if (storeName && transactionId) {
                await cacheTransaction(storeName, { id: transactionId, ...body, synced: false });
            }
            
            return { success: true, online: false, queued: true, message: 'Saved locally (will sync when online)' };
        }
    } else {
        // Offline - queue for later
        const { addToSyncQueue } = await import('./db-offline.js');
        await addToSyncQueue(endpoint, method, body);
        
        if (storeName && transactionId) {
            await cacheTransaction(storeName, { id: transactionId, ...body, synced: false });
        }
        
        return { success: true, online: false, queued: true, message: 'Offline: Saved locally, will sync when online' };
    }
}