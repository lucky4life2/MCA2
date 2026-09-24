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

// Maps the shop's admin-configurable billing_cycle to a Stripe recurring
// interval + count. Only 'yearly' is used by the membership product today,
// but every cycle the admin panel can select is handled correctly.
function recurringFor(cycle: string | null): { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } {
  switch (cycle) {
    case 'weekly': return { interval: 'week', interval_count: 1 };
    case 'biweekly': return { interval: 'week', interval_count: 2 };
    case 'monthly': return { interval: 'month', interval_count: 1 };
    case 'quarterly': return { interval: 'month', interval_count: 3 };
    case 'semiannual': return { interval: 'month', interval_count: 6 };
    case 'yearly': return { interval: 'year', interval_count: 1 };
    default: return { interval: 'month', interval_count: 1 };
  }
}

// The admin product editor offers a "fixed" billing anchor (bill everyone on
// the same date) alongside "from purchase date", and stores it in
// products.billing_anchor / billing_anchor_date. Checkout used to ignore
// both, so a fixed anchor silently billed from the purchase date instead.
// Returns the next occurrence of that anchor date, as a unix timestamp, or
// null when the product bills from the purchase date (Stripe's default).
function billingCycleAnchor(
  anchor: string | null,
  anchorDate: string | null,
  cycle: string | null,
): number | null {
  if (anchor !== 'fixed' || !anchorDate) return null;
  const parsed = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  const { interval, interval_count } = recurringFor(cycle);
  const next = new Date(parsed.getTime());

  // Walk the anchor forward one cycle at a time until it is in the future.
  // Stripe requires the anchor to be no more than one billing period away,
  // which is exactly where this stops.
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard++ < 500) {
    if (interval === 'day') next.setUTCDate(next.getUTCDate() + interval_count);
    else if (interval === 'week') next.setUTCDate(next.getUTCDate() + 7 * interval_count);
    else if (interval === 'month') next.setUTCMonth(next.getUTCMonth() + interval_count);
    else next.setUTCFullYear(next.getUTCFullYear() + interval_count);
  }
  if (next.getTime() <= now.getTime()) return null;
  return Math.floor(next.getTime() / 1000);
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

  // Checkout creates a real Stripe session (and, on success, a subscription)
  // per call — 10/5min per account is generous for a human clicking a
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

  const body = await req.json().catch(() => ({}));
  const requested: { id?: string; qty?: number }[] = Array.isArray(body?.items) ? body.items : [];
  const ids = requested.map((i) => i.id).filter((id): id is string => !!id);
  if (!ids.length) return json({ error: 'Your cart is empty.' }, 400);

  const { data: products, error: productsError } = await admin
    .from('products')
    .select('id, name, description, price, product_type, billing_cycle, billing_anchor, billing_anchor_date, active, inventory, cart_enabled')
    .in('id', ids);
  if (productsError) return json({ error: 'Could not load products.' }, 500);

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  let hasSubscription = false;
  let hasGoods = false;
  let subscriptionAnchor: number | null = null;
  let subscriptionProduct: { billing_cycle: string | null } | null = null;
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
    // Stripe line items and, on a subscription, two charges for one seat.
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
    const requestedQty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));

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
    if (isSubscription) {
      priceData.recurring = recurringFor(product.billing_cycle);
      subscriptionAnchor = billingCycleAnchor(product.billing_anchor, product.billing_anchor_date, product.billing_cycle);
      subscriptionProduct = { billing_cycle: product.billing_cycle };
    }
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
  // Stripe puts every line of a subscription session on one recurring
  // schedule, so two different subscription products in one cart would be
  // billed as a single mixed subscription. The shop only sells one
  // subscription (membership) today; reject the rest rather than create it.
  if (hasSubscription && lineItems.length > 1) {
    return json({ error: 'Only one subscription can be checked out at a time.' }, 400);
  }

  // A membership subscription is a single global seat on the profile
  // (profiles.membership_status), not a per-product purchase — someone
  // who already has an active membership (paid or admin-comped) must be
  // stopped here, server-side, before a second Stripe subscription is
  // ever created. The shop UI already disables the Subscribe button for
  // active members, but that's just UX: this endpoint is the only thing
  // actually enforcing it, since it can be called directly. Without this
  // check a duplicate subscription would auto-renew forever — nothing
  // downstream ever detects or cancels an extra one.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('membership_status, membership_current_period_end, stripe_customer_id')
    .eq('id', user.id)
    .single();
  if (profileError) return json({ error: 'Could not verify your membership status.' }, 500);

  if (hasSubscription) {
    const periodEnd = profile?.membership_current_period_end ? new Date(profile.membership_current_period_end) : null;
    const isActiveMember = profile?.membership_status === 'active' && !!periodEnd && periodEnd.getTime() > Date.now();
    if (isActiveMember) {
      return json({ error: "You're already a member — no need to subscribe again." }, 400);
    }
  }

  const origin = returnOrigin(req);

  // TEST_CHECKOUT_MODE: everything above this line (auth, rate limit, cart
  // validation, stock, duplicate-membership check) has already run exactly
  // as it would for a real purchase. From here, instead of talking to
  // Stripe, do directly what stripe-webhook's handleCompletedSession() /
  // syncSubscription() would do once Stripe told it the payment succeeded —
  // record the order and (for a subscription) flip the profile to an active
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
      customer_email: user.email ?? null,
      shipping: null,
    });
    if (orderError) {
      console.error('TEST_CHECKOUT_MODE: failed to record mock order:', orderError.message);
      return json({ error: 'Could not complete the test checkout.' }, 500);
    }

    if (!hasSubscription) {
      const stockItems = mockLines
        .filter((l) => l.product_id)
        .map((l) => ({ id: l.product_id, qty: l.quantity }));
      if (stockItems.length) {
        const { error: stockError } = await admin.rpc('shop_consume_inventory', { p_items: stockItems });
        if (stockError) console.error('TEST_CHECKOUT_MODE: failed to decrement inventory:', stockError.message);
      }
    } else {
      const { interval, interval_count } = recurringFor(subscriptionProduct?.billing_cycle ?? null);
      const periodEnd = new Date();
      if (interval === 'day') periodEnd.setUTCDate(periodEnd.getUTCDate() + interval_count);
      else if (interval === 'week') periodEnd.setUTCDate(periodEnd.getUTCDate() + 7 * interval_count);
      else if (interval === 'month') periodEnd.setUTCMonth(periodEnd.getUTCMonth() + interval_count);
      else periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + interval_count);

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

  // Reuse the Stripe customer this account already has, so a renewing or
  // returning member keeps one customer record (and one saved card, and one
  // billing-portal history) instead of a new one per checkout. `customer`
  // and `customer_email` are mutually exclusive in the API.
  const existingCustomer = typeof profile?.stripe_customer_id === 'string' && profile.stripe_customer_id
    ? profile.stripe_customer_id
    : null;

  try {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: hasSubscription ? 'subscription' : 'payment',
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      line_items: lineItems,
      success_url: `${origin}/shop.html?checkout=success`,
      cancel_url: `${origin}/shop.html?checkout=cancel`,
    };
    if (existingCustomer) params.customer = existingCustomer;
    else params.customer_email = user.email ?? undefined;

    if (hasSubscription) {
      params.subscription_data = { metadata: { user_id: user.id } };
      if (subscriptionAnchor) params.subscription_data.billing_cycle_anchor = subscriptionAnchor;
    } else {
      // Physical goods have to be posted somewhere. Without this the order
      // arrives with nothing but an email address on it.
      params.shipping_address_collection = { allowed_countries: ['US'] };
      params.phone_number_collection = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(params);
    return json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session creation failed:', err);
    return json({ error: err instanceof Error ? err.message : 'Could not start checkout.' }, 500);
  }
});
