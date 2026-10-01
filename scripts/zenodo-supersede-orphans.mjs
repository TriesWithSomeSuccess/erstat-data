// Marks the two September 2026 orphan records as superseded.
//
// On 2026-09-01 a WAF 403 on the concept lookup fell through to creating a brand
// new record, so each dataset grew a second concept DOI. Zenodo cannot merge
// concepts, so these two records cannot be folded back into the lineage everyone
// cites. They can only be labelled, so a reader who lands on one is sent to the
// canonical concept instead of treating it as a rival dataset.
const TOKEN = process.env.ZENODO_TOKEN;
if (!TOKEN) { console.error('ZENODO_TOKEN is not set.'); process.exit(1); }
const BASE = 'https://zenodo.org/api';
const UA = 'erstat-data/1.0 (+https://erstat.ca; dataset publisher)';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA,
      ...(typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

const ORPHANS = [
  { id: 22234481, canonicalConcept: '10.5281/zenodo.21853002', canonicalUrl: 'https://doi.org/10.5281/zenodo.21853002' },
  { id: 22234273, canonicalConcept: '10.5281/zenodo.21940685', canonicalUrl: 'https://doi.org/10.5281/zenodo.21940685' },
];

const NOTICE = (doi, url) =>
  '<p><strong>Superseded. Do not cite this record.</strong> It was created by a publishing fault on 1 September 2026: '
  + 'a blocked request was mistaken for a missing record, so this was deposited as a new dataset instead of as a new '
  + `version of the existing one. The maintained dataset is <a href="${url}"><code>${doi}</code></a>, which always `
  + 'resolves to the current version. Zenodo cannot merge two records, so this one cannot be folded back in; the '
  + 'September 2026 data it holds is also included in the maintained dataset. Please cite that DOI instead.</p><hr>';

for (const o of ORPHANS) {
  const before = await api(`/deposit/depositions/${o.id}`);
  console.log(`\n${o.id}: "${before.title}"`);

  if (before.title.startsWith('[SUPERSEDED]')) { console.log('  already marked; skipping'); continue; }

  await api(`/deposit/depositions/${o.id}/actions/edit`, { method: 'POST' });
  const d = await api(`/deposit/depositions/${o.id}`);
  const m = d.metadata;

  const metadata = {
    ...m,
    title: `[SUPERSEDED] ${m.title}`,
    description: NOTICE(o.canonicalConcept, o.canonicalUrl) + m.description,
    related_identifiers: [
      ...(m.related_identifiers || []).filter(r => r.identifier !== o.canonicalConcept),
      { identifier: o.canonicalConcept, relation: 'isObsoletedBy', resource_type: 'dataset' },
    ],
  };

  await api(`/deposit/depositions/${o.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
  const pub = await api(`/deposit/depositions/${o.id}/actions/publish`, { method: 'POST' });
  console.log(`  -> "${pub.title}"`);
  console.log(`  -> obsoleted by ${o.canonicalConcept}`);
}
console.log('\nDone.');
