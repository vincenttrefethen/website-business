/**
 * generate-index.js
 * Scans /sites for HTML files, reads their <title> tag, and writes a
 * styled index.html in the project root.
 *
 * Run manually:  node generate-index.js
 * Auto-run:      called by build-sites.js after every build
 */

const fs   = require('fs');
const path = require('path');

const SITES_DIR  = path.join(__dirname, 'sites');
const INDEX_FILE = path.join(__dirname, 'index.html');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
  return m ? m[1].trim() : null;
}

function slugToLabel(slug) {
  // "miami-beach--joes-plumbing" → "Joe's Plumbing"
  return slug
    .split('--').pop()          // drop city prefix
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function categoryIcon(category) {
  const map = {
    plumber: '🔧', electrician: '⚡', 'cleaning service': '🧹',
    landscaping: '🌿', painter: '🎨', 'auto repair': '🚗',
    'pest control': '🐛', locksmith: '🔑', 'hvac': '❄️', roofer: '🏠',
  };
  if (!category) return '🏪';
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(map)) {
    if (lower.includes(key)) return icon;
  }
  return '🏪';
}

// ─── Scan /sites ─────────────────────────────────────────────────────────────

function scanSites() {
  if (!fs.existsSync(SITES_DIR)) return [];

  const slugDirs = fs.readdirSync(SITES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const cards = [];
  for (const slug of slugDirs) {
    const indexPath = path.join(SITES_DIR, slug, 'index.html');
    if (!fs.existsSync(indexPath)) continue;

    const html     = fs.readFileSync(indexPath, 'utf8');
    const title    = extractTitle(html) || slugToLabel(slug);
    const category = extractMeta(html, 'category') || '';
    const city     = extractMeta(html, 'city') || '';
    const phone    = extractMeta(html, 'phone') || '';
    const stat     = fs.statSync(indexPath);
    const built    = stat.mtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    cards.push({ slug, title, category, city, phone, built, icon: categoryIcon(category) });
  }
  return cards;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderEmpty() {
  return `
    <div class="empty">
      <div class="empty-icon">📁</div>
      <h2>No demos built yet</h2>
      <p>Run <code>node run-morning.js</code> or <code>node build-sites.js</code> to generate your first demo sites.</p>
    </div>`;
}

function renderCards(cards) {
  return cards.map(c => {
    const href  = `sites/${c.slug}/index.html`;
    const city  = c.city  ? `<span class="tag">${c.city}</span>`  : '';
    const cat   = c.category ? `<span class="tag tag-cat">${c.category}</span>` : '';
    const phone = c.phone ? `<div class="phone">${c.phone}</div>` : '';
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
}

function buildHTML(cards) {
  const count   = cards.length;
  const updated = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const body = count === 0 ? renderEmpty() : `
    <div class="grid">${renderCards(cards)}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Website Business — Demo Sites</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0f1117;
      --surface:   #1a1d27;
      --surface2:  #22263a;
      --border:    #2e3347;
      --accent:    #6c8eff;
      --accent2:   #a78bfa;
      --text:      #e8eaf0;
      --muted:     #7a80a0;
      --success:   #4ade80;
      --radius:    14px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      padding: 0 0 64px;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #161929 0%, #1e2240 100%);
      border-bottom: 1px solid var(--border);
      padding: 40px 24px 32px;
      text-align: center;
    }
    .header-logo { font-size: 2rem; margin-bottom: 8px; }
    .header h1 {
      font-size: clamp(1.4rem, 4vw, 2rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header-sub {
      color: var(--muted);
      font-size: 0.9rem;
      margin-top: 6px;
    }
    .badge {
      display: inline-block;
      margin-top: 16px;
      padding: 4px 14px;
      border-radius: 99px;
      background: var(--surface2);
      border: 1px solid var(--border);
      font-size: 0.78rem;
      color: var(--muted);
    }
    .badge strong { color: var(--success); }

    /* ── Layout ── */
    .container {
      max-width: 960px;
      margin: 40px auto 0;
      padding: 0 20px;
    }
    .section-label {
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 18px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Cards ── */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 16px;
      text-decoration: none;
      color: var(--text);
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      box-shadow: 0 8px 32px rgba(108, 142, 255, 0.12);
    }
    .card-icon {
      font-size: 2rem;
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface2);
      border-radius: 10px;
    }
    .card-body { flex: 1; min-width: 0; }
    .card-title {
      font-size: 0.95rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
    .tag {
      font-size: 0.68rem;
      padding: 2px 8px;
      border-radius: 99px;
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--muted);
      text-transform: capitalize;
    }
    .tag-cat {
      border-color: rgba(108,142,255,0.3);
      color: var(--accent);
    }
    .phone {
      font-size: 0.78rem;
      color: var(--muted);
      margin-top: 5px;
    }
    .card-built {
      font-size: 0.68rem;
      color: var(--muted);
      margin-top: 5px;
    }
    .card-arrow {
      color: var(--muted);
      font-size: 1.1rem;
      flex-shrink: 0;
      transition: color 0.15s, transform 0.15s;
    }
    .card:hover .card-arrow { color: var(--accent); transform: translateX(3px); }

    /* ── Empty state ── */
    .empty {
      text-align: center;
      padding: 72px 24px;
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }
    .empty-icon { font-size: 3rem; margin-bottom: 16px; }
    .empty h2 { font-size: 1.2rem; font-weight: 600; margin-bottom: 10px; }
    .empty p { color: var(--muted); font-size: 0.88rem; line-height: 1.6; }
    .empty code {
      background: var(--surface2);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
    }

    /* ── Footer ── */
    .footer {
      text-align: center;
      margin-top: 56px;
      color: var(--muted);
      font-size: 0.75rem;
    }
    .footer a { color: var(--accent); text-decoration: none; }

    @media (max-width: 500px) {
      .grid { grid-template-columns: 1fr; }
      .card-icon { width: 40px; height: 40px; font-size: 1.5rem; }
    }
  </style>
</head>
<body>

  <header class="header">
    <div class="header-logo">🏗️</div>
    <h1>Website Business — Demo Sites</h1>
    <p class="header-sub">Auto-generated demo pages for local Miami-area businesses</p>
    <div class="badge">
      <strong>${count}</strong> demo${count === 1 ? '' : 's'} built &nbsp;·&nbsp; Updated ${updated}
    </div>
  </header>

  <div class="container">
    ${count > 0 ? `<div class="section-label">${count} site${count === 1 ? '' : 's'} ready to send</div>` : ''}
    ${body}
  </div>

  <div class="footer">
    <p>Generated by <a href="run-morning.js">run-morning.js</a> &nbsp;·&nbsp; Open a card to preview the live demo</p>
  </div>

</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function generateIndex() {
  const cards = scanSites();
  const html  = buildHTML(cards);
  fs.writeFileSync(INDEX_FILE, html, 'utf8');
  console.log(`[generate-index] index.html written — ${cards.length} site${cards.length === 1 ? '' : 's'} listed.`);
  return cards.length;
}

module.exports = { generateIndex };

if (require.main === module) {
  generateIndex();
}
