// Receives Stripe webhook events and fulfills orders / membership status.
//
// Register this function's URL as a webhook endpoint in the Stripe
// dashboard once a real Stripe account exists:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// listening for: checkout.session.completed,
// checkout.session.async_payment_succeeded, customer.subscription.updated,
// customer.subscription.deleted, invoice.payment_failed,
// invoice.payment_succeeded, charge.refunded, charge.dispute.created,
// charge.dispute.closed.
//
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are placeholders until a real
// Stripe account exists; set the real values with
// `supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...`.
//
// Deployed with verify_jwt=false — Stripe calls this endpoint directly and
// cannot supply a Supabase JWT. Authenticity instead comes entirely from
// the Stripe-Signature header check below.
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
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

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Stripe subscription statuses collapse down to the three values
// profiles.membership_status actually gates on.
function mapStatus(stripeStatus: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
  return 'canceled';
}

// current_period_end sits on the subscription in the API version this
// function is pinned to, and on the subscription item in later ones. Read
// whichever is present rather than trusting one shape: an undefined value
// would become `new Date(NaN).toISOString()`, which throws, fails the whole
// webhook, and leaves Stripe retrying a delivery that can never succeed.
function periodEndIso(subscription: Stripe.Subscription): string | null {
  const fromSubscription = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const fromItem = subscription.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const seconds = typeof fromSubscription === 'number' ? fromSubscription : fromItem?.current_period_end;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// invoice.subscription was removed in Stripe's 2025 API versions in favour
// of parent.subscription_details.subscription. Webhook payloads are
// rendered with the *account's* API version, not the one this function
// pins, so a brand-new Stripe account would deliver the newer shape and
// this handler would silently stop marking anyone past_due.
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
    lines?: { data?: Array<{ subscription?: string | { id?: string } | null }> } | null;
  };
  const candidates = [
    raw.subscription,
    raw.parent?.subscription_details?.subscription,
    raw.lines?.data?.[0]?.subscription,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (candidate && typeof candidate === 'object' && typeof candidate.id === 'string') return candidate.id;
  }
  return null;
}

async function setMembership(userId: string, fields: Record<string, unknown>) {
  const { error } = await admin.from('profiles').update(fields).eq('id', userId);
  if (error) console.error('Failed to update profile membership fields:', error.message);
}

// Audit fix auth:frozen-terminated-shop-checkout-no-status-gate: a
// frozen or terminated profile must never be written back to an active
// membership by a webhook, whatever Stripe says. Returns true when the
// profile's account_status is frozen or terminated.
async function isAccountFrozenOrTerminated(userId: string): Promise<boolean> {
  const { data, error } = await admin.from('profiles').select('account_status').eq('id', userId).maybeSingle();
  if (error) {
    // Fail closed by throwing: the webhook's handler returns 500 and
    // Stripe retries the delivery, instead of a transient read error
    // being misreported as a frozen account and silently skipping a
    // legitimate membership grant.
    throw new Error(`could not read account_status: ${error.message}`);
  }
  return data?.account_status === 'frozen' || data?.account_status === 'terminated';
}

// Staff alert channel for this function. There is no dedicated staff
// notification channel (email/Slack) wired to the Edge Functions yet,
// so an alert is a structured console.error (visible in the Supabase
// function logs) plus a Sentry report when a DSN is configured. Every
// call site passes enough ids for staff to find the order/profile in
// the admin panel and act — refund, reinstate, or revoke — by hand.
function alertStaff(where: string, message: string, details: Record<string, unknown>): void {
  console.error(`STAFF-ALERT [${where}]: ${message}`, details);
  reportError(`stripe-webhook:${where}: ${message}`, new Error(JSON.stringify(details)));
}

// UTC-midnight boundary for the daily order cap (same definition as
// create-checkout-session: orders recorded since UTC midnight today).
function todayStartUtc(): string {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
}

async function countOrdersToday(userId: string): Promise<number | null> {
  const { count, error } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', todayStartUtc());
  if (error) {
    console.error('Could not count orders today:', error.message);
    return null;
  }
  return count ?? 0;
}

