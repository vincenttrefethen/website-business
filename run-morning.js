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

  openDashboard();
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
