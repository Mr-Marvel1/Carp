import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../database.mjs';
import { migrateDatabase } from './migrate.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set SUPABASE_DB_URL or DATABASE_URL in .env to the Supabase PostgreSQL connection string.');

const sourcePath = resolve(process.env.DATABASE_PATH || join(root, 'data', 'store.sqlite'));
if (!existsSync(sourcePath)) throw new Error(`SQLite source database not found: ${sourcePath}`);

const source = new DatabaseSync(sourcePath, { readOnly: true });
const target = createDatabase({ ...process.env, NODE_ENV: 'development' });
const tables = ['users', 'sessions', 'products', 'orders', 'order_items'];
let sourceSnapshot = false;

try {
  await migrateDatabase(target);

  for (const table of tables) {
    const row = await target.prepare(`SELECT COUNT(*)::int AS count FROM ${table}`).get();
    if (row.count !== 0) throw new Error(`Supabase table ${table} is not empty. Migration stopped without changing application rows.`);
  }

  source.exec('BEGIN');
  sourceSnapshot = true;
  const productColumns = new Set(source.prepare('PRAGMA table_info(products)').all().map((column) => column.name));
  const products = source.prepare(`SELECT * FROM products${productColumns.has('is_demo') ? ' WHERE is_demo = 0' : ''} ORDER BY id`).all();
  const allProducts = source.prepare('SELECT id FROM products').all();
  const copiedProductIds = new Set(products.map((product) => product.id));
  const excludedProductIds = new Set(allProducts.filter((product) => !copiedProductIds.has(product.id)).map((product) => product.id));
  const users = source.prepare('SELECT * FROM users ORDER BY id').all();
  const sessions = source.prepare('SELECT * FROM sessions ORDER BY rowid').all();
  const orders = source.prepare('SELECT * FROM orders ORDER BY id').all();
  const items = source.prepare('SELECT * FROM order_items ORDER BY id').all().map((item) => ({
    ...item,
    product_id: excludedProductIds.has(item.product_id) ? null : item.product_id
  }));

  const columns = {
    users: ['id', 'name', 'email', 'phone', 'password_hash', 'role', 'created_at'],
    sessions: ['token_hash', 'user_id', 'expires_at'],
    products: ['id', 'name', 'description', 'category', 'material', 'color', 'size', 'price', 'stock', 'image_url', 'is_active', 'created_at', 'is_demo'],
    orders: ['id', 'user_id', 'status', 'total', 'recipient', 'phone', 'address', 'city', 'pincode', 'note', 'created_at'],
    order_items: ['id', 'order_id', 'product_id', 'product_name', 'unit_price', 'quantity']
  };
  const rows = { users, sessions, products, orders, order_items: items };
  source.exec('COMMIT');
  sourceSnapshot = false;

  await target.transaction(async (transaction) => {
    for (const table of tables) {
      const fields = columns[table];
      const insert = transaction.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`);
      for (const row of rows[table]) await insert.run(...fields.map((field) => row[field] ?? (field === 'is_demo' ? 0 : null)));
    }
    for (const table of ['users', 'products', 'orders', 'order_items']) {
      await transaction.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM ${table}`);
    }
  });

  console.log(`Migrated ${users.length} users, ${sessions.length} sessions, ${products.length} real products, ${orders.length} orders, and ${items.length} order items.`);
  console.log(`Skipped ${excludedProductIds.size} demo products; historical item references to those demos were retained without a product link.`);
} finally {
  if (sourceSnapshot) source.exec('ROLLBACK');
  source.close();
  await target.close();
}