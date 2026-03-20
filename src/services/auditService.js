import { db } from './db';
import { supabase } from './supabase';

/**
 * Records an audit log entry locally and prepares it for sync.
 * @param {string} action - e.g., 'UPDATE', 'DELETE', 'PRICE_CHANGE'
 * @param {string} entity - e.g., 'products', 'sales'
 * @param {string|number} entityId - ID of the affected record
 * @param {object} details - Any additional info (old/new values, etc.)
 * @param {string} userId - ID of the user performing the action
 * @param {string} shopId - ID of the shop
 */
export const recordAuditLog = async (action, entity, entityId, details, userId, shopId) => {
    const logEntry = {
        id: crypto.randomUUID(), // UUID so syncService strips it before Supabase INSERT (BIGSERIAL PK)
        action,
        entity,
        entity_id: String(entityId),
        details,
        user_id: userId,
        shop_id: shopId,
        timestamp: new Date().toISOString()
    };

    try {
        // 1. Record in local Dexie DB
        await db.audit_logs.add(logEntry);

        // 2. Add to sync queue to upload to Supabase
        await db.sync_queue.add({
            table: 'audit_logs',
            action: 'INSERT',
            data: logEntry,
            timestamp: logEntry.timestamp
        });

        console.log(`[Audit] Recorded: ${action} on ${entity} (${entityId})`);
    } catch (error) {
        console.error('[Audit] Failed to record log:', error);
    }
};
