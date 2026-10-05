// Lead form handler. The forms post here and we forward the lead to the client's inbox using Resend.
//
// Needs these env vars in Vercel (Settings > Environment Variables), then redeploy:
//   RESEND_API_KEY   - the client's Resend key
//   LEAD_TO_EMAIL    - inbox that should get the leads (comma separated if more than one)
//   LEAD_FROM_EMAIL  - e.g. "Subtle Marketing <leads@theirdomain.com>". The domain has to be
//                      verified in Resend first. If it's missing we fall back to Resend's test
//                      sender, which only delivers to the account owner's own email.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// strip line breaks and cap length so nobody can stuff junk into the subject or email
const clean = (v, max = 300) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

// only the free audit form sends leads by email, anything else gets rejected below
const SOURCES = { 'free-audit': 'Free Growth Audit' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});

  // Hidden "website" field - real people never see it, bots fill it in. Just say ok and drop it.
  if (body.website) return res.status(200).json({ ok: true });

  const source = SOURCES[body.source] ? body.source : null;
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  const entries = Object.entries(fields).slice(0, 15).map(([k, v]) => [clean(k, 40), clean(v)]).filter(([k, v]) => k && v);
  if (!source || !entries.length) return res.status(400).json({ ok: false, error: 'Invalid request' });

  const { RESEND_API_KEY, LEAD_TO_EMAIL } = process.env;
  const from = process.env.LEAD_FROM_EMAIL || 'Subtle Marketing <onboarding@resend.dev>';
  if (!RESEND_API_KEY || !LEAD_TO_EMAIL) {
    console.error('Missing RESEND_API_KEY or LEAD_TO_EMAIL');
    return res.status(500).json({ ok: false, error: 'Email not configured' });
  }

  const label = SOURCES[source];
  // simple table so the email is easy to read on a phone
  const rows = entries.map(([k, v]) =>
    `<tr><td style="padding:6px 12px;font-weight:600;border-bottom:1px solid #eee">${esc(k)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif"><h2>New lead: ${esc(label)}</h2><table style="border-collapse:collapse">${rows}</table></div>`;
  const text = `New lead: ${label}\n\n` + entries.map(([k, v]) => `${k}: ${v}`).join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: LEAD_TO_EMAIL.split(',').map(s => s.trim()).filter(Boolean),
        subject: `New lead – ${label}: ${entries[0][1]}`.slice(0, 150),
        html, text,
      }),
    });
    if (!r.ok) { console.error('Resend error', r.status, await r.text()); return res.status(502).json({ ok: false }); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Resend request failed', e);
    return res.status(502).json({ ok: false });
  }
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
