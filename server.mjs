import { createServer } from 'node:http';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.mjs';
import { migrateDatabase } from './scripts/migrate.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, 'public');
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production.');
}
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const hideDemoProducts = process.env.NODE_ENV === 'production' || process.env.HIDE_DEMO_PRODUCTS === '1';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const db = createDatabase();
if (db.dialect === 'sqlite') await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    material TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL,
    recipient TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    pincode TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
  CREATE INDEX IF NOT EXISTS products_active_idx ON products(is_active);
`);
await migrateDatabase(db);

const productFields = ['name', 'description', 'category', 'material', 'color', 'size', 'price', 'stock', 'image_url'];
const orderStatuses = new Set(['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled']);
const authAttempts = new Map();

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  const existing = await db.prepare('SELECT role FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.role !== 'admin') console.warn('ADMIN_EMAIL belongs to a customer; choose an unused email to create the admin account.');
    return;
  }
  await db.prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .run('Store administrator', email, '', hashPassword(password), 'admin');
}

await bootstrapAdmin();

function json(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

async function currentUser(request) {
  const cookie = request.headers.cookie || '';
  const token = cookie.match(/(?:^|;\s*)carpy_session=([a-f0-9]+)/)?.[1];
  if (!token) return null;
  const tokenHash = createHash('sha256').update(`${sessionSecret}:${token}`).digest('hex');
  const session = await db.prepare(`SELECT users.id, users.name, users.email, users.phone, users.role
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, Date.now());
  return session || null;
}

async function requireUser(request, response, admin = false) {
  const user = await currentUser(request);
  if (!user) {
    json(response, 401, { error: 'Sign in to continue.' });
    return null;
  }
  if (admin && user.role !== 'admin') {
    json(response, 403, { error: 'Administrator access required.' });
    return null;
  }
  return user;
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function limited(request) {
  const now = Date.now();
  const key = `${request.socket.remoteAddress}:${request.url?.split('?')[0]}`;
  const attempt = authAttempts.get(key);
  if (!attempt || now - attempt.start > 60_000) {
    authAttempts.set(key, { start: now, count: 1 });
    return false;
  }
  attempt.count += 1;
  return attempt.count > 12;
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(`${sessionSecret}:${token}`).digest('hex');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, Date.now() + 30 * 24 * 60 * 60 * 1000);
  return `carpy_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureCookie}`;
}

function productFromBody(body) {
  const product = Object.fromEntries(productFields.map((key) => [key, body[key] ?? '']));
  product.name = String(product.name).trim();
  product.category = String(product.category).trim();
  product.price = Number(product.price);
  product.stock = Number(product.stock);
  for (const key of ['description', 'material', 'color', 'size', 'image_url']) product[key] = String(product[key]).trim();
  if (!product.name || !product.category || !Number.isSafeInteger(product.price) || product.price < 0 || !Number.isSafeInteger(product.stock) || product.stock < 0) {
    throw Object.assign(new Error('Add a name and category, plus a valid whole-rupee price and stock quantity.'), { status: 400 });
  }
  if (product.image_url && !/^https:\/\//i.test(product.image_url)) {
    throw Object.assign(new Error('Product image URLs must use HTTPS.'), { status: 400 });
  }
  return product;
}

function productSqlValues(product) {
  return productFields.map((key) => product[key]);
}

async function adminOrderRows() {
  const orders = await db.prepare(`SELECT orders.*, users.name AS customer_name, users.email AS customer_email
    FROM orders JOIN users ON users.id = orders.user_id ORDER BY orders.created_at DESC`).all();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  return Promise.all(orders.map(async (order) => ({ ...order, items: await items.all(order.id) })));
}