// The most recent order paid with this payment intent, if any. Orders
// record stripe_payment_intent_id at fulfilment; charges and disputes
// carry the same id, which is what links a refund/dispute back to the
// order it paid for.
async function findOrderByPaymentIntent(paymentIntentId: string): Promise<{
  id: string;
  user_id: string;
  kind: string;
  status: string;
  line_items: unknown;
  stripe_checkout_session_id: string | null;
} | null> {
  const { data, error } = await admin
    .from('orders')
    .select('id, user_id, kind, status, line_items, stripe_checkout_session_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Could not look up order by payment intent:', error.message);
    return null;
  }
  return data ?? null;
}

// Put the goods on a refunded order back into stock. There is no
// shipped flag on orders, so this assumes the goods have NOT shipped:
// every call site alerts staff to verify the shipment and reverse the
// restore if the goods already went out. Returns false when the restore
// could not be completed, so the caller can alert staff to fix it by hand.
async function restoreStockForOrder(order: { id: string; line_items: unknown }): Promise<boolean> {
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  let ok = true;
  for (const line of lines) {
    const item = line as { product_id?: string | null; quantity?: number };
    if (!item.product_id || !(item.quantity && item.quantity > 0)) continue;
    const { data: product, error: readError } = await admin
      .from('products')
      .select('inventory')
      .eq('id', item.product_id)
      .maybeSingle();
    if (readError || !product || typeof product.inventory !== 'number') {
      console.error('Could not read inventory for stock restore:', item.product_id, readError?.message);
      ok = false;
      continue;
    }
    const { error } = await admin
      .from('products')
      .update({ inventory: product.inventory + item.quantity })
      .eq('id', item.product_id);
    if (error) {
      console.error('Failed to restore stock:', item.product_id, error.message);
      ok = false;
    }
  }
  return ok;
}

// LEGACY, defensive only: new memberships are one-time payments granted
// inline in handleCompletedSession above (no subscription object exists
// live — Stripe was never set up). Writes the given subscription's
// CURRENT state (re-fetched from Stripe,
// not the possibly-stale snapshot embedded in whatever event triggered
// this) onto the linked profile. Stripe does not guarantee webhook
// delivery order, so a customer.subscription.updated and a later
// customer.subscription.deleted for the same subscription can arrive
// reversed; always writing Stripe's live state instead of the event's
// payload means whichever event is processed last still converges on the
// same, correct result instead of an older event clobbering a newer one.
async function syncSubscription(
  subscriptionId: string,
  opts?: { fallbackUserId?: string | null; extraFields?: Record<string, unknown> }
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.user_id || opts?.fallbackUserId;
  const status = mapStatus(subscription.status);
  const endIso = periodEndIso(subscription);
  const fields: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    membership_status: status,
    membership_source: 'stripe',
    ...(opts?.extraFields || {}),
  };
  // Only overwrite the stored period end when Stripe actually gave one.
  // Blanking it would read as "expired" to every gate on the site.
  if (endIso) fields.membership_current_period_end = endIso;
  else if (status === 'canceled') fields.membership_current_period_end = new Date().toISOString();

  // Audit fix auth:frozen-terminated-shop-checkout-no-status-gate:
  // never write membership fields (not even Stripe's live state) onto
  // a frozen or terminated profile. A legacy subscription renewal
  // arriving after a freeze must not flip the member back to active.
  // The subscription id is still Stripe's problem, not the profile's;
  // staff can reinstate by hand if the account is unfrozen.
  if (userId) {
    if (await isAccountFrozenOrTerminated(userId)) {
      alertStaff('syncSubscription', 'Skipped membership sync for a frozen/terminated account; Stripe state NOT written to profile.', { userId, subscriptionId, stripeStatus: status });
      return;
    }
    await setMembership(userId, fields);
  } else {
    const { data: target } = await admin.from('profiles').select('id, account_status').eq('stripe_subscription_id', subscriptionId).maybeSingle();
    if (target && (target.account_status === 'frozen' || target.account_status === 'terminated')) {
      alertStaff('syncSubscription', 'Skipped membership sync for a frozen/terminated account; Stripe state NOT written to profile.', { userId: target.id, subscriptionId, stripeStatus: status });
      return;
    }
    const { error } = await admin.from('profiles').update(fields).eq('stripe_subscription_id', subscriptionId);
    if (error) console.error('Failed to update profile by subscription id:', error.message);
  }
}

// What was actually bought, read back from Stripe rather than from the
// cart the browser sent. Each line carries the products row it came from
// (create-checkout-session stamps product_data.metadata.product_id), which
// is what makes both the order record and the stock decrement possible.
async function purchasedLines(sessionId: string): Promise<
  { product_id: string | null; name: string; quantity: number; amount_total: number }[]
