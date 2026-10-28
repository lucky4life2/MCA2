
// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'cart-qty': (el, e) => window.cartQty(el.dataset.id, Number(el.dataset.delta)),
  'cart-remove': (el, e) => window.cartRemove(el.dataset.id),
  'shop-add-to-cart-detail': (el, e) => { window.shopAddToCart(JSON.parse(el.dataset.prod)); window.closeDetail(); },
  'shop-add-to-cart': (el, e) => window.shopAddToCart(JSON.parse(el.dataset.prod)),
  'open-billing-portal': (el, e) => window.openBillingPortal(el),
  'select-detail-thumb': (el, e) => window.selectDetailThumb(Number(el.dataset.index)),
  'close-detail': (el, e) => window.closeDetail(),
  'open-product-detail': (el, e) => window.openProductDetail(el.dataset.id),
  'load-products': (el, e) => window.loadProducts(),
};

document.addEventListener('click', (e) => {
  const actionEl = e.target.closest?.('[data-action]');
  if (!actionEl) return;
  // An inner element that asked to stop (e.g. a Sign In link inside a
  // clickable card) wins over the outer action: the click still follows
  // the inner element's own default, it just does not trigger the card.
  const stopEl = e.target.closest?.('[data-stop]');
  if (stopEl && stopEl !== actionEl && actionEl.contains(stopEl)) return;
  const handler = _ACTION_HANDLERS[actionEl.dataset.action];
  if (handler) handler(actionEl, e);
});

