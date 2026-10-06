import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../database.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Production build requires SUPABASE_DB_URL or DATABASE_URL.');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('Production build requires a SESSION_SECRET of at least 32 characters.');
}
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error('Production build requires ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.');
}

for (const file of ['server.mjs', 'database.mjs', 'api/handler.mjs', 'public/app.js', 'scripts/migrate.mjs', 'scripts/migrate-sqlite-to-postgres.mjs']) {
  execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
}

const db = createDatabase({ ...process.env, NODE_ENV: 'production' });
try {
  await db.query('SELECT 1');
  const migrations = new Set((await db.prepare('SELECT name FROM schema_migrations').all()).map((row) => row.name));
  for (const required of ['001_initial_schema.sql', '002_demo_products.sql']) {
    if (!migrations.has(required)) throw new Error(`Supabase migration ${required} has not been applied; run npm run migrate:postgres first.`);
  }
  console.log('Production build checks passed: syntax, Supabase connectivity, and PostgreSQL schema migrations.');
} finally {
  await db.close();
}