> {
  const lines: { product_id: string | null; name: string; quantity: number; amount_total: number }[] = [];
  const listed = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ['data.price.product'],
  });
  for (const line of listed.data) {
    const product = line.price?.product;
    const metadata = product && typeof product === 'object' && 'metadata' in product
      ? (product as Stripe.Product).metadata
      : null;
    lines.push({
      product_id: metadata?.product_id ?? null,
      name: line.description ?? '',
      quantity: line.quantity ?? 1,
      amount_total: (line.amount_total ?? 0) / 100,
    });
  }
  return lines;
}

async function handleCompletedSession(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id || session.metadata?.user_id;
  if (!userId) {
    console.error('checkout session completed with no user id in client_reference_id/metadata');
    return;
  }

  let lines: Awaited<ReturnType<typeof purchasedLines>> = [];
  try {
    lines = await purchasedLines(session.id);
  } catch (err) {
    // An order that records nothing about its contents is still better than
    // no order at all, so this never fails the webhook.
    console.error('Could not read line items for session', session.id, err);
    reportError('stripe-webhook:line-items', err);
  }

  const shipping = (session as unknown as { shipping_details?: unknown }).shipping_details
    ?? (session as unknown as { collected_information?: { shipping_details?: unknown } }).collected_information?.shipping_details
    ?? null;

  // Membership sessions are one-time payments since 2026-11-04, so
  // mode alone no longer identifies them: create-checkout-session
  // stamps metadata.membership === 'true' on membership carts, and
  // legacy subscription sessions still have mode 'subscription'.
  // Stock decrement applies to goods only, so this flag gates it.
  const isMembership = session.mode === 'subscription' || session.metadata?.membership === 'true';

  // Audit fix auth:frozen-terminated-shop-checkout-no-status-gate:
  // a session created before the freeze can still be paid afterwards,
  // so fulfilment re-checks the account here. A frozen/terminated
  // profile still gets its paid order recorded below (the money trail),
  // but the membership grant further down is skipped for it.
  const accountBlocked = await isAccountFrozenOrTerminated(userId);
  if (accountBlocked) {
    alertStaff('handleCompletedSession', 'Paid checkout fulfilled for a frozen/terminated account; order recorded but no membership will be granted.', { userId, sessionId: session.id, isMembership });
  }

  // Audit fix shop:checkout:daily-order-cap-outstanding-sessions: the
  // 3-orders-per-day cap is checked at session creation only, so
  // several sessions created under the cap can all be paid. Recount
  // recorded orders today BEFORE inserting. On breach, do NOT record a
  // normal paid order — the payment has already been taken, so record
  // the order as held (money trail preserved, no stock taken, no
  // membership granted) and alert staff to refund or release it by
  // hand. A retry of a session already recorded is not a breach: its
  // own order is in the count, so an existing row for this session
  // falls through to the normal (idempotent) path below.
  // Best effort, not atomic: two webhooks landing in the same instant
  // can both pass the recount. The unique session index still prevents
  // the same session recording twice.
  const ordersToday = await countOrdersToday(userId);
  if (ordersToday === null) {
    // Fail closed: without a reliable count the cap cannot be enforced.
    console.error('Daily-cap recount failed; refusing to fulfil session', session.id);
    throw new Error('daily order cap could not be verified');
  }
  if (ordersToday >= 3) {
    const { data: existingOrder } = await admin
      .from('orders')
      .select('id')
      .eq('stripe_checkout_session_id', session.id)
      .maybeSingle();
    if (!existingOrder) {
      const { error: heldError } = await admin.from('orders').insert({
        user_id: userId,
        kind: isMembership ? 'membership' : 'goods',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
        amount_total: (session.amount_total ?? 0) / 100,
        currency: session.currency ?? 'usd',
        status: 'held_daily_cap',
        line_items: lines,
        customer_email: session.customer_details?.email ?? session.customer_email ?? null,
        shipping,
      });
      if (heldError) console.error('Failed to record held (daily-cap) order:', heldError.message);
      alertStaff('handleCompletedSession', 'Daily order cap breached at fulfilment: paid order HELD, not recorded as paid. Refund or release by hand.', { userId, sessionId: session.id, ordersToday, amountTotal: (session.amount_total ?? 0) / 100 });
      return;
    }
  }

  // insert(), not upsert(): Stripe retries a delivery it didn't get a 2xx
  // for, and the duplicate-key rejection is what tells us this event was
  // already fulfilled — so the stock below comes off exactly once.
  const { error: orderError } = await admin.from('orders').insert({
    user_id: userId,
    kind: isMembership ? 'membership' : 'goods',
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
    amount_total: (session.amount_total ?? 0) / 100,
    currency: session.currency ?? 'usd',
    status: 'paid',
    line_items: lines,
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    shipping,
  });

  const alreadyRecorded = !!orderError && (orderError as { code?: string }).code === '23505';
  if (orderError && !alreadyRecorded) console.error('Failed to record order:', orderError.message);

  if (!orderError && !isMembership) {
    const stockItems = lines
      .filter((l) => l.product_id)
      .map((l) => ({ id: l.product_id, qty: l.quantity }));
    if (stockItems.length) {
      const { error: stockError } = await admin.rpc('shop_consume_inventory', { p_items: stockItems });
      if (stockError) {
        // Audit fix shop:checkout:inventory-oversell-unreserved
        // (webhook half): once the SQL fix lands, shop_consume_inventory
        // raises 'insufficient stock' instead of clamping at zero. An
        // insufficient-stock error here means this paid order sold stock
        // that does not exist — never a silent success. Hold the order
        // (no membership/goods shipped on a 'paid' row) and alert staff
        // to refund or fulfil by hand. Any other stock error keeps the
        // old behaviour (logged; the order stays paid) because the stock
        // state is unknown rather than proven oversold.
        if (/insufficient stock/i.test(stockError.message ?? '')) {
          const { error: holdError } = await admin
            .from('orders')
            .update({ status: 'held_oversell' })
            .eq('stripe_checkout_session_id', session.id);
          if (holdError) console.error('Failed to hold oversold order:', holdError.message);
          alertStaff('handleCompletedSession', 'OVERSELL: paid order consumed stock that does not exist; order HELD, not fulfilled. Refund or fulfil by hand.', { userId, sessionId: session.id, stockError: stockError.message });
        } else {
          console.error('Failed to decrement inventory:', stockError.message);
        }
      }
    }
  }

  if (isMembership && accountBlocked) {
    // Frozen/terminated: the order above is the money trail, but no
    // membership is granted and no subscription sync runs. Staff decide
    // what happens to the payment (see the alert above).
    return;
  }

  if (isMembership) {
    if (session.mode === 'subscription' && typeof session.subscription === 'string') {
      // Legacy subscription session: syncSubscription is the authority
      // here — the subscription id lives on Stripe, and the profiles row
      // must agree with what Stripe says the subscription is, not what
      // the session alone says. No such sessions exist live (Stripe was
      // never set up); this path is defensive only.
      await syncSubscription(session.subscription, {
        fallbackUserId: userId,
        extraFields: { stripe_customer_id: typeof session.customer === 'string' ? session.customer : null },
      });
    } else {
      // One-time membership payment: exactly one year from the session's
      // creation (the paid date, within minutes), no subscription object,
      // no subscription id stored. Anchoring on session.created instead
      // of fulfillment time makes the grant idempotent: a retried
      // delivery computes the same period end, so it can never extend
      // the year a second time, and a grant that threw on the first
      // attempt heals itself on retry.
      const paidAt = new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000);
      const periodEnd = new Date(paidAt.getTime());
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);

      // Audit fix shop:checkout:duplicate-membership-outstanding-
      // sessions: the duplicate block exists only at session creation,
      // so two sessions created before either payment lands can both
      // complete. Re-read the profile immediately before granting: if
      // the member is already active with a period end at or beyond
      // the end this grant would set, this payment buys nothing new —
      // skip the overwrite, alert staff, and refund the duplicate
      // payment in Stripe instead of silently keeping the second
      // charge. (A shorter existing period is a genuine extension, so
      // the grant proceeds.) The re-read must happen here, not at the
      // top of this function, or the two webhooks can both read "not
      // yet a member" before either grants.
      const { data: freshProfile, error: freshProfileError } = await admin
        .from('profiles')
        .select('membership_status, membership_current_period_end')
        .eq('id', userId)
        .maybeSingle();
      if (freshProfileError) {
        console.error('Could not re-read profile before membership grant:', freshProfileError.message);
        throw new Error('membership grant could not verify current membership');
      }
      const existingEnd = freshProfile?.membership_current_period_end
        ? new Date(freshProfile.membership_current_period_end).getTime()
        : NaN;
      if (
        freshProfile?.membership_status === 'active' &&
        Number.isFinite(existingEnd) &&
        existingEnd >= periodEnd.getTime()
      ) {
        alertStaff('handleCompletedSession', 'Duplicate membership payment: member already active through or beyond the new grant end. Grant skipped; duplicate payment queued for refund.', { userId, sessionId: session.id, existingPeriodEnd: freshProfile.membership_current_period_end, newPeriodEnd: periodEnd.toISOString() });
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
        if (paymentIntentId) {
          try {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
          } catch (refundError) {
            alertStaff('handleCompletedSession', 'Duplicate membership refund FAILED in Stripe; refund by hand in the Stripe dashboard.', { userId, sessionId: session.id, paymentIntentId, refundError: refundError instanceof Error ? refundError.message : String(refundError) });
          }
        } else {
          alertStaff('handleCompletedSession', 'Duplicate membership payment has no payment_intent on the session; refund by hand in the Stripe dashboard.', { userId, sessionId: session.id });
        }
        return;
      }

      const grant: Record<string, unknown> = {
        membership_status: 'active',
        membership_source: 'stripe_onetime',
        membership_current_period_end: periodEnd.toISOString(),
      };
      if (typeof session.customer === 'string') grant.stripe_customer_id = session.customer;
      const { error: grantError } = await admin
        .from('profiles')
        .update(grant)
        .eq('id', userId);
      if (grantError) throw new Error(`membership grant failed: ${grantError.message}`);
    }
  }
}

