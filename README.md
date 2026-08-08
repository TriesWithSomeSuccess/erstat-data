# Canadian ER Closures & Service Disruptions

Monthly point-in-time snapshots of Canadian emergency-room closures, reopenings and service disruptions, plus per-province counts of ERs publishing live wait times. Collected continuously by [ERstat](https://erstat.ca) from official health-authority sources across all provinces. No government or agency publishes this as one national record.

**Canonical dataset page (access, formats, citations): [erstat.ca/data](https://erstat.ca/data)**

## What's here

```
data/snapshots/YYYY-MM-DD/closures.csv   ER closures & disruptions at snapshot time
data/snapshots/YYYY-MM-DD/coverage.csv   Per-province ER counts + live wait reporting
latest/                                  Most recent snapshot (same files)
```

Snapshots are taken monthly by a scheduled GitHub Action calling the free [ERstat API](https://erstat.ca/developers).

### closures.csv columns

| Column | Meaning |
| --- | --- |
| `snapshot_at` | UTC timestamp the snapshot was taken |
| `id` | Stable ERstat hospital id |
| `name`, `city`, `province` | Hospital identity |
| `status` | `closed` or `disruption` |
| `message` | Official status message, when published |
| `updated_at` | When the official status last changed |
| `expected_reopen` | Published reopening time, when known (may be empty) |

### coverage.csv columns

| Column | Meaning |
| --- | --- |
| `snapshot_at` | UTC timestamp the snapshot was taken |
| `province` | Two-letter code |
| `ers` | ERs tracked in that province |
| `reporting_live` | ERs publishing a live wait time |
| `pct` | `reporting_live` as a percentage of `ers` |

## Live data & full history

- **Live JSON API** (free key, non-commercial): [erstat.ca/developers](https://erstat.ca/developers)
- **Embeddable widget** (no key): [erstat.ca/embed](https://erstat.ca/embed)
- **Full event-level history, wait-time time series, bulk export, commercial use**: [erstat.ca/licensing](https://erstat.ca/licensing)

These snapshots are monthly samples, useful for coursework, journalism and exploratory research. If your analysis needs every closure event or wait-time trends over time, that lives in the licensed history API.

## License & attribution

Data is licensed [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): free for non-commercial use with attribution. Attribution means a visible link to [erstat.ca](https://erstat.ca), e.g. "Data from [ERstat](https://erstat.ca)". Commercial use of the data requires a [licence](https://erstat.ca/licensing). The snapshot script in `scripts/` is MIT.

## How to cite

> ERstat. (2026). Canadian ER closures and service disruptions [Data set]. https://erstat.ca/data

More formats (MLA, BibTeX): [erstat.ca/data](https://erstat.ca/data)
