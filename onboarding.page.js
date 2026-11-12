import { supabase } from './supabase.js';

// ── Onboarding wizard ───────────────────────────────────────────
// Step-by-step account creation: account first, then "how you play",
// then done. Minecraft verification is NOT part of this wizard — it
// unlocks on the account page only after the member has paid, and the
// MCAVerify plugin's join gate is what keeps the server locked until
// then. Reuses the same server calls as login.html (signup-with-email,
// verify-signup-code, resend-signup-code), so the wizard is a new front
// door, not a second auth system.

const params = new URLSearchParams(window.location.search);

const PATH_KEY = 'mca_onboard_path';
const STEP_KEY = 'mca_onboard_step';

// The path is kept in sessionStorage only — there is no profiles column
// for it, so the account page reads it back from here (same tab) to
// pre-fill the Java/Bedrock choice when the member links Minecraft after
// paying. Nothing else in the wizard writes to the profile.
const STEPS = ['account', 'path', 'done'];
const STEP_META = {
  account:   { title: 'Create your account', subtitle: 'This is your MCA login. One account works for the website, the shop, and the server.' },
  verify:    { title: 'Almost there', subtitle: 'Just confirming your email so we know it\'s really you.' },
  path:      { title: 'How do you play?', subtitle: "Pick the version of Minecraft you play — we'll tailor the rest of setup around it." },
  done:      { title: 'Welcome to MCA!', subtitle: "You're all set up. Here's what's next." },
};

let _path = null;          // 'java' | 'bedrock' | 'both'
let _pendingSignupEmail = null;
let _pendingSignupUserId = null;
let _user = null;

// ── Step navigation ─────────────────────────────────────────────
const titleEl = document.getElementById('onboard-title');
const subtitleEl = document.getElementById('onboard-subtitle');

function showStep(name) {
  // 'verify' is a sub-state of the Account progress step.
  const progressName = name === 'verify' ? 'account' : name;
  document.querySelectorAll('.onboard-step').forEach(el => el.classList.remove('active'));
  const panel = document.getElementById('step-' + name);
  if (panel) panel.classList.add('active');
  const meta = STEP_META[name];
  if (meta) { titleEl.textContent = meta.title; subtitleEl.textContent = meta.subtitle; }
  document.querySelectorAll('.onboard-progress-step').forEach(el => {
    const key = el.dataset.step;
    const idx = STEPS.indexOf(key);
    const cur = STEPS.indexOf(progressName);
    el.classList.toggle('current', idx === cur);
    el.classList.toggle('done', idx < cur);
    const dot = el.querySelector('.onboard-progress-dot');
    if (dot) dot.textContent = idx < cur ? '✓' : String(idx + 1);
  });
  try { sessionStorage.setItem(STEP_KEY, name); } catch (e) {}
  window.scrollTo({ top: 0, behavior: 'smooth' });
  titleEl.focus({ preventScroll: true });
}

// ── Step 2: Pick your path ──────────────────────────────────────
const pathCards = document.querySelectorAll('.onboard-path-card');
const pathContinueBtn = document.getElementById('btn-path-continue');
function selectPath(p) {
  _path = p;
  pathCards.forEach(c => c.classList.toggle('selected', c.dataset.path === p));
  document.getElementById('path-error').style.display = 'none';
  pathContinueBtn.disabled = false;
  try { sessionStorage.setItem(PATH_KEY, p); } catch (e) {}
}
pathCards.forEach(c => c.addEventListener('click', () => selectPath(c.dataset.path)));
// "Back to sign in" lives on the account step now (step 1); the path
// step's way back is the account step.
document.getElementById('back-to-signin').addEventListener('click', () => {
  window.location.href = 'login.html';
});
document.getElementById('back-from-path').addEventListener('click', () => {
  showStep('account');
});
document.getElementById('btn-path-continue').addEventListener('click', () => {
  if (!_path) {
    const err = document.getElementById('path-error');
    err.style.display = 'block';
    return;
  }
  showStep('done');
});

