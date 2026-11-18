const SUPABASE_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co';

const SCOPE_COPY = {
  news: 'Stop receiving news update emails from Minecraft Club of America?',
  tasks: 'Stop receiving task assignment emails from Minecraft Club of America?',
  all: 'Stop receiving all optional emails from Minecraft Club of America?',
};

const params = new URLSearchParams(window.location.search);
const uid = params.get('uid');
const token = params.get('token');
const scope = ['news', 'tasks', 'all'].includes(params.get('scope')) ? params.get('scope') : 'news';

const show = (id) => {
  ['un-invalid', 'un-ask', 'un-done'].forEach((x) => {
    document.getElementById(x).style.display = x === id ? 'block' : 'none';
  });
};

if (!uid || !token) {
  show('un-invalid');
} else {
  document.getElementById('un-ask-copy').textContent = SCOPE_COPY[scope];
  show('un-ask');
  document.getElementById('un-confirm').addEventListener('click', async () => {
    const errEl = document.getElementById('un-error');
    errEl.style.display = 'none';
    const btn = document.getElementById('un-confirm');
    btn.disabled = true;
    try {
      const url = `${SUPABASE_URL}/functions/v1/unsubscribe?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}&scope=${encodeURIComponent(scope)}`;
      const res = await fetch(url, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        errEl.textContent = json.error || 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
        btn.disabled = false;
        return;
      }
      show('un-done');
    } catch (e) {
      errEl.textContent = 'Network error. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false;
    }
  });
}
