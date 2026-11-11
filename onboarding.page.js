import { supabase } from './supabase.js';

// ── Onboarding wizard ───────────────────────────────────────────
// Step-by-step account creation with a "pick your path" first step.
// Reuses the same server calls as login.html (signup-with-email,
// verify-signup-code, resend-signup-code) and account.html (profiles
// Minecraft link + set_mc_verify_code), so the wizard is a new front
// door, not a second auth system.

const params = new URLSearchParams(window.location.search);

const PATH_KEY = 'mca_onboard_path';
const STEP_KEY = 'mca_onboard_step';

const STEPS = ['path', 'account', 'minecraft', 'done'];
const STEP_META = {
  path:      { title: 'How do you play?', subtitle: "Pick the version of Minecraft you play — we'll tailor the rest of setup around it." },
  account:   { title: 'Create your account', subtitle: 'This is your MCA login. One account works for the website, the shop, and the server.' },
  verify:    { title: 'Almost there', subtitle: 'Just confirming your email so we know it\'s really you.' },
  minecraft: { title: 'Link your Minecraft name', subtitle: 'This is what lets the server know it\'s you. One quick command in-game and you\'re verified.' },
  done:      { title: 'Welcome to MCA!', subtitle: "You're all set up. Here's what's next." },
};

let _path = null;          // 'java' | 'bedrock' | 'both'
let _pendingSignupEmail = null;
let _pendingSignupUserId = null;
let _verifyCode = null;
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
}

// ── Step 1: Pick your path ──────────────────────────────────────
const pathCards = document.querySelectorAll('.onboard-path-card');
function selectPath(p) {
  _path = p;
  pathCards.forEach(c => c.classList.toggle('selected', c.dataset.path === p));
  document.getElementById('path-error').style.display = 'none';
  try { sessionStorage.setItem(PATH_KEY, p); } catch (e) {}
}
pathCards.forEach(c => c.addEventListener('click', () => selectPath(c.dataset.path)));
document.getElementById('btn-path-continue').addEventListener('click', () => {
  if (!_path) {
    const err = document.getElementById('path-error');
    err.style.display = 'block';
    return;
  }
  showStep('account');
});

// ── DOB selects (same neutral age screen as login.html) ─────────
const dobMonthEl = document.getElementById('signup-dob-month');
const dobDayEl = document.getElementById('signup-dob-day');
const dobYearEl = document.getElementById('signup-dob-year');
if (dobDayEl) {
  for (let d = 1; d <= 31; d++) {
    const v = String(d).padStart(2, '0');
    dobDayEl.insertAdjacentHTML('beforeend', `<option value="${v}">${d}</option>`);
  }
}
if (dobYearEl) {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 100; y--) {
    dobYearEl.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
  }
}
function buildDob() {
  const m = dobMonthEl ? dobMonthEl.value : '';
  const d = dobDayEl ? dobDayEl.value : '';
  const y = dobYearEl ? dobYearEl.value : '';
  if (!m || !d || !y) return '';
  const iso = `${y}-${m}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() + 1 !== Number(m) || dt.getUTCDate() !== Number(d)) return '';
  return iso;
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

function showAccountError(message) {
  const errEl = document.getElementById('signup-error');
  errEl.textContent = message;
  errEl.style.display = 'block';
}

// ── OAuth (redirects back here, then resumes at Minecraft) ──────
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
  const turnstileToken = (window.turnstile && document.querySelector('.cf-turnstile'))
    ? window.turnstile.getResponse()
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
    if (window.turnstile) window.turnstile.reset();
    errEl.textContent = 'Could not reach the server. Please try again.';
    errEl.style.display = 'block'; return;
  }
  btn.textContent = 'Create Account'; btn.disabled = false;
  if (!res.ok || json.error) {
    if (window.turnstile) window.turnstile.reset();
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
    enterMinecraftStep();
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

// ── Step 3: Minecraft (adapts to the chosen path) ───────────────
const mcUsernameEl = document.getElementById('field-mc-username');
const mcBedrockRow = document.getElementById('mc-bedrock-row');
const mcBedrockNameEl = document.getElementById('field-mc-bedrock-username');
const mcJavaRow = document.getElementById('mc-java-row');
let mcBedrockEdited = false;

function pathLabel(p) {
  return p === 'java' ? 'Java Edition' : p === 'bedrock' ? 'Bedrock Edition' : 'Java + Bedrock';
}

function enterMinecraftStep() {
  const note = document.getElementById('mc-path-note');
  if (_path === 'java') {
    note.innerHTML = `You picked <strong>Java Edition</strong> — enter the username you play Minecraft: Java Edition with on PC.`;
    mcJavaRow.style.display = '';
    mcBedrockRow.style.display = 'none';
  } else if (_path === 'bedrock') {
    note.innerHTML = `You picked <strong>Bedrock Edition</strong> — enter the username you play with on console, mobile, or Windows. We add the <strong>.</strong> for you.`;
    mcJavaRow.style.display = '';
    mcBedrockRow.style.display = 'none';
    mcUsernameEl.placeholder = 'Your Bedrock name';
    document.querySelector('label[for="field-mc-username"]').textContent = 'Bedrock Username';
  } else {
    note.innerHTML = `You picked <strong>both</strong> — enter your Java name, and your Bedrock name too if it's different. Same name? Just leave the Bedrock box as is.`;
    mcJavaRow.style.display = '';
    mcBedrockRow.style.display = '';
  }
  document.getElementById('mc-form').style.display = '';
  document.getElementById('mc-verify').style.display = 'none';
  showStep('minecraft');
}

