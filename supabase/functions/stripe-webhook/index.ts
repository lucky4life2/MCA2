// Receives Stripe webhook events and fulfills orders / membership status.
//
// Register this function's URL as a webhook endpoint in the Stripe
// dashboard once a real Stripe account exists:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// listening for: checkout.session.completed,
// checkout.session.async_payment_succeeded, customer.subscription.updated,
// customer.subscription.deleted, invoice.payment_failed,
// invoice.payment_succeeded.
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

// Writes the given subscription's CURRENT state (re-fetched from Stripe,
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

  if (userId) {
    await setMembership(userId, fields);
  } else {
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
  }

  const shipping = (session as unknown as { shipping_details?: unknown }).shipping_details
    ?? (session as unknown as { collected_information?: { shipping_details?: unknown } }).collected_information?.shipping_details
    ?? null;

  // insert(), not upsert(): Stripe retries a delivery it didn't get a 2xx
  // for, and the duplicate-key rejection is what tells us this event was
  // already fulfilled — so the stock below comes off exactly once.
  const { error: orderError } = await admin.from('orders').insert({
    user_id: userId,
    kind: session.mode === 'subscription' ? 'membership' : 'goods',
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

  if (!orderError && session.mode === 'payment') {
    const stockItems = lines
      .filter((l) => l.product_id)
      .map((l) => ({ id: l.product_id, qty: l.quantity }));
    if (stockItems.length) {
      const { error: stockError } = await admin.rpc('shop_consume_inventory', { p_items: stockItems });
      if (stockError) console.error('Failed to decrement inventory:', stockError.message);
    }
  }

  if (session.mode === 'subscription' && typeof session.subscription === 'string') {
    await syncSubscription(session.subscription, {
      fallbackUserId: userId,
      extraFields: { stripe_customer_id: typeof session.customer === 'string' ? session.customer : null },
    });
  }
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

      default:
        break;
    }
  } catch (err) {
    console.error('Error handling Stripe webhook event:', err);
    return new Response('Webhook handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