// Audit fix supabase/functions/stripe-webhook/index.ts:
// refund-dispute-events-unhandled. Until now charge.refunded and the
// charge.dispute.* events fell through to the default branch and
// returned 200 with no state change, so a refunded member kept paid
// status and access, and refunded stock was never restored. Live
// Stripe is not set up yet (placeholder key), so none of this can be
// live-tested until Stripe is connected; the handlers below are
// code-only until then.
//
// Membership revocation on refund is deliberately NOT automatic: the
// audit notes the owner still has to decide whether a refunded
// membership year is revoked immediately or runs to period end. What
// these handlers do without that decision is update the order, restore
// unshipped stock, and alert staff so the membership call is made and
// recorded by a human. The membership_status value is never rewritten
// to an invented hold state — the gate vocabulary (member-gate.js /
// membership_state()) has no 'held' state, so inventing one would
// change what the member sees in unpredictable ways.

// A refund of a charge: full refund marks the order refunded and
// restores unshipped goods stock; a partial refund marks it
// partially_refunded and leaves stock alone (the refunded lines are
// not identifiable from the charge alone). A refunded membership order
// is flagged for staff review, not auto-revoked (see above). Replays
// are safe: an order already in the target status is left alone, so a
// second delivery cannot restore the same stock twice.
async function handleRefund(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!paymentIntentId) {
    alertStaff('handleRefund', 'charge.refunded with no payment_intent; could not find the order. Investigate in Stripe.', { chargeId: charge.id });
    return;
  }
  const order = await findOrderByPaymentIntent(paymentIntentId);
  if (!order) {
    alertStaff('handleRefund', 'charge.refunded but no order matches the payment intent; nothing updated.', { chargeId: charge.id, paymentIntentId });
    return;
  }
  const amount = charge.amount ?? 0;
  const refunded = charge.amount_refunded ?? 0;
  const isFull = charge.refunded === true || (amount > 0 && refunded >= amount);
  const targetStatus = isFull ? 'refunded' : 'partially_refunded';
  if (order.status === targetStatus || (isFull && order.status === 'refunded')) {
    console.error(`Refund event replay for order ${order.id}; already ${order.status}, no change.`);
    return;
  }
  const wasPaid = order.status === 'paid';
  const { error } = await admin.from('orders').update({ status: targetStatus }).eq('id', order.id);
  if (error) {
    console.error('Failed to update order status for refund:', error.message);
    alertStaff('handleRefund', 'Failed to mark order refunded; update by hand in the admin panel.', { orderId: order.id, chargeId: charge.id });
    return;
  }
  if (isFull && wasPaid && order.kind !== 'membership') {
    const restored = await restoreStockForOrder(order);
    alertStaff('handleRefund', `Order fully refunded; stock restore ${restored ? 'completed' : 'INCOMPLETE — check inventory by hand'}. Verify the goods have NOT shipped before trusting the restored counts; reverse the restore if they already went out.`, { orderId: order.id, userId: order.user_id, chargeId: charge.id });
  } else if (isFull && wasPaid && order.kind === 'membership') {
    alertStaff('handleRefund', 'Membership order fully refunded. Membership NOT auto-revoked (owner decision pending: revoke now vs run to period end). Decide and record the outcome by hand; a renewal must not flip this member back to active.', { orderId: order.id, userId: order.user_id, chargeId: charge.id });
  } else {
    alertStaff('handleRefund', `Order ${targetStatus} (partial refund of $${(refunded / 100).toFixed(2)} of $${(amount / 100).toFixed(2)}). No stock change; review by hand.`, { orderId: order.id, userId: order.user_id, chargeId: charge.id });
  }
}

