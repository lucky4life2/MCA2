import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SITE_URL = 'https://minecraftclubofamerica.me';

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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const accessToken = authHeader.slice(7);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error: userError } = await adminClient.auth.getUser(accessToken);
  if (userError || !user) return json({ error: 'Invalid or expired token' }, 401);

  let body: { dateOfBirth?: string; parentEmail?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }

  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, email, date_of_birth, age_band, account_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr || !profile) return json({ error: 'Profile not found.' }, 404);

  // ---- Step 1: date of birth --------------------------------------------
  if (body.dateOfBirth !== undefined) {
    if (profile.date_of_birth) {
      return json({ error: 'Date of birth has already been submitted for this account.' }, 409);
    }
    const dob = String(body.dateOfBirth || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return json({ error: 'Please enter a valid date of birth.' }, 400);
    }

    const { data: ageBand, error: bandErr } = await adminClient.rpc('compute_age_band', { p_dob: dob });
    if (bandErr || !ageBand) {
      return json({ error: 'Please enter a valid date of birth.' }, 400);
    }

    const newStatus = ageBand === 'under_13' ? 'coppa_restricted' : 'active';
    const listing = ageBand === '18_plus';
    // display_name is deliberately left alone: it used to be seeded with the
    // email's local part here, which then showed in the member's header in
    // place of the username they chose.
    const update: Record<string, unknown> = {
      date_of_birth: dob,
      age_band: ageBand,
      account_status: newStatus,
      public_listing_opt_in: listing,
    };

    const { error: updateErr } = await adminClient.from('profiles').update(update).eq('id', user.id);
    if (updateErr) {
      console.error('submit-age-check update', updateErr);
      return json({ error: 'Could not save your date of birth. Please try again.' }, 500);
    }

    if (newStatus === 'active') {
      const { data: memberRole } = await adminClient.from('roles').select('id').eq('name', 'member').maybeSingle();
      if (memberRole?.id) {
        await adminClient.from('user_roles').upsert(
          { user_id: user.id, role_id: memberRole.id },
          { onConflict: 'user_id,role_id', ignoreDuplicates: true }
        );
      }
      return json({ ok: true, ageBand, status: 'active' }, 200);
    }

    return json({ ok: true, ageBand: 'under_13', status: 'coppa_restricted', needsParentEmail: true }, 200);
  }

  // ---- Step 2: parent email (only reachable once DOB says under 13) -----
  if (body.parentEmail !== undefined) {
    if (profile.age_band !== 'under_13') {
      return json({ error: 'A parent/guardian email is only needed for accounts under 13.' }, 400);
    }
    const { data: existing } = await adminClient
      .from('minor_consent')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing && existing.status !== 'pending' && existing.status !== 'declined') {
      return json({ error: `This account's consent request has already been ${existing.status}.`, status: existing.status }, 409);
    }

    const parentEmail = (body.parentEmail || '').trim().toLowerCase();
    if (!parentEmail || parentEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
      return json({ error: 'Please enter a valid parent or guardian email address.' }, 400);
    }
    // A child can't approve their own account by naming their own address.
    if (profile.email && parentEmail === String(profile.email).toLowerCase()) {
      return json({ error: "Please enter your parent or guardian's email address, not your own." }, 400);
    }
    if (!RESEND_API_KEY) return json({ error: 'Email delivery not configured.' }, 500);

    // Each call emails an arbitrary address: at most 3 per account per day.
    const { data: withinLimit, error: rlErr } = await adminClient.rpc('check_rate_limit', {
      p_key: `age-check-parent:${user.id}`, p_max_count: 3, p_window_seconds: 86400,
    });
    if (rlErr || !withinLimit) {
      return json({ error: 'Too many consent emails sent today. Please try again tomorrow.' }, 429);
    }

    const consentToken = crypto.randomUUID();
    const consentTokenHash = await sha256Hex(consentToken);
    const consentExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const portalToken = crypto.randomUUID() + crypto.randomUUID();
    const portalTokenHash = await sha256Hex(portalToken);
    const now = new Date().toISOString();

    const { error: upsertErr } = await adminClient.from('minor_consent').upsert({
      user_id: user.id,
      is_minor_under_13: true,
      parent_email: parentEmail,
      status: 'pending',
      consent_method: 'email_plus',
      consent_token_hash: consentTokenHash,
      consent_token_expires: consentExpires,
      portal_token_hash: portalTokenHash,
      portal_token_created_at: now,
      requested_at: now,
      approved_at: null,
      declined_at: null,
      revoked_at: null,
      notice_sent_at: now,
      updated_at: now,
    });
    if (upsertErr) {
      console.error('submit-age-check upsert', upsertErr);
      return json({ error: 'Could not start the consent request. Please try again.' }, 500);
    }

    const consentLink = `${SITE_URL}/parental-consent.html?uid=${user.id}&token=${consentToken}`;
    const portalLink = `${SITE_URL}/parental-consent.html?uid=${user.id}&ptoken=${portalToken}`;

    const emailHtml = `
      <p>Hello,</p>
      <p>Your child has asked to create an account with <strong>Minecraft Club of America</strong>, a leadership and learning club that uses Minecraft to teach government, economics, and civics. MCA serves students from elementary through high school age.</p>
      <p>Because your child told us they're under 13, the Children's Online Privacy Protection Act (COPPA) requires your verifiable consent before we activate their account or collect any personal information from them beyond this request.</p>
      <p><strong>What we've collected so far:</strong> your child's date of birth and this email address, and nothing else. <strong>What we'd collect if you approve:</strong> a display name and username for the site, and their email address for sign-in. Nothing your child submits through club features (posts, comments, etc.) is disclosed to any third party without a separate, additional consent from you — which is off by default and which we are not asking for here.</p>
      <p><strong>You must consent before we collect anything further.</strong> If you don't respond, the account stays inactive.</p>
      <p><strong>Your rights as a parent:</strong> at any time, using the link below, you can review exactly what's been collected about your child, revoke this consent, or request deletion of your child's information — revoking immediately restricts the account again and queues deletion of what's been collected.</p>
      <p><a href="${consentLink}" style="display:inline-block;background:#18449e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review &amp; Respond</a></p>
      <p>This response link expires in 14 days. Afterward — or any time you want to review, revoke, or request deletion — use your permanent parent portal link instead: <a href="${portalLink}">${portalLink}</a>. Keep it; we recommend saving this email.</p>
      <p>Our full Privacy Policy is at <a href="${SITE_URL}/privacy.html">${SITE_URL}/privacy.html</a>. If you did not expect this email, you can safely ignore it — your child's account will remain inactive.</p>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MCA <noreply@minecraftclubofamerica.me>',
        to: [parentEmail],
        subject: 'Parental consent requested — Minecraft Club of America',
        html: emailHtml,
      }),
    });
    if (!resendRes.ok) {
      console.error('submit-age-check resend', resendRes.status, await resendRes.text());
      return json({ error: 'Failed to send the consent email. Please try again.' }, 500);
    }

    const ip = req.headers.get('cf-connecting-ip') || null;
    const ua = req.headers.get('user-agent') || null;
    await adminClient.from('minor_consent_events').insert([
      { user_id: user.id, event_type: 'notice_sent', consent_method: 'email_plus', actor: 'system', ip, user_agent: ua },
      { user_id: user.id, event_type: 'portal_token_issued', consent_method: 'email_plus', actor: 'system', ip, user_agent: ua },
    ]);

    return json({ ok: true, status: 'pending' }, 200);
  }

  return json({ error: 'Missing dateOfBirth or parentEmail.' }, 400);
});