// ── DOB selects: month + year only (option 3). The signup edge function
// still expects a full DOB date, so we send the first of the month
// (YYYY-MM-01) — age validation and the age band still compute from it.
// Year range covers the school-club age band (13–19): a 19-year-old can
// have been born in thisYear-20 (e.g. December), and a 13-year-old in
// thisYear-13.
const dobMonthEl = document.getElementById('signup-dob-month');
const dobYearEl = document.getElementById('signup-dob-year');
if (dobYearEl) {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear - 13; y >= thisYear - 20; y--) {
    dobYearEl.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
  }
}
function buildDob() {
  const m = dobMonthEl ? dobMonthEl.value : '';
  const y = dobYearEl ? dobYearEl.value : '';
  if (!m || !y) return '';
  return `${y}-${m}-01`;
}
const todayIso = new Date().toISOString().slice(0, 10);

// ── Club list + consent gate (same as login.html) ───────────────
supabase.from('club_presidents').select('id, club_name, region').order('club_name').then(({ data }) => {
  const sel = document.getElementById('signup-club');
  for (const c of data || []) sel.add(new Option(c.club_name + (c.region ? ' — ' + c.region : ''), c.id));
});

const signupConsent = document.getElementById('signup-consent');
const signupConsentError = document.getElementById('signup-consent-error');
function requireSignupConsent() {
  if (signupConsent.checked) {
    signupConsentError.style.display = 'none';
    try {
      const club = document.getElementById('signup-club').value;
      if (club) sessionStorage.setItem('mca_signup_club', club);
      else sessionStorage.removeItem('mca_signup_club');
    } catch (e) {}
    return true;
  }
  signupConsentError.style.display = 'block';
  return false;
}
signupConsent.addEventListener('change', () => {
  if (signupConsent.checked) signupConsentError.style.display = 'none';
});

// ── Email form toggle + Turnstile ────────────────────────────────
// The account step shows the sign-up choices first; the email form (and
// its Turnstile challenge) only appears when the member picks email. The
// challenge is rendered explicitly the first time the form opens —
// rendering it into a hidden container is unreliable, and loading it up
// front would show a challenge to members who never pick email.
const TURNSTILE_SITEKEY = '0x4AAAAAAEkQfLOaNciyMxZ5';
let turnstileWidgetId = null;
function ensureTurnstile() {
  if (turnstileWidgetId !== null) return;
  if (!window.turnstile) {
    // The Turnstile script loads async — render as soon as it arrives.
    const script = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
    if (script) script.addEventListener('load', ensureTurnstile, { once: true });
    return;
  }
  turnstileWidgetId = window.turnstile.render('#turnstile-container', {
    sitekey: TURNSTILE_SITEKEY,
    theme: 'light',
  });
}
function showEmailForm() {
  document.getElementById('onboard-auth-choice').style.display = 'none';
  document.getElementById('onboard-email-form').style.display = '';
  ensureTurnstile();
}
function showAuthChoice() {
  document.getElementById('onboard-email-form').style.display = 'none';
  document.getElementById('onboard-auth-choice').style.display = '';
}
document.getElementById('btn-show-email-form').addEventListener('click', showEmailForm);
document.getElementById('back-to-auth-choice').addEventListener('click', showAuthChoice);

function showAccountError(message) {
  // The error lives in the email form, so make sure that form is showing —
  // otherwise an OAuth failure that sent the user back here with ?error=…
  // would write into a hidden panel and the member would never see it.
  showEmailForm();
  const errEl = document.getElementById('signup-error');
  errEl.textContent = message;
  errEl.style.display = 'block';
}

