import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export async function migrateDatabase(db, migrationsDirectory = join(root, 'migrations', db.dialect === 'postgres' ? 'postgres' : '')) {
  const appliedAt = db.dialect === 'postgres'
    ? "TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"
    : 'CURRENT_TIMESTAMP';
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT ${appliedAt}
  )`);
  const migrations = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
  for (const name of migrations) {
    await db.transaction(async (transaction) => {
      const applied = await transaction.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name);
      if (applied) return;
      await transaction.exec(readFileSync(join(migrationsDirectory, name), 'utf8'));
      await transaction.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    });
  }
}