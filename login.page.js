  import { supabase, signInWithDiscord } from './supabase.js';

  // ── Redirect destination ──────────────────────────────────────
  // If the user was sent here from another page, return them there after login.
  const params   = new URLSearchParams(window.location.search);

  // ?return= is attacker-controllable and is fed straight to
  // window.location.replace() and to the OAuth redirectTo. Anything but a
  // same-site page name would turn the login page into an open redirect, so
  // only "<page>.html" (optionally with a query/hash) is accepted.
  function safeReturnTo(raw) {
    const v = String(raw ?? '').trim();
    return /^[A-Za-z0-9._~-]+\.html(?:[?#][^\s]*)?$/.test(v) ? v : 'account.html';
  }
  const returnTo = safeReturnTo(params.get('return'));

  if (params.get('deletion_scheduled') === '1') {
    const banner = document.getElementById('deletion-scheduled-banner');
    if (banner) banner.style.display = 'block';
  }
  if (params.get('deactivated') === '1') {
    const banner = document.getElementById('deactivated-banner');
    if (banner) banner.style.display = 'block';
  }

  // Google/Discord send us back here with ?error=...&error_description=...
  // (or, for the implicit flow, the same pair in the #hash instead of the
  // query string) when the OAuth attempt itself fails — user denied access,
  // the provider errored, etc. Previously nothing read these, so a failed
  // "Continue with Google" silently dumped the user back on a blank login
  // page with zero explanation, which is exactly what "Google doesn't work"
  // reports were describing. Surface whichever one is present.
  (function showOAuthCallbackError() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const oauthError = params.get('error_description') || params.get('error')
      || hashParams.get('error_description') || hashParams.get('error');
    if (!oauthError) return;
    const errEl = document.getElementById('signin-error');
    if (!errEl) return;
    errEl.textContent = decodeURIComponent(oauthError.replace(/\+/g, ' '));
    errEl.style.display = 'block';
    // Clean the error out of the URL so a refresh doesn't keep re-showing it.
    history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&](error|error_description|error_code)=[^&]*/g, '').replace(/^&/, '?'));
  })();

  // Best-effort: flips a dormant account back to active on successful login.
  // No-op (and safe to ignore errors) if the account isn't deactivated.
  async function reactivateIfNeeded() {
    try { await supabase.rpc('reactivate_own_account'); } catch(e) {}
  }
  async function finishLogin(dest) {
    await reactivateIfNeeded();
    window.location.replace(dest);
  }

  // If already signed in, skip the login page entirely — unless the session
  // hasn't cleared the AAL2 (2FA) requirement yet, in which case we need to
  // show the MFA panel. Always check AAL regardless of the mfa=1 param — a
  // plain revisit/bookmark of login.html with only an AAL1 session (2FA
  // enrolled but not yet verified this session) must not skip straight to
  // returnTo.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel === aal.nextLevel) {
      // Already at required level — nothing to do.
      finishLogin(returnTo);
    }
    // Otherwise fall through: the MFA panel will be shown below after init.
  }

  // Pending email addresses for the code-entry steps below
  let _pendingSignupEmail  = null;
  let _pendingSignupUserId = null;
  let _pendingResetEmail   = null;
  let _pendingMfaFactorId = null;

  // ── Tab switching ─────────────────────────────────────────────
  const tabs     = document.querySelectorAll('.login-tab');
  const panels   = document.querySelectorAll('.login-panel');
  const cardTitle      = document.getElementById('card-title');
  const footerSwitchText = document.getElementById('footer-switch-text');
  const footerSwitchLink = document.getElementById('footer-switch-link');
  const loginCardFooter  = document.getElementById('login-card-footer');

  function switchTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
    loginCardFooter.style.display = '';

    if (name === 'signin') {
      cardTitle.textContent = 'Welcome Back';
      footerSwitchText.innerHTML = `Don't have an account? <a href="#" id="footer-switch-link">Create one</a>`;
    } else {
      cardTitle.textContent = 'Create Account';
      footerSwitchText.innerHTML = `Already have an account? <a href="#" id="footer-switch-link">Sign in</a>`;
    }
    document.getElementById('footer-switch-link').addEventListener('click', e => {
      e.preventDefault();
      switchTab(name === 'signin' ? 'signup' : 'signin');
    });
  }

  tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  footerSwitchLink.addEventListener('click', e => { e.preventDefault(); switchTab('signup'); });

  // Handle ?tab=signup in URL (e.g. from "Create account" link elsewhere)
  if (params.get('tab') === 'signup') switchTab('signup');

  // ── Terms/Privacy consent (Create Account tab only) ─────────────
  const signupConsent      = document.getElementById('signup-consent');
  const signupConsentError = document.getElementById('signup-consent-error');

  // Consent must be accepted before Create-Account-tab signup (email or OAuth) proceeds.
  // Returns true and clears the error if accepted; otherwise shows the error and returns false.
  function requireSignupConsent() {
    if (signupConsent.checked) {
      signupConsentError.style.display = 'none';
      // Every signup path (email, Discord, Google) passes through here, so this
      // is where the chosen club is remembered. nav.js sends the join request
      // once the new account has a session (after the OAuth redirect, too).
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
  supabase.from('club_presidents').select('id, club_name, region').order('club_name').then(({ data }) => {
    const sel = document.getElementById('signup-club');
    for (const c of data || []) sel.add(new Option(c.club_name + (c.region ? ' — ' + c.region : ''), c.id));
  });

  signupConsent.addEventListener('change', () => {
    if (signupConsent.checked) signupConsentError.style.display = 'none';
  });

  // signInWithOAuth() resolves with {error} instead of throwing when the
  // provider isn't enabled/configured on the Supabase project — previously
  // that error was never checked, so a broken provider looked exactly like
  // "nothing happens" when clicked, with no way to tell what went wrong.
  function showLoginError(message) {
    // Google/Discord buttons exist on both the Sign In and Create Account
    // panels, each with its own error element (#signin-error / #signup-error)
    // — only one panel is visible (.login-panel.active) at a time, so target
    // that one instead of always writing into the (possibly hidden) sign-in
    // error element.
    const activePanel = document.querySelector('.login-panel.active');
    const errEl = (activePanel && activePanel.querySelector('.login-error'))
      || document.getElementById('signin-error');
    if (!errEl) return;
    errEl.textContent = message;
    errEl.style.display = 'block';
  }

  // ── Discord ───────────────────────────────────────────────────
  const discordRedirect = window.location.origin + '/' + returnTo;

  async function discordLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: discordRedirect }
    });
    if (error) showLoginError('Could not start Discord sign-in: ' + error.message);
  }
  // Sign In tab's Discord button doesn't show the consent checkbox (that's
  // signup-only now), so it doesn't gate on it — see requireSignupConsent().
  document.getElementById('btn-discord-signin').addEventListener('click', discordLogin);
  document.getElementById('btn-discord-signup').addEventListener('click', () => {
    if (requireSignupConsent()) discordLogin();
  });

  // ── Google ────────────────────────────────────────────────────
  const googleRedirect = window.location.origin + '/' + returnTo;

  async function googleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: googleRedirect }
    });
    if (error) showLoginError('Could not start Google sign-in: ' + error.message);
  }
  document.getElementById('btn-google-signin').addEventListener('click', googleLogin);
  document.getElementById('btn-google-signup').addEventListener('click', () => {
    if (requireSignupConsent()) googleLogin();
  });

  // ── MFA challenge on page load (redirected from a protected page) ─────────
  // When the user arrives with ?mfa=1 they already have a valid aal1 session;
  // we just need to issue a TOTP challenge against it.
  if (params.get('mfa') === '1' && session) {
    try {
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const totpFactor = factorData?.totp?.find(f => f.status === 'verified');
      if (totpFactor) {
        _pendingMfaFactorId = totpFactor.id;
        document.getElementById('mfa-code').value = '';
        document.getElementById('mfa-error').style.display = 'none';
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        document.getElementById('panel-mfa').classList.add('active');
        document.getElementById('login-tabs').style.display = 'none';
        document.getElementById('login-card-footer').style.display = 'none';
        cardTitle.textContent = 'Two-Factor Authentication';
        document.getElementById('mfa-code').focus();
      } else {
        // No verified factor found — just go to the destination.
        finishLogin(returnTo);
      }
    } catch(e) {
      // On error, redirect rather than leaving user stuck.
      finishLogin(returnTo);
    }
  }


  document.getElementById('btn-email-signin').addEventListener('click', async () => {
    let identifier = document.getElementById('signin-email').value.trim();
    const password  = document.getElementById('signin-password').value;
    const errEl     = document.getElementById('signin-error');
    const btn       = document.getElementById('btn-email-signin');
    errEl.style.display = 'none';
    if (!identifier) {
      errEl.textContent = 'Please enter your email or username.';
      errEl.style.display = 'block'; return;
    }
    btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
    // A username is sent as-is: sign-in-with-email resolves it to an email
    // server-side (service role), so no email address ever reaches the browser.
    errEl.style.display = 'none';
    if (!identifier || !password) {
      errEl.textContent = 'Please enter your email or username and password.';
      errEl.style.display = 'block';
      btn.textContent = 'Sign In'; btn.disabled = false;
      return;
    }
      // Route through edge function so the revoke check is enforced server-side
      const res = await fetch('https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/sign-in-with-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        // The account exists and the password is correct, but the email was
        // never confirmed via the signup code (e.g. the tab was closed right
        // after signup). Reuse the same code-entry panel signup uses instead
        // of just failing, since sign-in-with-email already emailed a code
        // that's likely still valid.
        if (json.needsVerification && json.userId) {
          _pendingSignupUserId = json.userId;
          document.getElementById('signup-code').value = '';
          document.getElementById('confirm-error').style.display = 'none';
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));
          document.getElementById('panel-confirm').classList.add('active');
          document.getElementById('login-tabs').style.display = 'none';
          document.getElementById('login-card-footer').style.display = 'none';
          cardTitle.textContent = 'Almost there';
          btn.textContent = 'Sign In'; btn.disabled = false;
          return;
        }
        errEl.textContent = json.error || 'Sign in failed.';
        errEl.style.display = 'block';
        btn.textContent = 'Sign In'; btn.disabled = false;
        return;
      }
      // Set the session from the tokens returned by the edge function
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (sessionErr) throw sessionErr;

      // Check if MFA is required
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
        // MFA challenge needed — find the TOTP factor
        const { data: factorData } = await supabase.auth.mfa.listFactors();
        const totpFactor = factorData?.totp?.find(f => f.status === 'verified');
        if (totpFactor) {
          _pendingMfaFactorId = totpFactor.id;
          document.getElementById('mfa-code').value = '';
          document.getElementById('mfa-error').style.display = 'none';
          tabs.forEach(t => t.classList.remove('active'));
          panels.forEach(p => p.classList.remove('active'));
          document.getElementById('panel-mfa').classList.add('active');
          document.getElementById('login-tabs').style.display = 'none';
          document.getElementById('login-card-footer').style.display = 'none';
          cardTitle.textContent = 'Two-Factor Authentication';
          btn.textContent = 'Sign In'; btn.disabled = false;
          document.getElementById('mfa-code').focus();
          return;
        }
      }

      finishLogin(returnTo);
    } catch(e) {
      errEl.textContent   = e.message || 'Sign in failed.';
      errEl.style.display = 'block';
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  // Enter key on password field
  document.getElementById('signin-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-email-signin').click();
  });

  // ── Forgot password ───────────────────────────────────────
  document.getElementById('link-forgot-password').addEventListener('click', e => {
    e.preventDefault();
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    document.getElementById('panel-forgot').classList.add('active');
    document.getElementById('login-tabs').style.display = 'none';
    document.getElementById('login-card-footer').style.display = 'none';
    cardTitle.textContent = 'Reset Password';
    // Reset panel to its initial step
    document.getElementById('forgot-step-email').style.display = '';
    document.getElementById('forgot-step-code').style.display = 'none';
    document.getElementById('forgot-success').style.display = 'none';
    document.getElementById('forgot-error').style.display = 'none';
    document.getElementById('forgot-code-error').style.display = 'none';
    document.getElementById('forgot-code').value = '';
    document.getElementById('forgot-new-password').value = '';
    document.getElementById('forgot-back').style.display = '';
    document.getElementById('forgot-back').textContent = '← Back to sign in';
    // Pre-fill email if already typed
    const existingEmail = document.getElementById('signin-email').value.trim();
    if (existingEmail && existingEmail.includes('@')) document.getElementById('forgot-email').value = existingEmail;
  });

  document.getElementById('forgot-back').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('login-tabs').style.display = '';
    document.getElementById('login-card-footer').style.display = '';
    document.getElementById('forgot-success').style.display = 'none';
    document.getElementById('forgot-error').style.display = 'none';
    switchTab('signin');
  });

  document.getElementById('btn-send-reset').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email').value.trim();
    const errEl = document.getElementById('forgot-error');
    errEl.style.display = 'none';
    if (!email) {
      errEl.textContent = 'Please enter your email address.';
      errEl.style.display = 'block'; return;
    }
    const SUPABASE_URL = supabase.supabaseUrl;
    const ANON_KEY = supabase.supabaseKey;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      errEl.textContent = json.error || 'Could not send reset code.';
      errEl.style.display = 'block'; return;
    }
    _pendingResetEmail = email;
    document.getElementById('forgot-step-email').style.display = 'none';
    document.getElementById('forgot-step-code').style.display = '';
  });

  document.getElementById('btn-reset-password').addEventListener('click', async () => {
    const code    = document.getElementById('forgot-code').value.trim();
    const newPass = document.getElementById('forgot-new-password').value;
    const errEl   = document.getElementById('forgot-code-error');
    errEl.style.display = 'none';
    if (!code) {
      errEl.textContent = 'Enter the code from your email.';
      errEl.style.display = 'block'; return;
    }
    if (newPass.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters.';
      errEl.style.display = 'block'; return;
    }
    if (!/[A-Z]/.test(newPass)) {
      errEl.textContent = 'Password must contain at least one uppercase letter.';
      errEl.style.display = 'block'; return;
    }
    if (!/[a-z]/.test(newPass)) {
      errEl.textContent = 'Password must contain at least one lowercase letter.';
      errEl.style.display = 'block'; return;
    }

    const SUPABASE_URL = supabase.supabaseUrl;
    const ANON_KEY = supabase.supabaseKey;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/reset-password-with-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email: _pendingResetEmail, code, newPassword: newPass }),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      errEl.textContent = json.error || 'Invalid or expired code.';
      errEl.style.display = 'block'; return;
    }
    if (json.access_token && json.refresh_token) {
      await supabase.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token });
    }

    document.getElementById('forgot-step-code').style.display = 'none';
    document.getElementById('forgot-success').style.display = 'block';
    document.getElementById('forgot-back').textContent = '→ Sign in now';
  });

  // Enter key on reset password field
  document.getElementById('forgot-new-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-reset-password').click();
  });

  // ── MFA challenge ─────────────────────────────────────────────
  document.getElementById('btn-mfa-verify').addEventListener('click', async () => {
    const code  = document.getElementById('mfa-code').value.trim();
    const errEl = document.getElementById('mfa-error');
    const btn   = document.getElementById('btn-mfa-verify');
    errEl.style.display = 'none';
    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = 'Enter the 6-digit code from your authenticator app.';
      errEl.style.display = 'block'; return;
    }
    btn.textContent = 'Verifying…'; btn.disabled = true;
    try {
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: _pendingMfaFactorId });
      if (challengeErr) throw challengeErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: _pendingMfaFactorId,
        challengeId: challengeData.id,
        code,
      });
      if (verifyErr) throw verifyErr;
      finishLogin(returnTo);
    } catch(e) {
      errEl.textContent = e.message || 'Invalid code. Try again.';
      errEl.style.display = 'block';
      btn.textContent = 'Verify'; btn.disabled = false;
    }
  });

  document.getElementById('mfa-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-mfa-verify').click();
  });

  document.getElementById('mfa-back').addEventListener('click', async e => {
    e.preventDefault();
    await supabase.auth.signOut();
    _pendingMfaFactorId = null;
    document.getElementById('login-tabs').style.display = '';
    document.getElementById('login-card-footer').style.display = '';
    switchTab('signin');
  });

  // ── Email sign up ─────────────────────────────────────────────
  // Neutral age screen (16 CFR 312.5(a)): no "must be 13+" copy above the
  // fields and no default value — month/day/year selects (rather than a
  // native date picker, which renders inconsistently across browsers and
  // is awkward on mobile) each start on a blank placeholder, and the day/
  // year options are built here rather than hardcoded so the year list
  // never goes stale and Feb 30-style combinations still get caught by
  // buildDob()'s round-trip check below.
  const dobMonthEl = document.getElementById('signup-dob-month');
  const dobDayEl   = document.getElementById('signup-dob-day');
  const dobYearEl  = document.getElementById('signup-dob-year');
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

  // Combines the three selects into "YYYY-MM-DD", or returns '' if any is
  // blank or the combination isn't a real calendar date (e.g. Feb 30) —
  // Date normalizes overflow instead of erroring, so round-tripping through
  // it and comparing the parts back is what actually catches that.
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

  document.getElementById('btn-email-signup').addEventListener('click', async () => {
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const dob      = buildDob();
    const errEl    = document.getElementById('signup-error');
    errEl.style.display = 'none';
    if (!requireSignupConsent()) return;
    // The message promised a *valid* address but only emptiness was checked,
    // so a typo like "me@" reached the Edge Function and failed there instead.
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
      errEl.textContent   = 'Please enter a valid email address.';
      errEl.style.display = 'block'; return;
    }
    if (!dob) {
      errEl.textContent   = 'Please enter your date of birth.';
      errEl.style.display = 'block'; return;
    }
    if (dob > todayIso) {
      errEl.textContent   = 'Please enter a valid date of birth.';
      errEl.style.display = 'block'; return;
    }
    if (password.length < 8) {
      errEl.textContent   = 'Password must be at least 8 characters.';
      errEl.style.display = 'block'; return;
    }
    if (!/[A-Z]/.test(password)) {
      errEl.textContent   = 'Password must contain at least one uppercase letter.';
      errEl.style.display = 'block'; return;
    }
    if (!/[a-z]/.test(password)) {
      errEl.textContent   = 'Password must contain at least one lowercase letter.';
      errEl.style.display = 'block'; return;
    }
    // Cloudflare Turnstile. Blocking an empty token here is only a UX
    // safeguard (it catches someone who skipped or closed the widget) — a
    // scripted request can still POST to the Edge Function directly with a
    // fake or empty token. signup-with-email must verify this token against
    // https://challenges.cloudflare.com/turnstile/v0/siteverify before
    // creating an account. Its source/configuration is not included here;
    // the client check does not establish server-side enforcement.
    const turnstileToken = (window.turnstile && document.querySelector('.cf-turnstile'))
      ? window.turnstile.getResponse()
      : '';
    if (!turnstileToken) {
      errEl.textContent   = 'Please complete the verification challenge.';
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
      // Without this the button stayed on "Sending…" and disabled forever.
      btn.textContent = 'Create Account'; btn.disabled = false;
      // Reset the widget so a retry doesn't resend an already-spent token.
      if (window.turnstile) window.turnstile.reset();
      errEl.textContent   = 'Could not reach the server. Please try again.';
      errEl.style.display = 'block'; return;
    }
    btn.textContent = 'Create Account'; btn.disabled = false;
    if (!res.ok || json.error) {
      if (window.turnstile) window.turnstile.reset();
      errEl.textContent   = json.error || 'Sign up failed.';
      errEl.style.display = 'block'; return;
    }
    // Show code-entry confirmation panel
    _pendingSignupEmail = email;
    _pendingSignupUserId = json.userId;
    document.getElementById('signup-code').value = '';
    document.getElementById('confirm-error').style.display = 'none';
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    document.getElementById('panel-confirm').classList.add('active');
    document.getElementById('login-tabs').style.display = 'none';
    document.getElementById('login-card-footer').style.display = 'none';
    cardTitle.textContent = 'Almost there';
  });

  // ── Verify signup code ──────────────────────────────────────────
  document.getElementById('btn-verify-signup').addEventListener('click', async () => {
    const code  = document.getElementById('signup-code').value.trim();
    const errEl = document.getElementById('confirm-error');
    const btn   = document.getElementById('btn-verify-signup');
    errEl.style.display = 'none';
    if (!code) {
      errEl.textContent = 'Enter the code from your email.';
      errEl.style.display = 'block'; return;
    }
    btn.textContent = 'Verifying…'; btn.disabled = true;
    const SUPABASE_URL = supabase.supabaseUrl;
    const ANON_KEY = supabase.supabaseKey;
    // Every step below was previously unguarded: a network blip, a non-JSON
    // response, or a payload missing tokens threw past the error handling and
    // left the button disabled on "Verifying…" with no way back but a reload.
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
      // Set the session manually from the tokens returned
      await supabase.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token });
      // Backfill a username if signup didn't set one: derive from the email
      // prefix so the account page shows a name instead of an email fragment.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
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
        }
      } catch (e) { /* non-fatal: account page falls back to email prefix */ }
      window.location.replace(returnTo);
    } catch (e) {
      errEl.textContent = 'Could not reach the server. Please try again.';
      errEl.style.display = 'block';
      btn.textContent = 'Verify & Continue'; btn.disabled = false;
    }
  });

  // Enter key on signup code field
  document.getElementById('signup-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-verify-signup').click();
  });

  // Resend the signup code (covers the code expiring, or the original email
  // landing in spam / never arriving) without forcing the user to wait out
  // the 15-minute expiry and go through "Create Account" again.
  document.getElementById('confirm-resend').addEventListener('click', async e => {
    e.preventDefault();
    const link = document.getElementById('confirm-resend');
    const errEl = document.getElementById('confirm-error');
    errEl.style.display = 'none';
    if (!_pendingSignupUserId) return;
    const originalText = link.textContent;
    link.textContent = 'Sending…';
    try {
      // SUPABASE_URL/ANON_KEY are const-scoped inside the other handlers, so
      // referencing them here threw a ReferenceError that the catch below
      // swallowed — resend always reported a connection failure. The apikey
      // header was missing too, which would have 401'd even once in scope.
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

  // Back to sign in from confirmation
  document.getElementById('confirm-back').addEventListener('click', e => {
    e.preventDefault();
    _pendingSignupEmail  = null;
    _pendingSignupUserId = null;
    document.getElementById('login-tabs').style.display = '';
    document.getElementById('login-card-footer').style.display = '';
    switchTab('signin');
  });
