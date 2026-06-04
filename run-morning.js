/**
 * ORCHESTRATOR — run-morning.js
 *
 * Pipeline steps (sequential):
 *   1. find-leads     — scrapes Google Maps until 100 unique leads
 *   2. build-sites    — generates demo HTML, pushes to GitHub/Vercel
 *   3. draft-outreach — WhatsApp queue + Gmail drafts
 *   4. follow-up      — sends follow-up WA to 3-day-old leads
 *   5. archive        — moves 30-day-old closed leads to archive
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const { exec, spawn } = require('child_process');
const config = require('./config');

const { findLeads }     = require('./find-leads');
const { buildSites }    = require('./build-sites');
const { draftOutreach } = require('./draft-outreach');
const { followUp }      = require('./follow-up');
const { archiveLeads }  = require('./archive');
const { readCSV, writeCSV } = require('./csv-utils');

async function runSkill(name, fn) {
  const bar = '='.repeat(52);
  console.log(`\n${bar}`);
  console.log(`SKILL: ${name.padEnd(18)} [${new Date().toLocaleTimeString()}]`);
  console.log(bar);
  const start = Date.now();
  try {
    const result  = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${name}] ✓ Done in ${elapsed}s — ${JSON.stringify(result)}`);
    return { name, ok: true, result, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${name}] ✗ FAILED in ${elapsed}s: ${err.message}`);
    return { name, ok: false, error: err.message, elapsed };
  }
}

async function main() {
  const runAt = new Date().toISOString();
  console.log(`\nMORNING PIPELINE STARTED — ${runAt}`);

  const results = [];
  results.push(await runSkill('find-leads',     findLeads));
  results.push(await runSkill('build-sites',    buildSites));
  results.push(await runSkill('draft-outreach', draftOutreach));
  results.push(await runSkill('follow-up',      followUp));
  results.push(await runSkill('archive',        archiveLeads));

  // ── Morning report ─────────────────────────────────────────────────────────
  const fmt = r => {
    if (!r.ok) return `✗ FAILED — ${r.error}`;
    const v = r.result;
    if (typeof v === 'object' && v !== null) {
      return '✓ ' + Object.entries(v)
        .filter(([k]) => k !== 'combos')   // keep report tight
        .map(([k,n]) => `${k}: ${n}`)
        .join(' | ');
    }
    return `✓ ${v}`;
  };

  const leadsResult  = results[0]?.ok ? results[0].result : null;
  const comboSection = leadsResult?.combos
    ? `\nCombinations searched:\n${leadsResult.combos}\n  Rotation: ${leadsResult.rotation}`
    : '';

  const report = [
    `DemoReady Morning Pipeline Report`,
    `Run at: ${runAt}`,
    ``,
    ...results.map(r =>
      `  [${r.ok?'✓':'✗'}] ${r.name.padEnd(16)} ${fmt(r)}  (${r.elapsed}s)`
    ),
    ``,
    `Quick summary:`,
    `  Leads found:    ${leadsResult?.total ?? 'N/A'} (written to leads.csv after dedup)`,
    `  Batches run:    ${leadsResult?.batches ?? 'N/A'}`,
    `  Sites built:    ${results[1]?.ok ? results[1].result : 'N/A'}`,
    `  WA queued:      ${results[2]?.ok ? (results[2].result?.waSent ?? results[2].result) : 'N/A'}`,
    `  Follow-ups:     ${results[3]?.ok ? results[3].result : 'N/A'}`,
    `  Archived:       ${results[4]?.ok ? results[4].result : 'N/A'}`,
    comboSection,
    ``,
  ].join('\n');

  fs.writeFileSync(config.MORNING_REPORT, report, 'utf8');
  console.log('\n' + report);
  console.log(`Report saved → ${config.MORNING_REPORT}`);

  appendStatsLog(results, runAt);
  openDashboard();
}

function appendStatsLog(results, runAt) {
  try {
    const leads   = readCSV(config.LEADS_CSV, config.CSV_HEADERS);
    const leadsR  = results[0]?.ok ? results[0].result : {};
    const row = {
      date:                runAt.slice(0, 10),
      leads_scraped:       leadsR.total        || 0,
      leads_with_phones:   leadsR.withPhones   || 0,
      wa_opened:           leads.filter(r => r.status === 'opened').length,
      wa_sent:             leads.filter(r => r.status === 'sent' || r.status === 'contacted').length,
      connected:           leads.filter(r => r.status === 'connected' || r.status === 'converted').length,
      followups_sent:      results[3]?.ok ? (results[3].result || 0) : 0,
      combos_used:         leadsR.batches ? leadsR.batches * config.COMBOS_PER_RUN : 0,
      cities_searched:     '',
      categories_searched: '',
    };

    // Write headers if file doesn't exist
    if (!fs.existsSync(config.STATS_LOG)) {
      fs.writeFileSync(config.STATS_LOG, config.STATS_HEADERS.join(',') + '\n', 'utf8');
    }
    const line = config.STATS_HEADERS.map(h => String(row[h] || '')).join(',');
    fs.appendFileSync(config.STATS_LOG, line + '\n', 'utf8');
    console.log(`[stats] Row appended to stats-log.csv`);
  } catch (e) {
    console.warn(`[stats] Could not write stats-log: ${e.message}`);
  }
}

function openDashboard() {
  const DASH_URL = 'http://localhost:3000';
  http.get(DASH_URL, () => {
    console.log(`\n📊 Dashboard → ${DASH_URL}`);
    exec(`start "" "${DASH_URL}"`);
  }).on('error', () => {
    const srv = spawn('node', [path.join(__dirname, 'server.js')], {
      detached: true, stdio: 'ignore', cwd: __dirname, env: process.env,
    });
    srv.unref();
    setTimeout(() => {
      console.log(`\n📊 Opening dashboard → ${DASH_URL}`);
      exec(`start "" "${DASH_URL}"`);
    }, 1500);
  });
}

main().catch(err => {
  console.error('Fatal pipeline error:', err);
  process.exit(1);
});