// Keep the Bedrock box in sync with the Java name until the user edits
// it themselves (same as account.html).
const mcSyncBedrock = () => {
  if (_path !== 'both') return;
  if (!mcBedrockEdited) mcBedrockNameEl.value = mcUsernameEl.value.trim();
};
mcBedrockNameEl.addEventListener('input', () => { mcBedrockEdited = true; });
mcUsernameEl.addEventListener('input', mcSyncBedrock);

function likeEscape(s) {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

document.getElementById('btn-submit-mc').addEventListener('click', async () => {
  if (!_user) {
    const { data: { user } } = await supabase.auth.getUser();
    _user = user;
  }
  if (!_user) {
    const errEl = document.getElementById('mc-error');
    errEl.textContent = 'You need to be signed in. Go back and create your account first.';
    errEl.style.display = 'block'; return;
  }
  const username = mcUsernameEl.value.trim();
  const errEl = document.getElementById('mc-error');
  errEl.style.display = 'none';
  if (!username) { errEl.textContent = 'Enter your Minecraft username.'; errEl.style.display = 'block'; return; }

  const javaChecked = _path === 'java' || _path === 'both';
  const bedrockChecked = _path === 'bedrock' || _path === 'both';
  // Primary username stored on the profile: the Java name when Java is
  // picked, otherwise the Bedrock name with the Floodgate dot prefix
  // added automatically (Bedrock players show up in-game as ".Name").
  // When both are picked, the Bedrock name is stored separately.
  const bedrockName = bedrockChecked
    ? (javaChecked ? mcBedrockNameEl.value.trim() : username)
    : '';
  if (bedrockChecked && !bedrockName) { errEl.textContent = 'Enter your Bedrock username.'; errEl.style.display = 'block'; return; }
  const primaryUsername = javaChecked ? username : '.' + bedrockName;
  const bedrockUsername = bedrockChecked ? '.' + bedrockName : null;

  // Uniqueness checks (client-side convenience only — the database unique
  // indexes are the real enforcement).
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .ilike('minecraft_username', likeEscape(primaryUsername))
    .neq('id', _user.id)
    .maybeSingle();
  if (existing) {
    errEl.textContent = `"${primaryUsername}" is already linked to another account. If this is your username, contact an admin.`;
    errEl.style.display = 'block';
    return;
  }
  if (bedrockUsername) {
    const { data: existingBedrock } = await supabase
      .from('profiles')
      .select('id')
      .ilike('minecraft_bedrock_username', likeEscape(bedrockUsername))
      .neq('id', _user.id)
      .maybeSingle();
    if (existingBedrock) {
      errEl.textContent = `"${bedrockUsername}" is already linked to another account. If this is your username, contact an admin.`;
      errEl.style.display = 'block';
      return;
    }
  }

  const btn = document.getElementById('btn-submit-mc');
  btn.textContent = 'Saving…'; btn.disabled = true;
  const { error } = await supabase.from('profiles').update({
    minecraft_username: primaryUsername,
    minecraft_bedrock_username: bedrockUsername,
  }).eq('id', _user.id);
  btn.textContent = 'Save & Get My Code'; btn.disabled = false;
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }

  // Show the in-game verify code.
  _verifyCode = generateCode();
  document.getElementById('mc-code-command').textContent = '/mcaverify ' + _verifyCode;
  document.getElementById('mc-form').style.display = 'none';
  document.getElementById('mc-verify').style.display = '';
  document.getElementById('mc-verify-error').style.display = 'none';
  document.getElementById('mc-verify-success').style.display = 'none';
});

