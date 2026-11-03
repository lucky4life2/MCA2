// Opens the Stripe Billing Portal for the signed-in member.
//
// Without this there is no way for a member to cancel, change their card or
// see an invoice: the site sold a recurring subscription with no self-serve
// exit. The portal is Stripe-hosted, so nothing about payment methods ever
// touches this codebase.
//
// Requires a saved portal configuration in the Stripe dashboard
// (Settings → Billing → Customer portal). Stripe's own error is passed
// straight back if there isn't one.
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


const SITE_URL = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://minecraftclubofamerica.me',
  'https://www.minecraftclubofamerica.me',
  'http://localhost:8787',
  'http://localhost:8788',
].filter(Boolean);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Same rule as create-checkout-session: the Origin header decides where the
// member lands afterwards, so it is only honoured when it is this site.
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

  if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.startsWith('sk_placeholder')) {
    return json({ error: 'Billing is not connected yet.' }, 503);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'You must be signed in.' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fail closed: an error checking the limit is treated as "not allowed"
  // rather than silently skipping the throttle.
  const { data: withinLimit, error: rateLimitError } = await admin.rpc('check_rate_limit', {
    p_key: `billing-portal:${user.id}`,
    p_max_count: 10,
    p_window_seconds: 300,
  });
  if (rateLimitError || !withinLimit) {
    return json({ error: 'Too many requests — please wait a few minutes and try again.' }, 429);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('stripe_customer_id, membership_source')
    .eq('id', user.id)
    .single();
  if (profileError) return json({ error: 'Could not load your billing details.' }, 500);

  if (!profile?.stripe_customer_id) {
    return json({
      error: profile?.membership_source === 'admin_grant'
        ? 'Your membership was granted by an admin, so there is no billing to manage.'
        : 'There is no billing account linked to your profile yet.',
    }, 400);
  }

  const body = await req.json().catch(() => ({}));
  const requestedReturn = typeof body?.return_to === 'string' ? body.return_to : 'account.html';
  // Only a bare page name from this site — never a caller-supplied URL.
  const returnPage = /^[a-z0-9._-]+\.html$/i.test(requestedReturn) ? requestedReturn : 'account.html';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${returnOrigin(req)}/${returnPage}`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error('Stripe billing portal session creation failed:', err);
    reportError('create-billing-portal-session', err);
    return json({ error: err instanceof Error ? err.message : 'Could not open the billing portal.' }, 500);
  }
});
