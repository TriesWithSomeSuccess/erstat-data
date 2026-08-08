// Pulls the free-tier ERstat API snapshot and writes dated CSVs.
// Usage: ERSTAT_API_KEY=esk_... node scripts/snapshot.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.ERSTAT_API_KEY;
if (!KEY) {
  console.error('ERSTAT_API_KEY is not set. Get a free key at https://erstat.ca/account');
  process.exit(1);
}

const BASE = 'https://erstat.ca/api/v1';
const HEADERS = { 'X-API-Key': KEY, 'User-Agent': 'erstat-data-mirror (github.com/TriesWithSomeSuccess/erstat-data)' };

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => csvEscape(r[c])).join(','));
  return lines.join('\n') + '\n';
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

const closures = await get('/closures');
const coverage = await get('/coverage');

const date = closures.generated_at.slice(0, 10);
const closureRows = closures.closures.map(c => ({ snapshot_at: closures.generated_at, ...c }));
const coverageRows = coverage.provinces.map(p => ({ snapshot_at: coverage.generated_at, ...p }));

const closuresCsv = toCsv(closureRows, ['snapshot_at', 'id', 'name', 'city', 'province', 'status', 'message', 'updated_at', 'expected_reopen']);
const coverageCsv = toCsv(coverageRows, ['snapshot_at', 'province', 'ers', 'reporting_live', 'pct']);

for (const dir of [join('data', 'snapshots', date), 'latest']) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'closures.csv'), closuresCsv);
  writeFileSync(join(dir, 'coverage.csv'), coverageCsv);
}

console.log(`Snapshot ${date}: ${closureRows.length} closures/disruptions, ${coverageRows.length} provinces.`);
