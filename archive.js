/**
 * archive.js
 *
 * Moves leads older than ARCHIVE_AFTER_DAYS (30) with status
 * sent / followedup / skip into leads-archive.csv to keep
 * leads.csv clean and fast.
 *
 * leads-archive.csv is the permanent do-not-contact list.
 * Both name and phone from archive are excluded from future scrapes.
 *
 * Run standalone:  node archive.js
 * Auto-run:        last step in run-morning.js
 */

'use strict';

const fs     = require('fs');
const config = require('./config');
const { readCSV, writeCSV } = require('./csv-utils');

const ARCHIVE_STATUSES = new Set(['sent', 'followedup', 'skip', 'converted', 'connected']);

async function archiveLeads() {
  const leads   = readCSV(config.LEADS_CSV,   config.CSV_HEADERS);
  const archive = readCSV(config.ARCHIVE_CSV, config.CSV_HEADERS);

  const cutoffMs  = Date.now() - (config.ARCHIVE_AFTER_DAYS * 86400000);
  const archiveSet = new Set(archive.map(r => r.name.toLowerCase()));

  const toArchive  = [];
  const toKeep     = [];

  for (const lead of leads) {
    if (!ARCHIVE_STATUSES.has(lead.status)) {
      toKeep.push(lead);
      continue;
    }

    // Use outreach_date or followup_date to determine age
    const dateStr = lead.followup_date || lead.outreach_date;
    if (!dateStr) { toKeep.push(lead); continue; }

    const age = new Date(dateStr).getTime();
    if (isNaN(age) || age > cutoffMs) {
      toKeep.push(lead);
      continue;
    }

    // Don't double-archive
    if (!archiveSet.has(lead.name.toLowerCase())) {
      toArchive.push(lead);
      archiveSet.add(lead.name.toLowerCase());
    }
  }

  if (toArchive.length === 0) {
    console.log('[archive] No leads old enough to archive.');
    return 0;
  }

  writeCSV(config.ARCHIVE_CSV, [...archive, ...toArchive], config.CSV_HEADERS);
  writeCSV(config.LEADS_CSV,   toKeep,                     config.CSV_HEADERS);

  console.log(
    `[archive] Moved ${toArchive.length} lead(s) to archive. ` +
    `leads.csv: ${toKeep.length} remaining.`
  );
  return toArchive.length;
}

module.exports = { archiveLeads };

if (require.main === module) {
  archiveLeads().then(n => console.log(`[archive] Done. ${n} archived.`)).catch(console.error);
}
