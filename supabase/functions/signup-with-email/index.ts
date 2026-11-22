import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Single-use 15-minute code: unsalted SHA-256 keeps it out of the DB as plaintext.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// CSPRNG six-digit code with rejection sampling (uniform digits).
function generateSixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xFFFFFFFF / 1000000) * 1000000;
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return String(value % 1000000).padStart(6, '0');
}

const GENERIC = 'Something went wrong. Please try again.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const TURNSTILE_SECRET_KEY = Deno.env.get('TURNSTILE_SECRET_KEY');

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email delivery not configured.' }), { status: 500, headers: CORS });
    }

    const { email, password, turnstileToken, dateOfBirth } = await req.json().catch(() => ({}));
    if (!email || !password || typeof email !== 'string' || email.length > 320) {
      return new Response(JSON.stringify({ error: 'Missing email or password.' }), { status: 400, headers: CORS });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const normalizedEmail = String(email).toLowerCase().trim();

    // Unauthenticated endpoint that creates accounts and sends email: cap it
    // at 5 attempts / IP / hour and 3 / address / hour, failing closed.
    const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const [byIp, byEmail] = await Promise.all([
      adminClient.rpc('check_rate_limit', { p_key: `signup:ip:${ip}`, p_max_count: 5, p_window_seconds: 3600 }),
      adminClient.rpc('check_rate_limit', { p_key: `signup:email:${normalizedEmail}`, p_max_count: 3, p_window_seconds: 3600 }),
    ]);
    if (byIp.error || byEmail.error || !byIp.data || !byEmail.data) {
      return new Response(JSON.stringify({ error: 'Too many signup attempts. Please wait an hour and try again.' }), { status: 429, headers: CORS });
    }

    // Neutral age screen (16 CFR 312.5(a)). handle_new_user() re-validates and
    // is the only thing that acts on it; a malformed value falls through to
    // the normal age_unverified gate.
    let dobMeta: string | undefined = undefined;
    if (typeof dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      dobMeta = dateOfBirth;
    }

    // Bot check: enforced once TURNSTILE_SECRET_KEY is set (with a real
    // sitekey on login.html). Fails closed if siteverify is unreachable.
    if (TURNSTILE_SECRET_KEY) {
      if (!turnstileToken) {
        return new Response(JSON.stringify({ error: 'Please complete the verification challenge.' }), { status: 400, headers: CORS });
      }
      let challengePassed = false;
      try {
        const form = new FormData();
        form.append('secret', TURNSTILE_SECRET_KEY);
        form.append('response', String(turnstileToken));
        const callerIp = req.headers.get('cf-connecting-ip');
        if (callerIp) form.append('remoteip', callerIp);
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
        const verdict = await verifyRes.json();
        challengePassed = verdict?.success === true;
      } catch {
        challengePassed = false;
      }
      if (!challengePassed) {
        return new Response(JSON.stringify({ error: 'Verification challenge failed. Please try again.' }), { status: 403, headers: CORS });
      }
    }

    // Reclaim an abandoned signup on this address: only if it was NEVER
    // confirmed, NEVER signed in, has no OAuth identity, and its code expired.
    const { data: priorProfile } = await adminClient
      .from('profiles')
      .select('id, pending_email_expires')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (priorProfile?.id) {
      const { data: priorLookup } = await adminClient.auth.admin.getUserById(priorProfile.id);
      const prior = priorLookup?.user;
      if (prior) {
        const neverConfirmed = !prior.email_confirmed_at;
        const neverSignedIn = !prior.last_sign_in_at;
        const noOauthIdentity = !(prior.identities || []).some((i) => i.provider !== 'email');
        const codeExpired =
          !priorProfile.pending_email_expires ||
          new Date(priorProfile.pending_email_expires) < new Date();
        if (neverConfirmed && neverSignedIn && noOauthIdentity && codeExpired) {
          const { error: delErr } = await adminClient.auth.admin.deleteUser(prior.id);
          if (delErr) {
            return new Response(JSON.stringify({ error: 'Could not free the previous incomplete signup. Please try again.' }), { status: 500, headers: CORS });
          }
        }
      }
    }

    const { data: inUse, error: inUseErr } = await adminClient.rpc('email_in_use', {
      p_email: normalizedEmail,
      p_exclude_user_id: null,
    });
    if (inUseErr) {
      console.error('signup-with-email email_in_use', inUseErr);
      return new Response(JSON.stringify({ error: GENERIC }), { status: 500, headers: CORS });
    }
    if (inUse) {
      return new Response(JSON.stringify({ error: 'An account with that email already exists.' }), { status: 409, headers: CORS });
    }

    // Create the account UNCONFIRMED; verify-signup-code confirms it once the
    // emailed code matches.
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: false,
      user_metadata: dobMeta ? { date_of_birth: dobMeta } : undefined,
    });
    if (createErr || !newUser?.user) {
      // GoTrue password-policy errors are safe and useful to show.
      const msg = createErr?.message && /password/i.test(createErr.message) ? createErr.message : 'Failed to create account.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: CORS });
    }

    const userId = newUser.user.id;
    const code = generateSixDigitCode();
    const codeHash = await sha256Hex(code);
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Profile row is created by a DB trigger; retry briefly in case it lags.
    let profileUpdated = false;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const { error: upErr } = await adminClient
        .from('profiles')
        .update({ pending_email_token: codeHash, pending_email_expires: expires, pending_email_attempts: 0 })
        .eq('id', userId);
      if (!upErr) { profileUpdated = true; break; }
    }
    if (!profileUpdated) {
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: 'Failed to initialise account. Please try again.' }), { status: 500, headers: CORS });
    }

    const emailBody = `<p>Your MCA verification code is:</p><h2 style="letter-spacing:4px;font-size:32px;">${code}</h2><p>This code expires in 15 minutes. Do not share it with anyone.</p>`;
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MCA <noreply@minecraftclubofamerica.me>',
        to: [normalizedEmail],
        subject: `Your MCA verification code: ${code}`,
        html: emailBody,
      }),
    });
    if (!resendRes.ok) {
      console.error('signup-with-email resend', resendRes.status, await resendRes.text());
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: 'Failed to send verification email. Please try again.' }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ success: true, userId }), { status: 200, headers: CORS });
  } catch (e) {
    console.error('signup-with-email', e);
    return new Response(JSON.stringify({ error: GENERIC }), { status: 500, headers: CORS });
  }
});
