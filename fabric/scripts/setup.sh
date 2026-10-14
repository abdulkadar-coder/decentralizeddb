#!/usr/bin/env bash
# setup.sh - generate all crypto material, genesis block and channel artifacts.
# Idempotent: wipes and regenerates the generated directories.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"

cd "$ROOT_DIR"

rm -rf organizations system-genesis-block channel-artifacts
mkdir -p organizations system-genesis-block channel-artifacts

log "Generating crypto material (cryptogen)..."
"$(tool_path cryptogen)" generate --config=./crypto-config.yaml --output=./organizations

log "Generating orderer genesis block..."
"$(tool_path configtxgen)" -profile HRMSAuditGenesis -channelID syschannel -asOrg OrdererMSP \
  -outputBlock ./system-genesis-block/genesis.block

log "Generating channel creation transaction..."
"$(tool_path configtxgen)" -profile HRMSAuditChannel -channelID "$CHANNEL" \
  -outputCreateChannelTx ./channel-artifacts/channel.tx

log "Generating anchor peer update transactions..."
for o in hr it finance admin; do
  msp="$(org_msp "$o")"
  "$(tool_path configtxgen)" -profile HRMSAuditChannel -channelID "$CHANNEL" -asOrg "$msp" \
    -outputAnchorPeersUpdate "./channel-artifacts/${o}-anchors.tx"
done

log "Done. Generated:"
du -sh organizations system-genesis-block channel-artifacts