function generateCode() {
  // CSPRNG 8-char code, stored through set_mc_verify_code() (server checks
  // the format and uniqueness and sets the 10-minute expiry itself).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
  supabase.rpc('set_mc_verify_code', { p_code: code }).then(({ error }) => {
    if (error) console.warn('Could not store verify code:', error.message);
  });
  return code;
}

document.getElementById('btn-copy-code').addEventListener('click', function() {
  navigator.clipboard.writeText('/mcaverify ' + _verifyCode).catch(() => {});
  this.textContent = 'Copied!';
  this.classList.add('copied');
  setTimeout(() => { this.textContent = 'Copy'; this.classList.remove('copied'); }, 2000);
});

document.getElementById('btn-check-mc').addEventListener('click', async () => {
  const successEl = document.getElementById('mc-verify-success');
  const errorEl = document.getElementById('mc-verify-error');
  successEl.style.display = 'none';
  errorEl.style.display = 'none';
  const { data: prof } = await supabase.from('profiles')
    .select('minecraft_verified, minecraft_bedrock_verified')
    .eq('id', _user.id).single();
  if (prof && (prof.minecraft_verified || prof.minecraft_bedrock_verified)) {
    successEl.textContent = 'Verified! You\'re all set — welcome to the server.';
    successEl.style.display = 'block';
    setTimeout(() => showStep('done'), 1200);
    return;
  }
  errorEl.textContent = 'Not verified yet. Run the command in-game, then check again.';
  errorEl.style.display = 'block';
});

document.getElementById('btn-mc-continue').addEventListener('click', () => showStep('done'));

// ── Back links ──────────────────────────────────────────────────
document.getElementById('back-from-account').addEventListener('click', () => showStep('path'));
document.getElementById('back-from-verify').addEventListener('click', () => showStep('account'));
document.getElementById('back-from-minecraft').addEventListener('click', () => {
  // If the account was just created, going back lands on the verify step
  // only when there's a pending email code; otherwise back to account.
  if (_pendingSignupUserId) showStep('verify');
  else showStep('account');
});

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
    // Already linked? Skip straight to Done.
    const { data: prof } = await supabase.from('profiles')
      .select('minecraft_username, minecraft_verified, minecraft_bedrock_username, minecraft_bedrock_verified')
      .eq('id', user.id).single();
    if (prof && (prof.minecraft_username || prof.minecraft_bedrock_username)) {
      if (prof.minecraft_verified || prof.minecraft_bedrock_verified) { showStep('done'); return; }
      // Linked but not verified — show the code again.
      if (_path) { enterMinecraftStep(); return; }
    }
    if (_path) { enterMinecraftStep(); return; }
  }
  // Fresh visit (or returning from OAuth without a stored path): start
  // at the path picker, or resume at the stored step if there is one.
  let step = 'path';
  try { step = sessionStorage.getItem(STEP_KEY) || 'path'; } catch (e) {}
  if (step === 'done' || step === 'minecraft' || step === 'verify') step = 'path';
  if (step === 'account' && !_path) step = 'path';
  showStep(step);
})();