// A dispute opened against a charge: hold the order (status 'disputed')
// so it is not treated as a clean paid order, and alert staff that the
// membership behind it — if any — is on hold pending the outcome. The
// membership_status value itself is left untouched until the dispute
// closes (see the note above handleRefund): staff, not the webhook,
// decide whether access stays, is suspended, or is revoked.
async function handleDisputeOpened(dispute: Stripe.Dispute) {
  let paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  if (!paymentIntentId && typeof dispute.charge === 'string') {
    try {
      const charge = await stripe.charges.retrieve(dispute.charge);
      paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
    } catch (err) {
      console.error('Could not retrieve charge for dispute:', err);
    }
  }
  if (!paymentIntentId) {
    alertStaff('handleDisputeOpened', 'charge.dispute.created with no payment intent resolvable; could not find the order. Investigate in Stripe.', { disputeId: dispute.id });
    return;
  }
  const order = await findOrderByPaymentIntent(paymentIntentId);
  if (!order) {
    alertStaff('handleDisputeOpened', 'Dispute opened but no order matches the payment intent; nothing updated.', { disputeId: dispute.id, paymentIntentId });
    return;
  }
  const { error } = await admin.from('orders').update({ status: 'disputed' }).eq('id', order.id);
  if (error) {
    console.error('Failed to mark order disputed:', error.message);
    alertStaff('handleDisputeOpened', 'Failed to mark order disputed; update by hand in the admin panel.', { orderId: order.id, disputeId: dispute.id });
    return;
  }
  alertStaff('handleDisputeOpened', `Dispute opened (${dispute.reason ?? 'no reason given'}). Order HELD as disputed${order.kind === 'membership' ? '; membership on hold pending the outcome — decide access by hand' : '; do not ship'} until the dispute closes.`, { orderId: order.id, userId: order.user_id, disputeId: dispute.id, amount: (dispute.amount ?? 0) / 100 });
}

