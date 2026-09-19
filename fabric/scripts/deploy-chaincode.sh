#!/usr/bin/env bash
# deploy-chaincode.sh - package, install, approve and commit the audit
# chaincode with a 2-of-4 endorsement policy. Idempotent; upgrades the
# chaincode definition sequence when an updated package is provided.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"

cd "$ROOT_DIR"

SIGNATURE_POLICY="OutOf(2, 'HROrgMSP.peer','ITOrgMSP.peer','FinanceOrgMSP.peer','AdminOrgMSP.peer')"
PACKAGE_DIR="$ROOT_DIR/chaincode-package"
mkdir -p "$PACKAGE_DIR"

log "Installing chaincode dependencies (npm)..."
(cd "$CHAINCODE_SRC" && npm install --omit=dev --no-audit --no-fund)

log "Packaging chaincode '$CHAINCODE_NAME'..."
set_org_admin_env hr
pc lifecycle chaincode package /network/chaincode-package/$CHAINCODE_NAME.tgz \
  --lang node \
  --path /chaincode \
  --label "${CHAINCODE_NAME}_${CHAINCODE_VERSION}"

for o in hr it finance admin; do
  log "Installing on $(org_dom "$o")..."
  set_org_admin_env "$o"
  if OUT="$(pc lifecycle chaincode install /network/chaincode-package/$CHAINCODE_NAME.tgz 2>&1)" \
     && echo "$OUT" | grep -q "already successfully installed"; then
    echo "$OUT" | tail -1
    log "  (already installed on $(org_msp "$o"))"
  else
    [ -n "${OUT:-}" ] && echo "$OUT" | tail -1
  fi
done

PACKAGE_ID="$(pc lifecycle chaincode queryinstalled -O json 2>/dev/null \
  | jq -r '.installed_chaincodes[] | select(.label=="'"${CHAINCODE_NAME}_${CHAINCODE_VERSION}"'") | .package_id' | head -1)"
if [ -z "$PACKAGE_ID" ]; then
  echo "ERROR: could not resolve package_id" >&2
  exit 1
fi
log "package_id=$PACKAGE_ID"

# Detect the currently committed definition sequence; if none, start at 1.
set_org_admin_env hr
CURRENT_SEQ="$(pc lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CHAINCODE_NAME" \
  -o "$ORDERER_HOST:7050" --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true 2>/dev/null \
  | sed -n 's/.*, Sequence: \([0-9][0-9]*\).*/\1/p' | head -1 || true)"
CURRENT_SEQ="${CURRENT_SEQ:-0}"
SEQUENCE=$((CURRENT_SEQ + 1))
log "Using chaincode definition sequence $SEQUENCE"

for o in hr it finance admin; do
  log "Approving chaincode definition for $(org_msp "$o")..."
  set_org_admin_env "$o"
  pc lifecycle chaincode approveformyorg \
    -o "$ORDERER_HOST:7050" \
    --ordererTLSHostnameOverride "$ORDERER_HOST" \
    --channelID "$CHANNEL" \
    --name "$CHAINCODE_NAME" \
    --version "$CHAINCODE_VERSION" \
    --package-id "$PACKAGE_ID" \
    --sequence "$SEQUENCE" \
    --signature-policy "$SIGNATURE_POLICY" \
    --cafile "$ORDERER_CA" --tls true
done

log "Commit readiness:"
set_org_admin_env hr
pc lifecycle chaincode checkcommitreadiness \
  --channelID "$CHANNEL" \
  --name "$CHAINCODE_NAME" \
  --version "$CHAINCODE_VERSION" \
  --sequence "$SEQUENCE" \
  --signature-policy "$SIGNATURE_POLICY" \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true

log "Committing chaincode to '$CHANNEL'..."
set_org_admin_env hr
pc lifecycle chaincode commit \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --channelID "$CHANNEL" \
  --name "$CHAINCODE_NAME" \
  --version "$CHAINCODE_VERSION" \
  --sequence "$SEQUENCE" \
  --signature-policy "$SIGNATURE_POLICY" \
  --cafile "$ORDERER_CA" --tls true \
  --peerAddresses peer0.hr.hrms.com:7051 --tlsRootCertFiles "$(organizations_path)/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem" \
  --peerAddresses peer0.it.hrms.com:7051 --tlsRootCertFiles "$(organizations_path)/peerOrganizations/it.hrms.com/tlsca/tlsca.it.hrms.com-cert.pem" \
  --peerAddresses peer0.finance.hrms.com:7051 --tlsRootCertFiles "$(organizations_path)/peerOrganizations/finance.hrms.com/tlsca/tlsca.finance.hrms.com-cert.pem" \
  --peerAddresses peer0.admin.hrms.com:7051 --tlsRootCertFiles "$(organizations_path)/peerOrganizations/admin.hrms.com/tlsca/tlsca.admin.hrms.com-cert.pem"

log "Verifying committed definition:"
for o in hr it finance admin; do
  set_org_admin_env "$o"
  pc lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CHAINCODE_NAME"
done