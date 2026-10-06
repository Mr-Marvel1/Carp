import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

let directory;
let child;
let baseUrl;
let output = '';
let customerCookie;
let adminCookie;
let sessionSecret;
let adminPassword;
let customerPassword;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'harshit-store-'));
  sessionSecret = randomBytes(32).toString('hex');
  adminPassword = randomBytes(24).toString('base64url');
  customerPassword = randomBytes(24).toString('base64url');
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      VERCEL: '',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
      PG_CA_CERT: '',
      PG_CA_CERT_PATH: '',
      DATABASE_PATH: join(directory, 'store.sqlite'),
      SESSION_SECRET: sessionSecret,
      NODE_ENV: 'development',
      HIDE_DEMO_PRODUCTS: '1',
      ADMIN_EMAIL: 'admin@example.test',
      ADMIN_PASSWORD: adminPassword
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 8_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        baseUrl = `http://127.0.0.1:${match[1]}`;
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited (${code}). ${output}`)); });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  const setCookie = response.headers.get('set-cookie');
  return { response, data, cookie: setCookie?.match(/^carpy_session=[^;]+/)?.[0] };
}

test('fresh catalog, local order lifecycle, and admin inventory', async () => {
  const storefront = await fetch(baseUrl);
  assert.equal(storefront.status, 200);
  assert.match(await storefront.text(), /Harshit International/);

  for (const path of ['/shop', '/products/1', '/cart']) {
    const page = await fetch(`${baseUrl}${path}`);
    assert.equal(page.status, 200, `${path} should be served by the frontend router`);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
  }

  const catalog = await request('/api/products');
  assert.deepEqual(catalog.data.products, []);

  const missingProduct = await request('/api/products/1');
  assert.equal(missingProduct.response.status, 404);
  assert.equal(missingProduct.data.error, 'Carpet not found.');

  const nestedAuth = await request('/api/auth/login', { method: 'POST', body: {} });
  assert.equal(nestedAuth.response.status, 400);
  assert.match(nestedAuth.response.headers.get('content-type') || '', /application\/json/);

  const nestedAdmin = await request('/api/admin/products');
  assert.equal(nestedAdmin.response.status, 401);
  assert.equal(nestedAdmin.data.error, 'Sign in to continue.');

  const databasePath = join(directory, 'store.sqlite');
  const rejectedSeed = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, VERCEL: '', SUPABASE_DB_URL: '', DATABASE_URL: '', DATABASE_PATH: databasePath, NODE_ENV: 'production', ALLOW_DEMO_SEED: '1' },
    encoding: 'utf8'
  });
  assert.notEqual(rejectedSeed.status, 0);
  assert.match(rejectedSeed.stderr, /Demo seeding is disabled/);

  const seeded = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, VERCEL: '', SUPABASE_DB_URL: '', DATABASE_URL: '', DATABASE_PATH: databasePath, NODE_ENV: 'development', ALLOW_DEMO_SEED: '1' },
    encoding: 'utf8'
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /24 demo carpets added/);
  assert.deepEqual((await request('/api/products')).data.products, []);

  const unauthenticatedOrder = await request('/api/orders', {
    method: 'POST', body: { items: [{ id: 1, quantity: 1 }] }
  });
  assert.equal(unauthenticatedOrder.response.status, 401);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Local Customer', email: 'customer@example.test', phone: '9876543210', password: customerPassword }
  });
  assert.equal(registered.response.status, 200);
  customerCookie = registered.cookie;
  assert.ok(customerCookie);

  const adminLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: 'admin@example.test', password: adminPassword }
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.data.user.role, 'admin');
  adminCookie = adminLogin.cookie;

  const allProducts = await request('/api/admin/products', { cookie: adminCookie });
  const demoProducts = allProducts.data.filter((product) => product.is_demo === 1);
  assert.equal(demoProducts.length, 24);
  const demoOrder = await request('/api/orders', {
    method: 'POST', cookie: customerCookie,
    body: { recipient: 'Local Customer', phone: '9876543210', address: 'Main Road', city: 'Mirzapur', pincode: '231001', items: [{ id: demoProducts[0].id, quantity: 1 }] }
  });
  assert.equal(demoOrder.response.status, 409);

  const created = await request('/api/admin/products', {
    method: 'POST', cookie: adminCookie,
    body: { name: 'Test rug', category: 'Test', material: 'Wool', color: 'Red', size: '5 × 7 ft', price: 1499, stock: 3, image_url: '', description: 'Test inventory record.' }
  });
  assert.equal(created.response.status, 201);

  const order = await request('/api/orders', {
    method: 'POST', cookie: customerCookie,
    body: { recipient: 'Local Customer', phone: '9876543210', address: 'Main Road', city: 'Mirzapur', pincode: '231001', items: [{ id: created.data.id, quantity: 2 }] }
  });
  assert.equal(order.response.status, 201);
  assert.equal(order.data.total, 2998);

  const adminOrders = await request('/api/admin/orders', { cookie: adminCookie });
  assert.equal(adminOrders.data.length, 1);
  assert.equal(adminOrders.data[0].items[0].quantity, 2);

  const cancelled = await request(`/api/admin/orders/${order.data.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'cancelled' } });
  assert.equal(cancelled.response.status, 200);
  const inventory = await request('/api/admin/products', { cookie: adminCookie });
  assert.equal(inventory.data.find((product) => product.name === 'Test rug').stock, 3);

  const customers = await request('/api/admin/customers', { cookie: adminCookie });
  assert.equal(customers.data.length, 1);
  assert.equal(customers.data[0].order_count, 1);
});

test('admin APIs reject customer sessions', async () => {
  const result = await request('/api/admin/products', { cookie: customerCookie });
  assert.equal(result.response.status, 403);
});