// A dispute closed: won means the merchant kept the money, so the
// order returns to paid and staff are told to release the hold; lost
// means the money is gone, so the order is treated like a full refund
// (refunded status, unshipped stock restored, membership flagged for
// review). Any other outcome is logged and alerted for a human call.
async function handleDisputeClosed(dispute: Stripe.Dispute) {
  let paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  if (!paymentIntentId && typeof dispute.charge === 'string') {
    try {
      const charge = await stripe.charges.retrieve(dispute.charge);
      paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
    } catch (err) {
      console.error('Could not retrieve charge for dispute:', err);
    }
  }
  if (!paymentIntentId) {
    alertStaff('handleDisputeClosed', 'charge.dispute.closed with no payment intent resolvable; could not find the order. Investigate in Stripe.', { disputeId: dispute.id });
    return;
  }
  const order = await findOrderByPaymentIntent(paymentIntentId);
  if (!order) {
    alertStaff('handleDisputeClosed', 'Dispute closed but no order matches the payment intent; nothing updated.', { disputeId: dispute.id, paymentIntentId });
    return;
  }
  if (dispute.status === 'won') {
    const { error } = await admin.from('orders').update({ status: 'paid' }).eq('id', order.id);
    if (error) console.error('Failed to restore disputed order to paid:', error.message);
    alertStaff('handleDisputeClosed', `Dispute WON: merchant kept the payment. Order restored to paid; release any membership hold${order.kind === 'membership' ? ' by hand' : ''}.`, { orderId: order.id, userId: order.user_id, disputeId: dispute.id });
    return;
  }
  if (dispute.status === 'lost') {
    const wasPaid = order.status === 'paid' || order.status === 'disputed';
    const { error } = await admin.from('orders').update({ status: 'refunded' }).eq('id', order.id);
    if (error) {
      console.error('Failed to mark lost-dispute order refunded:', error.message);
      alertStaff('handleDisputeClosed', 'Failed to mark lost-dispute order refunded; update by hand.', { orderId: order.id, disputeId: dispute.id });
      return;
    }
    if (wasPaid && order.kind !== 'membership') {
      const restored = await restoreStockForOrder(order);
      alertStaff('handleDisputeClosed', `Dispute LOST: order refunded; stock restore ${restored ? 'completed' : 'INCOMPLETE — check inventory by hand'}. Verify the goods have NOT shipped; reverse the restore if they already went out.`, { orderId: order.id, userId: order.user_id, disputeId: dispute.id });
    } else if (wasPaid && order.kind === 'membership') {
      alertStaff('handleDisputeClosed', 'Dispute LOST on a membership order. Membership NOT auto-revoked (owner decision pending). Decide and record the outcome by hand.', { orderId: order.id, userId: order.user_id, disputeId: dispute.id });
    }
    return;
  }
  alertStaff('handleDisputeClosed', `Dispute closed with unexpected status '${dispute.status}'; order left as '${order.status}'. Decide by hand.`, { orderId: order.id, userId: order.user_id, disputeId: dispute.id });
}

