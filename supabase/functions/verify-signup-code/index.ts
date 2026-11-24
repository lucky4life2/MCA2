import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// How many wrong guesses a single issued code tolerates before it is burned.
// Without this the 6-digit code could be walked end to end inside its
// 15-minute window.
const MAX_CODE_ATTEMPTS = 5;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares in time independent of how many leading characters match, so the
// response time can't be used to narrow the code down digit by digit.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const { userId, code } = await req.json();
    if (!userId || !code) {
      return new Response(JSON.stringify({ error: 'Missing userId or code.' }), { status: 400, headers: CORS });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('pending_email_token, pending_email_expires')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: 'Account not found.' }), { status: 400, headers: CORS });
    }
    if (!profile.pending_email_expires || new Date(profile.pending_email_expires) < new Date()) {
      return new Response(JSON.stringify({ error: 'Code has expired. Please sign up again.' }), { status: 400, headers: CORS });
    }

    // Count this guess BEFORE checking it. consume_code_attempt increments
    // atomically and returns the new total, so a burst of parallel requests
    // can't all read the same pre-increment value and slip past the cap.
    const { data: attempts, error: attemptErr } = await adminClient.rpc('consume_code_attempt', {
      p_user_id: userId,
      p_kind: 'pending_email',
    });
    if (attemptErr) {
      return new Response(JSON.stringify({ error: 'Could not check the code. Please try again.' }), { status: 500, headers: CORS });
    }
    if ((attempts ?? 0) > MAX_CODE_ATTEMPTS) {
      await adminClient.from('profiles').update({
        pending_email_token: null,
        pending_email_expires: null,
      }).eq('id', userId);
      return new Response(JSON.stringify({ error: 'Too many incorrect attempts. Please sign up again to get a new code.' }), { status: 429, headers: CORS });
    }

    // pending_email_token holds a SHA-256 hash (see signup-with-email), not the
    // plaintext code, so the submitted code has to be hashed the same way
    // before comparing.
    const codeHash = await sha256Hex(String(code).trim());
    if (!timingSafeEqual(codeHash, String(profile.pending_email_token ?? ''))) {
      return new Response(JSON.stringify({ error: 'Invalid code.' }), { status: 400, headers: CORS });
    }

    // ---- The code matched. THIS is the only place the address is proven to
    // ---- belong to the person signing up, so this is the only place the
    // ---- email may be marked confirmed.
    //
    // signup-with-email used to pass email_confirm: true when it created the
    // account in step 1, which handed out verification before any code was
    // checked: abandoning the flow left a fully confirmed account with a
    // working password, and because the endpoint is unauthenticated anyone
    // could claim an address they did not own. The account is now created
    // unconfirmed and is confirmed here instead.
    const { error: confirmErr } = await adminClient.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (confirmErr) {
      return new Response(JSON.stringify({ error: 'Failed to confirm email: ' + confirmErr.message }), { status: 500, headers: CORS });
    }

    // Clear the pending code only after confirmation succeeded, so a failure
    // above leaves the code usable for a retry instead of burning it.
    await adminClient.from('profiles').update({
      pending_email_token: null,
      pending_email_expires: null,
      pending_email_attempts: 0,
    }).eq('id', userId);

    // Generate a sign-in link so the frontend can get a session. This requires
    // the email to be confirmed, which is why it runs after the step above.
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: (await adminClient.auth.admin.getUserById(userId)).data.user!.email!,
    });
    if (linkErr || !linkData) {
      return new Response(JSON.stringify({ error: 'Failed to create session.' }), { status: 500, headers: CORS });
    }

    // Extract the tokens from the magic link URL
    const url = new URL(linkData.properties.action_link);
    const token_hash = url.searchParams.get('token_hash') || linkData.properties.hashed_token;
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: sessionData, error: sessionErr } = await anonClient.auth.verifyOtp({
      token_hash: token_hash!,
      type: 'magiclink',
    });

    if (sessionErr || !sessionData?.session) {
      return new Response(JSON.stringify({ error: 'Failed to create session.' }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({
      success: true,
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
