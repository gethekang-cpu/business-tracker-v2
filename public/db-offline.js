// public/db-offline.js - Clean version using local idb
import { openDB } from '../lib/idb.js';

let db = null;

// Initialize offline database
export async function initOfflineDB() {
    try {
        db = await openDB('BusinessTrackerOffline', 1, {
            upgrade(upgradeDb) {
                // Pending sync queue
                if (!upgradeDb.objectStoreNames.contains('pendingSync')) {
                    const pendingStore = upgradeDb.createObjectStore('pendingSync', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    pendingStore.createIndex('endpoint', 'endpoint');
                    pendingStore.createIndex('timestamp', 'timestamp');
                }
                
                // Master data caches
                if (!upgradeDb.objectStoreNames.contains('masterItems')) {
                    upgradeDb.createObjectStore('masterItems', { keyPath: 'id' });
                }
                
                if (!upgradeDb.objectStoreNames.contains('masterParties')) {
                    upgradeDb.createObjectStore('masterParties', { keyPath: 'id' });
                }
                
                // Transaction caches
                if (!upgradeDb.objectStoreNames.contains('stockIn')) {
                    upgradeDb.createObjectStore('stockIn', { keyPath: 'id' });
                }
                
                if (!upgradeDb.objectStoreNames.contains('orders')) {
                    upgradeDb.createObjectStore('orders', { keyPath: 'id' });
                }
                
                if (!upgradeDb.objectStoreNames.contains('payments')) {
                    upgradeDb.createObjectStore('payments', { keyPath: 'id' });
                }
            }
        });
        console.log('✅ Offline DB initialized');
        return db;
    } catch (error) {
        console.warn('⚠️ Offline DB not available:', error);
        return null;
    }
}

// Add to pending sync queue
export async function addToSyncQueue(endpoint, method, body) {
    if (!db) return null;
    try {
        const pendingItem = {
            endpoint,
            method,
            body: JSON.stringify(body),
            timestamp: new Date().toISOString(),
            retryCount: 0
        };
        return await db.add('pendingSync', pendingItem);
    } catch (error) {
        console.error('Failed to add to sync queue:', error);
        return null;
    }
}

// Get all pending items
export async function getPendingSync() {
    if (!db) return [];
    try {
        return await db.getAll('pendingSync');
    } catch (error) {
        return [];
    }
}

// Remove from queue after successful sync
export async function removeFromSyncQueue(id) {
    if (!db) return;
    try {
        await db.delete('pendingSync', id);
    } catch (error) {
        console.error('Failed to remove from sync queue:', error);
    }
}

// Clear all pending
export async function clearPendingSync() {
    if (!db) return;
    try {
        const all = await db.getAll('pendingSync');
        for (const item of all) {
            await db.delete('pendingSync', item.id);
        }
    } catch (error) {
        console.error('Failed to clear sync queue:', error);
    }
}

// Cache master data
export async function cacheItems(items) {
    if (!db) return;
    try {
        const tx = db.transaction('masterItems', 'readwrite');
        for (const item of items) {
            await tx.store.put(item);
        }
        await tx.done;
    } catch (error) {
        console.error('Failed to cache items:', error);
    }
}

export async function cacheParties(parties) {
    if (!db) return;
    try {
        const tx = db.transaction('masterParties', 'readwrite');
        for (const party of parties) {
            await tx.store.put(party);
        }
        await tx.done;
    } catch (error) {
        console.error('Failed to cache parties:', error);
    }
}

// Get cached data
export async function getCachedItems() {
    if (!db) return [];
    try {
        return await db.getAll('masterItems');
    } catch (error) {
        return [];
    }
}

export async function getCachedParties() {
    if (!db) return [];
    try {
        return await db.getAll('masterParties');
    } catch (error) {
        return [];
    }
}

// Cache individual transactions
export async function cacheTransaction(storeName, transaction) {
    if (!db) return;
    try {
        await db.put(storeName, transaction);
    } catch (error) {
        console.error('Failed to cache transaction:', error);
    }
}

// Check online status
export function isOnline() {
    return navigator.onLine;
}

// Add connectivity listeners
export function addConnectivityListeners(callback) {
    window.addEventListener('online', () => {
        console.log('🟢 Online');
        callback(true);
    });
    window.addEventListener('offline', () => {
        console.log('🔴 Offline');
        callback(false);
    });
}