// A renewal is billed straight off the subscription — there is no Checkout
// Session behind it — so nothing here would ever reach the orders table and
// a member's order history stopped at the first year. The first invoice of a
// subscription is skipped: handleCompletedSession() has already recorded
// that one from its Checkout Session.
async function recordRenewalOrder(invoice: Stripe.Invoice, subscriptionId: string) {
  const reason = (invoice as unknown as { billing_reason?: string }).billing_reason;
  if (reason && reason !== 'subscription_cycle' && reason !== 'subscription_update') return;
  if (!invoice.id) return;

  let userId: string | null = null;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    userId = subscription.metadata?.user_id ?? null;
  } catch (err) {
    console.error('Could not read subscription for renewal order:', err);
    reportError('stripe-webhook:renewal', err);
  }
  if (!userId) {
    const { data } = await admin.from('profiles').select('id').eq('stripe_subscription_id', subscriptionId).maybeSingle();
    userId = data?.id ?? null;
  }
  if (!userId) return;

  const { error } = await admin.from('orders').insert({
    user_id: userId,
    kind: 'membership',
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subscriptionId,
    amount_total: (invoice.amount_paid ?? 0) / 100,
    currency: invoice.currency ?? 'usd',
    status: 'paid',
    line_items: [],
    customer_email: invoice.customer_email ?? null,
  });
  // 23505 = this invoice was already recorded by an earlier delivery.
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('Failed to record renewal order:', error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    if (!signature) throw new Error('Missing stripe-signature header');
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    reportError('stripe-webhook:signature', err);
    return new Response(`Webhook Error: ${err instanceof Error ? err.message : 'invalid signature'}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // async_payment_succeeded is the same fulfilment moment for a payment
      // method that settles later (bank debits); without it those orders
      // would never be recorded.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        // A completed session whose payment is still pending is not paid
        // yet; the async_payment_succeeded event above finishes that one.
        if (session.payment_status === 'unpaid' && session.mode === 'payment') break;
        await handleCompletedSession(session);
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(subscription.id, { fallbackUserId: subscription.metadata?.user_id });
        break;
      }

      // A renewal payment moves the period end forward; a failure moves the
      // membership to past_due. Both converge on Stripe's live state.
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = subscriptionIdFromInvoice(invoice);
        if (subscriptionId) {
          await syncSubscription(subscriptionId);
          if (event.type === 'invoice.payment_succeeded') {
            await recordRenewalOrder(invoice, subscriptionId);
          }
        }
        break;
      }

      // Audit fix supabase/functions/stripe-webhook/index.ts:
      // refund-dispute-events-unhandled. These used to fall through to
      // default and return 200 with no state change.
      case 'charge.refunded': {
        await handleRefund(event.data.object as Stripe.Charge);
        break;
      }

      case 'charge.dispute.created': {
        await handleDisputeOpened(event.data.object as Stripe.Dispute);
        break;
      }

      case 'charge.dispute.closed': {
        await handleDisputeClosed(event.data.object as Stripe.Dispute);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Error handling Stripe webhook event:', err);
    reportError('stripe-webhook:handler', err);
    return new Response('Webhook handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
