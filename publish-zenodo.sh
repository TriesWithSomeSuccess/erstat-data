#!/usr/bin/env bash
# Publish the current snapshots to Zenodo FROM THIS BOX.
#
# GitHub Actions runs on shared IPs that Zenodo WAF blocks with a 403 and
# "unusual traffic from your network" -- a property of GitHub network, not of the
# request, so no amount of retrying there helps. This machine already exports the
# data and pushes the repo, so publishing from here removes that whole class of
# failure.
#
#   ./publish-zenodo.sh                 closures + wait times (what cron runs)
#   ./publish-zenodo.sh closures
#   ./publish-zenodo.sh waits
#   ./publish-zenodo.sh accuracy        needs ACCURACY_CONCEPT set below
#   ./publish-zenodo.sh accuracy --first-version
#                                       creates the accuracy record for the
#                                       first and only time; then paste the
#                                       concept recid it prints into
#                                       ACCURACY_CONCEPT below.
set -euo pipefail
cd /opt/erstat/wait-times/erstat-data

[ -f .env.zenodo ] && set -a && . ./.env.zenodo && set +a
: "${ZENODO_TOKEN:?ZENODO_TOKEN is not set. Put it in /opt/erstat/wait-times/erstat-data/.env.zenodo}"

# The concepts everything cites. The scripts refuse to publish anywhere else.
CLOSURES_CONCEPT=21853002
WAITS_CONCEPT=21940685
# Empty until the accuracy dataset has been published once. See --first-version.
ACCURACY_CONCEPT=""

echo "Pulling the latest snapshot commit..."
git pull -q --rebase origin main

# Refuse to publish stale inputs. The closures snapshot is pulled and committed by
# a GitHub Action at 09:17 UTC; this runs at 10:30. If that job failed or ran late
# a plain pull leaves last month in place, and we would republish it stamped with
# this month version -- wrong data, silently, which is the failure mode this whole
# cleanup exists to stop. A published Zenodo version cannot be withdrawn, so the
# check goes before the upload, not after.
THIS_MONTH=$(date -u +%Y-%m)
check_fresh() {
  local label="$1" file="$2" col="$3" newest
  if [ ! -f "$file" ]; then
    echo "MISSING: $file ($label). Refusing to publish." >&2
    return 1
  fi
  newest=$(tail -n +2 "$file" | cut -d, -f"$col" | sort | tail -1 | cut -c1-7)
  if [ "$newest" != "$THIS_MONTH" ]; then
    echo "STALE: $label newest row is $newest, expected $THIS_MONTH ($file)." >&2
    echo "Refusing to publish: a Zenodo version cannot be withdrawn once out." >&2
    echo "Check whether the snapshot job ran, then re-run this script." >&2
    return 1
  fi
  echo "  $label is current ($newest)"
}

run() {
  echo
  echo "=== $1 (concept ${2:-NEW RECORD}) ==="
  ZENODO_TOKEN="$ZENODO_TOKEN" ZENODO_CONCEPT_RECID="$2" node "scripts/$3"
}

check_closures() { check_fresh "closures snapshot" latest/closures.csv 1; }
# The hourly export is gzipped, so this reads the last hour out of the stream
# rather than loading 1.7M rows; the file is sorted by hospital then hour, so
# the newest hour is not the last line and has to be scanned for.
check_waits() {
  local newest
  newest=$(zcat wait-times/latest/wait_times_hourly.csv.gz | tail -n +2 | cut -d, -f2 | sort | tail -1 | cut -c1-7)
  if [ "$newest" != "$THIS_MONTH" ]; then
    echo "STALE: wait-times export newest hour is $newest, expected $THIS_MONTH." >&2
    echo "Refusing to publish. Check the Timescale export (09:20 UTC cron)." >&2
    return 1
  fi
  echo "  wait-times export is current ($newest)"
}

case "${1:-all}" in
  closures) check_closures; run closures     "$CLOSURES_CONCEPT" zenodo.mjs ;;
  waits)    check_waits;    run "wait times" "$WAITS_CONCEPT"    zenodo-waits.mjs ;;
  all)      check_closures; check_waits
            run closures     "$CLOSURES_CONCEPT" zenodo.mjs
            run "wait times" "$WAITS_CONCEPT"    zenodo-waits.mjs ;;
  accuracy)
    if [ "${2:-}" = "--first-version" ]; then
      if [ -n "$ACCURACY_CONCEPT" ]; then
        echo "ACCURACY_CONCEPT is already set to $ACCURACY_CONCEPT." >&2
        echo "Creating another record would fork the DOI lineage, which is the bug this script exists to prevent." >&2
        exit 1
      fi
      echo "Creating the FIRST accuracy record. Paste the concept recid it prints into ACCURACY_CONCEPT in this script."
      run "forecast accuracy (first version)" "" zenodo-accuracy.mjs
    else
      : "${ACCURACY_CONCEPT:?The accuracy dataset has never been published. Run: $0 accuracy --first-version}"
      run "forecast accuracy" "$ACCURACY_CONCEPT" zenodo-accuracy.mjs
    fi ;;
  *) echo "usage: $0 [all|closures|waits|accuracy [--first-version]]"; exit 2 ;;
esac

echo
echo "Done. Check that each concept DOI resolves to what you just published:"
echo "  https://doi.org/10.5281/zenodo.$CLOSURES_CONCEPT"
echo "  https://doi.org/10.5281/zenodo.$WAITS_CONCEPT"