function serveStatic(request, response, pathname) {
  const isFrontendRoute = pathname === '/shop'
    || ['/cart', '/checkout', '/account', '/admin'].includes(pathname)
    || /^\/products\/\d+$/.test(pathname);
  const requested = pathname === '/' || isFrontendRoute ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = resolve(publicRoot, requested);
  const fromRoot = relative(publicRoot, file);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return json(response, 404, { error: 'Not found.' });
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(readFileSync(file));
  } catch {
    json(response, 404, { error: 'Not found.' });
  }
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const { pathname } = url;
  try {
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return json(response, 403, { error: 'Cross-origin request rejected.' });
    }
    if (request.method === 'GET' && pathname === '/api/config') {
      return json(response, 200, {
        storeName: process.env.STORE_NAME || 'Harshit International',
        phone: process.env.STORE_PHONE || '',
        whatsapp: process.env.STORE_WHATSAPP || '',
        address: process.env.STORE_ADDRESS || '',
        serviceAreas: (process.env.SERVICE_AREAS || 'Mirzapur,Bhadohi,Varanasi').split(',').map((area) => area.trim()).filter(Boolean)
      });
    }
    if (request.method === 'GET' && pathname === '/api/products') {
      const where = hideDemoProducts ? ['is_active = 1', 'is_demo = 0'] : ['is_active = 1'];
      const values = [];
      if (url.searchParams.has('q')) {
        const matchOperator = db.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
        where.push(`(name ${matchOperator} ? OR category ${matchOperator} ? OR material ${matchOperator} ? OR color ${matchOperator} ?)`);
        const query = `%${url.searchParams.get('q').slice(0, 80)}%`;
        values.push(query, query, query, query);
      }
      if (url.searchParams.has('category')) {
        where.push('category = ?');
        values.push(url.searchParams.get('category').slice(0, 80));
      }
      if (url.searchParams.has('min')) {
        where.push('price >= ?');
        values.push(Math.max(0, Number(url.searchParams.get('min')) || 0));
      }
      if (url.searchParams.has('max')) {
        where.push('price <= ?');
        values.push(Math.max(0, Number(url.searchParams.get('max')) || 0));
      }
      const sort = url.searchParams.get('sort');
      const order = sort === 'price-asc' ? 'price ASC' : sort === 'price-desc' ? 'price DESC' : 'created_at DESC';
      const products = await db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`).all(...values);
      const categoryRows = await db.prepare(`SELECT DISTINCT category FROM products WHERE is_active = 1${hideDemoProducts ? ' AND is_demo = 0' : ''} ORDER BY category`).all();
      const categories = categoryRows.map((row) => row.category);
      return json(response, 200, { products, categories });
    }
    if (request.method === 'GET' && /^\/api\/products\/\d+$/.test(pathname)) {
      const product = await db.prepare(`SELECT * FROM products WHERE id = ? AND is_active = 1${hideDemoProducts ? ' AND is_demo = 0' : ''}`).get(Number(pathname.split('/').at(-1)));
      return product ? json(response, 200, product) : json(response, 404, { error: 'Carpet not found.' });
    }
    if (request.method === 'GET' && pathname === '/api/session') return json(response, 200, { user: await currentUser(request) });

    if (request.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(pathname)) {
      if (limited(request)) return json(response, 429, { error: 'Too many attempts. Try again in a minute.' });
      const body = await readJson(request);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!validEmail(email) || password.length < 10 || password.length > 128) return json(response, 400, { error: 'Enter a valid email and a password of at least 10 characters.' });
      let user;
      if (pathname.endsWith('register')) {
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        if (!name || name.length > 120 || !phone || phone.length > 32) return json(response, 400, { error: 'Enter your name and phone number.' });
        try {
          const result = await db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?) RETURNING id')
            .get(name, email, phone, hashPassword(password));
          user = await db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(result.id);
        } catch (error) {
          if (error.code === '23505' || String(error.message).includes('UNIQUE')) return json(response, 409, { error: 'An account already exists for this email.' });
          throw error;
        }
      } else {
        const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!row || !checkPassword(password, row.password_hash)) return json(response, 401, { error: 'Email or password is incorrect.' });
        user = { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role };
      }
      return json(response, 200, { user }, { 'Set-Cookie': await createSession(user.id) });
    }
    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const token = request.headers.cookie?.match(/(?:^|;\s*)carpy_session=([a-f0-9]+)/)?.[1];
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(`${sessionSecret}:${token}`).digest('hex'));
      return json(response, 200, { user: null }, { 'Set-Cookie': `carpy_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}` });
    }
    if (request.method === 'GET' && pathname === '/api/orders') {
      const user = await requireUser(request, response);
      if (!user) return;
      const orders = await db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
      return json(response, 200, await Promise.all(orders.map(async (order) => ({ ...order, items: await items.all(order.id) }))));
    }
    if (request.method === 'POST' && pathname === '/api/orders') {
      const user = await requireUser(request, response);
      if (!user) return;
      const body = await readJson(request);
      const recipient = String(body.recipient || '').trim();
      const phone = String(body.phone || '').trim();
      const address = String(body.address || '').trim();
      const city = String(body.city || '').trim();
      const pincode = String(body.pincode || '').trim();
      if (!recipient || !phone || !address || !city || !/^\d{6}$/.test(pincode)) return json(response, 400, { error: 'Complete the delivery details with a valid 6-digit PIN code.' });
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) return json(response, 400, { error: 'Your cart is empty or has too many items.' });
      try {
        const orderId = await db.transaction(async (transaction) => {
        let total = 0;
        const lines = [];
        for (const item of body.items) {
          const id = Number(item.id);
          const quantity = Number(item.quantity);
          if (!Number.isSafeInteger(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) throw Object.assign(new Error('Invalid item quantity.'), { status: 400 });
          const product = await transaction.prepare(`SELECT id, name, price, stock FROM products WHERE id = ? AND is_active = 1${hideDemoProducts ? ' AND is_demo = 0' : ''}`).get(id);
          if (!product || product.stock < quantity) throw Object.assign(new Error(`${product?.name || 'A carpet'} is no longer available in that quantity.`), { status: 409 });
          total += product.price * quantity;
          lines.push({ ...product, quantity });
        }
        const result = await transaction.prepare(`INSERT INTO orders (user_id, total, recipient, phone, address, city, pincode, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(user.id, total, recipient, phone, address, city, pincode, String(body.note || '').trim().slice(0, 500));
        const insertItem = transaction.prepare('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)');
        const decrement = transaction.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
        for (const item of lines) {
          await insertItem.run(result.id, item.id, item.name, item.price, item.quantity);
          const changed = await decrement.run(item.quantity, item.id, item.quantity);
          if (changed.changes !== 1) throw Object.assign(new Error(`${item.name} just sold out. Please refresh your cart.`), { status: 409 });
        }
        return { id: Number(result.id), total };
        });
        return json(response, 201, orderId);
      } catch (error) {
        throw error;
      }
    }

    if (pathname.startsWith('/api/admin/')) {
      const admin = await requireUser(request, response, true);
      if (!admin) return;
      if (request.method === 'GET' && pathname === '/api/admin/products') {
        return json(response, 200, await db.prepare('SELECT * FROM products ORDER BY created_at DESC').all());
      }
      if (request.method === 'POST' && pathname === '/api/admin/products') {
        const product = productFromBody(await readJson(request));
        const result = await db.prepare(`INSERT INTO products (${productFields.join(', ')}) VALUES (${productFields.map(() => '?').join(', ')}) RETURNING id`).get(...productSqlValues(product));
        return json(response, 201, { id: Number(result.id) });
      }
      const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
      if (productMatch && request.method === 'PUT') {
        const product = productFromBody(await readJson(request));
        const result = await db.prepare(`UPDATE products SET ${productFields.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`)
          .run(...productSqlValues(product), Number(productMatch[1]));
        return result.changes ? json(response, 200, { ok: true }) : json(response, 404, { error: 'Carpet not found.' });
      }
      if (productMatch && request.method === 'DELETE') {
        const result = await db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(Number(productMatch[1]));
        return result.changes ? json(response, 200, { ok: true }) : json(response, 404, { error: 'Carpet not found.' });
      }
      if (request.method === 'GET' && pathname === '/api/admin/orders') return json(response, 200, await adminOrderRows());
      const orderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (orderMatch && request.method === 'PATCH') {
        const body = await readJson(request);
        if (!orderStatuses.has(body.status)) return json(response, 400, { error: 'Invalid order status.' });
        const order = await db.prepare('SELECT status FROM orders WHERE id = ?').get(Number(orderMatch[1]));
        if (!order) return json(response, 404, { error: 'Order not found.' });
        if (order.status === 'cancelled' && body.status !== 'cancelled') return json(response, 409, { error: 'Cancelled orders cannot be reopened.' });
        if (order.status !== 'cancelled' && body.status === 'cancelled') {
          await db.transaction(async (transaction) => {
            for (const item of await transaction.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(Number(orderMatch[1]))) {
              if (item.product_id !== null) await transaction.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
            }
            await transaction.prepare('UPDATE orders SET status = ? WHERE id = ?').run(body.status, Number(orderMatch[1]));
          });
        } else {
          await db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(body.status, Number(orderMatch[1]));
        }
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && pathname === '/api/admin/customers') {
        return json(response, 200, await db.prepare(`SELECT users.id, users.name, users.email, users.phone, users.created_at,
          COUNT(orders.id) AS order_count, COALESCE(SUM(CASE WHEN orders.status != 'cancelled' THEN orders.total ELSE 0 END), 0) AS lifetime_value
          FROM users LEFT JOIN orders ON orders.user_id = users.id WHERE users.role = 'customer'
          GROUP BY users.id ORDER BY users.created_at DESC`).all());
      }
    }
    if (pathname.startsWith('/api/')) return json(response, 404, { error: 'API route not found.' });
    if (request.method === 'GET') return serveStatic(request, response, pathname);
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong.' });
    if (!error.status) console.error(error);
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => console.log(`Harshit International is running at http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}