import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const root = dirname(fileURLToPath(import.meta.url));

function postgresParameters(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export class StoreDatabase {
  constructor({ dialect, sqlite = null, pool = null, client = null }) {
    this.dialect = dialect;
    this.sqlite = sqlite;
    this.pool = pool;
    this.client = client;
  }

  prepare(sql) {
    return {
      get: async (...values) => {
        if (this.dialect === 'sqlite') return this.sqlite.prepare(sql).get(...values);
        const result = await this.query(sql, values);
        return result.rows[0];
      },
      all: async (...values) => {
        if (this.dialect === 'sqlite') return this.sqlite.prepare(sql).all(...values);
        const result = await this.query(sql, values);
        return result.rows;
      },
      run: async (...values) => {
        if (this.dialect === 'sqlite') {
          const result = this.sqlite.prepare(sql).run(...values);
          return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
        }
        const result = await this.query(sql, values);
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
      }
    };
  }

  query(sql, values = []) {
    if (this.dialect === 'sqlite') throw new Error('Use a prepared statement for SQLite queries.');
    const client = this.client || this.pool;
    return client.query(postgresParameters(sql), values);
  }

  async exec(sql) {
    if (this.dialect === 'sqlite') return this.sqlite.exec(sql);
    return this.query(sql);
  }

  async transaction(callback) {
    if (this.dialect === 'sqlite') {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(this);
        this.sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }

    const client = await this.pool.connect();
    const transaction = new StoreDatabase({ dialect: this.dialect, pool: this.pool, client });
    try {
      await client.query('BEGIN');
      const result = await callback(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.dialect === 'sqlite') this.sqlite.close();
    else await this.pool.end();
  }
}

export function createDatabase(env = process.env) {
  const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (env.NODE_ENV === 'production' && !connectionString) {
    throw new Error('Set SUPABASE_DB_URL or DATABASE_URL to a Supabase PostgreSQL connection string in production.');
  }
  if (connectionString) {
    const pool = new Pool({
      connectionString,
      max: Number(env.PG_POOL_MAX || 1),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      ssl: {
        rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED !== 'false',
        ...(env.PG_CA_CERT
          ? { ca: env.PG_CA_CERT.replace(/\\n/g, '\n') }
          : env.PG_CA_CERT_PATH ? { ca: readFileSync(resolve(env.PG_CA_CERT_PATH), 'utf8') } : {})
      }
    });
    return new StoreDatabase({ dialect: 'postgres', pool });
  }

  const databasePath = resolve(env.DATABASE_PATH || join(root, 'data', 'store.sqlite'));
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return new StoreDatabase({ dialect: 'sqlite', sqlite });
}