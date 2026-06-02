/**
 * ORCHESTRATOR — run-morning.js
 * Runs all 4 skills in sequence. Errors in one skill don't stop the others.
 */

const fs = require('fs');
const config = require('./config');

const { findLeads }   = require('./find-leads');
const { buildSites }  = require('./build-sites');
const { findContact } = require('./find-contact');
const { draftEmails } = require('./draft-emails');

async function runSkill(name, fn) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`SKILL: ${name}  [${new Date().toLocaleTimeString()}]`);
  console.log('='.repeat(50));
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${name}] Completed in ${elapsed}s → result: ${result}`);
    return { name, ok: true, result, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${name}] FAILED after ${elapsed}s: ${err.message}`);
    return { name, ok: false, error: err.message, elapsed };
  }
}

async function main() {
  const runAt = new Date().toISOString();
  console.log(`\nMORNING PIPELINE STARTED — ${runAt}`);

  const results = [];
  results.push(await runSkill('find-leads',   findLeads));
  results.push(await runSkill('build-sites',  buildSites));
  results.push(await runSkill('find-contact', findContact));
  results.push(await runSkill('draft-emails', draftEmails));

  const report = [
    `Morning Pipeline Report`,
    `Run at: ${runAt}`,
    ``,
    ...results.map(r => {
      const status = r.ok ? '✓' : '✗ FAILED';
      const detail = r.ok ? `result=${r.result}` : `error=${r.error}`;
      return `  [${status}] ${r.name.padEnd(14)} ${detail}  (${r.elapsed}s)`;
    }),
    ``,
    `Skill summary:`,
    `  Leads found:    ${results[0].ok ? results[0].result : 'N/A'}`,
    `  Sites built:    ${results[1].ok ? results[1].result : 'N/A'}`,
    `  Emails found:   ${results[2].ok ? results[2].result : 'N/A'}`,
    `  Drafts created: ${results[3].ok ? results[3].result : 'N/A'}`,
    ``,
  ].join('\n');

  fs.writeFileSync(config.MORNING_REPORT, report, 'utf8');
  console.log('\n' + report);
  console.log(`Report saved to: ${config.MORNING_REPORT}`);
}

main().catch(err => {
  console.error('Fatal pipeline error:', err);
  process.exit(1);
});
