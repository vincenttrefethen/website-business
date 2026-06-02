const fs = require('fs');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(content) {
  const lines = content.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] !== undefined ? values[i] : ''; });
    return obj;
  });
  return { headers, rows };
}

function escapeCSVValue(v) {
  const str = String(v === undefined || v === null ? '' : v);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(rows, headers) {
  const lines = [headers.map(escapeCSVValue).join(',')];
  rows.forEach(row => lines.push(headers.map(h => escapeCSVValue(row[h])).join(',')));
  return lines.join('\n');
}

function readCSV(filePath, defaultHeaders = []) {
  if (!fs.existsSync(filePath)) {
    if (defaultHeaders.length) {
      fs.writeFileSync(filePath, defaultHeaders.map(escapeCSVValue).join(',') + '\n', 'utf8');
    }
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  const { rows } = parseCSV(content);
  return rows;
}

function writeCSV(filePath, rows, headers) {
  fs.writeFileSync(filePath, toCSV(rows, headers) + '\n', 'utf8');
}

module.exports = { readCSV, writeCSV, toCSV, parseCSV };
