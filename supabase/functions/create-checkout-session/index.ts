// Creates a Stripe Checkout Session for the signed-in user's cart.
//
// Called from shop.html (via supabase.js's createCheckoutSession helper)
// with { items: [{ id, qty }] }. Looks each product up server-side (never
// trusts a client-supplied price) and builds the session with price_data,
// so no pre-created Stripe Price objects are required in the Stripe
// dashboard — only a valid secret key.
//
// STRIPE_SECRET_KEY is a placeholder until a real Stripe account exists;
// set the real value with `supabase secrets set STRIPE_SECRET_KEY=...`.
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// ── Server-side error capture (approved 2026-11-02, server-side first) ──
// Only active when a SENTRY_DSN secret is set in the Supabase dashboard;
// with no DSN this is a no-op and console.error remains the only log.
// No Sentry project or DSN exists yet — creating one and setting the
// secret is the remaining dashboard step. Browser error logging is NOT
// added here (held until a privacy review).
// Everything sent is scrubbed: emails, JWTs/tokens, Stripe keys, and
// card-like digit runs. Request bodies, user emails, and payment data are
// never sent — only the scrubbed error message and the call site.
const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';
function scrubText(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(sk|pk|rk|whsec)_(live|test)_[A-Za-z0-9]+\b/g, '[stripe-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [token]')
    .replace(/\b\d{13,19}\b/g, '[card]');
}
function reportError(where: string, err: unknown): void {
  if (!SENTRY_DSN) return;
  try {
    const m = SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if (!m) return;
    const [, publicKey, host, projectId] = m;
    const eventId = crypto.randomUUID().replaceAll('-', '');
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      level: 'error',
      logger: 'edge-function',
      message: { formatted: scrubText(`${where}: ${err instanceof Error ? err.message : String(err)}`) },
    };
    const eventJson = JSON.stringify(event);
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event', content_type: 'application/json', length: new TextEncoder().encode(eventJson).length }),
      eventJson,
    ].join('\n');
    const req = fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=mca-edge/1.0, sentry_key=${publicKey}`,
      },
      body,
    });
    const waitUntil = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
    if (typeof waitUntil === 'function') waitUntil(req.catch(() => {}));
    else req.catch(() => {});
  } catch {
    // Reporting must never break the function it reports on.
  }
}


// Lets the whole shop → checkout → membership/order → Minecraft-plugin-gate
// flow be exercised end to end before a real Stripe account exists, without
// touching Stripe at all. Only takes effect when STRIPE_SECRET_KEY is still
// the placeholder (see stripeConfigured below) — the moment a real key is
// set, this whole path is dead code, so there's no way to leave it on by
// accident in production. Enable with `supabase secrets set
// TEST_CHECKOUT_MODE=true` in a dev/staging project only.
const TEST_CHECKOUT_MODE = (Deno.env.get('TEST_CHECKOUT_MODE') ?? '').toLowerCase() === 'true';

// Where the browser is sent back to after Checkout. The Origin header is
// attacker-controllable (this endpoint can be called from anywhere with a
// valid user token), so it is only honoured when it matches the site; any
// other value would let a third party collect the post-payment redirect.
// SITE_URL overrides the built-in list for a preview/staging deployment:
// `supabase secrets set SITE_URL=https://staging.example.org`.
const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://minecraftclubofamerica.me',
  'https://www.minecraftclubofamerica.me',
  'http://localhost:8787',
  'http://localhost:8788',
].filter(Boolean);

function returnOrigin(req: Request): string {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return SITE_URL || ALLOWED_ORIGINS[0] || new URL(req.url).origin;
}

// Only reflect an Origin this site actually recognises — never '*'. A
// disallowed/absent Origin gets no Allow-Origin header at all, which the
// browser treats as a CORS failure rather than granting access.
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  const headers: Record<string, string> = { ...BASE_CORS_HEADERS };
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Membership age at purchase, in full years, from a YYYY-MM-DD date of
// birth (UTC). Returns null for a missing, malformed, impossible, or
// future date — the caller treats null as "age cannot be determined"
// and fails closed.
function ageAtPurchase(dob: string | null): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age < 0 ? null : age;
}

