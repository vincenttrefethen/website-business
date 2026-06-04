/**
 * SKILL 6 — follow-up.js
 *
 * Reads leads.csv for entries where:
 *   - status = "contacted"  (WhatsApp was sent by draft-outreach)
 *   - outreach_date is at least FOLLOWUP_DAYS ago
 *   - status != "followedup" (haven't already followed up)
 *
 * Builds a short follow-up WhatsApp message, writes followup-queue.html,
 * and marks status = "followedup" in leads.csv.
 *
 * Run standalone:  node follow-up.js
 * Auto-run:        last step in run-morning.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');
const { getFuTemplate }    = require('./message-templates');

const FOLLOWUP_HTML = path.join(__dirname, 'followup-queue.html');

const FOLLOWUP_MESSAGE =
  "Hey, just wanted to make sure you saw this — " +
  "I built {name} a free website last week: {url} " +
  "Still free to look at, just reply if you want to keep it. " +
  "— Vincent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr);
  if (isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function normalisePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '1' + digits;
  if (digits.length === 11 && digits[0] === '1') return digits;
  if (digits.length > 11) return digits;
  if (digits.length < 7) return null;
  return digits;
}

function buildFollowUpUrl(phone, lead) {
  const { text, version } = getFuTemplate(lead);
  lead._fuVersion = version;
  return { url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, version };
}

// ─── HTML dashboard ───────────────────────────────────────────────────────────

function buildFollowUpHtml(entries, generatedAt) {
  const count = entries.length;

  const rows = entries.map((e, i) => `
    <div class="card" id="card-${i}">
      <div class="card-left">
        <div class="biz-name">${e.name}</div>
        <div class="biz-meta">
          <span class="tag">${e.city || '—'}</span>
          <span class="tag tag-cat">${e.category || '—'}</span>
          ${e.rating  ? `<span class="tag tag-gold">⭐ ${e.rating}</span>` : ''}
          <span class="tag tag-age">First contact: ${e.outreach_date} (${daysAgo(e.outreach_date)}d ago)</span>
        </div>
        <div class="biz-phone">${e.phone}</div>
      </div>
      <a class="btn-wa" href="${e.waUrl}" target="_blank" rel="noopener"
         onclick="markSent(${i})">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.857L0 24l6.335-1.509A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.368l-.36-.214-3.732.889.917-3.636-.235-.374A9.818 9.818 0 1112 21.818z"/>
        </svg>
        Follow Up
      </a>
    </div>`).join('\n');

  const allUrls = JSON.stringify(entries.map(e => e.waUrl));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DemoReady — Follow-Up Queue (${count})</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#060C1A;color:#fff;min-height:100vh;padding:0 0 60px;
      -webkit-font-smoothing:antialiased}
    :root{--gold:#D4AF37;--gold2:#EDD060;--green:#25D366;--green2:#1da851;
      --amber:#F59E0B;--border:rgba(255,255,255,.08);--r:14px}
    .header{background:linear-gradient(to bottom,#0A0F1E,#060C1A);
      border-bottom:1px solid var(--border);padding:2.2rem 1.5rem 1.8rem}
    .header-inner{max-width:860px;margin:0 auto;
      display:flex;align-items:center;justify-content:space-between;
      flex-wrap:wrap;gap:1rem}
    .logo{font-size:1.2rem;font-weight:800;letter-spacing:-.03em}
    .logo span{color:var(--gold)}
    .header-right{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
    .count-badge{padding:.35rem 1rem;border-radius:99px;
      background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);
      font-size:.8rem;font-weight:600;color:var(--amber);white-space:nowrap}
    .btn-open-all{display:inline-flex;align-items:center;gap:.5rem;
      padding:.65rem 1.4rem;border-radius:99px;background:var(--amber);color:#000;
      font-size:.9rem;font-weight:700;border:none;cursor:pointer;
      transition:filter .2s,transform .15s;white-space:nowrap}
    .btn-open-all:hover{filter:brightness(1.1);transform:scale(1.04)}
    .btn-open-all:active{transform:scale(.97)}
    .generated{font-size:.72rem;color:rgba(255,255,255,.28);
      margin-top:.5rem;max-width:860px;margin-left:auto;
      margin-right:auto;padding:0 1.5rem}
    .list{max-width:860px;margin:2rem auto 0;padding:0 1.5rem;
      display:flex;flex-direction:column;gap:1rem}
    .card{display:flex;align-items:center;justify-content:space-between;
      gap:1.5rem;background:rgba(255,255,255,.04);
      border:1px solid var(--border);border-radius:var(--r);
      padding:1.25rem 1.5rem;flex-wrap:wrap;
      transition:border-color .2s}
    .card.sent{border-color:rgba(37,211,102,.35);
      background:rgba(37,211,102,.04)}
    .card-left{flex:1;min-width:0}
    .biz-name{font-size:1.05rem;font-weight:700;letter-spacing:-.02em;
      margin-bottom:.55rem}
    .biz-meta{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem}
    .tag{font-size:.68rem;padding:2px 9px;border-radius:99px;
      background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
      color:rgba(255,255,255,.5);text-transform:capitalize}
    .tag-cat{border-color:rgba(108,142,255,.3);color:#8aabff}
    .tag-gold{border-color:rgba(212,175,55,.35);color:var(--gold2)}
    .tag-age{border-color:rgba(245,158,11,.3);color:var(--amber)}
    .biz-phone{font-size:.88rem;color:rgba(255,255,255,.45)}
    .btn-wa{display:inline-flex;align-items:center;gap:.55rem;
      padding:.7rem 1.4rem;border-radius:99px;background:var(--amber);
      color:#000;font-size:.88rem;font-weight:700;
      text-decoration:none;white-space:nowrap;flex-shrink:0;
      transition:filter .2s,transform .15s,opacity .2s}
    .btn-wa:hover{filter:brightness(1.1);transform:scale(1.04)}
    .btn-wa:active{transform:scale(.97)}
    .btn-wa.done{background:rgba(37,211,102,.25);
      color:rgba(37,211,102,.8);pointer-events:none}
    .empty{text-align:center;padding:72px 24px;
      color:rgba(255,255,255,.3);font-size:1rem}
    @media(max-width:500px){
      .header-inner{flex-direction:column;align-items:flex-start}
      .card{flex-direction:column;align-items:flex-start}
      .btn-wa{width:100%;justify-content:center}}
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <div class="logo">Demo<span>Ready</span>.co — Follow-Ups</div>
      <div class="header-right">
        <div class="count-badge">🔁 ${count} follow-up${count === 1 ? '' : 's'} ready</div>
        ${count > 0 ? `<button class="btn-open-all" onclick="openAll()">
          Open All (${count})
        </button>` : ''}
      </div>
    </div>
    <div class="generated">Generated ${generatedAt} · leads not replied after ${config.FOLLOWUP_DAYS}+ days</div>
  </header>

  <div class="list">
    ${count === 0
      ? '<div class="empty">No follow-ups due yet — check back in a few days.</div>'
      : rows}
  </div>

  <script>
    const ALL_URLS = ${allUrls};
    function markSent(i) {
      const card = document.getElementById('card-' + i);
      if (!card) return;
      setTimeout(() => {
        card.classList.add('sent');
        const btn = card.querySelector('.btn-wa');
        if (btn) { btn.classList.add('done'); btn.textContent = '✓ Sent'; }
      }, 800);
    }
    function openAll() {
      ALL_URLS.forEach((url, i) =>
        setTimeout(() => window.open(url, '_blank'), i * 2000)
      );
      setTimeout(() => ALL_URLS.forEach((_, i) => markSent(i)),
        ALL_URLS.length * 2000 + 500);
    }
  </script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function followUp() {
  const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);

  const due = leads.filter(r =>
    r.status === 'contacted' &&
    r.demo_url &&
    r.phone &&
    daysAgo(r.outreach_date) >= config.FOLLOWUP_DAYS
  );

  if (due.length === 0) {
    console.log('[follow-up] No follow-ups due yet.');

    // Still write an empty dashboard so the file always exists
    const genAt = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    fs.writeFileSync(FOLLOWUP_HTML, buildFollowUpHtml([], genAt), 'utf8');
    return 0;
  }

  console.log(`[follow-up] ${due.length} lead(s) due for follow-up`);

  const entries = [];
  due.forEach(lead => {
    const phone = normalisePhone(lead.phone);
    if (!phone) {
      console.warn(`[follow-up] Skipping ${lead.name} — bad phone: "${lead.phone}"`);
      return;
    }
    const { url: waUrl, version: fuVer } = buildFollowUpUrl(phone, lead);
    lead.message_version = fuVer;
    entries.push({ ...lead, waUrl });

    // Mark as followed up so we don't send again tomorrow
    lead.status = 'followedup';
    console.log(`[follow-up] Queued: ${lead.name} (${daysAgo(lead.outreach_date)}d since contact)`);
  });

  // Write HTML dashboard
  const genAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  fs.writeFileSync(FOLLOWUP_HTML, buildFollowUpHtml(entries, genAt), 'utf8');
  console.log(`[follow-up] Wrote followup-queue.html`);

  console.log('[follow-up] No tabs auto-opened — use the dashboard to send follow-ups');

  // Persist status changes
  writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
  console.log(`[follow-up] Done. ${entries.length} follow-up(s) sent.`);
  return entries.length;
}

module.exports = { followUp };

if (require.main === module) {
  followUp()
    .then(n => console.log(`[follow-up] Done. ${n} sent.`))
    .catch(console.error);
}
