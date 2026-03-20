import { db } from './db';
import { supabase } from './supabase';

// Tables that only exist locally and should NOT be synced to Supabase
const LOCAL_ONLY_TABLES = ['held_carts', 'held_purchases']
// Note: audit_logs intentionally removed — they now sync to Supabase;

export const syncOfflineData = async () => {
    if (!navigator.onLine) return;

    const queue = await db.sync_queue.toArray();
    if (queue.length === 0) return;

    // Filter out local-only table entries and clean them from queue
    const syncable = [];
    for (const item of queue) {
        if (LOCAL_ONLY_TABLES.includes(item.table)) {
            await db.sync_queue.delete(item.id);
        } else {
            syncable.push(item);
        }
    }

    if (syncable.length === 0) return;
    console.log(`Syncing ${syncable.length} offline actions...`);

    const idMapping = {}; // Maps offline string UUIDs to real DB numeric IDs

    for (const item of syncable) {
        try {
            // Helper to recursively replace UUIDs in the payload with real IDs
            const replaceIds = (obj) => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(replaceIds);
                const newObj = { ...obj };
                for (const key in newObj) {
                    if (typeof newObj[key] === 'string' && idMapping[newObj[key]]) {
                        newObj[key] = idMapping[newObj[key]];
                    } else if (typeof newObj[key] === 'object') {
                        newObj[key] = replaceIds(newObj[key]);
                    }
                }
                return newObj;
            };

            const processedData = replaceIds(item.data);

            let error;
            let returnedData = null;

            if (item.action === 'INSERT') {
                const isArray = Array.isArray(processedData);
                const payload = isArray ? processedData.map(d => {
                    const obj = { ...d };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                }) : (() => {
                    const obj = { ...processedData };
                    if (typeof obj.id === 'string' && obj.id.includes('-')) delete obj.id;
                    return obj;
                })();

                const { data: resData, error: err } = await supabase.from(item.table).insert(payload).select();
                error = err;
                returnedData = resData;

                // Build ID mapping if we inserted a single object that had a UUID originally
                if (!error && !isArray && typeof item.data.id === 'string' && item.data.id.includes('-') && returnedData?.[0]) {
                    idMapping[item.data.id] = returnedData[0].id;
                }
            } else if (item.action === 'UPDATE') {
                const dataObj = Array.isArray(processedData) ? processedData[0] : processedData;
                const { id, ...updateData } = dataObj;
                if (id) {
                    ({ error } = await supabase.from(item.table).update(updateData).eq('id', id));
                } else {
                    // Can't update without an ID, skip
                    await db.sync_queue.delete(item.id);
                    continue;
                }
            } else if (item.action === 'DELETE') {
                const dataObj = Array.isArray(processedData) ? processedData[0] : processedData;
                if (dataObj.id) {
                    ({ error } = await supabase.from(item.table).delete().eq('id', dataObj.id));
                } else {
                    await db.sync_queue.delete(item.id);
                    continue;
                }
            }

            if (!error) {
                await db.sync_queue.delete(item.id);
            } else {
                console.error(`Sync error for ${item.table}:`, error);
                // If table doesn't exist or column doesn't exist, remove from queue to stop spam
                if (['PGRST205', '42P01', 'PGRST204', '22P02'].includes(error.code)) {
                    await db.sync_queue.delete(item.id);
                }
            }
        } catch (e) {
            console.error('Sync failed:', e);
        }
    }
};

// Periodically check for sync if online
setInterval(syncOfflineData, 30000);

window.addEventListener('online', syncOfflineData);
