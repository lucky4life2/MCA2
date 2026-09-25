// Member-only page guard (economy, stocks; congress and court in data-gate="view" mode).
//
// Loaded as a classic blocking <script src> in <head>, right after
// early-hide.js, so the page body is marked hidden before first paint and
// member content never flashes. Page scripts wait on window._mcaMemberGate
// (true = render, false = stop) before loading any data.
//
// This is UX. Real enforcement is server-side: the members_only RLS policies
// and require_active_membership() / user_meets_membership_gate(), which use
// the same state rules as get_my_membership_state() below.
(function () {
  const root = document.documentElement;
  root.dataset.memberGate = 'pending';

  // data-gate="view" (congress, court): non-members may read public records, so
  // a missing/expired membership shows a banner instead of blocking the page.
  const viewOnly = document.currentScript?.dataset.gate === 'view';
  const page = location.pathname.split('/').pop() || 'index.html';
  const fmt = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  function place(el) {
    const nav = document.querySelector('body > nav');
    if (nav) nav.after(el); else document.body.prepend(el);
  }

  function panel(title, text, actions) {
    const el = document.createElement('div');
    el.className = 'member-gate-panel';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', title);
    const h = document.createElement('h1'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'member-gate-actions';
    for (const [label, href, primary] of actions) {
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
      a.className = primary ? 'btn btn-primary' : 'btn btn-outline';
      row.append(a);
    }
    el.append(h, p, row);
    return el;
  }

  function banner(text, label, href) {
    const el = document.createElement('div');
    el.className = 'member-gate-banner';
    el.setAttribute('role', 'status');
    el.append(text + ' ');
    const a = document.createElement('a'); a.href = href; a.textContent = label;
    el.append(a);
    return el;
  }

  function block(el) {
    root.dataset.memberGate = 'blocked';
    const show = () => place(el);
    document.body ? show() : document.addEventListener('DOMContentLoaded', show, { once: true });
    return false;
  }

  function allow(extra) {
    const show = () => { if (extra) place(extra); delete root.dataset.memberGate; };
    document.body ? show() : document.addEventListener('DOMContentLoaded', show, { once: true });
    return true;
  }

  const ACCOUNT_MESSAGES = {
    frozen: ['Your account is frozen', 'Member features are unavailable while your account is frozen. Visit your account page for details or to appeal.'],
    terminated: ['Your account has been terminated', 'This account can no longer use member features. Visit your account page for details.'],
    deactivated: ['Your account is deactivated', 'Reactivate your account from your account page to use member features.'],
    age_unverified: ['Finish setting up your account', 'Please complete the age check on your account page before using member features.'],
    coppa_restricted: ['Waiting for parent or guardian approval', 'Member features unlock once a parent or guardian approves your account.'],
  };

  window._mcaMemberGate = (async () => {
    try {
      const { supabase } = await import('./supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return block(panel('Sign in to continue',
          'This page is for MCA members. Sign in to your account to continue.',
          [['Sign in', 'login.html?return=' + encodeURIComponent(page), true]]));
      }

      const { data, error } = await supabase.rpc('get_my_membership_state');
      const s = Array.isArray(data) ? data[0] : data;
      if (error || !s) return allow(); // lookup failed: RLS still protects the data

      if (s.bypass) return allow();

      if (!['active', 'pending_deletion'].includes(s.account_status)) {
        const [title, text] = ACCOUNT_MESSAGES[s.account_status]
          || ['Account unavailable', 'Your account cannot use member features right now. Visit your account page for details.'];
        return block(panel(title, text, [['Go to my account', 'account.html', true]]));
      }

      switch (s.state) {
        case 'active':
          return allow();
        case 'grace':
          return allow(banner(`Your last membership payment didn't go through. You keep access until ${fmt(s.expires_at)}.`,
            'Update payment', 'account.html'));
        case 'cancelled':
          return allow(banner(`Your membership is cancelled and ends on ${fmt(s.expires_at)}.`,
            'Renew membership', 'shop.html'));
        case 'expired':
          if (viewOnly) return allow(banner('Your membership has expired. You can view public records; renew to take part.',
            'Renew membership', 'shop.html'));
          return block(panel('Membership expired',
            s.expires_at ? `Your membership expired on ${fmt(s.expires_at)}.` : 'Your membership has expired.',
            [['Renew membership', 'shop.html', true], ['My account', 'account.html', false]]));
        default:
          if (viewOnly) return allow(banner('You are viewing public records. Membership ($12/year) is required to take part.',
            'Join MCA', 'shop.html'));
          return block(panel('Membership required',
            'This page is for MCA members. Membership is $12/year and also unlocks the Minecraft server.',
            [['Join MCA', 'shop.html', true], ['Learn more', 'help.html', false]]));
      }
    } catch (e) {
      return allow(); // never strand a member on a script error; RLS enforces access
    }
  })();
})();
