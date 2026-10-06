import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, StoreDatabase } from '../database.mjs';

function mockPool() {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: sql.includes('RETURNING id') ? [{ id: 41 }] : [{ id: 41 }], rowCount: 1 };
    },
    release() { queries.push({ sql: 'RELEASE', values: [] }); }
  };
  return {
    queries,
    client,
    pool: {
      query: client.query.bind(client),
      async connect() { return client; },
      async end() {}
    }
  };
}

test('PostgreSQL adapter binds parameters and returns SQLite-compatible results', async () => {
  const { pool, queries } = mockPool();
  const db = new StoreDatabase({ dialect: 'postgres', pool });
  const row = await db.prepare('SELECT id FROM products WHERE id = ? AND category = ?').get(41, 'Kilim');
  assert.equal(row.id, 41);
  assert.deepEqual(queries.at(-1), {
    sql: 'SELECT id FROM products WHERE id = $1 AND category = $2',
    values: [41, 'Kilim']
  });

  const changed = await db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(2, 41);
  assert.equal(changed.changes, 1);
});

test('PostgreSQL adapter keeps transaction statements on one client and rolls back errors', async () => {
  const { pool, queries } = mockPool();
  const db = new StoreDatabase({ dialect: 'postgres', pool });
  await db.transaction(async (transaction) => {
    await transaction.prepare('UPDATE products SET stock = ? WHERE id = ?').run(2, 41);
  });
  assert.deepEqual(queries.map((query) => query.sql), [
    'BEGIN', 'UPDATE products SET stock = $1 WHERE id = $2', 'COMMIT', 'RELEASE'
  ]);

  queries.length = 0;
  await assert.rejects(db.transaction(async () => { throw new Error('abort'); }), /abort/);
  assert.deepEqual(queries.map((query) => query.sql), ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('production database selection requires a Supabase PostgreSQL URL', () => {
  assert.throws(() => createDatabase({ NODE_ENV: 'production' }), /SUPABASE_DB_URL or DATABASE_URL/);
});