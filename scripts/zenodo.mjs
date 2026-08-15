// Publishes the current snapshot to Zenodo.
// First run (no ZENODO_CONCEPT_RECID): creates and publishes a new record,
// prints the concept recid to wire into the workflow. Later runs: creates a
// new version of that concept with fresh files.
// Usage: ZENODO_TOKEN=... [ZENODO_CONCEPT_RECID=...] node scripts/zenodo.mjs
import { readFileSync } from 'node:fs';

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
  title: 'Canadian ER Closures and Service Disruptions (ERstat)',
  creators: [{ name: 'Turnbull, Jason', affiliation: 'ERstat' }],
  description:
    '<p>Point-in-time records of Canadian emergency-room closures, reopenings and service disruptions, collected continuously by <a href="https://erstat.ca">ERstat</a> from official health-authority sources across all provinces, plus per-province counts of ERs publishing live wait times. No government or agency publishes this as one national record.</p>' +
    '<p><code>closures.csv</code>: every ER closed or on reduced service at snapshot time, with status message and expected reopening where published. <code>coverage.csv</code>: per-province ER counts and live wait-time reporting. Coverage began February 2026; snapshots are monthly.</p>' +
    '<p>Canonical dataset page (access, formats, citations): <a href="https://erstat.ca/data">erstat.ca/data</a>. Live JSON API with a free key: <a href="https://erstat.ca/developers">erstat.ca/developers</a>. Monthly CSV archive: <a href="https://github.com/TriesWithSomeSuccess/erstat-data">github.com/TriesWithSomeSuccess/erstat-data</a>.</p>' +
    '<p>Free for non-commercial use with attribution (a visible link to erstat.ca). Full event-level history, wait-time time series, bulk export and commercial use are available under a <a href="https://erstat.ca/licensing">commercial licence</a>.</p>',
  license: 'cc-by-nc-4.0',
  keywords: ['emergency room closures', 'ER wait times', 'Canada', 'hospital closures', 'emergency department', 'health care access', 'service disruptions'],
  version: today,
  publication_date: today,
  related_identifiers: [{ identifier: 'https://erstat.ca/data', relation: 'isDerivedFrom' }, { identifier: 'https://www.wikidata.org/wiki/Q141071728', relation: 'isReferencedBy' }],
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

const bucket = draft.links.bucket;
for (const file of ['latest/closures.csv', 'latest/coverage.csv', 'README.md']) {
  const name = file.split('/').pop();
  const res = await fetch(`${bucket}/${name}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
    body: readFileSync(file),
  });
  if (!res.ok) throw new Error(`upload ${name} -> HTTP ${res.status}: ${await res.text()}`);
}

await api(`/deposit/depositions/${draft.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
const pub = await api(`/deposit/depositions/${draft.id}/actions/publish`, { method: 'POST' });

console.log(`Published: ${pub.links.record_html}`);
console.log(`DOI: ${pub.doi}`);
console.log(`Concept DOI (cite this, always resolves to latest): ${pub.conceptdoi}`);
console.log(`Concept recid (set as ZENODO_CONCEPT_RECID): ${pub.conceptrecid}`);
