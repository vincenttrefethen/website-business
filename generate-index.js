/**
 * generate-index.js
 *
 * TWO jobs:
 *   1. generateIndex()      → writes an internal dashboard to dashboard.html
 *   2. updatePublicIndex()  → surgically patches the marketing index.html:
 *        • updates the "Live demos built" stat count
 *        • replaces the SITES JS array so demo cards + marquee auto-rebuild
 *
 * Run manually:  node generate-index.js
 * Auto-run:      called by build-sites.js after every build
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');

const SITES_DIR      = path.join(__dirname, 'sites');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');
const PUBLIC_INDEX   = path.join(__dirname, 'index.html');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'
  );
  const m = html.match(re) ||
    html.match(new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'
    ));
  return m ? m[1].trim() : '';
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

function slugToLabel(slug) {
  return slug.split('--').pop().replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function categoryIcon(cat) {
  const map = {
    plumber: '🔧', electrician: '⚡', 'cleaning service': '🧹',
    landscaping: '🌿', painter: '🎨', 'house painter': '🖌️',
    'auto repair': '🚗', 'mobile detailing': '✨',
    'pest control': '🐛', locksmith: '🔑', hvac: '❄️', roofer: '🏠',
    handyman: '🔨', 'pressure washing': '💦', 'mobile notary': '📝',
    'personal trainer': '💪', 'dog groomer': '🐶',
    photography: '📸', 'food truck': '🍽️',
  };
  if (!cat) return '🏪';
  const lower = cat.toLowerCase();
  for (const [key, icon] of Object.entries(map)) {
    if (lower.includes(key)) return icon;
  }
  return '🏪';
}

// ─── Scan /sites ──────────────────────────────────────────────────────────────

function scanSites() {
  if (!fs.existsSync(SITES_DIR)) return [];

  return fs.readdirSync(SITES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reduce((acc, slug) => {
      const indexPath = path.join(SITES_DIR, slug, 'index.html');
      if (!fs.existsSync(indexPath)) return acc;

      const html     = fs.readFileSync(indexPath, 'utf8');
      const rawTitle = extractTitle(html) || slugToLabel(slug);
      const title    = rawTitle.split(' — ')[0].trim() || slugToLabel(slug);
      const category = extractMeta(html, 'category');
      const city     = extractMeta(html, 'city');
      const phone    = extractMeta(html, 'phone');
      const built    = fs.statSync(indexPath).mtime
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const url      = `${config.VERCEL_BASE_URL}/sites/${slug}/index.html`;

      acc.push({ slug, title, category, city, phone, built, url, icon: categoryIcon(category) });
      return acc;
    }, []);
}

// ─── 1. INTERNAL DASHBOARD → dashboard.html ───────────────────────────────────

function renderDashboardCards(cards) {
  if (cards.length === 0) {
    return `
    <div class="empty">
      <div class="empty-icon">📁</div>
      <h2>No demos built yet</h2>
      <p>Run <code>node run-morning.js</code> or <code>node build-sites.js</code> to generate your first demo sites.</p>
    </div>`;
  }
  const rows = cards.map(c => {
    const href  = `sites/${c.slug}/index.html`;
    const city  = c.city     ? `<span class="tag">${c.city}</span>`     : '';
    const cat   = c.category ? `<span class="tag tag-cat">${c.category}</span>` : '';
    const phone = c.phone    ? `<div class="phone">${c.phone}</div>` : '';
    return `
      <a class="card" href="${href}" target="_blank" rel="noopener">
        <div class="card-icon">${c.icon}</div>
        <div class="card-body">
          <div class="card-title">${c.title}</div>
          <div class="card-meta">${city}${cat}</div>
          ${phone}
          <div class="card-built">Built ${c.built}</div>
        </div>
        <div class="card-arrow">→</div>
      </a>`;
  }).join('\n');

  return `<div class="grid">${rows}</div>`;
}

function buildDashboardHTML(cards) {
  const count   = cards.length;
  const updated = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DemoReady — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:#0f1117; --surface:#1a1d27; --surface2:#22263a; --border:#2e3347;
      --accent:#6c8eff; --accent2:#a78bfa; --text:#e8eaf0; --muted:#7a80a0;
      --success:#4ade80; --gold:#D4AF37; --radius:14px;
    }
    body { background:var(--bg); color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      min-height:100vh; padding:0 0 64px; }
    .header { background:linear-gradient(135deg,#161929 0%,#1e2240 100%);
      border-bottom:1px solid var(--border); padding:40px 24px 32px; text-align:center; }
    .header h1 { font-size:clamp(1.4rem,4vw,2rem); font-weight:700; letter-spacing:-.02em;
      background:linear-gradient(135deg,var(--accent),var(--accent2));
      -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .header-sub { color:var(--muted); font-size:.9rem; margin-top:6px; }
    .badge { display:inline-block; margin-top:16px; padding:4px 14px; border-radius:99px;
      background:var(--surface2); border:1px solid var(--border); font-size:.78rem; color:var(--muted); }
    .badge strong { color:var(--success); }
    .links { display:flex; gap:1rem; justify-content:center; margin-top:14px; }
    .links a { font-size:.8rem; color:var(--accent); text-decoration:none;
      padding:4px 12px; border-radius:99px; border:1px solid rgba(108,142,255,.3);
      transition:background .15s; }
    .links a:hover { background:rgba(108,142,255,.1); }
    .container { max-width:960px; margin:40px auto 0; padding:0 20px; }
    .section-label { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase;
      color:var(--muted); margin-bottom:18px; padding-bottom:10px;
      border-bottom:1px solid var(--border); }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
    .card { display:flex; align-items:center; gap:16px; background:var(--surface);
      border:1px solid var(--border); border-radius:var(--radius); padding:18px 16px;
      text-decoration:none; color:var(--text);
      transition:transform .15s,border-color .15s,box-shadow .15s; }
    .card:hover { transform:translateY(-2px); border-color:var(--accent);
      box-shadow:0 8px 32px rgba(108,142,255,.12); }
    .card-icon { font-size:2rem; flex-shrink:0; width:48px; height:48px;
      display:flex; align-items:center; justify-content:center;
      background:var(--surface2); border-radius:10px; }
    .card-body { flex:1; min-width:0; }
    .card-title { font-size:.95rem; font-weight:600; white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis; }
    .card-meta { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .tag { font-size:.68rem; padding:2px 8px; border-radius:99px;
      background:var(--surface2); border:1px solid var(--border);
      color:var(--muted); text-transform:capitalize; }
    .tag-cat { border-color:rgba(108,142,255,.3); color:var(--accent); }
    .phone { font-size:.78rem; color:var(--muted); margin-top:5px; }
    .card-built { font-size:.68rem; color:var(--muted); margin-top:5px; }
    .card-arrow { color:var(--muted); font-size:1.1rem; flex-shrink:0;
      transition:color .15s,transform .15s; }
    .card:hover .card-arrow { color:var(--accent); transform:translateX(3px); }
    .empty { text-align:center; padding:72px 24px; background:var(--surface);
      border:1px dashed var(--border); border-radius:var(--radius); }
    .empty-icon { font-size:3rem; margin-bottom:16px; }
    .empty h2 { font-size:1.2rem; font-weight:600; margin-bottom:10px; }
    .empty p { color:var(--muted); font-size:.88rem; line-height:1.6; }
    .empty code { background:var(--surface2); padding:1px 6px; border-radius:4px;
      font-family:'Courier New',monospace; font-size:.85em; }
    .footer { text-align:center; margin-top:56px; color:var(--muted); font-size:.75rem; }
    .footer a { color:var(--accent); text-decoration:none; }
    @media(max-width:500px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header class="header">
    <h1>🏗️ DemoReady — Dashboard</h1>
    <p class="header-sub">Auto-generated demo pages for Miami-area businesses</p>
    <div class="badge"><strong>${count}</strong> demo${count === 1 ? '' : 's'} built &nbsp;·&nbsp; Updated ${updated}</div>
    <div class="links">
      <a href="index.html">← Public Site</a>
      <a href="whatsapp-queue.txt">WhatsApp Queue</a>
      <a href="morning-report.txt">Morning Report</a>
    </div>
  </header>
  <div class="container">
    ${count > 0 ? `<div class="section-label">${count} site${count === 1 ? '' : 's'} ready to send</div>` : ''}
    ${renderDashboardCards(cards)}
  </div>
  <div class="footer">
    <p>Generated by <a href="run-morning.js">run-morning.js</a> &nbsp;·&nbsp; Open a card to preview the demo</p>
  </div>
</body>
</html>`;
}

function generateIndex() {
  const cards = scanSites();
  const html  = buildDashboardHTML(cards);
  fs.writeFileSync(DASHBOARD_FILE, html, 'utf8');
  console.log(`[generate-index] dashboard.html written — ${cards.length} site(s) listed.`);
  return cards.length;
}

// ─── 2. PUBLIC INDEX PATCHER → index.html ────────────────────────────────────
//
// Surgically updates two regions of the marketing index.html without
// touching anything else:
//   • <div class="stat-number">N+</div> for "Live demos built"
//   • const SITES = [...] in the inline <script>
//
// The SITES array drives both the marquee thumbnails and the demo cards
// grid — updating it is all that's needed for the page to reflect new sites.

function buildSitesArray(cards) {
  if (cards.length === 0) return '[]';
  const rows = cards.map(c => {
    const name = c.title.replace(/'/g, "\\'");
    return `  { slug:'${c.slug}', name:'${name}', cat:'${c.category}', city:'${c.city}', url:'${c.url}' }`;
  });
  return `[\n${rows.join(',\n')}\n]`;
}

function updatePublicIndex() {
  if (!fs.existsSync(PUBLIC_INDEX)) {
    console.warn('[generate-index] index.html not found — skipping public update.');
    return 0;
  }

  const cards = scanSites();
  let html = fs.readFileSync(PUBLIC_INDEX, 'utf8');

  // ── 1. Update "Live demos built" stat ──────────────────────────────────────
  // Matches: <div class="stat-number">5+</div> followed by the "Live demos built" label
  html = html.replace(
    /(<div class="stat-number">)[\d]+\+?(<\/div>\s*<div class="stat-label">Live demos built<\/div>)/,
    `$1${cards.length}+$2`
  );

  // ── 2. Replace SITES array in the inline script ───────────────────────────
  // Matches: const SITES = [ ... ]; (multiline)
  html = html.replace(
    /const SITES = \[[\s\S]*?\];/,
    `const SITES = ${buildSitesArray(cards)};`
  );

  fs.writeFileSync(PUBLIC_INDEX, html, 'utf8');
  console.log(`[generate-index] index.html patched — ${cards.length} sites, stat updated.`);
  return cards.length;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateIndex, updatePublicIndex, scanSites };

if (require.main === module) {
  generateIndex();
  updatePublicIndex();
}
