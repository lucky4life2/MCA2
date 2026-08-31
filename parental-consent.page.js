const SUPABASE_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co';

  const params = new URLSearchParams(window.location.search);
  const userId = params.get('uid');
  const token  = params.get('token');

  const show = (id) => {
    ['pc-loading','pc-invalid','pc-ask','pc-approved','pc-declined'].forEach(x => {
      document.getElementById(x).style.display = x === id ? 'block' : 'none';
    });
  };

  if (!userId || !token) {
    show('pc-invalid');
  } else {
    show('pc-ask');
  }

  async function respond(decision) {
    const errEl = document.getElementById('pc-error');
    errEl.style.display = 'none';
    document.getElementById('pc-approve').disabled = true;
    document.getElementById('pc-decline').disabled = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/confirm-parental-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        errEl.textContent = json.error || 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
        document.getElementById('pc-approve').disabled = false;
        document.getElementById('pc-decline').disabled = false;
        return;
      }
      show(decision === 'approve' ? 'pc-approved' : 'pc-declined');
    } catch (e) {
      errEl.textContent = 'Network error. Please try again.';
      errEl.style.display = 'block';
      document.getElementById('pc-approve').disabled = false;
      document.getElementById('pc-decline').disabled = false;
    }
  }

  document.getElementById('pc-approve').addEventListener('click', () => respond('approve'));
  document.getElementById('pc-decline').addEventListener('click', () => {
    if (confirm('Are you sure you want to decline? The account will remain inactive.')) respond('decline');
  });