// ── OAuth (redirects back here, then resumes at Done — or the path
// picker if the member was mid-wizard) ────────────────────────────
const oauthRedirect = window.location.origin + '/onboarding.html';
async function oauthLogin(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirect },
  });
  if (error) showAccountError('Could not start ' + provider + ' sign-in: ' + error.message);
}
document.getElementById('btn-discord-signup').addEventListener('click', () => {
  if (requireSignupConsent()) oauthLogin('discord');
});
document.getElementById('btn-google-signup').addEventListener('click', () => {
  if (requireSignupConsent()) googleLogin();
});
async function googleLogin() { await oauthLogin('google'); }

// Surface an OAuth failure that sent the user back here with ?error=…
(function showOAuthCallbackError() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const oauthError = params.get('error_description') || params.get('error')
    || hashParams.get('error_description') || hashParams.get('error');
  if (!oauthError) return;
  showAccountError(decodeURIComponent(oauthError.replace(/\+/g, ' ')));
  history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&](error|error_description|error_code)=[^&]*/g, '').replace(/^&/, '?'));
})();

// ── Email sign up (same validation + endpoint as login.html) ────
document.getElementById('btn-email-signup').addEventListener('click', async () => {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const dob = buildDob();
  const errEl = document.getElementById('signup-error');
  errEl.style.display = 'none';
  if (!requireSignupConsent()) return;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block'; return;
  }
  if (!dob) {
    errEl.textContent = 'Please enter your date of birth.';
    errEl.style.display = 'block'; return;
  }
  if (dob > todayIso) {
    errEl.textContent = 'Please enter a valid date of birth.';
    errEl.style.display = 'block'; return;
  }
  if (password.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters.';
    errEl.style.display = 'block'; return;
  }
  if (!/[A-Z]/.test(password)) {
    errEl.textContent = 'Password must contain at least one uppercase letter.';
    errEl.style.display = 'block'; return;
  }
  if (!/[a-z]/.test(password)) {
    errEl.textContent = 'Password must contain at least one lowercase letter.';
    errEl.style.display = 'block'; return;
  }
  const turnstileToken = (window.turnstile && turnstileWidgetId !== null)
    ? window.turnstile.getResponse(turnstileWidgetId)
    : '';
  if (!turnstileToken) {
    errEl.textContent = 'Please complete the verification challenge.';
    errEl.style.display = 'block'; return;
  }
  const btn = document.getElementById('btn-email-signup');
  btn.textContent = 'Sending…'; btn.disabled = true;
  const SUPABASE_URL = supabase.supabaseUrl;
  const ANON_KEY = supabase.supabaseKey;
  let res, json;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/signup-with-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email, password, turnstileToken, dateOfBirth: dob }),
    });
    json = await res.json();
  } catch (e) {
    btn.textContent = 'Create Account'; btn.disabled = false;
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    errEl.textContent = 'Could not reach the server. Please try again.';
    errEl.style.display = 'block'; return;
  }
  btn.textContent = 'Create Account'; btn.disabled = false;
  if (!res.ok || json.error) {
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    errEl.textContent = json.error || 'Sign up failed.';
    errEl.style.display = 'block'; return;
  }
  _pendingSignupEmail = email;
  _pendingSignupUserId = json.userId;
  document.getElementById('verify-email-display').textContent = email;
  document.getElementById('signup-code').value = '';
  document.getElementById('confirm-error').style.display = 'none';
  showStep('verify');
});

