import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE_URL = 'https://minecraftclubofamerica.me';
const FUNCTIONS_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1';

// CAN-SPAM (15 U.S.C. 7704(a)(5)) requires a valid physical postal address
// in every commercial email. A P.O. Box is fine -- it just has to be a real
// one. Fill this in, then this placeholder can be removed.
const MAILING_ADDRESS = '[MAILING ADDRESS NEEDED — add a real postal address or P.O. Box here before sending further news emails; required by CAN-SPAM, 15 U.S.C. 7704(a)(5)]';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email delivery not configured.' }), { status: 500, headers: CORS });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

    // Caller must be authenticated and hold can_manage_news
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

    const { data: canManage, error: permErr } = await userClient.rpc('user_has_permission', { perm: 'can_manage_news' });
    if (permErr || !canManage) {
      return new Response(JSON.stringify({ error: 'You do not have permission to send news notifications.' }), { status: 403, headers: CORS });
    }

    const { articleId } = await req.json();
    if (!articleId) return new Response(JSON.stringify({ error: 'Missing articleId' }), { status: 400, headers: CORS });

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: article, error: articleErr } = await adminClient
      .from('news_articles')
      .select('id,title,slug,summary,body,category,author_name,status')
      .eq('id', articleId)
      .single();
    if (articleErr || !article) {
      return new Response(JSON.stringify({ error: 'Article not found.' }), { status: 404, headers: CORS });
    }
    if (article.status !== 'published') {
      return new Response(JSON.stringify({ error: 'Article is not published.' }), { status: 400, headers: CORS });
    }

    // Recipients: opted in, have a usable email, account not frozen/terminated/revoked
    const { data: subscribers, error: subErr } = await adminClient
      .from('profiles')
      .select('id,email,display_name,username,email_unsub_token')
      .eq('news_email_opt_in', true)
      .not('email', 'is', null)
      .neq('email_access_revoked', true)
      .or('account_status.is.null,account_status.eq.active');

    if (subErr) {
      return new Response(JSON.stringify({ error: subErr.message }), { status: 500, headers: CORS });
    }

    const recipients = (subscribers || []).filter(s => !!s.email);
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No opted-in subscribers.' }), { status: 200, headers: CORS });
    }

    const articleUrl = `${SITE_URL}/article.html?slug=${encodeURIComponent(article.slug)}`;
    const rawExcerpt = article.summary || (article.body || '').replace(/[*_`#>\[\]]/g, '').replace(/\s+/g, ' ').trim();
    const excerpt = rawExcerpt.length > 220 ? rawExcerpt.slice(0, 220).replace(/\s\S*$/, '') + '…' : rawExcerpt;

    const subject = `New on MCA: ${article.title}`;

    function buildEmail(recipient) {
      const unsubUrl = `${SITE_URL}/unsubscribe.html?uid=${encodeURIComponent(recipient.id)}&token=${encodeURIComponent(recipient.email_unsub_token)}&scope=news`;
      const unsubApiUrl = `${FUNCTIONS_URL}/unsubscribe?uid=${encodeURIComponent(recipient.id)}&token=${encodeURIComponent(recipient.email_unsub_token)}&scope=news`;
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
          <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 6px;">${escapeHtml(article.category || 'News')}</p>
          <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;">${escapeHtml(article.title)}</h1>
          ${article.author_name ? `<p style="font-size:13px;color:#666;margin:0 0 16px;">By ${escapeHtml(article.author_name)}</p>` : ''}
          ${excerpt ? `<p style="font-size:15px;line-height:1.6;margin:0 0 20px;">${escapeHtml(excerpt)}</p>` : ''}
          <a href="${articleUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">Read the full article</a>
          <p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
            You're receiving this because you opted in to news emails from Minecraft Club of America.
            <a href="${unsubUrl}" style="color:#999;">Unsubscribe</a> or
            <a href="${SITE_URL}/account.html" style="color:#999;">manage your notification preferences</a>.
          </p>
          <p style="font-size:11px;color:#bbb;margin-top:8px;">${escapeHtml(MAILING_ADDRESS)}</p>
        </div>`;
      return {
        from: 'MCA <noreply@minecraftclubofamerica.me>',
        to: [recipient.email],
        subject,
        html,
        headers: {
          // RFC 8058 one-click unsubscribe: lets Gmail/Outlook/Yahoo show a
          // built-in "Unsubscribe" button that POSTs here directly, no page
          // visit required. Required by Google/Yahoo's 2024 bulk-sender rules.
          'List-Unsubscribe': `<${unsubApiUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    }

    // Resend batch endpoint accepts up to 100 emails per request
    const CHUNK = 100;
    let sent = 0;
    const failures = [];

    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      const batchBody = chunk.map(buildEmail);

      const resendRes = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batchBody),
      });

      if (resendRes.ok) {
        sent += chunk.length;
      } else {
        const errText = await resendRes.text();
        failures.push(errText);
      }
    }

    return new Response(JSON.stringify({
      success: failures.length === 0,
      sent,
      total: recipients.length,
      errors: failures.length ? failures : undefined,
    }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