// Keyboard activation for role=button rows and cards: native buttons and
// links already fire click on Enter/Space, so only non-native controls
// need this. It replaces the old pattern where a keydown handler re-fired click.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.closest) return;
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const actionEl = t.closest('[data-action]');
  if (!actionEl) return;
  e.preventDefault();
  const handler = _ACTION_HANDLERS[actionEl.dataset.action];
  if (handler) handler(actionEl, e);
});

  import { supabase, signOut, hasPermission, createCheckoutSession, createBillingPortalSession, getMembership } from './supabase.js';

  let _isAdmin = false, _isLoggedIn = false, _userId = null, _initialized = false;
  let _products = [];
  // Membership state for the signed-in user, or null when signed out /
  // not yet loaded. The storefront needs it to stop an existing member
  // from starting a second subscription: the checkout function rejects
  // that server-side, but only after the member has clicked through to a
  // checkout that was never going to work.
  let _membership = null;

  // Product text is admin-supplied but still untrusted at render time: every
  // field below lands in innerHTML, and several land inside quoted attributes.
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Image URLs come from the products table; only http(s) and relative paths
  // may reach a src, so a javascript: value can't execute.
  function safeUrl(url) {
    // Positive allowlist: the browser's own URL parser resolves the value (it
    // strips every leading C0 control char, which the old regex missed) and only
    // http(s) survives. Relative links resolve against this page, so they still work.
    // Empty/missing input must NOT fall through: new URL('', base) resolves to the
    // page URL itself, which would render a broken <img> pointing at this document.
    if (url == null || String(url).trim() === '') return '';
    try {
      const p = new URL(String(url), location.href);
      return (p.protocol === 'https:' || p.protocol === 'http:') ? p.href : '';
    } catch { return ''; }
  }

  // Helper: race any supabase call against a timeout so DNS/network issues
  // don't leave the page hanging forever.
  function withTimeout(promise, ms = 8000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out — having trouble reaching the server.')), ms))
    ]);
  }

  // ── Subscription billing periods
  // The admin product editor has offered six cycles ever since billing_cycle
  // was added, but the storefront rendered every subscription as "/mo". A
  // yearly plan therefore advertised itself at a twelfth of its real cadence.
  // Everything below reads the product's actual cycle instead.
  const BILLING_PERIODS = {
    weekly:     { short: '/wk',  label: 'Billed weekly' },
    biweekly:   { short: '/2wk', label: 'Billed every 2 weeks' },
    monthly:    { short: '/mo',  label: 'Billed monthly' },
    quarterly:  { short: '/qtr', label: 'Billed every 3 months' },
    semiannual: { short: '/6mo', label: 'Billed every 6 months' },
    yearly:     { short: '/yr',  label: 'Billed yearly' },
  };
  // Products created before billing_cycle existed, and cart entries saved
  // before the cycle was stored, both arrive with no cycle. Monthly was the
  // effective behaviour then, so keep it as the fallback rather than showing
  // a bare price with no cadence at all.
  function billingPeriod(cycle) { return BILLING_PERIODS[cycle] || BILLING_PERIODS.monthly; }
  function isSubscription(x) { return !!x && x.product_type === 'subscription'; }
  // A subscription is one seat: Stripe is sent quantity 1 no matter what
  // the cart says, so letting the cart show 2 only misprices the subtotal.
  function maxQty(x) { return isSubscription(x) ? 1 : 99; }
  function priceLabel(x) {
    const amount = '$' + Number(x.price).toFixed(2);
    return isSubscription(x) ? amount + billingPeriod(x.billing_cycle).short : amount;
  }

  // How a subscription product should present itself to the signed-in
  // viewer. An existing member cannot buy a second seat (the checkout
  // function refuses it), and someone whose payment failed needs the
  // billing portal, not a fresh subscription.
  function subscriptionState() {
    if (!_membership) return 'none';
    if (_membership.isActive) return _membership.source === 'admin_grant' ? 'comped' : 'active';
    if (_membership.status === 'past_due') return 'past_due';
    return 'none';
  }

  window.openBillingPortal = async (btn) => {
    const prev = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
    // Clear any previous portal error.
    document.querySelectorAll('.portal-error').forEach(function (e) { e.remove(); });
    try {
      window.location.href = await createBillingPortalSession('shop.html');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = prev; }
      // Inline error instead of alert(): e.g. an active membership record
      // with no Stripe customer behind it (admin grants, test checkouts).
      var msg = document.createElement('p');
      msg.className = 'portal-error';
      msg.style.cssText = 'color:#c0392b;font-size:13px;margin-top:8px;';
      msg.textContent = err.message || 'Could not open the billing portal.';
      if (btn && btn.parentNode) btn.parentNode.insertBefore(msg, btn.nextSibling);
      else document.body.appendChild(msg);
    }
  };

  // ── Cart
  function cartKey() { return 'mca_cart_' + _userId; }
  function getCart() {
    if (!_userId) return [];
    let items;
    try { items = JSON.parse(localStorage.getItem(cartKey())) || []; } catch(e) { return []; }
    if (!Array.isArray(items)) return [];
    // Normalise on read so a cart saved before the one-seat rule (or hand
    // edited in localStorage) can't show a subtotal the checkout won't
    // charge — Stripe is sent quantity 1 for a subscription regardless.
    return items.map(i => ({ ...i, qty: Math.min(maxQty(i), Math.max(1, Math.floor(Number(i.qty) || 1))) }));
  }
  function saveCart(items) {
    if (!_userId) return;
    // getCart() already tolerates blocked storage; without the same guard here
    // a quota/private-mode throw escaped addToCart() before the drawer opened,
    // so "Add to Cart" looked like a dead button.
    try { localStorage.setItem(cartKey(), JSON.stringify(items)); }
    catch (e) { alert('Your browser is blocking local storage, so the cart could not be saved.'); }
    updateFloatCart();
    if (window._mcaUpdateCartBadge) window._mcaUpdateCartBadge();
  }
  // A subscription is a single recurring entitlement — quantity is meaningless
  // for it, and letting it climb meant a second "Subscribe" click checked out
  // as qty 2, i.e. double the recurring charge for one membership.
  function addToCart(product) {
    const items = getCart();
    // Stripe bills one Checkout Session as either a subscription or a
    // one-off payment, never both, and the checkout function rejects a
    // mixed cart. Catch it at the point of the click instead of at the
    // end of checkout, where the cart is already full.
    const mixing = isSubscription(product)
      ? items.some(i => !isSubscription(i))
      : items.some(i => isSubscription(i));
    if (mixing) {
      alert(isSubscription(product)
        ? 'Membership has to be checked out on its own. Empty your cart (or check out first), then subscribe.'
        : 'Your cart has a membership in it, and membership is checked out on its own. Check out the membership first, then add shop items.');
      return;
    }
    if (isSubscription(product) && items.some(i => isSubscription(i))) {
      alert('Only one subscription can be checked out at a time.');
      return;
    }
    const ex = items.find(i => i.id === product.id);
    if (ex) { ex.qty = Math.min(maxQty(ex), (ex.qty || 1) + 1); }
    else { items.push({...product, qty: 1}); }
    saveCart(items); renderCartDrawer(); openCartDrawer();
  }
  function removeFromCart(id) { saveCart(getCart().filter(i => i.id !== id)); renderCartDrawer(); }
  function changeQty(id, d) {
    const items = getCart(), item = items.find(i => i.id === id);
    if (!item) return;
    item.qty = Math.min(maxQty(item), Math.max(1, (item.qty || 1) + d));
    saveCart(items); renderCartDrawer();
  }
  window.cartQty    = (id, d) => changeQty(id, d);
  window.cartRemove = (id)    => removeFromCart(id);
  window.shopAddToCart = (p)  => addToCart(p);

  function updateFloatCart() {
    const items = getCart();
    const total = items.reduce((s, i) => s + (i.qty || 1), 0);
    const btn   = document.getElementById('btn-float-cart');
    const badge = document.getElementById('float-cart-badge');
    if (!_isLoggedIn || total === 0) { btn.classList.remove('visible'); return; }
    btn.classList.add('visible');
    badge.textContent = total > 99 ? '99+' : total;
  }

  // ── Cart drawer
  const elCartOverlay  = document.getElementById('cart-overlay');
  const elCartDrawer   = document.getElementById('cart-drawer');
  const elCartBody     = document.getElementById('cart-drawer-body');
  const elCartFooter   = document.getElementById('cart-drawer-footer');
  const elCartSubtotal = document.getElementById('cart-subtotal');
  const elCartSubtotalNote = document.getElementById('cart-subtotal-note');
  function openCartDrawer()  { elCartOverlay.classList.add('open'); elCartDrawer.classList.add('open'); }
  function closeCartDrawer() { elCartOverlay.classList.remove('open'); elCartDrawer.classList.remove('open'); }
  document.getElementById('cart-drawer-close').addEventListener('click', closeCartDrawer);
  document.getElementById('btn-float-cart').addEventListener('click', () => { renderCartDrawer(); openCartDrawer(); });
  elCartOverlay.addEventListener('click', closeCartDrawer);
  const navCartBtn = document.getElementById('nav-cart-btn');
  if (navCartBtn) navCartBtn.addEventListener('click', () => { renderCartDrawer(); openCartDrawer(); });

  // ── Checkout
  document.querySelector('.btn-checkout').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const items = getCart();
    if (!items.length) return;
    // Defense in depth against a cart that went stale while this tab sat
    // open (e.g. a membership was added, then granted/renewed elsewhere
    // before checkout): never send a subscription line at qty > 1, and
    // never let an already-active member check out another subscription.
    if (_membership?.isActive && items.some(isSubscription)) {
      alert("You're already a member — remove the membership from your cart to continue.");
      return;
    }
    const prevText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Redirecting to checkout...';
    try {
      const url = await createCheckoutSession(items.map(i => ({ id: i.id, qty: isSubscription(i) ? 1 : (i.qty || 1) })));
      window.location.href = url;
    } catch (err) {
      alert(err.message || 'Could not start checkout.');
      btn.disabled = false; btn.textContent = prevText;
    }
  });

  // Stripe redirects back here with ?checkout=success|cancel. The cart is
  // keyed per-user, so it can only be cleared once _userId is known —
  // handled inside init() below.
  const _checkoutReturn = new URLSearchParams(window.location.search).get('checkout');
  let _checkoutHandled = false;
  if (_checkoutReturn) history.replaceState(null, '', window.location.pathname);

  function renderCartDrawer() {
    const items = getCart();
    if (!items.length) { elCartBody.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><p>Your cart is empty.</p></div>'; elCartFooter.style.display = 'none'; return; }
    const sub = items.reduce((s, i) => s + (Number(i.price) || 0) * Math.min(maxQty(i), i.qty || 1), 0);
    elCartBody.innerHTML = items.map(i => `
      <div class="cart-item">
        ${safeUrl(i.image_url) ? `<img class="cart-item-img" src="${esc(safeUrl(i.image_url))}" alt="${esc(i.name)}">` : `<div class="cart-item-img-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></div>`}
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(i.name)}</div>
          <div class="cart-item-price">${isSubscription(i) ? priceLabel(i) : priceLabel(i) + ' each'}</div>
          <div class="cart-item-controls">
            ${isSubscription(i) ? '' : `
            <button class="cart-qty-btn" type="button" aria-label="Decrease quantity" data-action="cart-qty" data-id="${esc(i.id)}" data-delta="-1">−</button>
            <span class="cart-qty">${i.qty || 1}</span>
            <button class="cart-qty-btn" type="button" aria-label="Increase quantity" data-action="cart-qty" data-id="${esc(i.id)}" data-delta="1">+</button>`}
            <button class="cart-item-remove" type="button" data-action="cart-remove" data-id="${esc(i.id)}">Remove</button>
          </div>
        </div>
      </div>`).join('');
    elCartSubtotal.textContent = '$' + sub.toFixed(2);
    // The subtotal adds recurring and one-off items together, so say plainly
    // which part of it renews rather than letting it read as a single charge.
    const subs = items.filter(isSubscription);
    elCartSubtotalNote.innerHTML = subs.length
      ? subs.map(i => `${esc(i.name)} renews at ${esc(priceLabel(i))} (${esc(billingPeriod(i.billing_cycle).label.toLowerCase())}) until you cancel.`).join('<br>')
      : '';
    elCartSubtotalNote.style.display = subs.length ? '' : 'none';
    elCartFooter.style.display = '';
  }

  // ── Product detail modal
  const elDetailOverlay = document.getElementById('detail-overlay');
  const elDetailInner   = document.getElementById('detail-modal-inner');
  function openDetail(p) {
    const showCart = p.cart_enabled !== false;
    const specs = [
      p.weight      && { label: 'Weight',     value: p.weight },
      p.dimensions  && { label: 'Dimensions', value: p.dimensions },
      p.material    && { label: 'Material',   value: p.material },
      p.sizes       && { label: 'Sizes',      value: p.sizes },
      p.colors      && { label: 'Colors',     value: p.colors },
      p.sku         && { label: 'SKU',        value: p.sku },
    ].filter(Boolean);

    let cartBtn = '';
    if (showCart) {
      if (_isLoggedIn) {
        const prod = esc(JSON.stringify({id:p.id,name:p.name,price:p.price,image_url:p.image_url||null,product_type:p.product_type||null,billing_cycle:p.billing_cycle||null}));
        const isSubDetail = p.product_type === 'subscription';
        const subState = isSubDetail ? subscriptionState() : 'none';
        const isOOSDetail = !isSubDetail && p.inventory === 0;
        if (subState === 'active') {
          cartBtn = `<button class="btn-detail-cart" data-action="open-billing-portal">Manage Membership</button>`;
        } else if (subState === 'comped') {
          cartBtn = `<button class="btn-detail-cart" disabled>Membership Included</button>`;
        } else if (subState === 'past_due') {
          cartBtn = `<button class="btn-detail-cart" data-action="open-billing-portal">Update Payment</button>`;
        } else {
          const detailLabel = isSubDetail ? 'Subscribe' : (isOOSDetail ? 'Out of Stock' : 'Add to Cart');
          cartBtn = `<button class="btn-detail-cart" ${isOOSDetail?'disabled':''} data-action="shop-add-to-cart-detail" data-prod="${prod}">${detailLabel}</button>`;
        }
      } else {
        cartBtn = `<a class="btn-detail-cart sign-in" href="login.html?return=shop.html">Sign In to Add to Cart</a>`;
      }
    }

    const gallery = (p.images && Array.isArray(p.images) && p.images.length)
      ? p.images.map(img => img.url)
      : [p.image_url, p.image_url2].filter(Boolean);

    const mainImg = gallery[0]
      ? `<img class="detail-modal-img" id="detail-modal-main-img" src="${esc(safeUrl(gallery[0]))}" alt="${esc(p.name)}">`
      : `<div class="detail-modal-img-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l4-4 4 4 4-4 4 4"/><circle cx="8.5" cy="13.5" r="1.5"/></svg></div>`;

    window._detailGallery = gallery;

    const thumbStrip = gallery.length > 1 ? `
      <div class="detail-modal-thumbs" style="display:flex;gap:6px;padding:8px 0 0;flex-wrap:wrap;">
        ${gallery.map((url, i) => `<img src="${esc(safeUrl(url))}" alt="${esc(p.name)} image ${i + 1}" data-action="select-detail-thumb" data-index="${i}" style="width:48px;height:48px;object-fit:cover;border-radius:5px;cursor:pointer;border:2px solid ${i===0?'var(--blue)':'transparent'};">`).join('')}
      </div>` : '';

    elDetailInner.innerHTML = `
      ${mainImg}
      ${thumbStrip}
      <div class="detail-modal-body">
        <div class="detail-modal-header">
          <div>
            ${p.category ? `<div class="detail-modal-category">${esc(p.category)}</div>` : ''}
            <div class="detail-modal-name">${esc(p.name)}</div>
          </div>
          <button class="detail-modal-close" type="button" aria-label="Close product details" data-action="close-detail">✕</button>
        </div>
        <div class="detail-modal-price">${priceLabel(p)}</div>
        ${p.product_type === 'subscription' ? `<div class="detail-modal-stock" style="color:var(--green);font-weight:600;">${billingPeriod(p.billing_cycle).label}</div>` : `<div class="detail-modal-stock ${p.inventory===0?'out':p.inventory<5?'low':''}">` + (p.inventory===0 ? 'Out of stock' : p.inventory+' in stock') + '</div>'}
        ${p.description ? `<div class="detail-modal-desc">${esc(p.description)}</div>` : ''}
        ${specs.length ? `
          <div class="detail-modal-specs">
            <div class="detail-modal-specs-title">Specifications</div>
            <div class="detail-modal-spec-grid">
              ${specs.map(s => `<div class="detail-modal-spec"><div class="detail-modal-spec-label">${esc(s.label)}</div><div class="detail-modal-spec-value">${esc(s.value)}</div></div>`).join('')}
            </div>
          </div>` : ''}
      </div>
      ${cartBtn ? `<div class="detail-modal-footer">${cartBtn}</div>` : ''}`;
    elDetailOverlay.classList.add('open');
  }
  window.closeDetail = () => elDetailOverlay.classList.remove('open');
  window.selectDetailThumb = (i) => {
    const url = window._detailGallery?.[i];
    if (!url) return;
    const mainImg = document.getElementById('detail-modal-main-img');
    const safe = safeUrl(url);
    if (mainImg && safe) mainImg.src = safe;
    document.querySelectorAll('.detail-modal-thumbs img').forEach((el, j) => {
      el.style.borderColor = j === i ? 'var(--blue)' : 'transparent';
    });
  };
  elDetailOverlay.addEventListener('click', e => { if (e.target === elDetailOverlay) closeDetail(); });

  // ── Element refs
  const elLoading    = document.getElementById('shop-loading');
  const elShop       = document.getElementById('shop-wrap');
  const elAdminBar   = document.getElementById('shop-admin-bar');
  const elGrid       = document.getElementById('product-grid');
  const elCount      = document.getElementById('product-count');

  function applyState() {
    elAdminBar.classList.toggle('visible', _isAdmin);
    document.body.classList.toggle('admin-mode', _isAdmin);
  }

  async function init(user, accessToken, isAdmin) {
    _isLoggedIn = !!user; _userId = user?.id || null;
    _isAdmin = !!isAdmin;
    elLoading.style.display = 'none'; elShop.style.display = 'block';
    updateFloatCart();
    applyState();
    // init() deliberately re-runs on later auth events (SIGNED_IN,
    // TOKEN_REFRESHED, INITIAL_SESSION) to refresh the admin bar, but the
    // Stripe return is a one-shot: without this guard the success alert fired
    // once per event and every re-run called saveCart([]) again, wiping items
    // the user had added since paying.
    if (_checkoutReturn && !_checkoutHandled) {
      _checkoutHandled = true;
      if (_checkoutReturn === 'success' && _userId) {
        saveCart([]);
        alert('Payment received! Your order or membership is now active — it may take a minute to update on your account page.');
      } else if (_checkoutReturn === 'cancel') {
        alert('Checkout was canceled — your cart is still here whenever you\'re ready.');
      }
    }
    // Membership state decides how the membership product is rendered, so
    // it is resolved before the grid is drawn rather than after.
    try { _membership = await withTimeout(getMembership(), 6000); }
    catch (e) { _membership = null; }
    loadProducts();
  }

  // Show the shop immediately in a signed-out state — no spinner wait.
  // Auth will upgrade the UI once _mcaAuthReady resolves (usually <500 ms).
  elLoading.style.display = 'none'; elShop.style.display = 'block';
  loadProducts(); updateFloatCart();

  // Bootstrap: wait for nav.js to finish resolving auth. nav.js now creates
  // window._mcaAuthReady at module evaluation time (before injectNav) so it
  // is always defined by the time we reach this line — no more
  // Promise.resolve(undefined) falling through to the 6 s hard timeout.
  try {
    const authResult = await withTimeout(window._mcaAuthReady, 6000);
    const { user, session, isAdmin } = authResult || {};
    if (!_initialized) {
      _initialized = true;
      if (user) await init(user, session?.access_token || null, !!isAdmin);
      // If no user, already rendered signed-out above — just mark done.
    }
  } catch(e) {
    if (!_initialized) _initialized = true;
  }

  // Listen for live sign-in/out/refresh events. Also handles INITIAL_SESSION
  // to guarantee the admin bar is applied even if _mcaAuthReady beat us here.
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (!session?.user) return;
      // profiles.role is a stale legacy column; admin visibility is governed
      // by the role/permission system, same as every other page.
      let isAdmin = false;
      try {
        isAdmin = await withTimeout(hasPermission('can_view_admin'), 6000);
      } catch(e) { isAdmin = false; }
      // Re-init to apply correct admin bar / product visibility state.
      _initialized = true;
      await init(session.user, session.access_token || null, isAdmin);
    } else if (event === 'SIGNED_OUT') {
      _initialized = false; _isAdmin = false; _isLoggedIn = false; _userId = null; _membership = null;
      elLoading.style.display = 'none'; elShop.style.display = 'block';
      applyState(); loadProducts(); updateFloatCart();
    }
  });

  // ── Load products
  // Store products in memory for detail modal
  window.openProductDetail = async (id) => {
    let p = _products.find(x => x.id === id);
    if (!p) { const { data } = await supabase.from('products').select('*').eq('id', id).single(); p = data; }
    if (p) openDetail(p);
  };
  async function loadProducts() {
    let data, error;
    try {
      ({ data, error } = await withTimeout(supabase.from('products').select('*').order('created_at', { ascending: false }), 8000));
    } catch(e) {
      elGrid.innerHTML = `<div class="product-empty"><div class="product-empty-icon">⚠️</div><p>${esc(e.message || 'Failed to load products.')}</p><button class="btn-add-to-cart" style="margin-top:12px;max-width:160px;" data-action="load-products">Retry</button></div>`;
      return;
    }
    if (error) { elGrid.innerHTML = `<div class="product-empty"><p>Error: ${esc(error.message)}</p></div>`; return; }
    _products = data || [];
    const visible = _isAdmin ? _products : _products.filter(p => p.active);
    elCount.textContent = visible.length === 1 ? '1 product' : `${visible.length} products`;
    if (!visible.length) { elGrid.innerHTML = `<div class="product-empty"><div class="product-empty-icon">📦</div><p>No products available yet.</p></div>`; return; }
    elGrid.innerHTML = visible.map(p => {
      const cartAllowed = p.cart_enabled !== false;
      let cartBtn = '';
      if (cartAllowed) {
        if (!_initialized) {
          cartBtn = `<button class="btn-add-to-cart" disabled>Loading\u2026</button>`;
        } else if (_isLoggedIn) {
          const prod = esc(JSON.stringify({id:p.id,name:p.name,price:p.price,image_url:p.image_url||null,product_type:p.product_type||null,billing_cycle:p.billing_cycle||null}));
          const isSub = p.product_type === 'subscription';
          const subState = isSub ? subscriptionState() : 'none';
          const isOutOfStock = !isSub && p.inventory === 0;
          if (subState === 'active') {
            cartBtn = `<button class="btn-add-to-cart" data-action="open-billing-portal">Manage Membership</button>`;
          } else if (subState === 'comped') {
            cartBtn = `<button class="btn-add-to-cart" disabled >Membership Included</button>`;
          } else if (subState === 'past_due') {
            cartBtn = `<button class="btn-add-to-cart" data-action="open-billing-portal">Update Payment</button>`;
          } else {
            const btnLabel = isSub ? 'Subscribe' : (isOutOfStock ? 'Out of Stock' : 'Add to Cart');
            cartBtn = `<button class="btn-add-to-cart" ${isOutOfStock?'disabled':''} data-action="shop-add-to-cart" data-prod="${prod}">${btnLabel}</button>`;
          }
        } else {
          cartBtn = `<a class="btn-add-to-cart sign-in-prompt" href="login.html?return=shop.html" data-stop>Sign In to Add to Cart</a>`;
        }
      }
      return `<div class="product-card" role="button" tabindex="0" aria-label="View ${esc(p.name)}" data-action="open-product-detail" data-id="${esc(p.id)}">
        ${safeUrl(p.image_url) ? `<img class="product-card-img" src="${esc(safeUrl(p.image_url))}" alt="${esc(p.name)}">` : `<div class="product-card-img-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9l4-4 4 4 4-4 4 4"/><circle cx="8.5" cy="13.5" r="1.5"/></svg></div>`}
        <div class="product-card-body">
          ${p.category ? `<div class="product-card-category">${esc(p.category)}</div>` : ''}
          <div class="product-card-name">${esc(p.name)}</div>
          ${p.description ? `<div class="product-card-desc">${esc(p.description)}</div>` : ''}
          <div class="product-card-footer">
            <div class="product-card-price">${priceLabel(p)}</div>
            ${p.product_type === 'subscription'
              ? `<div class="product-card-stock" style="color:var(--green);font-weight:600;">${billingPeriod(p.billing_cycle).label}</div>`
              : `<div class="product-card-stock ${p.inventory===0?'out':p.inventory<5?'low':''}">${p.inventory===0?'Out of stock':`${p.inventory} in stock`}</div>`}
          </div>
          ${cartBtn}

        </div>
      </div>`;
    }).join('');
  }
  window.loadProducts = loadProducts;

