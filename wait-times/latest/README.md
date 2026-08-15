# Canadian Emergency Department Wait Times (ERstat)

Historical emergency department (ED) wait times at Canadian hospitals, compiled by
ERstat from official provincial and regional health-authority feeds. This is a
periodic archived snapshot; live, current data is at https://erstat.ca.

## Coverage

- **224 emergency departments** across: AB, BC, MB, NB, NS, ON, PE, QC.
- **2026-03-11 to 2026-08-15** in this snapshot, aggregated from ~7,418,150 point-in-time readings.
- Provinces/territories without a public live ED wait feed are not represented.

## Files

### `hospitals.csv` — reference table (one row per ED)
`id`, `name`, `city`, `province`, `lat`, `lng`, `has_er`, `data_source` (upstream feed),
`wait_metric` (usually time_to_physician), `stat_type`. `id` is the join key used everywhere.

### `wait_times_hourly.csv` — hourly time series (UTC)
`hospital_id`, `hour_utc` (start of hour, UTC), `median_wait_minutes`, `min_wait_minutes`,
`max_wait_minutes`, `observations` (readings in the hour).

### `wait_patterns.csv` — typical wait by day-of-week and hour (LOCAL time)
`hospital_id`, `day_of_week` (0=Sunday … 6=Saturday, local), `hour_of_day` (0–23, local),
`typical_wait_minutes` (median across the window), `sample_size`. The "when is this ED least busy" table.

## Methodology
Readings are point-in-time estimates ERstat collects from official feeds (see `data_source`),
usually every few minutes. `wait_minutes` is the source's reported estimate (most commonly
time-to-physician; see `wait_metric`). Aggregates use the median. Hourly buckets are UTC;
patterns are computed in each hospital's provincial timezone. Readings without a numeric wait are excluded.

## Caveats
Wait definitions and update frequency vary by source; compare within a hospital/source over time.
Estimates only. **Not medical advice. In an emergency, call 911.** Coverage can change as authorities
add or drop live feeds.

## License
Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0). Free for non-commercial
use with attribution. Commercial use / live-feed licensing: hello@erstat.ca.

## Citation
ERstat. (2026). *Canadian Emergency Department Wait Times* [Data set]. Zenodo.
https://doi.org/10.5281/zenodo.21940685

## Related
- Live data & API: https://erstat.ca/data
- Companion dataset — *Canadian ER Closures and Service Disruptions (ERstat)*: https://doi.org/10.5281/zenodo.21853002
