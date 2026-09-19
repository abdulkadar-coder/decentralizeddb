#!/usr/bin/env bash
# channel.sh - create the application channel and join all four org peers.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"

cd "$ROOT_DIR"

log "Creating channel '$CHANNEL' (signed by HR admin)..."
set_org_admin_env hr
pc channel create \
  -o "$ORDERER_HOST:7050" \
  -c "$CHANNEL" \
  -f /network/channel-artifacts/channel.tx \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" \
  --tls true \
  --outputBlock "/network/channel-artifacts/$CHANNEL.block"

for o in hr it finance admin; do
  log "Joining peer0 of '$(org_dom "$o")' to the channel..."
  set_org_admin_env "$o"
  pc channel join -b "/network/channel-artifacts/$CHANNEL.block"
  log "Updating anchor peers for $(org_msp "$o")..."
  pc channel update \
    -o "$ORDERER_HOST:7050" \
    -c "$CHANNEL" \
    -f "/network/channel-artifacts/${o}-anchors.tx" \
    --ordererTLSHostnameOverride "$ORDERER_HOST" \
    --cafile "$ORDERER_CA" \
    --tls true
done

log "Channel joined by all 4 organizations."
for o in hr it finance admin; do
  set_org_admin_env "$o"
  log "  ---- $(org_msp "$o") sees channel(s):"
  pc channel list
done