#!/usr/bin/env bash
# demo.sh - demonstrate a permissioned audit transaction lifecycle:
#   1. submit a VALID audit transaction endorsed by 2 organizations
#   2. confirm commit on the network
#   3. query the resulting ledger record(s)
#   4. verify the in-contract hash chain
#   5. show rejection of an unauthorized identity
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"

cd "$ROOT_DIR"

echo "======================================================================"
echo " PERMISSIONED AUDIT NETWORK DEMO  (channel=$CHANNEL, chaincode=$CHAINCODE_NAME)"
echo "======================================================================"
docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms ps --format 'table {{.Name}}\t{{.Status}}'

step() { echo; echo "--- $1 ---"; }

# Poll querySeq until the given sequence is committed and visible. Append-only
# writes share the global 'seq' key, so a second submit issued before the first
# commits lands in the same block and fails MVCC validation - waiting for the
# previous commit guarantees serialized appends.
wait_seq() {
  local want="$1" now="" i
  for ((i = 0; i < 20; i++)); do
    now="$(pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
      -c '{"function":"querySeq","Args":[]}' 2>/dev/null | jq -r '.seq // ""')"
    [ "$now" = "$want" ] && return 0
    sleep 2
  done
  echo "ERROR: sequence did not reach $want (now=$now)" >&2
  return 1
}

# ---------------------------------------------------------------------------
step "1. Submit a VALID audit transaction (DOCUMENT_ACCESSED) endorsed by HR + Finance"
# ---------------------------------------------------------------------------
set_org_admin_env hr
INVOCATION='{"function":"submitAudit","Args":["DOCUMENT_ACCESSED","user-4f2a1c","emp-0050","{\"docId\":\"doc-9f8e3c\",\"via\":\"api\"}"]}'
pc chaincode invoke \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true \
  -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  --peerAddresses peer0.hr.hrms.com:7051  --tlsRootCertFiles "$(organizations_path)/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem" \
  --peerAddresses peer0.finance.hrms.com:7051 --tlsRootCertFiles "$(organizations_path)/peerOrganizations/finance.hrms.com/tlsca/tlsca.finance.hrms.com-cert.pem" \
  -c "$INVOCATION" 2>&1 | tail -3
wait_seq 1
[ $? -eq 0 ] || exit 1

# ---------------------------------------------------------------------------
step "2. Submit two more VALID transactions (EMPLOYEE_CREATED, ACCESS_REVOKED) endorsed by IT + Admin"
# ---------------------------------------------------------------------------
set_org_admin_env it
INVOCATION='{"function":"submitAudit","Args":["EMPLOYEE_CREATED","user-7810b2","emp-0091","{\"role\":\"engineer\"}"]}'
pc chaincode invoke \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true \
  -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  --peerAddresses peer0.it.hrms.com:7051     --tlsRootCertFiles "$(organizations_path)/peerOrganizations/it.hrms.com/tlsca/tlsca.it.hrms.com-cert.pem" \
  --peerAddresses peer0.admin.hrms.com:7051  --tlsRootCertFiles "$(organizations_path)/peerOrganizations/admin.hrms.com/tlsca/tlsca.admin.hrms.com-cert.pem" \
  -c "$INVOCATION" 2>&1 | tail -3
wait_seq 2
[ $? -eq 0 ] || exit 1

set_org_admin_env admin
INVOCATION='{"function":"submitAudit","Args":["ACCESS_REVOKED","user-4f2a1c","doc-9f8e3c","{\"reason\":\"separation\"}"]}'
pc chaincode invoke \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true \
  -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  --peerAddresses peer0.admin.hrms.com:7051 --peerAddresses peer0.finance.hrms.com:7051 \
  --tlsRootCertFiles "$(organizations_path)/peerOrganizations/admin.hrms.com/tlsca/tlsca.admin.hrms.com-cert.pem" \
--tlsRootCertFiles "$(organizations_path)/peerOrganizations/finance.hrms.com/tlsca/tlsca.finance.hrms.com-cert.pem" \
  -c "$INVOCATION" 2>&1 | tail -3
wait_seq 3
[ $? -eq 0 ] || exit 1

# ---------------------------------------------------------------------------
step "3. Confirm the ledger state (seq + full records) via an org peer"
# ---------------------------------------------------------------------------
set_org_admin_env hr
echo ">> querySeq:"
pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  -c '{"function":"querySeq","Args":[]}' 2>/dev/null | jq -r .

echo ">> queryAll:"
pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  -c '{"function":"queryAll","Args":["1","10"]}' 2>/dev/null | jq -c '.[]'

# ---------------------------------------------------------------------------
step "4. Query audit history for a subject (queryBySubject) and verify the hash chain"
# ---------------------------------------------------------------------------
echo ">> queryBySubject(emp-0050):"
pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  -c '{"function":"queryBySubject","Args":["emp-0050"]}' 2>/dev/null | jq -c '.[]'
echo ">> verifyChain (must be intact=true):"
pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  -c '{"function":"verifyChain","Args":[]}' 2>/dev/null | jq -c .

# ---------------------------------------------------------------------------
step "5. Rejection of an UNauthorized identity (OrdererMSP admin is not a channel org)"
# ---------------------------------------------------------------------------
dom="$DOMAIN_BASE"
export CORE_PEER_LOCALMSPID="OrdererMSP"
export CORE_PEER_ADDRESS="peer0.hr.hrms.com:7051"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE="$(organizations_path)/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem"
export CORE_PEER_MSPCONFIGPATH="$(organizations_path)/ordererOrganizations/$dom/users/Admin@$dom/msp"
INVOCATION='{"function":"submitAudit","Args":["ROLE_CHANGED","evil","emp-0050","{\"oops\":true}"]}'
echo ">> attempting to submit as OrdererMSP admin (must fail):"
OUT="$(pc chaincode invoke \
  -o "$ORDERER_HOST:7050" \
  --ordererTLSHostnameOverride "$ORDERER_HOST" \
  --cafile "$ORDERER_CA" --tls true \
  -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  --peerAddresses peer0.hr.hrms.com:7051 \
  --tlsRootCertFiles "$(organizations_path)/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem" \
  -c "$INVOCATION" 2>&1 | tail -2)"
echo "$OUT" | sed 's/\x1b\[[0-9;]*m//g'
if echo "$OUT" | grep -qiE "error|FORBIDDEN|forbidden"; then
  echo ">> RESULT: transaction REJECTED (as expected)."
else
  echo ">> RESULT: NOT rejected - review identity checks! (seq must not have advanced)"
fi
set_org_admin_env hr
echo ">> ledger state after the rejected attempt (must still be seq=3):"
pc chaincode query -C "$CHANNEL" -n "$CHAINCODE_NAME" \
  -c '{"function":"querySeq","Args":[]}' 2>/dev/null | jq -r .

echo
echo "======================================================================"
echo " DEMO COMPLETE - network confirmed the VALID transactions and rejected"
echo " the UNAUTHORIZED one. Queries reflect the committed ledger state."
echo "======================================================================"