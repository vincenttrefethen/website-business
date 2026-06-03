/**
 * ORCHESTRATOR — run-morning.js
 * Runs the full pipeline in sequence. Errors in one step don't stop the others.
 *
 * Steps:
 *   1. find-leads     — scrapes Google Maps for new Miami business leads
 *   2. build-sites    — generates demo HTML, pushes to GitHub/Vercel, patches index.html
 *   3. find-contact   — finds emails for leads via web scraping
 *   4. draft-outreach — queues WhatsApp links + saves Gmail drafts
 */

'use strict';

const fs = require('fs');
const config = require('./config');

const { findLeads }     = require('./find-leads');
const { buildSites }    = require('./build-sites');
const { findContact }   = require('./find-contact');
const { draftOutreach } = require('./draft-outreach');

async function runSkill(name, fn) {
  const bar = '='.repeat(52);
  console.log(`\n${bar}`);
  console.log(`SKILL: ${name.padEnd(18)} [${new Date().toLocaleTimeString()}]`);
  console.log(bar);
  const start = Date.now();
  try {
    const result  = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${name}] ✓ Completed in ${elapsed}s — result: ${JSON.stringify(result)}`);
    return { name, ok: true, result, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${name}] ✗ FAILED after ${elapsed}s: ${err.message}`);
    return { name, ok: false, error: err.message, elapsed };
  }
}

async function main() {
  const runAt = new Date().toISOString();
  console.log(`\nMORNING PIPELINE STARTED — ${runAt}`);

  // Run sequentially so each step can depend on the previous
  const results = [];
  results.push(await runSkill('find-leads',     findLeads));
  results.push(await runSkill('build-sites',    buildSites));
  results.push(await runSkill('find-contact',   findContact));
  results.push(await runSkill('draft-outreach', draftOutreach));

  // ── Morning report ────────────────────────────────────────────────────────
  const fmt = (r) => {
    if (!r.ok) return `✗ FAILED  — ${r.error}`;
    const v = r.result;
    if (typeof v === 'object' && v !== null) {
      return `✓ ${Object.entries(v).map(([k,n]) => `${k}: ${n}`).join(' | ')}`;
    }
    return `✓ ${v}`;
  };

  const report = [
    `DemoReady Morning Pipeline Report`,
    `Run at: ${runAt}`,
    ``,
    ...results.map(r =>
      `  [${r.ok ? '✓' : '✗'}] ${r.name.padEnd(16)} ${fmt(r)}  (${r.elapsed}s)`
    ),
    ``,
    `Quick summary:`,
    `  Leads found:    ${results[0].ok ? results[0].result : 'N/A'}`,
    `  Sites built:    ${results[1].ok ? results[1].result : 'N/A'}`,
    `  Contacts found: ${results[2].ok ? results[2].result : 'N/A'}`,
    `  WA queued:      ${results[3].ok ? (results[3].result?.waSent      ?? results[3].result) : 'N/A'}`,
    `  Email drafts:   ${results[3].ok ? (results[3].result?.emailDrafted ?? 'N/A') : 'N/A'}`,
    ``,
  ].join('\n');

  fs.writeFileSync(config.MORNING_REPORT, report, 'utf8');
  console.log('\n' + report);
  console.log(`Report saved → ${config.MORNING_REPORT}`);
}

main().catch(err => {
  console.error('Fatal pipeline error:', err);
  process.exit(1);
});