// ── Verify email code (same endpoint as login.html) ─────────────
document.getElementById('btn-verify-signup').addEventListener('click', async () => {
  const code = document.getElementById('signup-code').value.trim();
  const errEl = document.getElementById('confirm-error');
  const btn = document.getElementById('btn-verify-signup');
  errEl.style.display = 'none';
  if (!code) {
    errEl.textContent = 'Enter the code from your email.';
    errEl.style.display = 'block'; return;
  }
  btn.textContent = 'Verifying…'; btn.disabled = true;
  const SUPABASE_URL = supabase.supabaseUrl;
  const ANON_KEY = supabase.supabaseKey;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-signup-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ userId: _pendingSignupUserId, code }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      errEl.textContent = json.error || 'Invalid or expired code.';
      errEl.style.display = 'block';
      btn.textContent = 'Verify & Continue'; btn.disabled = false;
      return;
    }
    if (!json.access_token || !json.refresh_token) {
      errEl.textContent = 'Could not complete sign-in. Please try again.';
      errEl.style.display = 'block';
      btn.textContent = 'Verify & Continue'; btn.disabled = false;
      return;
    }
    await supabase.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token });
    await backfillUsername();
    const { data: { user } } = await supabase.auth.getUser();
    _user = user;
    btn.textContent = 'Verify & Continue'; btn.disabled = false;
    showStep('path');
  } catch (e) {
    errEl.textContent = 'Could not reach the server. Please try again.';
    errEl.style.display = 'block';
    btn.textContent = 'Verify & Continue'; btn.disabled = false;
  }
});
document.getElementById('signup-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-verify-signup').click();
});
document.getElementById('confirm-resend').addEventListener('click', async e => {
  e.preventDefault();
  const link = document.getElementById('confirm-resend');
  const errEl = document.getElementById('confirm-error');
  errEl.style.display = 'none';
  if (!_pendingSignupUserId) return;
  const originalText = link.textContent;
  link.textContent = 'Sending…';
  try {
    const SUPABASE_URL = supabase.supabaseUrl;
    const ANON_KEY = supabase.supabaseKey;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resend-signup-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ userId: _pendingSignupUserId }),
    });
    const json = await res.json();
    if (!res.ok) {
      errEl.style.color = '';
      errEl.textContent = json.error || 'Failed to resend the code.';
      errEl.style.display = 'block';
    } else {
      document.getElementById('signup-code').value = '';
      errEl.style.color = '#2e7d32';
      errEl.textContent = 'A new code has been sent to your email.';
      errEl.style.display = 'block';
    }
  } catch {
    errEl.textContent = 'Failed to resend the code. Please check your connection and try again.';
    errEl.style.display = 'block';
  } finally {
    link.textContent = originalText;
  }
});

// Backfill a username from the email prefix if signup didn't set one
// (same as login.html — keeps the account page from showing an email fragment).
async function backfillUsername() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).single();
    if (prof && !prof.username) {
      let base = (user.email || '').split('@')[0].split('+')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'member';
      let candidate = base, n = 0;
      for (;;) {
        const { data: taken } = await supabase.from('profiles').select('id').eq('username', candidate).limit(1);
        if (!taken || !taken.length) break;
        n += 1; candidate = `${base}${n}`;
        if (n > 99) break;
      }
      await supabase.from('profiles').update({ username: candidate }).eq('id', user.id);
    }
  } catch (e) { /* non-fatal */ }
}


// ── Back links ──────────────────────────────────────────────────
document.getElementById('back-from-verify').addEventListener('click', () => showStep('account'));

// ── Done ────────────────────────────────────────────────────────
document.getElementById('btn-done-account').addEventListener('click', () => {
  window.location.href = 'account.html';
});

// ── Resume / entry ──────────────────────────────────────────────
(async function init() {
  try { _path = sessionStorage.getItem(PATH_KEY); } catch (e) {}
  if (_path) selectPath(_path);

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data: { user } } = await supabase.auth.getUser();
    _user = user;
    // Signed in means the account already exists, so the wizard is
    // effectively done — except when they were mid-way through the path
    // picker (e.g. they verified their email and then refreshed). Let
    // them finish picking how they play, then Done.
    let step = 'done';
    try { step = sessionStorage.getItem(STEP_KEY) || 'done'; } catch (e) {}
    if (step === 'path') { showStep('path'); return; }
    showStep('done');
    return;
  }
  // Fresh visit: start at the account step. A stored step from an
  // earlier visit only matters if it's the account step itself (the
  // email form); anything else funnels back to account, since the
  // account has to exist before the path picker means anything.
  let step = 'account';
  try { step = sessionStorage.getItem(STEP_KEY) || 'account'; } catch (e) {}
  if (step !== 'account') step = 'account';
  showStep(step);
})();
