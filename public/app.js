const app = document.querySelector('#app');
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = (name) => name === 'arrow'
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const state = {
  config: { storeName: 'Harshit International', serviceAreas: ['Mirzapur', 'Bhadohi', 'Varanasi'] },
  products: [], categories: [], user: null, cart: readCart(), adminTab: 'products', authMode: 'register',
  detailQuantity: 1, editingProduct: null, toastTimer: null
};

function readCart() {
  try { return JSON.parse(localStorage.getItem('hi-cart') || '[]'); } catch { return []; }
}
function saveCart() {
  localStorage.setItem('hi-cart', JSON.stringify(state.cart));
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector('#cart-count').textContent = count;
}
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const content = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(content.error || 'Something went wrong. Please try again.');
  return content;
}
function currentRoute() {
  let route = location.hash.replace(/^#\/?/, '');
  if (!route) {
    if (location.pathname === '/shop') route = 'catalog';
    else if (['/cart', '/checkout', '/account', '/admin'].includes(location.pathname)) route = location.pathname.slice(1);
    else {
      const product = location.pathname.match(/^\/products\/(\d+)$/);
      route = product ? `product/${product[1]}` : 'home';
    }
  }
  const [page, id] = route.split('/');
  return { page, id: id ? Number(id) : null };
}
function productImage(product, className = 'product-image') {
  const alt = escapeHtml(product.name || 'Carpet');
  const placeholder = `<div class="woven-placeholder" aria-label="Carpet preview"${product.image_url ? ' hidden' : ''}><span>${escapeHtml((product.category || 'Carpet').slice(0, 20))}</span></div>`;
  const image = product.image_url
    ? `<img src="${escapeHtml(product.image_url)}" alt="${alt}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : '';
  return `<div class="${className}">${image}${placeholder}${product.stock === 0 ? '<span class="stock-label">Currently unavailable</span>' : ''}</div>`;
}
function productCard(product) {
  return `<article class="product-card">
    <a href="#product/${product.id}" aria-label="View ${escapeHtml(product.name)}">${productImage(product)}${product.is_demo ? '<span class="demo-ribbon">DEMO · DEVELOPMENT ONLY</span>' : ''}</a>
    <div class="product-meta"><p class="product-category">${escapeHtml(product.category)}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</p>
      <a class="product-name" href="#product/${product.id}">${escapeHtml(product.name)}</a>
      <div class="product-bottom"><span class="product-price">${money.format(product.price)}</span>
        <button class="add-button" data-add="${product.id}" aria-label="Add ${escapeHtml(product.name)} to bag" ${product.stock < 1 ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
    </div>
  </article>`;
}
function productGrid(products) {
  if (!products.length) return `<div class="empty-state"><strong>No carpets listed just yet.</strong><p>Our showroom inventory is being added. Check back soon, or contact us and we’ll help you find the right carpet.</p><a class="text-link" href="#catalog">Browse the showroom ${icon('arrow')}</a></div>`;
  return `<div class="product-grid">${products.map(productCard).join('')}</div>`;
}
function homePage() {
  const featured = state.products.slice(0, 4);
  const demoCount = state.products.filter((product) => product.is_demo).length;
  return `<section class="home-masthead">
    <div class="home-hero-copy"><p class="eyebrow">Carpets for living, from ${escapeHtml(state.config.serviceAreas[0] || 'Uttar Pradesh')}</p>
      <h1>Ground your<br>room in <em>colour.</em></h1>
      <p>Find a pattern, texture and size that feels like yours. Browse the current ${escapeHtml(state.config.storeName)} collection with no sign-in required.</p>
      <form class="hero-search" id="hero-search"><label class="sr-only" for="hero-query">Search carpets</label><input id="hero-query" name="q" type="search" placeholder="Try “cotton”, “runner”, “blue”…"><button aria-label="Search carpets">${icon('arrow')}</button></form>
      <div class="home-hero-links"><a class="button" href="#catalog">Shop all carpets ${icon('arrow')}</a><span>Local service · ${escapeHtml(state.config.serviceAreas.slice(0, 3).join(' · '))}</span></div>
    </div>
    <div class="home-hero-photo" role="img" aria-label="A patterned carpet in a warm, considered living space"><span class="photo-label">TEXTURE FOR EVERYDAY LIVING</span><span class="photo-caption">A softer place<br>to land.</span></div>
  </section>
  ${demoCount ? `<div class="demo-notice"><strong>Development preview</strong><span>${demoCount} demo carpets · Not for sale · Replaced with verified product details before launch</span></div>` : ''}
  <div class="local-promise"><span>Harshit International</span><span>Mirzapur</span><span>Bhadohi</span><span>Varanasi</span><span>Easy local ordering</span></div>
  ${state.categories.length ? `<section class="home-categories section"><div class="section-head"><div><p class="eyebrow">Start somewhere</p><h2>Shop by style</h2></div><a class="text-link" href="#catalog">All carpets ${icon('arrow')}</a></div><div class="category-links">${state.categories.map((category, index) => `<a class="category-link category-tone-${index % 4}" href="#catalog?category=${encodeURIComponent(category)}"><span class="category-number">0${index + 1}</span><strong>${escapeHtml(category)}</strong>${icon('arrow')}</a>`).join('')}</div></section>` : ''}
  <section class="section home-collection"><div class="section-head"><div><p class="eyebrow">On the floor now</p><h2>Find your kind of cosy</h2><p>Every item comes from the live store catalog.</p></div><a class="text-link" href="#catalog">View the collection ${icon('arrow')}</a></div>${productGrid(featured)}</section>
  <section class="home-local"><div class="home-local-image" role="img" aria-label="Detail of a woven rug"></div><div class="home-local-copy"><p class="eyebrow">Your nearby carpet shop</p><h2>Made for your home.<br>Ordered close to home.</h2><p>Browse freely, choose at your pace, and share your delivery details only when you’re ready to place an order. Our team will confirm delivery and payment with you.</p><a class="button button-light" href="#catalog">Explore carpets ${icon('arrow')}</a></div></section>`;
}
function catalogPage() {
  const query = new URLSearchParams(location.hash.split('?')[1] || location.search.slice(1));
  const search = query.get('q') || '';
  const category = query.get('category') || '';
  const min = query.get('min') || '';
  const max = query.get('max') || '';
  const sort = query.get('sort') || 'newest';
  const url = new URLSearchParams();
  if (search) url.set('q', search);
  if (category) url.set('category', category);
  if (min) url.set('min', min);
  if (max) url.set('max', max);
  if (sort !== 'newest') url.set('sort', sort);
  const result = state.filteredProducts || state.products;
  return `<div class="page-shell catalog-shell"><div class="catalog-banner"><p class="eyebrow">Harshit International · Mirzapur, UP</p><h1 class="page-title">The carpet collection<span>.</span></h1><p class="page-subtitle">Browse by feel, fibre or favourite colour. No account needed.</p></div>
    <form class="filter-bar" id="filter-form"><div class="field filter-search"><label for="filter-q">Search carpets</label><input id="filter-q" class="filter-control" name="q" value="${escapeHtml(search)}" placeholder="Try a colour, material or style"></div>
      <div class="field filter-small"><label for="filter-category">Category</label><select class="filter-control" id="filter-category" name="category"><option value="">All categories</option>${state.categories.map((value) => `<option ${value === category ? 'selected' : ''} value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></div>
      <div class="field filter-small"><label for="filter-sort">Sort by</label><select class="filter-control" id="filter-sort" name="sort"><option value="newest" ${sort === 'newest' ? 'selected' : ''}>Recently added</option><option value="price-asc" ${sort === 'price-asc' ? 'selected' : ''}>Price: low to high</option><option value="price-desc" ${sort === 'price-desc' ? 'selected' : ''}>Price: high to low</option></select></div>
      <div class="field filter-small"><label for="filter-min">Min ₹</label><input id="filter-min" class="filter-control" name="min" value="${escapeHtml(min)}" type="number" min="0" placeholder="Any"></div>
      <div class="field filter-small"><label for="filter-max">Max ₹</label><input id="filter-max" class="filter-control" name="max" value="${escapeHtml(max)}" type="number" min="0" placeholder="Any"></div>
      <button class="button button-small" type="submit">Apply filters</button>
    </form><p class="filter-results">${result.length} ${result.length === 1 ? 'carpet' : 'carpets'}</p>${productGrid(result)}</div>`;
}
function detailPage(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return `<div class="page-shell"><div class="empty-state"><strong>We couldn’t find that carpet.</strong><p>It may have been removed from the collection.</p><a class="button button-small" href="#catalog">Back to carpets</a></div></div>`;
  return `<div class="page-shell"><p class="eyebrow"><a href="#catalog">Carpet collection</a> / ${escapeHtml(product.category)}</p><div class="detail-layout">${productImage(product)}<div class="detail-info">${product.is_demo ? '<p class="demo-inline">DEVELOPMENT DEMO · NOT FOR SALE</p>' : ''}<p class="product-category">${escapeHtml(product.category)}</p><h1>${escapeHtml(product.name)}</h1><p class="detail-price">${money.format(product.price)}</p><p class="detail-description">${escapeHtml(product.description || 'Ask us for details about this carpet, including delivery and care.')}</p>
    <div class="spec-list">${[['Material', product.material], ['Colour', product.color], ['Size', product.size], ['Available', product.stock > 0 ? `${product.stock} in stock` : 'Currently unavailable']].filter((row) => row[1]).map(([key, value]) => `<div class="spec-row"><span>${key}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    <div class="quantity-control"><button data-quantity="-1" aria-label="Decrease quantity">−</button><span id="detail-quantity">${state.detailQuantity}</span><button data-quantity="1" aria-label="Increase quantity">+</button></div><button class="button" data-add="${product.id}" ${product.stock < 1 ? 'disabled' : ''}>Add to bag ${icon('arrow')}</button>
    <p class="page-subtitle">Delivery details for ${escapeHtml(state.config.serviceAreas.join(', '))} are confirmed with you after ordering.</p></div></div></div>`;
}
function cartPage() {
  const lines = state.cart.map((item) => ({ ...item, product: state.products.find((product) => product.id === item.id) })).filter((line) => line.product);
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  if (!lines.length) return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Your selection</p><h1 class="page-title">Your bag</h1></div><div class="empty-state" style="margin-top:22px"><strong>Your bag is waiting for a favourite.</strong><p>Take a look through the collection and add a carpet you love.</p><a class="button button-small" href="#catalog">Explore carpets ${icon('arrow')}</a></div></div>`;
  return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Your selection</p><h1 class="page-title">Your bag <span style="font:400 16px var(--sans);color:var(--muted)">(${lines.length})</span></h1></div><div class="cart-layout"><div>${lines.map(({ product, quantity }) => `<article class="cart-line"><a class="cart-thumb" href="#product/${product.id}">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">` : '<div class="woven-placeholder"><span>Carpet</span></div>'}</a><div><a href="#product/${product.id}"><h3>${escapeHtml(product.name)}</h3></a><p>${money.format(product.price)} each</p><div class="quantity-control compact"><button data-cart-qty="${product.id}" data-delta="-1" aria-label="Decrease quantity">−</button><span>${quantity}</span><button data-cart-qty="${product.id}" data-delta="1" aria-label="Increase quantity">+</button></div></div><div class="cart-line-actions"><strong>${money.format(product.price * quantity)}</strong><button class="remove-button" data-remove="${product.id}">Remove</button></div></article>`).join('')}</div>
    <aside class="cart-summary"><h2>Order summary</h2><div class="summary-row"><span>Items (${lines.reduce((sum, line) => sum + line.quantity, 0)})</span><span>${money.format(total)}</span></div><div class="summary-row"><span>Delivery</span><span>Confirmed after order</span></div><div class="summary-row summary-total"><span>Subtotal</span><span>${money.format(total)}</span></div><p class="page-subtitle">No payment is collected online. Our team will confirm payment and delivery with you.</p><a class="button" href="#checkout">Continue to checkout ${icon('arrow')}</a></aside></div></div>`;
}
function authBox(mode = state.authMode, checkout = false) {
  const register = mode === 'register';
  return `<section class="auth-box"><h2>${checkout ? 'One quick step before ordering' : 'Welcome back'}</h2><p>${checkout ? 'Sign in or create an account to securely place your order.' : 'Sign in to view your orders, or create an account.'}</p>
    <div class="auth-tabs"><button class="auth-tab ${register ? 'active' : ''}" data-auth-mode="register">Create account</button><button class="auth-tab ${!register ? 'active' : ''}" data-auth-mode="login">Sign in</button></div>
    <form class="auth-form" id="auth-form" data-checkout="${checkout}" data-mode="${mode}">${register ? '<div class="field"><label for="auth-name">Your name</label><input id="auth-name" name="name" autocomplete="name" required></div><div class="field"><label for="auth-phone">Mobile number</label><input id="auth-phone" name="phone" autocomplete="tel" required></div>' : ''}
      <div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="10" autocomplete="${register ? 'new-password' : 'current-password'}" required></div><p class="error-text" id="auth-error" hidden></p><button class="button button-small" type="submit">${register ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form>
  </section>`;
}
function checkoutPage() {
  const total = state.cart.reduce((sum, item) => {
    const product = state.products.find((candidate) => candidate.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
  if (!state.cart.length) return `<div class="page-shell"><div class="empty-state"><strong>Your bag is empty.</strong><p>Add a carpet before continuing to checkout.</p><a class="button button-small" href="#catalog">Browse carpets</a></div></div>`;
  return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Almost there</p><h1 class="page-title">Checkout</h1><p class="page-subtitle">Your account is only needed to place the order. Browsing stays open to everyone.</p></div><div class="checkout-layout"><div class="checkout-form">${state.user ? `<section class="auth-box"><strong>Ordering as ${escapeHtml(state.user.name)}</strong><p>${escapeHtml(state.user.email)} · <button class="remove-button" data-logout>Sign out</button></p></section>` : authBox(state.authMode, true)}
    <form id="order-form" class="${state.user ? '' : 'order-locked'}" ${state.user ? '' : 'aria-disabled="true"'}><h2 style="margin:0;font:500 22px var(--serif)">Delivery details</h2><div class="form-grid"><div class="field"><label for="recipient">Recipient name</label><input id="recipient" name="recipient" autocomplete="name" value="${escapeHtml(state.user?.name || '')}" required></div><div class="field"><label for="delivery-phone">Mobile number</label><input id="delivery-phone" name="phone" autocomplete="tel" value="${escapeHtml(state.user?.phone || '')}" required></div><div class="field field-span"><label for="address">Delivery address</label><textarea id="address" name="address" autocomplete="street-address" required></textarea></div><div class="field"><label for="city">Town / city</label><input id="city" name="city" placeholder="e.g. Mirzapur" required></div><div class="field"><label for="pincode">PIN code</label><input id="pincode" name="pincode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6 digits" required></div><div class="field field-span"><label for="note">Order note <span style="font-weight:400;color:var(--muted)">(optional)</span></label><textarea id="note" name="note" maxlength="500" placeholder="Anything we should know?"></textarea></div></div><p class="error-text" id="order-error" hidden></p><button class="button" type="submit" ${state.user ? '' : 'disabled'}>Place order · ${money.format(total)} ${icon('arrow')}</button><p class="page-subtitle">We’ll contact you to confirm availability, delivery timing and payment method.</p></form></div>
    <aside class="cart-summary"><h2>Your order</h2>${state.cart.map((item) => { const product = state.products.find((candidate) => candidate.id === item.id); return product ? `<div class="summary-row"><span>${escapeHtml(product.name)} × ${item.quantity}</span><strong>${money.format(product.price * item.quantity)}</strong></div>` : ''; }).join('')}<div class="summary-row summary-total"><span>Total</span><span>${money.format(total)}</span></div><div class="summary-row"><span>Delivery</span><span>Confirmed by phone</span></div></aside></div></div>`;
}
function ordersMarkup(orders) {
  if (!orders.length) return '<div class="empty-state"><strong>No orders yet.</strong><p>Your orders will appear here after checkout.</p><a class="text-link" href="#catalog">Find a carpet</a></div>';
  return `<div class="order-list">${orders.map((order) => `<article class="order-card"><div class="order-top"><strong>Order #${order.id} · ${new Date(order.created_at + 'Z').toLocaleDateString('en-IN')}</strong><span class="status-chip">${escapeHtml(order.status)}</span></div><p>${order.items.map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}`).join(' · ')}<br>${money.format(order.total)} · ${escapeHtml(order.city)}</p></article>`).join('')}</div>`;
}
function accountPage() {
  if (!state.user) return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Your account</p><h1 class="page-title">Orders & account</h1><p class="page-subtitle">You can browse and add to your bag without signing in.</p></div><div style="max-width:460px;padding-top:25px">${authBox()}</div></div>`;
  return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Your account</p><h1 class="page-title">Orders & account</h1></div><div class="account-grid"><aside class="account-profile"><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(state.user.email)}<br>${escapeHtml(state.user.phone || '')}</p><button class="button button-outline button-small" data-logout>Sign out</button></aside><section><h2 style="margin:0 0 15px;font:500 22px var(--serif)">Your orders</h2><div id="customer-orders"><div class="loading-state">Loading orders…</div></div></section></div></div>`;
}
function adminPage() {
  if (!state.user || state.user.role !== 'admin') return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Store desk</p><h1 class="page-title">Administrator sign in</h1><p class="page-subtitle">Use the admin account configured for this store.</p></div><div style="max-width:460px;padding-top:25px">${authBox('login')}</div></div>`;
  return `<div class="page-shell"><div class="page-heading"><p class="eyebrow">Store desk</p><h1 class="page-title">Admin dashboard</h1><p class="page-subtitle">Manage the real showroom inventory, local orders and customer list.</p></div><div class="admin-tabs" role="tablist"><button class="admin-tab ${state.adminTab === 'products' ? 'active' : ''}" data-admin-tab="products">Products</button><button class="admin-tab ${state.adminTab === 'orders' ? 'active' : ''}" data-admin-tab="orders">Orders</button><button class="admin-tab ${state.adminTab === 'customers' ? 'active' : ''}" data-admin-tab="customers">Customers</button></div><div id="admin-content" class="admin-layout"><div class="loading-state">Loading store data…</div></div></div>`;
}
function render() {
  const { page, id } = currentRoute();
  document.querySelectorAll('[data-nav]').forEach((link) => link.classList.toggle('active', link.dataset.nav === page || (page === 'product' && link.dataset.nav === 'catalog')));
  document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('.main-nav').classList.remove('open');
  if (page === 'home') app.innerHTML = homePage();
  else if (page === 'catalog') app.innerHTML = catalogPage();
  else if (page === 'product') app.innerHTML = detailPage(id);
  else if (page === 'cart') app.innerHTML = cartPage();
  else if (page === 'checkout') app.innerHTML = checkoutPage();
  else if (page === 'account') app.innerHTML = accountPage();
  else if (page === 'admin') app.innerHTML = adminPage();
  else { location.hash = '#home'; return; }
  if (page === 'account' && state.user) loadOrders();
  if (page === 'admin' && state.user?.role === 'admin') loadAdminTab();
}
async function refreshProducts(filters = '') {
  const result = await api(`/api/products${filters}`);
  state.products = result.products;
  state.categories = result.categories;
  if (currentRoute().page === 'catalog' && filters) state.filteredProducts = result.products;
  else state.filteredProducts = null;
}
async function loadOrders() {
  const target = document.querySelector('#customer-orders');
  if (!target) return;
  try { target.innerHTML = ordersMarkup(await api('/api/orders')); }
  catch (error) { target.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`; }
}
async function loadAdminTab() {
  const target = document.querySelector('#admin-content');
  if (!target) return;
  try {
    if (state.adminTab === 'products') {
      const products = await api('/api/admin/products');
      target.innerHTML = `<div class="admin-toolbar"><h2>Products <span style="color:var(--muted);font:400 13px var(--sans)">(${products.length})</span></h2><button class="button button-small" data-new-product>${icon('plus')} Add carpet</button></div>${products.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Carpet</th><th>Category</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>${products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong>${product.is_demo ? '<span class="admin-demo-tag">DEMO · DEV ONLY</span>' : ''}</td><td>${escapeHtml(product.category)}</td><td>${money.format(product.price)}</td><td>${product.stock}</td><td>${product.is_active ? 'Listed' : 'Hidden'}</td><td><div class="table-actions"><button class="icon-button" data-edit-product="${product.id}" aria-label="Edit ${escapeHtml(product.name)}" title="Edit">✎</button>${product.is_active ? `<button class="icon-button" data-hide-product="${product.id}" aria-label="Hide ${escapeHtml(product.name)}" title="Hide">×</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No carpets in the catalog yet.</strong><p>Add Harshit International’s actual inventory here. The public storefront will update automatically.</p></div>'}`;
    } else if (state.adminTab === 'orders') {
      const orders = await api('/api/admin/orders');
      target.innerHTML = `<div class="admin-toolbar"><h2>Orders <span style="color:var(--muted);font:400 13px var(--sans)">(${orders.length})</span></h2></div>${orders.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Delivery</th><th>Status</th></tr></thead><tbody>${orders.map((order) => `<tr><td><strong>#${order.id}</strong><br>${new Date(order.created_at + 'Z').toLocaleDateString('en-IN')}</td><td>${escapeHtml(order.customer_name)}<br>${escapeHtml(order.phone)}</td><td>${order.items.map((item) => `${escapeHtml(item.product_name)} × ${item.quantity}`).join('<br>')}</td><td>${money.format(order.total)}</td><td>${escapeHtml(order.address)}, ${escapeHtml(order.city)} ${escapeHtml(order.pincode)}</td><td><select data-order-status="${order.id}" aria-label="Order ${order.id} status">${['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'].map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No orders received.</strong><p>Customer orders will be listed here.</p></div>'}`;
    } else {
      const customers = await api('/api/admin/customers');
      target.innerHTML = `<div class="admin-toolbar"><h2>Customers <span style="color:var(--muted);font:400 13px var(--sans)">(${customers.length})</span></h2></div>${customers.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Joined</th><th>Orders</th><th>Lifetime value</th></tr></thead><tbody>${customers.map((customer) => `<tr><td><strong>${escapeHtml(customer.name)}</strong></td><td>${escapeHtml(customer.email)}<br>${escapeHtml(customer.phone)}</td><td>${new Date(customer.created_at + 'Z').toLocaleDateString('en-IN')}</td><td>${customer.order_count}</td><td>${money.format(customer.lifetime_value)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No customer accounts yet.</strong><p>Customer details are collected only when someone is ready to order.</p></div>'}`;
    }
  } catch (error) { target.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`; }
}
function addToCart(id, quantity = 1) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return toast('This carpet is no longer available.');
  const existing = state.cart.find((item) => item.id === id);
  if ((existing?.quantity || 0) + quantity > product.stock) return toast(`Only ${product.stock} available right now.`);
  if (existing) existing.quantity += quantity;
  else state.cart.push({ id, quantity });
  saveCart();
  toast(`${product.name} added to your bag.`);
}
function openProductModal(product = null) {
  state.editingProduct = product;
  const values = product || { name: '', description: '', category: '', material: '', color: '', size: '', price: '', stock: 0, image_url: '' };
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="product-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title"><div class="modal-head"><h2 id="product-modal-title">${product ? 'Edit carpet details' : 'Add a carpet'}</h2><button class="modal-close" data-close-modal aria-label="Close">×</button></div><form class="product-form" id="product-form"><div class="form-grid"><div class="field field-span"><label for="p-name">Product name</label><input id="p-name" name="name" value="${escapeHtml(values.name)}" required></div><div class="field"><label for="p-category">Category</label><input id="p-category" name="category" value="${escapeHtml(values.category)}" required></div><div class="field"><label for="p-material">Material</label><input id="p-material" name="material" value="${escapeHtml(values.material)}"></div><div class="field"><label for="p-color">Colour</label><input id="p-color" name="color" value="${escapeHtml(values.color)}"></div><div class="field"><label for="p-size">Size</label><input id="p-size" name="size" value="${escapeHtml(values.size)}" placeholder="e.g. 5 × 7 ft"></div><div class="field"><label for="p-price">Price (₹, whole rupees)</label><input id="p-price" name="price" value="${values.price}" type="number" min="0" step="1" required></div><div class="field"><label for="p-stock">Stock quantity</label><input id="p-stock" name="stock" value="${values.stock}" type="number" min="0" step="1" required></div><div class="field field-span"><label for="p-image">Image URL (HTTPS)</label><input id="p-image" name="image_url" value="${escapeHtml(values.image_url)}" type="url" placeholder="Optional"></div><div class="field field-span"><label for="p-description">Description</label><textarea id="p-description" name="description">${escapeHtml(values.description)}</textarea></div></div><p class="error-text" id="product-error" hidden></p><div><button class="button" type="submit">${product ? 'Save changes' : 'Add to catalog'}</button></div></form></section></div>`);
  document.querySelector('#p-name').focus();
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.matches('a[href^="#"]')) {
    if (target.hash) state.filteredProducts = null;
    return;
  }
  if (target.id === 'menu-toggle') {
    const open = document.querySelector('.main-nav').classList.toggle('open');
    target.setAttribute('aria-expanded', String(open));
  } else if (target.dataset.add) {
    addToCart(Number(target.dataset.add), currentRoute().page === 'product' ? state.detailQuantity : 1);
  } else if (target.dataset.quantity) {
    const product = state.products.find((item) => item.id === currentRoute().id);
    state.detailQuantity = Math.max(1, Math.min(product?.stock || 1, state.detailQuantity + Number(target.dataset.quantity)));
    document.querySelector('#detail-quantity').textContent = state.detailQuantity;
  } else if (target.dataset.cartQty) {
    const item = state.cart.find((line) => line.id === Number(target.dataset.cartQty));
    const product = state.products.find((line) => line.id === item?.id);
    const updated = Math.max(1, Math.min(product?.stock || 1, item.quantity + Number(target.dataset.delta)));
    item.quantity = updated;
    saveCart();
    render();
  } else if (target.dataset.remove) {
    state.cart = state.cart.filter((item) => item.id !== Number(target.dataset.remove));
    saveCart(); render();
  } else if (target.dataset.authMode) {
    state.authMode = target.dataset.authMode; render();
  } else if (target.hasAttribute('data-logout')) {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null; render(); toast('You have signed out.');
  } else if (target.dataset.adminTab) {
    state.adminTab = target.dataset.adminTab;
    document.querySelectorAll('[data-admin-tab]').forEach((tab) => tab.classList.toggle('active', tab === target));
    loadAdminTab();
  } else if (target.hasAttribute('data-new-product')) {
    openProductModal();
  } else if (target.dataset.editProduct) {
    const product = await api('/api/admin/products').then((items) => items.find((item) => item.id === Number(target.dataset.editProduct)));
    if (product) openProductModal(product);
  } else if (target.dataset.hideProduct) {
    if (confirm('Hide this carpet from the public catalog? Order history will be kept.')) {
      await api(`/api/admin/products/${target.dataset.hideProduct}`, { method: 'DELETE' });
      await refreshProducts(); loadAdminTab(); toast('Carpet hidden from the catalog.');
    }
  } else if (target.hasAttribute('data-close-modal') || target.id === 'product-modal') {
    document.querySelector('#product-modal')?.remove();
  }
});
document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-order-status]')) {
    try {
      await api(`/api/admin/orders/${event.target.dataset.orderStatus}`, { method: 'PATCH', body: { status: event.target.value } });
      toast('Order status updated.');
    } catch (error) { toast(error.message); loadAdminTab(); }
  }
});
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'hero-search') {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(form)).toString();
    location.hash = `#catalog${query ? `?${query}` : ''}`;
  } else if (form.id === 'filter-form') {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    for (const [key, value] of [...params]) if (!value) params.delete(key);
    const query = params.toString();
    try { await refreshProducts(query ? `?${query}` : ''); state.filteredProducts = state.products; history.replaceState(null, '', `#catalog${query ? `?${query}` : ''}`); render(); }
    catch (error) { toast(error.message); }
  } else if (form.id === 'auth-form') {
    event.preventDefault();
    const errorTarget = document.querySelector('#auth-error');
    const data = Object.fromEntries(new FormData(form));
    const register = form.dataset.mode === 'register';
    try {
      const result = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: data });
      state.user = result.user;
      render();
      toast(register ? 'Your account is ready.' : 'Welcome back.');
    } catch (error) { errorTarget.textContent = error.message; errorTarget.hidden = false; }
  } else if (form.id === 'order-form') {
    event.preventDefault();
    if (!state.user) return;
    const errorTarget = document.querySelector('#order-error');
    const data = Object.fromEntries(new FormData(form));
    data.items = state.cart.map(({ id, quantity }) => ({ id, quantity }));
    try {
      const order = await api('/api/orders', { method: 'POST', body: data });
      state.cart = []; saveCart();
      app.innerHTML = `<div class="page-shell"><div class="empty-state" style="margin-top:35px"><p class="eyebrow" style="justify-content:center">Order received</p><strong>Thank you, ${escapeHtml(state.user.name)}.</strong><p>Order #${order.id} is in. Our team will contact you to confirm carpet availability, delivery and payment.</p><a class="button button-small" href="#account">View your orders</a></div></div>`;
      history.replaceState(null, '', '#order-placed');
    } catch (error) { errorTarget.textContent = error.message; errorTarget.hidden = false; }
  } else if (form.id === 'product-form') {
    event.preventDefault();
    const errorTarget = document.querySelector('#product-error');
    const data = Object.fromEntries(new FormData(form));
    data.price = Number(data.price); data.stock = Number(data.stock);
    try {
      if (state.editingProduct) await api(`/api/admin/products/${state.editingProduct.id}`, { method: 'PUT', body: data });
      else await api('/api/admin/products', { method: 'POST', body: data });
      document.querySelector('#product-modal').remove();
      await refreshProducts(); loadAdminTab();
      toast(state.editingProduct ? 'Carpet details updated.' : 'Carpet added to the catalog.');
    } catch (error) { errorTarget.textContent = error.message; errorTarget.hidden = false; }
  }
});
window.addEventListener('hashchange', async () => {
  const { page } = currentRoute();
  if (page === 'catalog') {
    const query = location.hash.split('?')[1] || '';
    try { await refreshProducts(query ? `?${query}` : ''); } catch (error) { toast(error.message); }
  } else if (page === 'product') state.detailQuantity = 1;
  render();
});
document.querySelector('#year').textContent = new Date().getFullYear();
async function start() {
  saveCart();
  try {
    const [config, session] = await Promise.all([api('/api/config'), api('/api/session')]);
    state.config = config; state.user = session.user;
    document.title = `${config.storeName} | Carpets for your home`;
    document.querySelector('#brand-name').textContent = config.storeName;
    document.querySelector('#footer-name').textContent = config.storeName;
    document.querySelector('#footer-name-short').textContent = config.storeName;
    const contact = document.querySelector('#footer-contact');
    contact.innerHTML = `${config.phone ? `<a href="tel:${escapeHtml(config.phone)}">${escapeHtml(config.phone)}</a>` : ''}${config.whatsapp ? `<a href="https://wa.me/${escapeHtml(config.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noreferrer">WhatsApp our team</a>` : ''}${config.address ? `<span>${escapeHtml(config.address)}</span>` : '<span>Mirzapur · Uttar Pradesh</span>'}`;
    await refreshProducts();
    render();
    if (location.hash.startsWith('#catalog?')) {
      const params = new URLSearchParams(location.hash.split('?')[1]);
      await refreshProducts(`?${params}`); state.filteredProducts = state.products; render();
    }
  } catch (error) {
    app.innerHTML = `<div class="page-shell"><div class="empty-state"><strong>The showroom couldn’t connect.</strong><p>${escapeHtml(error.message)}</p><p>Start the local app server and reload this page.</p></div></div>`;
  }
}
start();