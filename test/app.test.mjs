import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'harshit-store-'));
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATABASE_PATH: join(directory, 'store.sqlite'),
      SESSION_SECRET: 'integration-test-secret',
      ADMIN_EMAIL: 'admin@example.test',
      ADMIN_PASSWORD: 'integration-admin-password'
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

  const catalog = await request('/api/products');
  assert.deepEqual(catalog.data.products, []);

  const unauthenticatedOrder = await request('/api/orders', {
    method: 'POST', body: { items: [{ id: 1, quantity: 1 }] }
  });
  assert.equal(unauthenticatedOrder.response.status, 401);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Local Customer', email: 'customer@example.test', phone: '9876543210', password: 'customer-password' }
  });
  assert.equal(registered.response.status, 200);
  customerCookie = registered.cookie;
  assert.ok(customerCookie);

  const adminLogin = await request('/api/auth/login', {
    method: 'POST', body: { email: 'admin@example.test', password: 'integration-admin-password' }
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.data.user.role, 'admin');
  adminCookie = adminLogin.cookie;

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
  assert.equal(inventory.data[0].stock, 3);

  const customers = await request('/api/admin/customers', { cookie: adminCookie });
  assert.equal(customers.data.length, 1);
  assert.equal(customers.data[0].order_count, 1);
});

test('admin APIs reject customer sessions', async () => {
  const result = await request('/api/admin/products', { cookie: customerCookie });
  assert.equal(result.response.status, 403);
});