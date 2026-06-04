/**
 * server.js — DemoReady local dashboard server
 *
 * Serves morning-dashboard.html and exposes a small REST+SSE API so the
 * dashboard can read/write project data and run pipeline scripts.
 *
 * Endpoints:
 *   GET  /                        → morning-dashboard.html
 *   GET  /sites/*                 → demo-site static files
 *   GET  /assets/*                → project asset files
 *
 *   GET  /api/leads               → leads.csv as JSON
 *   POST /api/leads/update        → patch one lead row
 *   GET  /api/report              → morning-report.txt (plain text)
 *   GET  /api/sites               → /sites folder manifest (JSON)
 *   GET  /api/rotation            → rotation progress
 *   GET  /api/config              → public config values
 *
 *   GET  /api/run?skill=xxx       → SSE stream: spawns node xxx.js
 *
 * Usage:
 *   node server.js           (stays running until Ctrl-C)
 *   npm run dashboard        (same, via package.json script)
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const { readCSV, writeCSV, toCSV } = require('./csv-utils');

// CL_HEADERS defined here so server.js never needs to import craigslist-monitor
// (avoids loading axios/xml2js on every API request)
const CL_HEADERS = [
  'title', 'city', 'region', 'category', 'budget', 'score',
  'posted_date', 'url', 'status', 'notes', 'description',
  'remote', 'has_phone', 'has_email',
];

const PORT = 3000;
const ROOT = __dirname;

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain; charset=utf-8',
  '.csv':  'text/csv',
  '.ico':  'image/x-icon',
};

function mime(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function err(res, msg, status = 500) { json(res, { error: msg }, status); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err2, data) => {
    if (err2) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime(filePath) });
    res.end(data);
  });
}

// ─── API handlers ─────────────────────────────────────────────────────────────

function apiLeads(res) {
  try {
    const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
    json(res, leads);
  } catch (e) { err(res, e.message); }
}

async function apiLeadsUpdate(req, res) {
  try {
    const body  = await parseBody(req);
    const { name, updates } = body;
    if (!name || !updates) { err(res, 'name and updates required', 400); return; }

    const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
    const idx   = leads.findIndex(r => r.name === name);
    if (idx === -1) { err(res, 'Lead not found', 404); return; }

    Object.assign(leads[idx], updates);
    writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
    json(res, { ok: true, lead: leads[idx] });
  } catch (e) { err(res, e.message); }
}

function apiReport(res) {
  const p = config.MORNING_REPORT;
  if (!fs.existsSync(p)) { json(res, { text: 'No report yet — run the morning pipeline.' }); return; }
  json(res, { text: fs.readFileSync(p, 'utf8') });
}

function apiSites(res) {
  try {
    const dir = config.SITES_FOLDER;
    if (!fs.existsSync(dir)) { json(res, []); return; }

    const sites = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const slug      = d.name;
        const indexPath = path.join(dir, slug, 'index.html');
        if (!fs.existsSync(indexPath)) return null;
        const html  = fs.readFileSync(indexPath, 'utf8');
        const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || slug)
                        .split(' — ')[0].trim();
        const cat   = (html.match(/<meta[^>]+name=["']category["'][^>]+content=["']([^"']+)/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']category/i)
                      )?.[1] || '';
        const city  = (html.match(/<meta[^>]+name=["']city["'][^>]+content=["']([^"']+)/i)
                      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']city/i)
                      )?.[1] || '';
        const built = new Date(fs.statSync(indexPath).mtime)
                        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const url   = `${config.VERCEL_BASE_URL}/sites/${slug}/index.html`;
        return { slug, title, category: cat, city, built, url };
      })
      .filter(Boolean);
    json(res, sites);
  } catch (e) { err(res, e.message); }
}

function apiRotation(res) {
  try {
    const targets  = JSON.parse(fs.readFileSync(config.TARGETS_FILE, 'utf8'));
    const total    = targets.cities.length * targets.categories.length;
    let used = 0;
    if (fs.existsSync(config.ROTATION_LOG)) {
      const log = JSON.parse(fs.readFileSync(config.ROTATION_LOG, 'utf8'));
      used = (log.used || []).length;
    }
    json(res, {
      total,
      used,
      remaining: total - used,
      pct:       Math.round((used / total) * 100),
      daysLeft:  Math.floor((total - used) / config.COMBOS_PER_RUN),
    });
  } catch (e) { err(res, e.message); }
}

function apiClLeads(res) {
  try {
    if (!fs.existsSync(config.CL_LEADS_CSV)) {
      console.log(`[/api/cl-leads] File not found: ${config.CL_LEADS_CSV}`);
      json(res, []); return;
    }
    const leads = readCSV(config.CL_LEADS_CSV, CL_HEADERS);
    console.log(`[/api/cl-leads] Returning ${leads.length} leads from ${config.CL_LEADS_CSV}`);
    json(res, leads);
  } catch (e) {
    console.error(`[/api/cl-leads] ERROR: ${e.message}`);
    err(res, e.message);
  }
}

async function apiClLeadsUpdate(req, res) {
  try {
    const body = await parseBody(req);
    const { url: postUrl, updates } = body;
    if (!postUrl || !updates) { err(res, 'url and updates required', 400); return; }
    const leads = readCSV(config.CL_LEADS_CSV, CL_HEADERS);
    const idx   = leads.findIndex(r => r.url === postUrl);
    if (idx === -1) { err(res, 'Lead not found', 404); return; }
    Object.assign(leads[idx], updates);
    writeCSV(config.CL_LEADS_CSV, leads, CL_HEADERS);
    json(res, { ok: true, lead: leads[idx] });
  } catch (e) { err(res, e.message); }
}

// ─── CRM data (crm-data.json — rich per-lead data: contact log, notes) ───────

function loadCRMData() {
  if (!fs.existsSync(config.CRM_DATA)) return {};
  try { return JSON.parse(fs.readFileSync(config.CRM_DATA, 'utf8')); } catch { return {}; }
}
function saveCRMData(data) {
  fs.writeFileSync(config.CRM_DATA, JSON.stringify(data, null, 2), 'utf8');
}

function apiCRMData(res) {
  json(res, loadCRMData());
}

async function apiCRMDataUpdate(req, res) {
  try {
    const body = await parseBody(req);
    const { name, data } = body;
    if (!name) { err(res, 'name required', 400); return; }
    const all = loadCRMData();
    all[name] = { ...(all[name] || {}), ...data };
    saveCRMData(all);
    json(res, { ok: true });
  } catch (e) { err(res, e.message); }
}

async function apiLeadsCRM(req, res) {
  // Promote a lead into CRM: sets crm=true, crm_status, source_channel
  try {
    const body = await parseBody(req);
    const { name, crm_status, source_channel } = body;
    if (!name) { err(res, 'name required', 400); return; }
    const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
    const idx   = leads.findIndex(r => r.name === name);
    if (idx === -1) { err(res, 'Lead not found', 404); return; }
    leads[idx].crm            = 'true';
    leads[idx].crm_status     = crm_status     || 'connected';
    leads[idx].source_channel = source_channel || 'WhatsApp';
    if (!leads[idx].status || leads[idx].status === 'sent' || leads[idx].status === 'followedup')
      leads[idx].status = crm_status || 'connected';
    writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
    json(res, { ok: true, lead: leads[idx] });
  } catch (e) { err(res, e.message); }
}

// ─── Reminders (reminders.json) ───────────────────────────────────────────────

function loadReminders() {
  if (!fs.existsSync(config.REMINDERS)) return [];
  try { return JSON.parse(fs.readFileSync(config.REMINDERS, 'utf8')); } catch { return []; }
}
function saveReminders(list) {
  fs.writeFileSync(config.REMINDERS, JSON.stringify(list, null, 2), 'utf8');
}

function apiGetReminders(res) { json(res, loadReminders()); }

async function apiAddReminder(req, res) {
  try {
    const body     = await parseBody(req);
    const list     = loadReminders();
    const reminder = { id: Date.now().toString(36), ...body, dismissed: false };
    list.push(reminder);
    saveReminders(list);
    json(res, { ok: true, reminder });
  } catch (e) { err(res, e.message); }
}

function apiDeleteReminder(res, id) {
  const list = loadReminders().map(r => r.id === id ? { ...r, dismissed: true } : r);
  saveReminders(list);
  json(res, { ok: true });
}

async function apiLeadsAdd(req, res) {
  try {
    const body  = await parseBody(req);
    const leads = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
    const row   = {};
    config.CSV_HEADERS.forEach(h => { row[h] = body[h] || ''; });
    if (!row.name) { err(res, 'name required', 400); return; }
    row.status = row.status || 'new';
    leads.push(row);
    writeCSV(config.LEADS_CSV, leads, config.CSV_HEADERS);
    json(res, { ok: true, lead: row });
  } catch (e) { err(res, e.message); }
}

async function apiClLeadsAdd(req, res) {
  try {
    const body  = await parseBody(req);
    const leads = fs.existsSync(config.CL_LEADS_CSV)
      ? readCSV(config.CL_LEADS_CSV, CL_HEADERS) : [];
    const row   = {};
    CL_HEADERS.forEach(h => { row[h] = body[h] || ''; });
    if (!row.title) { err(res, 'title required', 400); return; }
    row.status = row.status || 'new';
    row.score  = row.score  || '5';
    leads.push(row);
    writeCSV(config.CL_LEADS_CSV, leads, CL_HEADERS);
    json(res, { ok: true, lead: row });
  } catch (e) { err(res, e.message); }
}

function apiCLStatus(res) {
  if (!fs.existsSync(config.CL_STATUS)) {
    json(res, { status: 'never_run', last_run: null, leads_found: 0, regions_searched: 0, blocked: false });
    return;
  }
  try { json(res, JSON.parse(fs.readFileSync(config.CL_STATUS, 'utf8'))); }
  catch (e) { err(res, e.message); }
}

function apiPipelineStatus(res) {
  if (!fs.existsSync(config.PIPELINE_STATUS)) {
    json(res, { status: 'never_run', step: null, leads_found: 0 });
    return;
  }
  try { json(res, JSON.parse(fs.readFileSync(config.PIPELINE_STATUS, 'utf8'))); }
  catch (e) { err(res, e.message); }
}

function apiStatsLog(res) {
  try {
    if (!fs.existsSync(config.STATS_LOG)) { json(res, []); return; }
    const lines = fs.readFileSync(config.STATS_LOG, 'utf8').trim().split('\n');
    if (lines.length < 2) { json(res, []); return; }
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
      return obj;
    });
    json(res, rows);
  } catch (e) { err(res, e.message); }
}

function apiConfig(res) {
  json(res, {
    vercelBaseUrl:    config.VERCEL_BASE_URL,
    followupDays:     config.FOLLOWUP_DAYS,
    archiveAfterDays: config.ARCHIVE_AFTER_DAYS,
    combosPerRun:     config.COMBOS_PER_RUN,
    maxLeadsPerRun:   config.MAX_LEADS_PER_RUN,
  });
}

// ─── SSE script runner ────────────────────────────────────────────────────────

const SKILLS = {
  'find-leads':          'find-leads.js',
  'build-sites':         'build-sites.js',
  'find-contact':        'find-contact.js',
  'draft-outreach':      'draft-outreach.js',
  'follow-up':           'follow-up.js',
  'craigslist-monitor':  'craigslist-monitor.js',
  'morning':             'run-morning.js',
};

const running = new Map(); // track active runs

function apiRunStream(req, res, skill) {
  const script = SKILLS[skill];
  if (!script) { err(res, `Unknown skill: ${skill}`, 400); return; }

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (running.has(skill)) {
    send('error', { msg: `${skill} is already running` });
    res.end();
    return;
  }

  send('start', { skill, script, ts: new Date().toISOString() });

  const child = spawn('node', [path.join(ROOT, script)], {
    cwd: ROOT,
    env: { ...process.env },
  });
  running.set(skill, child);

  child.stdout.on('data', d => send('log',  { line: d.toString() }));
  child.stderr.on('data', d => send('err',  { line: d.toString() }));
  child.on('close', code => {
    running.delete(skill);
    send('done', { code, ts: new Date().toISOString() });
    res.end();
  });

  req.on('close', () => {
    if (running.has(skill)) {
      running.get(skill).kill();
      running.delete(skill);
    }
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const p = url.pathname;

  // ── API routes ────────────────────────────────────────────────────────────
  if (p === '/api/leads'  && method === 'GET')  { apiLeads(res); return; }
  if (p === '/api/leads/update' && method === 'POST') { await apiLeadsUpdate(req, res); return; }
  if (p === '/api/report' && method === 'GET')  { apiReport(res); return; }
  if (p === '/api/sites'  && method === 'GET')  { apiSites(res); return; }
  if (p === '/api/rotation'  && method === 'GET') { apiRotation(res); return; }
  if (p === '/api/config'    && method === 'GET') { apiConfig(res); return; }
  if (p === '/api/stats-log'        && method === 'GET') { apiStatsLog(res); return; }
  if (p === '/api/cl-status'        && method === 'GET') { apiCLStatus(res); return; }
  if (p === '/api/pipeline-status'  && method === 'GET') { apiPipelineStatus(res); return; }
  if (p === '/api/cl-leads'        && method === 'GET')  { apiClLeads(res); return; }
  if (p === '/api/cl-leads/update' && method === 'POST') { await apiClLeadsUpdate(req, res); return; }
  if (p === '/api/crm-data'        && method === 'GET')  { apiCRMData(res); return; }
  if (p === '/api/crm-data'        && method === 'POST') { await apiCRMDataUpdate(req, res); return; }
  if (p === '/api/leads/crm'        && method === 'POST') { await apiLeadsCRM(req, res); return; }
  if (p === '/api/leads/add'        && method === 'POST') { await apiLeadsAdd(req, res); return; }
  if (p === '/api/cl-leads/add'     && method === 'POST') { await apiClLeadsAdd(req, res); return; }
  if (p === '/api/reminders'       && method === 'GET')  { apiGetReminders(res); return; }
  if (p === '/api/reminders'       && method === 'POST') { await apiAddReminder(req, res); return; }
  if (p.startsWith('/api/reminders/') && method === 'DELETE') {
    apiDeleteReminder(res, p.split('/').pop()); return;
  }

  if (p === '/api/run' && method === 'GET') {
    apiRunStream(req, res, url.searchParams.get('skill') || '');
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  if (p === '/' || p === '/morning-dashboard.html') {
    serveFile(res, path.join(ROOT, 'morning-dashboard.html'));
    return;
  }

  // /sites/* → serve demo site files
  if (p.startsWith('/sites/')) {
    const rel = p.replace(/^\//, '');
    serveFile(res, path.join(ROOT, rel));
    return;
  }

  // /assets/* → project assets
  if (p.startsWith('/assets/')) {
    const rel = p.replace(/^\//, '');
    serveFile(res, path.join(ROOT, rel));
    return;
  }

  // Fallback for any file in root
  const candidate = path.join(ROOT, p.replace(/^\//, ''));
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 DemoReady dashboard → http://localhost:${PORT}`);
  console.log(`   Press Ctrl-C to stop\n`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`[server] Port ${PORT} already in use — dashboard already running`);
    process.exit(0);
  } else {
    throw e;
  }
});
