import Dexie from 'dexie';

export const db = new Dexie('SanitaryPOS_Local');

db.version(1).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  sync_queue: '++id, table, action, data, timestamp'
});

db.version(2).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at'
});

db.version(6).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at'
});

db.version(7).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by'
});

db.version(8).stores({
  products: 'id, name, brand, category_id, shop_id',
  categories: 'id, name, shop_id',
  suppliers: 'id, name, shop_id',
  customers: 'id, name, shop_id',
  brands: 'id, name, shop_id',
  sales: 'id, customer_id, shop_id, created_at',
  sale_items: 'id, sale_id, product_id',
  purchases: 'id, supplier_id, shop_id, created_at',
  purchase_items: 'id, purchase_id, product_id',
  expenses: 'id, category, shop_id, date',
  users: 'id, username, shop_id, role',
  shops: 'id, name',
  customer_payments: 'id, customer_id, shop_id, created_at',
  supplier_payments: 'id, supplier_id, shop_id, created_at',
  sync_queue: '++id, table, action, data, timestamp',
  audit_logs: '++id, action, entity, entity_id, user_id, timestamp',
  held_carts: '++id, customer_id, shop_id, saved_at',
  trash: '++id, original_table, original_id, shop_id, deleted_at, deleted_by'
});

export const addToSyncQueue = async (table, action, data) => {
  await db.sync_queue.add({
    table,
    action,
    data,
    timestamp: new Date().toISOString()
  });
};

export const moveToTrash = async (table, originalId, data, userId, shopId) => {
  await db.trash.add({
    original_table: table,
    original_id: originalId,
    data: JSON.parse(JSON.stringify(data)),
    shop_id: shopId,
    deleted_by: userId,
    deleted_at: new Date().toISOString()
  });
};

export const restoreFromTrash = async (trashItem) => {
  const { original_table, data } = trashItem;
  if (db[original_table]) {
    await db[original_table].put(data);
  }
  await db.trash.delete(trashItem.id);
};

db.open().catch(async (err) => {
  if (err.name === 'UpgradeError' || err.name === 'VersionError') {
    console.warn('Detected local database schema conflict. Rebuilding database...', err);
    await db.delete();
    window.location.reload();
  }
});
