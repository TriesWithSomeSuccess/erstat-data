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

run() {
  echo
  echo "=== $1 (concept ${2:-NEW RECORD}) ==="
  ZENODO_TOKEN="$ZENODO_TOKEN" ZENODO_CONCEPT_RECID="$2" node "scripts/$3"
}

case "${1:-all}" in
  closures) run closures     "$CLOSURES_CONCEPT" zenodo.mjs ;;
  waits)    run "wait times" "$WAITS_CONCEPT"    zenodo-waits.mjs ;;
  all)      run closures     "$CLOSURES_CONCEPT" zenodo.mjs
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
