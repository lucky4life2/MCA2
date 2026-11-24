import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Same hashing scheme as signup-with-email / verify-signup-code: the code is
// single-use and short-lived, so an unsalted SHA-256 is enough to keep it
// from sitting in the database as plaintext.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Math.random() is not a CSPRNG (see signup-with-email) — same rejection
// sampling here so a resent code is exactly as unguessable as the original.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email delivery not configured.' }), { status: 500, headers: CORS });
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId.' }), { status: 400, headers: CORS });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // This endpoint is unauthenticated (the pending signup flow has no
    // session yet), so userId is the only credential. That's the same trust
    // model verify-signup-code already uses — a v4 UUID isn't guessable — and
    // requiring the account to still be unconfirmed keeps this from being a
    // way to spam mail at an address that has already completed signup.
    const { data: userLookup, error: userErr } = await adminClient.auth.admin.getUserById(userId);
    const user = userLookup?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Account not found.' }), { status: 400, headers: CORS });
    }
    if (user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: 'This account is already verified.' }), { status: 400, headers: CORS });
    }

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('pending_email_expires')
      .eq('id', userId)
      .single();
    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: 'Account not found.' }), { status: 400, headers: CORS });
    }

    // Cooldown: pending_email_expires is always set to now+15min when a code
    // is issued, so an expiry more than a minute away means one was just sent
    // — refuse instead of burning a Resend send (and a fresh code) on rapid
    // repeat clicks.
    if (profile.pending_email_expires) {
      const msRemaining = new Date(profile.pending_email_expires).getTime() - Date.now();
      const issuedMsAgo = CODE_TTL_MS - msRemaining;
      if (issuedMsAgo < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - issuedMsAgo) / 1000);
        return new Response(JSON.stringify({ error: `Please wait ${waitSec}s before requesting another code.` }), { status: 429, headers: CORS });
      }
    }

    const code = generateSixDigitCode();
    const codeHash = await sha256Hex(code);
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: upErr } = await adminClient
      .from('profiles')
      .update({ pending_email_token: codeHash, pending_email_expires: expires, pending_email_attempts: 0 })
      .eq('id', userId);
    if (upErr) {
      return new Response(JSON.stringify({ error: 'Failed to issue a new code. Please try again.' }), { status: 500, headers: CORS });
    }

    const emailBody = `<p>Your verification code for Minecraft Club of America is:</p><h2 style="letter-spacing:4px;font-size:32px;">${code}</h2><p>This code expires in 15 minutes. Do not share it with anyone.</p>`;
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MCA <noreply@minecraftclubofamerica.me>',
        to: [user.email],
        subject: `Your MCA verification code: ${code}`,
        html: emailBody,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return new Response(JSON.stringify({ error: 'Failed to send verification email: ' + errText }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
