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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { userId?: string; token?: string; decision?: 'approve' | 'decline' };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const { userId, token, decision } = body;
  if (!userId || !token || !decision || (decision !== 'approve' && decision !== 'decline')) {
    return json({ error: 'Missing required fields.' }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: record, error: fetchErr } = await adminClient
    .from('minor_consent')
    .select('status, consent_token_hash, consent_token_expires')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr || !record) return json({ error: 'Consent request not found.' }, 404);
  if (record.status !== 'pending') {
    return json({ error: `This request has already been ${record.status}.`, status: record.status }, 409);
  }
  if (!record.consent_token_expires || new Date(record.consent_token_expires) < new Date()) {
    return json({ error: 'This consent link has expired. Please contact us to send a new one.' }, 400);
  }
  const providedHash = await sha256Hex(token);
  if (!record.consent_token_hash || providedHash !== record.consent_token_hash) {
    return json({ error: 'Invalid consent link.' }, 400);
  }

  const now = new Date().toISOString();
  const ip = req.headers.get('cf-connecting-ip') || null;
  const ua = req.headers.get('user-agent') || null;

  if (decision === 'approve') {
    const { error } = await adminClient.from('minor_consent').update({
      status: 'approved',
      approved_at: now,
      consent_token_hash: null,
      consent_token_expires: null,
      consent_ip: ip,
      consent_user_agent: ua,
      updated_at: now,
    }).eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);

    // display_name is left as-is (normally empty): it used to be filled with
    // the email's local part here, which then showed in the member's header
    // in place of the username they chose.
    await adminClient.from('profiles').update({
      account_status: 'active',
      public_listing_opt_in: false,
    }).eq('id', userId);

    const { data: memberRole } = await adminClient.from('roles').select('id').eq('name', 'member').maybeSingle();
    if (memberRole?.id) {
      await adminClient.from('user_roles').upsert(
        { user_id: userId, role_id: memberRole.id },
        { onConflict: 'user_id,role_id', ignoreDuplicates: true }
      );
    }

    await adminClient.from('minor_consent_events').insert({
      user_id: userId, event_type: 'consent_given', consent_method: 'email_plus', actor: 'parent', ip, user_agent: ua,
    });

    return json({ ok: true, status: 'approved' }, 200);
  } else {
    const { error } = await adminClient.from('minor_consent').update({
      status: 'declined',
      declined_at: now,
      consent_token_hash: null,
      consent_token_expires: null,
      consent_ip: ip,
      consent_user_agent: ua,
      updated_at: now,
    }).eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);

    await adminClient.from('profiles').update({
      account_status: 'coppa_restricted',
      deletion_scheduled_at: now,
    }).eq('id', userId);

    await adminClient.from('minor_consent_events').insert({
      user_id: userId, event_type: 'consent_declined', consent_method: 'email_plus', actor: 'parent', ip, user_agent: ua,
    });

    return json({ ok: true, status: 'declined' }, 200);
  }
});
