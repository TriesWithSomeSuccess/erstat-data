// Publishes the current wait-times snapshot to Zenodo as a new version.
// Mirrors scripts/zenodo.mjs (closures). Files live in wait-times/latest/.
// The hourly file is stored gzipped in git and uploaded decompressed as .csv.
// Usage: ZENODO_TOKEN=... ZENODO_CONCEPT_RECID= node scripts/zenodo-accuracy.mjs
// Leave ZENODO_CONCEPT_RECID empty for the FIRST publish: that mints a new
// record. Put the concept recid it returns into the workflow afterwards, or
// every month creates a separate record instead of a new version.
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
  title: 'Forecasting Canadian Emergency Department Waits: Accuracy (ERstat)',
  creators: [{ name: 'Turnbull, Jason', affiliation: 'ERstat' }],
  description:
    '<p>How well two different numbers predict what a Canadian emergency department&rsquo;s wait will actually be, one, two and three hours ahead. The predictors are <a href="https://erstat.ca">ERstat</a>&rsquo;s forecast and the hospital&rsquo;s own currently-posted wait, both scored against the same realised outcome.</p>' +
    '<p>Three CSV files (documented in <code>README.md</code>): <code>forecast_pairs.csv</code> &mdash; one row per scored forecast, from which every aggregate is recomputable; <code>scorecard.csv</code> &mdash; mean absolute error and win rate by horizon, province and hospital; <code>hospitals.csv</code> &mdash; reference table.</p>' +
    '<p>The outcome scored is what the hospital later posted, not what patients actually waited, so this measures forecast skill on a published series. Only EDs with a public feed can be scored; roughly half of Canada&rsquo;s emergency departments publish nothing. Not medical advice. Method: <a href="https://erstat.ca/data">erstat.ca/data</a>.</p>',
  license: 'cc-by-nc-4.0',
  keywords: ['emergency department wait times', 'forecast evaluation', 'forecast accuracy', 'time series forecasting', 'Canada', 'emergency medicine', 'health services research', 'mean absolute error'],
  version: today,
  publication_date: today,
  related_identifiers: [
    { identifier: 'https://erstat.ca/data', relation: 'isDocumentedBy' },
    { identifier: '10.5281/zenodo.21940685', relation: 'isSupplementTo' },
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
  ['forecast-accuracy/latest/hospitals.csv', 'hospitals.csv', false],
  ['forecast-accuracy/latest/scorecard.csv', 'scorecard.csv', false],
  ['forecast-accuracy/latest/forecast_pairs.csv.gz', 'forecast_pairs.csv', true],
  ['forecast-accuracy/latest/README.md', 'README.md', false],
];
const bucket = draft.links.bucket;
for (const [srcPath, name, gz] of uploads) {
  const body = gz ? gunzipSync(readFileSync(srcPath)) : readFileSync(srcPath);
  let uploaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${bucket}/${name}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
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

await api(`/deposit/depositions/${draft.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
const pub = await api(`/deposit/depositions/${draft.id}/actions/publish`, { method: 'POST' });

console.log(`Published: ${pub.links.record_html}`);
console.log(`DOI: ${pub.doi}`);
console.log(`Concept DOI (cite this): ${pub.conceptdoi}`);
console.log(`Concept recid: ${pub.conceptrecid}`);
