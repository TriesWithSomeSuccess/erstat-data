// Publishes the current wait-times snapshot to Zenodo as a new version.
// Mirrors scripts/zenodo.mjs (closures). Files live in wait-times/latest/.
// The hourly file is stored gzipped in git and uploaded decompressed as .csv.
// Usage: ZENODO_TOKEN=... ZENODO_CONCEPT_RECID=21940685 node scripts/zenodo-waits.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

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
  title: 'Canadian Emergency Department Wait Times (ERstat)',
  creators: [{ name: 'Turnbull, Jason', affiliation: 'ERstat' }],
  description:
    '<p>Historical emergency department (ED) wait times at Canadian hospitals, compiled by <a href="https://erstat.ca">ERstat</a> from official provincial and regional health-authority feeds.</p>' +
    '<p>Three CSV files (documented in <code>README.md</code>): <code>hospitals.csv</code> &mdash; reference table of the emergency departments; <code>wait_times_hourly.csv</code> &mdash; hourly measurements; <code>wait_patterns.csv</code> &mdash; aggregate statistics.</p>' +
    '<p>Wait times are estimates (most commonly time-to-physician) and are not medical advice; in an emergency, call 911. Live data and a free API: <a href="https://erstat.ca/data">erstat.ca/data</a>.</p>',
  license: 'cc-by-nc-4.0',
  keywords: ['emergency department wait times', 'ER wait times', 'Canada', 'hospital wait times', 'emergency medicine', 'health care access', 'real-time health data'],
  version: today,
  publication_date: today,
  related_identifiers: [
    { identifier: 'https://erstat.ca/data', relation: 'isDocumentedBy' },
    { identifier: '10.5281/zenodo.21853002', relation: 'references' },
    { identifier: 'https://www.wikidata.org/wiki/Q141085438', relation: 'isReferencedBy' },
  ],
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

// Upload map: repo path -> published filename. The hourly file is decompressed.
const uploads = [
  ['wait-times/latest/hospitals.csv', 'hospitals.csv', false],
  ['wait-times/latest/wait_patterns.csv', 'wait_patterns.csv', false],
  ['wait-times/latest/wait_times_hourly.csv.gz', 'wait_times_hourly.csv', true],
  ['wait-times/latest/README.md', 'README.md', false],
];
const bucket = draft.links.bucket;
for (const [srcPath, name, gz] of uploads) {
  const body = gz ? gunzipSync(readFileSync(srcPath)) : readFileSync(srcPath);
  let uploaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${bucket}/${name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA, 'Content-Type': 'application/octet-stream' },
        body,
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
console.log(`Concept DOI (cite this): ${pub.conceptdoi}`);
console.log(`Concept recid: ${pub.conceptrecid}`);
