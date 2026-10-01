// Publishes the current snapshot to Zenodo.
// First run (no ZENODO_CONCEPT_RECID): creates and publishes a new record,
// prints the concept recid to wire into the workflow. Later runs: creates a
// new version of that concept with fresh files.
// Usage: ZENODO_TOKEN=... [ZENODO_CONCEPT_RECID=...] node scripts/zenodo.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.ZENODO_TOKEN;
if (!TOKEN) { console.error('ZENODO_TOKEN is not set.'); process.exit(1); }
const CONCEPT = process.env.ZENODO_CONCEPT_RECID || '';
const BASE = 'https://zenodo.org/api';

// Zenodo's WAF 403s two User-Agents: a missing one, and the literal string
// "node", which is exactly what Node's built-in fetch sends. Every other UA
// tested (curl, undici, python-requests, this one) is served normally. That
// rule is what broke the 2026-10-01 publish, and what forked the DOI lineage
// on 2026-09-01 back when a failed lookup fell through to creating a record.
// So this header is load-bearing, not cosmetic.
const UA = 'erstat-data/1.0 (+https://erstat.ca; dataset publisher)';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA, ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function apiWithRetry(path, opts = {}, maxRetries = 4) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await api(path, opts);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      // Zenodo's WAF answers a blocked IP with 403 and an HTML body ("unusual
      // traffic from your network"). That is a property of the network, not the
      // request, so it wants a longer wait than an ordinary transient error.
      const blocked = /HTTP 403|HTTP 429|HTTP 50\d/.test(error.message);
      const delay = blocked ? 30000 * (attempt + 1) : Math.pow(2, attempt + 1) * 1000;
      console.log(`Retry ${attempt + 1}/${maxRetries - 1} in ${delay / 1000}s: ${error.message.slice(0, 160)}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const today = new Date().toISOString().slice(0, 10);

const metadata = {
  upload_type: 'dataset',
  title: 'Canadian ER Closures and Service Disruptions (ERstat)',
  creators: [{ name: 'Turnbull, Jason', affiliation: 'ERstat' }],
  description:
    '<p>Point-in-time records of Canadian emergency-room closures, reopenings and service disruptions, collected continuously by <a href="https://erstat.ca">ERstat</a> from official health-authority sources across all provinces and territories.</p>' +
    '<p><code>closures.csv</code>: every ER closed or on reduced service at snapshot time, with status message and expected reopening where published. <code>coverage.csv</code>: per-province ER counts and data freshness. <code>closures_history.csv</code> and <code>coverage_history.csv</code>: every monthly snapshot to date concatenated, so this one version carries the full series. Canonical dataset page (access, formats, citations): <a href="https://erstat.ca/data">erstat.ca/data</a>. Live JSON API with a free key: <a href="https://erstat.ca/developers">erstat.ca/developers</a>.</p>' +
    '<p>Free for non-commercial use with attribution (a visible link to erstat.ca). Full event-level history, wait-time time series, bulk export and commercial use are available under a separate license.</p>',
  license: 'cc-by-nc-4.0',
  keywords: ['emergency room closures', 'ER wait times', 'Canada', 'hospital closures', 'emergency department', 'health care access', 'service disruptions'],
  version: today,
  publication_date: today,
  related_identifiers: [{ identifier: 'https://erstat.ca/data', relation: 'isDerivedFrom' }, { identifier: 'https://www.wikidata.org/wiki/Q141071728', relation: 'isReferencedBy' }],
};

let draft;
if (!CONCEPT) {
  draft = await apiWithRetry('/deposit/depositions', { method: 'POST', body: '{}' });
} else {
  // NO FALLBACK TO A NEW DEPOSITION. This used to create one whenever the
  // lookup came back empty or the newversion call failed, which turned any
  // transient error into a permanent split in the DOI lineage. It did exactly
  // that on 2026-09-01: both datasets silently acquired a second concept DOI,
  // so the concept everyone cites stopped resolving to the latest version and
  // nobody noticed for a month. A failed publish is recoverable; a forked DOI
  // is forever. Fail loudly instead.
  const list = await apiWithRetry(`/deposit/depositions?q=conceptrecid:${CONCEPT}&status=published&sort=mostrecent&size=1`);
  if (!list.length) {
    throw new Error(`No published deposition found for concept ${CONCEPT}. Refusing to create a new record: that would fork the DOI lineage. Check ZENODO_CONCEPT_RECID and that the token owns this record.`);
  }
  const nv = await apiWithRetry(`/deposit/depositions/${list[0].id}/actions/newversion`, { method: 'POST' });
  const draftId = nv.links.latest_draft.split('/').pop();
  draft = await apiWithRetry(`/deposit/depositions/${draftId}`);
  for (const f of draft.files || []) {
    await apiWithRetry(`/deposit/depositions/${draft.id}/files/${f.id}`, { method: 'DELETE' });
  }
  // Belt and braces: whatever happened above, we are about to publish. Prove it
  // lands in the concept we were told to extend.
  if (String(draft.conceptrecid) !== String(CONCEPT)) {
    throw new Error(`Draft ${draft.id} belongs to concept ${draft.conceptrecid}, expected ${CONCEPT}. Refusing to publish.`);
  }
}


// Each published version of this dataset is a point-in-time snapshot, so a
// reader who lands on one version sees one month. These two files carry the
// whole series, making any single version self-contained -- which also means a
// month that never made it into this concept (September 2026, published under a
// forked DOI) is still recoverable from the latest record.
function buildHistory(kind) {
  const base = 'data/snapshots';
  const dirs = readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let header = null;
  const rows = [];
  for (const dir of dirs) {
    const file = `${base}/${dir}/${kind}.csv`;
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    if (!lines.length) continue;
    if (header === null) header = lines[0];
    else if (lines[0] !== header) throw new Error(`${file} header differs from ${dirs[0]}; refusing to concatenate mismatched schemas`);
    rows.push(...lines.slice(1));
  }
  if (header === null) throw new Error(`no ${kind}.csv snapshots found under ${base}`);
  const out = `latest/${kind}_history.csv`;
  writeFileSync(out, header + '\n' + rows.join('\n') + '\n');
  console.log(`Built ${out}: ${rows.length} rows across ${dirs.length} snapshots`);
  return out;
}

const history = [buildHistory('closures'), buildHistory('coverage')];

const bucket = draft.links.bucket;
for (const file of ['latest/closures.csv', 'latest/coverage.csv', ...history, 'README.md']) {
  const name = file.split('/').pop();
  let uploaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${bucket}/${name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA, 'Content-Type': 'application/octet-stream' },
        body: readFileSync(file),
        signal: AbortSignal.timeout(180000), // 3 minute timeout per upload
      });
      if (!res.ok) throw new Error(`upload ${name} -> HTTP ${res.status}: ${await res.text()}`);
      console.log(`Uploaded ${name}`);
      uploaded = true;
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      console.log(`Upload retry ${attempt + 1}/2 for ${name}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

await apiWithRetry(`/deposit/depositions/${draft.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
const pub = await apiWithRetry(`/deposit/depositions/${draft.id}/actions/publish`, { method: 'POST' });

console.log(`Published: ${pub.links.record_html}`);
console.log(`DOI: ${pub.doi}`);
console.log(`Concept DOI (cite this, always resolves to latest): ${pub.conceptdoi}`);
console.log(`Concept recid (set as ZENODO_CONCEPT_RECID): ${pub.conceptrecid}`);