// Cart hash shared with stripe-webhook (which recomputes it from the
// paid Stripe lines) and with the checkout_intents table: SHA-256 hex of
// the sorted "product_id:qty" pairs. The same goods in a different order
// hash the same; a changed quantity or a different product does not.
async function cartHashForLines(lines: { product_id: string | null; quantity: number }[]): Promise<string> {
  const canonical = lines
    .filter((l) => l.product_id)
    .map((l) => `${l.product_id}:${Math.max(1, Math.floor(Number(l.quantity) || 1))}`)
    .sort()
    .join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const stripeConfigured = !!STRIPE_SECRET_KEY && !STRIPE_SECRET_KEY.startsWith('sk_placeholder');
  if (!stripeConfigured && !TEST_CHECKOUT_MODE) {
    return json({ error: 'The shop is not accepting payments yet — Stripe has not been connected.' }, 503);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'You must be signed in to check out.' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Checkout creates a real Stripe session per call — a membership
  // session is a one-time payment, never a subscription — 10/5min per
  // account is generous for a human clicking a
  // button and stops a compromised/scripted session from hammering Stripe.
  // Fail closed: an error checking the limit is treated as "not allowed"
  // rather than silently skipping the throttle.
  const { data: withinLimit, error: rateLimitError } = await admin.rpc('check_rate_limit', {
    p_key: `checkout:${user.id}`,
    p_max_count: 10,
    p_window_seconds: 300,
  });
  if (rateLimitError || !withinLimit) {
    return json({ error: 'Too many checkout attempts — please wait a few minutes and try again.' }, 429);
  }

  // Bound the request body: a checkout body is { items: [...] } plus an
  // idempotency key and never legitimately approaches 64KB.
  const rawBody = await req.text().catch(() => '');
  if (rawBody.length > 65536) return json({ error: 'Request too large.' }, 413);
  let body: { items?: unknown; idempotencyKey?: unknown } = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  const requested: { id?: string; qty?: number }[] = Array.isArray(body?.items) ? body.items : [];
  const ids = requested.map((i) => i.id).filter((id): id is string => !!id);
  if (!ids.length) return json({ error: 'Your cart is empty.' }, 400);
  // The webhook records a single page of 100 Stripe line items (no
  // pagination there), so a cart larger than that would record a truncated
  // order. Cap distinct items here instead of touching the webhook.
  if (ids.length > 100) return json({ error: 'Too many distinct items in one checkout (maximum 100).' }, 400);
  // Idempotency: same key + same params makes Stripe return the original
  // session instead of creating a second one, so a retried or
  // double-clicked checkout cannot double-charge. Keys are accepted only
  // in a strict shape; anything else is ignored (old clients keep working).
  const idempotencyKey = typeof body?.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey)
    ? body.idempotencyKey
    : undefined;

  const { data: products, error: productsError } = await admin
    .from('products')
    .select('id, name, description, price, product_type, billing_cycle, billing_anchor, billing_anchor_date, active, inventory, cart_enabled')
    .in('id', ids);
  if (productsError) return json({ error: 'Could not load products.' }, 500);

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  // hasSubscription means "the cart contains the membership product".
  // product_type 'subscription' is the membership marker in the products
  // table; since 2026-11-04 it no longer creates a Stripe subscription.
  let hasSubscription = false;
  let hasGoods = false;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  // Same shape purchasedLines() in stripe-webhook builds from a real Stripe
  // session — kept in step here so a TEST_CHECKOUT_MODE order looks exactly
  // like a real one to the admin panel and account page.
  const mockLines: { product_id: string | null; name: string; quantity: number; amount_total: number }[] = [];
  const seen = new Set<string>();

  for (const item of requested) {
    const product = item.id ? byId.get(item.id) : undefined;
    if (!product || !product.active) {
      return json({ error: `One of the items in your cart is no longer available.` }, 400);
    }
    // A cart that lists the same product twice would otherwise become two
    // Stripe line items and, for a membership, two charges for one seat.
    if (seen.has(product.id)) {
      return json({ error: `"${product.name}" is in your cart more than once — remove the duplicate and try again.` }, 400);
    }
    seen.add(product.id);
    // cart_enabled is how the storefront hides a product from purchase
    // (display-only listings, etc). The UI already hides the Add to
    // Cart/Subscribe button for these, but this endpoint can be called
    // directly, so it has to enforce the same rule itself.
    if (product.cart_enabled === false) {
      return json({ error: `"${product.name}" isn't available for purchase.` }, 400);
    }
    const isSubscription = product.product_type === 'subscription';
    isSubscription ? (hasSubscription = true) : (hasGoods = true);
    // Spending cap (club decision): at most 10 of one item per order.
    // This REJECTS a quantity over 10 instead of silently clamping it
    // (B6 fix 2026-11-15) — silently shipping 10 when the member asked
    // for 11 hides that they got fewer than they paid attention to, and
    // the cap is a block, not a suggestion. A missing/invalid qty still
    // defaults to 1, as before.
    const requestedQty = Math.max(1, Math.floor(Number(item.qty) || 1));
    if (!isSubscription && requestedQty > 10) {
      return json({ error: `You can buy at most 10 of "${product.name}" in one order.` }, 400);
    }

    // Stock is only tracked for physical goods, never for a subscription
    // seat. A null inventory means the product doesn't track stock at
    // all; a number means it does, and must be enforced here — the
    // storefront already disables out-of-stock items, but nothing
    // stopped this endpoint from being called directly with a stale or
    // hand-crafted quantity that oversells what's actually left.
    if (!isSubscription && typeof product.inventory === 'number') {
      if (product.inventory <= 0) {
        return json({ error: `"${product.name}" is out of stock.` }, 400);
      }
      if (requestedQty > product.inventory) {
        return json({ error: `Only ${product.inventory} of "${product.name}" left in stock.` }, 400);
      }
    }
    const quantity = isSubscription ? 1 : requestedQty;

    // Stripe rejects a charge under $0.50, and a free product would create
    // a paid-looking order for nothing. Both are configuration mistakes in
    // the admin panel, so say so plainly rather than surfacing a raw
    // Stripe error at the checkout button.
    const unitAmount = Math.round(Number(product.price) * 100);
    if (!Number.isFinite(unitAmount) || unitAmount < 50) {
      return json({ error: `"${product.name}" is not priced for online purchase (minimum $0.50).` }, 400);
    }

    const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency: 'usd',
      unit_amount: unitAmount,
      // The product id rides along on the Stripe product so the webhook can
      // map each paid line back to a row in products — that is what lets it
      // record the order's contents and take the goods out of stock.
      product_data: {
        name: product.name,
        description: product.description || undefined,
        metadata: { product_id: product.id },
      },
    };
    lineItems.push({ price_data: priceData, quantity });
    mockLines.push({
      product_id: product.id,
      name: product.name,
      quantity,
      amount_total: (unitAmount * quantity) / 100,
    });
  }

  if (hasSubscription && hasGoods) {
    return json({ error: 'Membership and shop items can’t be checked out together — please check out the membership by itself.' }, 400);
  }
  // A membership is a single seat: two membership products in one cart
  // would charge twice for one seat. The shop only sells one membership
  // product today; reject the rest rather than create it.
  if (hasSubscription && lineItems.length > 1) {
    return json({ error: 'Only one membership can be checked out at a time.' }, 400);
  }
  // Club decision (2026-11-02): max order total $500. mockLines mirrors
  // the Stripe line items exactly, so this is the order total.
  const orderTotal = mockLines.reduce((sum, l) => sum + l.amount_total, 0);
  if (orderTotal > 500) {
    return json({ error: 'Orders are limited to $500 total.' }, 400);
  }

  // A membership is a single global seat on the profile
  // (profiles.membership_status), not a per-product purchase — someone
  // who already has an active membership (paid or admin-comped) must be
  // stopped here, server-side, before a second purchase is ever created.
  // The shop UI already disables the buy button for active members, but
  // that's just UX: this endpoint is the only thing actually enforcing
  // it, since it can be called directly. Without this check a second
  // purchase would silently overwrite the membership year.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('membership_status, membership_current_period_end, stripe_customer_id, date_of_birth, age_band, account_status')
    .eq('id', user.id)
    .single();
  if (profileError) return json({ error: 'Could not verify your membership status.' }, 500);

  // Audit fix auth:frozen-terminated-shop-checkout-no-status-gate: a
  // frozen or terminated account must not be able to start checkout at
  // all. This gate sits upstream of BOTH fulfilment paths below — the
  // real Stripe session creation and the TEST_CHECKOUT_MODE path — so
  // neither can mint a session (or a test order / test membership) for
  // such an account. The webhook re-checks at fulfilment as defence in
  // depth, in case a session created before the freeze is paid later.
  if (profile?.account_status === 'frozen' || profile?.account_status === 'terminated') {
    console.error(`Checkout refused: account is ${profile.account_status}`, { userId: user.id });
    return json({ error: 'This account is not eligible for checkout.' }, 403);
  }

  // Under-13 fix (2026-11-18): a coppa_restricted account — a child under
  // 13 whose parent has not approved the account yet — must not be able
  // to buy anything, membership or otherwise. The website UI already
  // keeps restricted accounts out of the shop (nav.js redirects them to
  // the account page), but this endpoint can be called directly, so the
  // gate has to live here. Without it, a child could pay with a parent's
  // card before any parent has approved the account, and a declined
  // account would be left holding a paid membership it can never use.
  // Same placement as the frozen/terminated gate above: upstream of both
  // fulfilment paths.
  if (profile?.account_status === 'coppa_restricted') {
    console.error('Checkout refused: account is coppa_restricted (parental consent pending)', { userId: user.id });
    return json({ error: 'Your account needs a parent or guardian to approve it before you can check out. Ask them to check their email for the approval link.' }, 403);
  }

  if (hasSubscription) {
    const periodEnd = profile?.membership_current_period_end ? new Date(profile.membership_current_period_end) : null;
    const isActiveMember = profile?.membership_status === 'active' && !!periodEnd && periodEnd.getTime() > Date.now();
    if (isActiveMember) {
      return json({ error: "You're already a member — no need to buy it again." }, 400);
    }
  }

  // Membership age cap (club decision 2026-11-04): membership may only be
  // bought at age 19 or under, judged at purchase time only. This is
  // server-side and authoritative — any client check is UX only, never
  // enforcement. profiles.date_of_birth is the authoritative source
  // (readable here via the service role; it is deliberately not
  // client-readable). It is retained for members 13 and up and cleared
  // for under-13 accounts once their band is recorded, so a missing DOB
  // falls back to age_band: 'under_13' and '13_17' both prove
  // 19-or-under. Anything else with no DOB fails closed: the member
  // must complete age verification first. Existing memberships are
  // never touched by this — no re-check, no expiry on birthdays.
  if (hasSubscription) {
    const dob = typeof profile?.date_of_birth === 'string' ? profile.date_of_birth : null;
    const band = typeof profile?.age_band === 'string' ? profile.age_band : null;
    const age = ageAtPurchase(dob);
    if (age !== null) {
      if (age > 19) {
        return json({ error: 'Membership is only available to members aged 19 or under at purchase.' }, 400);
      }
    } else if (band === 'under_13' || band === '13_17') {
      // Band proves 19-or-under without a DOB on file; allow.
    } else {
      return json({ error: 'We could not verify your age from your profile. Please complete age verification on your account page first, then try again.' }, 400);
    }
  }

  // ── Checkout-intent dedup (stress-test item 1, 2026-11-23) ───────
  // The client persists ONE idempotency key per cart (shop.page.js), but
  // a key the client never sends — a second phone, a cleared cache, an
  // old client — still mints a second payable session. So the server
  // dedups on the cart itself: cart_hash is a SHA-256 of the sorted
  // "product_id:qty" pairs (the same string the webhook recomputes from
  // the paid lines), and checkout_intents holds one row per (user, cart
  // hash). A recent row whose Stripe session is still open means "return
  // that session's URL", not "create a second session". The stored key
  // is also reused as the Stripe idempotency key, so even if the DB
  // lookup misses, Stripe itself returns the original session for a
  // same-key retry. Rows older than 24h are ignored (Stripe sessions
  // expire after ~24h by default); a changed cart is a different hash
  // and a different intent, so a legitimate second order still works.
  const cartHashValue = await cartHashForLines(mockLines);
  const { data: existingIntent } = await admin
    .from('checkout_intents')
    .select('idempotency_key, stripe_session_id, created_at')
    .eq('user_id', user.id)
    .eq('cart_hash', cartHashValue)
    .maybeSingle();
  const intentIsRecent = !!existingIntent?.created_at &&
    Date.now() - new Date(existingIntent.created_at).getTime() < 24 * 60 * 60 * 1000;
  // Prefer the stored key: the client's per-click key is only a fallback.
  const effectiveIdempotencyKey = existingIntent?.idempotency_key ?? idempotencyKey;
  if (stripeConfigured && intentIsRecent && existingIntent?.stripe_session_id) {
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(existingIntent.stripe_session_id);
      if (existingSession.status === 'open' && existingSession.url) {
        return json({ url: existingSession.url });
      }
    } catch {
      // Session gone (expired/paid/voided): fall through and create a
      // fresh one; the upsert below overwrites this intent row.
    }
  }
  if (!stripeConfigured && intentIsRecent && existingIntent?.stripe_session_id?.startsWith('test_')) {
    // TEST_CHECKOUT_MODE (Gap C): the test path used to mint a fresh fake
    // session — and a fresh order + a fresh membership grant — on every
    // call. A recent test intent replays the same success redirect with
    // no second order, mirroring the real-Stripe dedup above.
    const originForTest = returnOrigin(req);
    return json({ url: `${originForTest}/shop.html?checkout=success` });
  }

  // Club decision (2026-11-02): max 3 orders per member per day.
  // Orders are only recorded on completed payment, so every row counts.
  // Fail closed: an error checking recent orders blocks checkout rather
  // than silently skipping the limit.
  const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';  const { count: ordersToday, error: ordersTodayError } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', todayStart);
  if (ordersTodayError) return json({ error: 'Could not verify your recent orders.' }, 500);
  if ((ordersToday ?? 0) >= 3) {
    return json({ error: 'You have already placed 3 orders today — please try again tomorrow.' }, 429);
  }

  const origin = returnOrigin(req);

  // TEST_CHECKOUT_MODE: everything above this line (auth, rate limit, cart
  // validation, stock, duplicate-membership check) has already run exactly
  // as it would for a real purchase. From here, instead of talking to
  // Stripe, do directly what stripe-webhook's handleCompletedSession()
  // would do once Stripe told it the payment succeeded —
  // record the order and (for a membership) flip the profile to an active
  // member — then send the browser straight to the same success URL Stripe
  // would have redirected to. This is what lets the whole shop → checkout →
  // membership flow, and anything downstream that reads membership_status
  // (the account page, the admin panel, the Minecraft membership-gate
  // plugin), be tested before a real Stripe account exists.
  if (!stripeConfigured) {
    const amountTotal = mockLines.reduce((sum, l) => sum + l.amount_total, 0);
    const fakeSessionId = `test_${crypto.randomUUID()}`;

    const { error: orderError } = await admin.from('orders').insert({
      user_id: user.id,
      kind: hasSubscription ? 'membership' : 'goods',
      stripe_checkout_session_id: fakeSessionId,
      stripe_payment_intent_id: null,
      stripe_subscription_id: null,
      amount_total: amountTotal,
      currency: 'usd',
      status: 'paid',
      line_items: mockLines,
      cart_hash: cartHashValue,
      customer_email: user.email ?? null,
      shipping: null,
    });
    if (orderError) {
      console.error('TEST_CHECKOUT_MODE: failed to record mock order:', orderError.message);
      return json({ error: 'Could not complete the test checkout.' }, 500);
    }
    // Record the test intent so a second call for the same cart replays
    // the success redirect instead of recording a second test order.
    await admin.from('checkout_intents').upsert({
      user_id: user.id,
      cart_hash: cartHashValue,
      idempotency_key: effectiveIdempotencyKey ?? `test_${crypto.randomUUID()}`,
      stripe_session_id: fakeSessionId,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,cart_hash' });

    if (!hasSubscription) {
      const stockItems = mockLines
        .filter((l) => l.product_id)
        .map((l) => ({ id: l.product_id, qty: l.quantity }));
      if (stockItems.length) {
        const { error: stockError } = await admin.rpc('shop_consume_inventory', { p_items: stockItems });
        if (stockError) console.error('TEST_CHECKOUT_MODE: failed to decrement inventory:', stockError.message);
      }
    } else {
      // One-time membership: exactly one year from today, no renewal.
      const periodEnd = new Date();
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);

      const { error: membershipError } = await admin.from('profiles').update({
        membership_status: 'active',
        membership_source: 'test_checkout',
        membership_current_period_end: periodEnd.toISOString(),
      }).eq('id', user.id);
      if (membershipError) {
        console.error('TEST_CHECKOUT_MODE: failed to update membership:', membershipError.message);
        return json({ error: 'Could not complete the test checkout.' }, 500);
      }
    }

    return json({ url: `${origin}/shop.html?checkout=success` });
  }

  // Reuse the Stripe customer this account already has, so a returning
  // member keeps one customer record (and one saved card, and one
  // billing-portal history) instead of a new one per checkout. `customer`
  // and `customer_email` are mutually exclusive in the API.
  const existingCustomer = typeof profile?.stripe_customer_id === 'string' && profile.stripe_customer_id
    ? profile.stripe_customer_id
    : null;

  try {
    // Membership checkout is a one-time payment, never a subscription:
    // there is no Stripe subscription object to renew, so nothing here
    // sets recurring pricing or subscription_data. The webhook tells a
    // membership session apart from a goods session by the metadata flag
    // below (session.mode is 'payment' for both now).
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      client_reference_id: user.id,
      // cart_hash rides in metadata so the webhook can recognise a second
      // paid session for the same cart as a duplicate (goods refund).
      metadata: hasSubscription ? { user_id: user.id, membership: 'true', cart_hash: cartHashValue } : { user_id: user.id, cart_hash: cartHashValue },
      line_items: lineItems,
      success_url: `${origin}/shop.html?checkout=success`,
      cancel_url: `${origin}/shop.html?checkout=cancel`,
    };
    if (existingCustomer) params.customer = existingCustomer;
    else params.customer_email = user.email ?? undefined;

    if (!hasSubscription) {
      // Physical goods have to be posted somewhere. Without this the order
      // arrives with nothing but an email address on it.
      params.shipping_address_collection = { allowed_countries: ['US'] };
      params.phone_number_collection = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(params, effectiveIdempotencyKey ? { idempotencyKey: effectiveIdempotencyKey } : undefined);
    // Persist the intent: the next call for this exact cart returns this
    // session's URL instead of creating a second payable session.
    // The stored key is what makes a same-key Stripe retry return the
    // original session even if the DB lookup above ever misses.
    await admin.from('checkout_intents').upsert({
      user_id: user.id,
      cart_hash: cartHashValue,
      idempotency_key: effectiveIdempotencyKey ?? session.id,
      stripe_session_id: session.id,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,cart_hash' });
    return json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session creation failed:', err);
    reportError('create-checkout-session', err);
    return json({ error: err instanceof Error ? err.message : 'Could not start checkout.' }, 500);
  }
});
