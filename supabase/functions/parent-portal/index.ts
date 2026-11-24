import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Tokenized, no-account-required parent portal (16 CFR 312.6). The token is
// a 64-hex-char random value (~244 bits) issued alongside the initial
// consent request and never expires on its own — a parent needs durable
// access to review, revoke, or request deletion for as long as the child's
// account exists. Every action re-validates the token against its stored
// hash; nothing here trusts the request beyond that.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { userId?: string; portalToken?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const { userId, portalToken, action } = body;
  if (!userId || !portalToken || !action) return json({ error: 'Missing required fields.' }, 400);
  if (!['review', 'revoke', 'request_deletion'].includes(action)) {
    return json({ error: 'Unknown action.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: consent, error: fetchErr } = await adminClient
    .from('minor_consent')
    .select('status, parent_email, consent_method, requested_at, notice_sent_at, approved_at, declined_at, revoked_at, portal_token_hash, third_party_disclosure_consent')
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchErr || !consent) return json({ error: 'No consent record found for this account.' }, 404);

  const providedHash = await sha256Hex(portalToken);
  if (!consent.portal_token_hash || providedHash !== consent.portal_token_hash) {
    return json({ error: 'Invalid or expired portal link.' }, 401);
  }

  const { data: profile } = await adminClient
    .from('profiles')
    .select('email, display_name, username, minecraft_username, discord_id, google_id, date_of_birth, age_band, account_status')
    .eq('id', userId)
    .maybeSingle();

  if (action === 'review') {
    return json({
      ok: true,
      consent: {
        status: consent.status,
        parentEmail: consent.parent_email,
        consentMethod: consent.consent_method,
        requestedAt: consent.requested_at,
        noticeSentAt: consent.notice_sent_at,
        approvedAt: consent.approved_at,
        declinedAt: consent.declined_at,
        revokedAt: consent.revoked_at,
        thirdPartyDisclosureConsent: consent.third_party_disclosure_consent,
        thirdPartyDisclosureAvailable: false,
        thirdPartyDisclosureReason: 'No verifiable-parental-consent method stronger than email-plus is configured, so third-party disclosure consent cannot be turned on — the account is structurally blocked from linking Discord/Google or disclosing your child’s information to a third party regardless of this setting.',
      },
      collected: profile ? {
        childEmail: profile.email,
        dateOfBirth: profile.date_of_birth,
        ageBand: profile.age_band,
        displayName: profile.display_name,
        username: profile.username,
        minecraftUsername: profile.minecraft_username,
        discordLinked: !!profile.discord_id,
        googleLinked: !!profile.google_id,
        accountStatus: profile.account_status,
      } : null,
    }, 200);
  }

  if (action === 'revoke' && consent.status !== 'approved') {
    return json({ error: 'Only an approved consent can be revoked.' }, 400);
  }

  const now = new Date().toISOString();
  const ip = req.headers.get('cf-connecting-ip') || null;
  const ua = req.headers.get('user-agent') || null;

  const consentUpdate: Record<string, unknown> = { updated_at: now };
  if (consent.status === 'approved' || action === 'revoke') {
    consentUpdate.status = 'revoked';
    consentUpdate.revoked_at = now;
  }
  await adminClient.from('minor_consent').update(consentUpdate).eq('user_id', userId);

  await adminClient.from('profiles').update({
    account_status: 'coppa_restricted',
    deletion_scheduled_at: now,
    display_name: null,
    username: null,
    minecraft_username: null,
    minecraft_uuid: null,
    minecraft_verified: false,
    discord_id: null,
    google_id: null,
    public_listing_opt_in: false,
  }).eq('id', userId);

  await adminClient.from('minor_consent_events').insert({
    user_id: userId,
    event_type: action === 'revoke' ? 'consent_revoked' : 'deletion_requested',
    consent_method: consent.consent_method,
    actor: 'parent',
    ip,
    user_agent: ua,
  });

  return json({ ok: true, status: 'restricted', deletionScheduledAt: now }, 200);
});
