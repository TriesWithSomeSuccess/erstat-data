#!/usr/bin/env bash
# Publish the current snapshot to Zenodo FROM THIS BOX.
#
# GitHub Actions runs on shared IPs that Zenodo's WAF blocks with a 403 and
# "unusual traffic from your network" — a property of GitHub's network, not of
# the request. This machine already exports the data and pushes the repo, so
# publishing from here removes that whole class of failure.
#
#   ./publish-zenodo.sh            both datasets
#   ./publish-zenodo.sh closures   just one
#   ./publish-zenodo.sh waits
set -euo pipefail
cd /opt/erstat/wait-times/erstat-data

[ -f .env.zenodo ] && set -a && . ./.env.zenodo && set +a
: "${ZENODO_TOKEN:?ZENODO_TOKEN is not set. Put it in /opt/erstat/wait-times/erstat-data/.env.zenodo}"

# The concepts everything cites. The scripts now refuse to publish anywhere else.
CLOSURES_CONCEPT=21853002
WAITS_CONCEPT=21940685

echo "Pulling the latest snapshot commit..."
git pull -q --rebase origin main

run() {
  echo
  echo "=== $1 (concept $2) ==="
  ZENODO_TOKEN="$ZENODO_TOKEN" ZENODO_CONCEPT_RECID="$2" node "scripts/$3"
}

case "${1:-all}" in
  closures) run closures   "$CLOSURES_CONCEPT" zenodo.mjs ;;
  waits)    run "wait times" "$WAITS_CONCEPT"  zenodo-waits.mjs ;;
  all)      run closures   "$CLOSURES_CONCEPT" zenodo.mjs
            run "wait times" "$WAITS_CONCEPT"  zenodo-waits.mjs ;;
  *) echo "usage: $0 [all|closures|waits]"; exit 2 ;;
esac
echo
echo "Done. Check that the concept DOI resolves to what you just published:"
echo "  https://doi.org/10.5281/zenodo.$CLOSURES_CONCEPT"
echo "  https://doi.org/10.5281/zenodo.$WAITS_CONCEPT"
