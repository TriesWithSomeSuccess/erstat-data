# Canadian Emergency Department Wait Times (ERstat)

Historical emergency department (ED) wait times at Canadian hospitals. Each hour
carries up to two figures: what the hospital itself published, and ERstat's own
number, which is computed on a single definition for every ED including the
roughly half of them that publish nothing. This is a periodic archived snapshot;
live, current data is at https://erstat.ca.

## Coverage

- **652 emergency departments** across: AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT.
- **281** of them publish a wait time themselves. **599** carry an ERstat
  figure, including EDs that publish nothing at all.
- **2026-03-11 to 2026-10-01** in this snapshot, aggregated from ~10,337,092 point-in-time readings.
- A province with no public live feed can still appear here, because the ERstat
  figure does not depend on one. Where neither exists, the ED is absent.

## Files

### `hospitals.csv` — reference table (one row per ED)
`id`, `name`, `city`, `province`, `lat`, `lng`, `has_er`, `data_source` (upstream feed),
`wait_metric` (usually time_to_physician), `stat_type`. `id` is the join key used everywhere.

### `wait_times_hourly.csv` — hourly time series (UTC), TWO numbers per hour
`hospital_id`, `hour_utc` (start of hour, UTC), then:

**What the hospital published** (present for EDs where `has_publisher_feed` is true):
`median_wait_minutes`, `min_wait_minutes`, `max_wait_minutes`, `observations`.

**What ERstat computed** (present from 2026-07-01 onward, for a much wider set of EDs):
`erstat_median_minutes`, `erstat_lower_minutes`, `erstat_upper_minutes` (calibrated interval),
`erstat_tier`, `erstat_confidence`, `erstat_observations`.

Rows are a FULL OUTER JOIN, so a row exists when either number does. Either side
may be empty. `erstat_tier` is one of `live_informed` (the ED had a feed that
hour), `stale_informant` (it had one recently), `silent_safe` or
`silent_caution` (it publishes nothing and the figure is modelled).

### `wait_patterns.csv` — typical wait by day-of-week and hour (LOCAL time)
`hospital_id`, `day_of_week` (0=Sunday … 6=Saturday, local), `hour_of_day` (0–23, local),
`typical_wait_minutes` (median across the window), `sample_size`. The "when is this ED least busy" table.

## The two numbers, and why they differ

**The published number** is whatever the hospital or health authority reports. It is
NOT the same quantity across the country. Most feeds report a time to first
physician assessment; New Brunswick and Quebec report a whole-visit duration,
which runs about twice as long (see `wait_metric`). Several publishers cap their
figure at a display ceiling, so long waits are recorded at the cap. A single
published figure also describes a population that varies: some count everyone in
the department, some only those still in the waiting room.

**The ERstat number** is one definition applied everywhere: the time from arrival
to leaving the waiting room, derived from the queue by Little's law and issued
as a nowcast for the hour it is stamped with. It exists for EDs that publish
nothing at all, which is roughly half of Canada's emergency departments, and it
is the only figure in this file that can be compared across provinces without
adjustment.

Roughly 64,000 hours carry both, which is where the two can be compared directly.

## Methodology
Published readings are point-in-time estimates ERstat collects from official feeds
(see `data_source`), usually every few minutes; aggregates use the median. Hourly
buckets are UTC; patterns are computed in each hospital's provincial timezone.
Readings without a numeric wait are excluded.

ERstat values are hourly medians of the nowcast, with `erstat_lower_minutes` and
`erstat_upper_minutes` giving the calibrated interval. The series begins
2026-07-01 and deliberately excludes May and June 2026, when a faulty model
promotion put 2.06% of June predictions above 20 hours against 0.00% either side.
Those months are not published in any form.

## Caveats
Published definitions and update frequency vary by source, so a published figure
should be compared within one hospital over time, or converted using
`wait_metric` first. The ERstat figure is modelled wherever `erstat_tier` starts
with `silent`, and is an estimate rather than an observation everywhere.
Neither number is a clinical measure or medical advice.
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
