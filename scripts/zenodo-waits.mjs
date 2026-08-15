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

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const today = new Date().toISOString().slice(0, 10);

const metadata = {
  upload_type: 'dataset',
  title: 'Canadian Emergency Department Wait Times (ERstat)',
  creators: [{ name: 'Turnbull, Jason', affiliation: 'ERstat' }],
  description:
    '<p>Historical emergency department (ED) wait times at Canadian hospitals, compiled by <a href="https://erstat.ca">ERstat</a> from official provincial and regional health-authority feeds. This is a periodic archived snapshot of the historical record; live, current data is at <a href="https://erstat.ca">erstat.ca</a>.</p>' +
    '<p>Three CSV files (documented in <code>README.md</code>): <code>hospitals.csv</code> &mdash; reference table of the emergency departments; <code>wait_times_hourly.csv</code> &mdash; hourly median/min/max wait per hospital (UTC); <code>wait_patterns.csv</code> &mdash; typical wait by local day-of-week and hour-of-day (the "when is this ED least busy" table).</p>' +
    '<p>Wait times are estimates (most commonly time-to-physician) and are not medical advice; in an emergency, call 911. Live data and a free API: <a href="https://erstat.ca/data">erstat.ca/data</a>. Commercial use and live-feed licensing: hello@erstat.ca.</p>',
  license: 'cc-by-nc-4.0',
  keywords: ['emergency department wait times', 'ER wait times', 'Canada', 'hospital wait times', 'emergency medicine', 'health care access', 'real-time health data'],
  version: today,
  publication_date: today,
  related_identifiers: [
    { identifier: 'https://erstat.ca/data', relation: 'isDocumentedBy' },
    { identifier: '10.5281/zenodo.21853002', relation: 'references' },
  ],
};

let draft;
if (!CONCEPT) {
  draft = await api('/deposit/depositions', { method: 'POST', body: '{}' });
} else {
  const list = await api(`/deposit/depositions?q=conceptrecid:${CONCEPT}&status=published&sort=mostrecent&size=1`);
  if (!list.length) throw new Error(`No published deposition found for concept ${CONCEPT}`);
  const nv = await api(`/deposit/depositions/${list[0].id}/actions/newversion`, { method: 'POST' });
  const draftId = nv.links.latest_draft.split('/').pop();
  draft = await api(`/deposit/depositions/${draftId}`);
  for (const f of draft.files || []) {
    await api(`/deposit/depositions/${draft.id}/files/${f.id}`, { method: 'DELETE' });
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
  const res = await fetch(`${bucket}/${name}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${name} -> HTTP ${res.status}: ${await res.text()}`);
}

await api(`/deposit/depositions/${draft.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
const pub = await api(`/deposit/depositions/${draft.id}/actions/publish`, { method: 'POST' });

console.log(`Published: ${pub.links.record_html}`);
console.log(`DOI: ${pub.doi}`);
console.log(`Concept DOI (cite this): ${pub.conceptdoi}`);
console.log(`Concept recid: ${pub.conceptrecid}`);
