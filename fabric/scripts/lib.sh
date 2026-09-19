#!/usr/bin/env bash
# lib.sh - shared environment and helpers for the HR audit Fabric network.
#
# Peer CLI commands run inside a throwaway container attached to the
# fabric_hrms docker network, so peer/orderer/TLS hostnames resolve via
# Docker DNS with matching certificates (no /etc/hosts hacks required).

# NOTE: no `-e` here; scripts source this file AFTER setting their own
# strict-mode flags (demo.sh deliberately runs without errexit so it can
# demonstrate a REJECTED transaction without aborting).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Host-side tool lookup (cryptogen/configtxgen).
# ---------------------------------------------------------------------------
tool_path() {
  local name="$1"
  if [ -n "${CUSTOM_FABRIC_BIN:-}" ] && [ -x "$CUSTOM_FABRIC_BIN/$name" ]; then
    printf '%s' "$CUSTOM_FABRIC_BIN/$name"
    return
  fi
  if [ -x "$ROOT_DIR/bin/$name" ]; then
    printf '%s' "$ROOT_DIR/bin/$name"
    return
  fi
  if [ -n "${HOME:-}" ] && [ -x "$HOME/hrms-fabric/bin/$name" ]; then
    printf '%s' "$HOME/hrms-fabric/bin/$name"
    return
  fi
  command -v "$name" || { echo "ERROR: $name not found (run scripts/bootstrap-tools.sh)" >&2; exit 1; }
}

export PATH="$ROOT_DIR/bin:$PATH"
CRYPTOGEN="$(tool_path cryptogen)"
CONFIGTXGEN="$(tool_path configtxgen)"

# ---------------------------------------------------------------------------
# Fabric peer CLI inside a container on the network.
# ---------------------------------------------------------------------------
PEER_IMG="${PEER_IMG:-hyperledger/fabric-tools:2.5}"
NETWORK_NAME="fabric_hrms"

pc() { # peer-cli wrapper: docker run with org context + repo mounted
  local envs=(CORE_PEER_LOCALMSPID CORE_PEER_ADDRESS CORE_PEER_TLS_ENABLED \
              CORE_PEER_TLS_ROOTCERT_FILE CORE_PEER_MSPCONFIGPATH)
  local envarg=()
  for e in "${envs[@]}"; do
    if [ -n "${!e:-}" ]; then envarg+=("-e" "$e"); fi
  done
  docker run --rm --network "$NETWORK_NAME" "${envarg[@]}" \
    -v "$ROOT_DIR:/network" \
    -v "$CHAINCODE_SRC:/chaincode" \
    "$PEER_IMG" peer "$@"
}

CHANNEL="hrmsaudit"
CHAINCODE_NAME="hrmsauditcc"
CHAINCODE_VERSION="1.0"
CHAINCODE_SRC="$ROOT_DIR/../chaincode/hrms-audit"

DOMAIN_BASE="hrms.com"
ORDERER_HOST="orderer.$DOMAIN_BASE"

# ---------------------------------------------------------------------------
# Organization context: hr | it | finance | admin
# ---------------------------------------------------------------------------
org() {
  case "$1" in
    hr)      echo "peer0.hr.$DOMAIN_BASE|HROrgMSP|hr.$DOMAIN_BASE" ;;
    it)      echo "peer0.it.$DOMAIN_BASE|ITOrgMSP|it.$DOMAIN_BASE" ;;
    finance) echo "peer0.finance.$DOMAIN_BASE|FinanceOrgMSP|finance.$DOMAIN_BASE" ;;
    admin)   echo "peer0.admin.$DOMAIN_BASE|AdminOrgMSP|admin.$DOMAIN_BASE" ;;
    *) echo "ERROR: unknown org $1" >&2; exit 1 ;;
  esac
}

org_peer() { IFS='|' read -r P M D <<< "$(org "$1")"; echo "$P"; }
org_msp()  { IFS='|' read -r P M D <<< "$(org "$1")"; echo "$M"; }
org_dom()  { IFS='|' read -r P M D <<< "$(org "$1")"; echo "$D"; }

# Paths are container paths inside the peer CLI container (/network mount).
organizations_path() { echo "/network/organizations"; }

orderer_tls_ca() {
  echo "$(organizations_path)/ordererOrganizations/$DOMAIN_BASE/tlsca/tlsca.$DOMAIN_BASE-cert.pem"
}

ORDERER_CA="$(orderer_tls_ca)"

set_org_admin_env() {
  local o="$1"
  local dom; dom="$(org_dom "$o")"
  local msp; msp="$(org_msp "$o")"
  local peer; peer="$(org_peer "$o")"
  export CORE_PEER_LOCALMSPID="$msp"
  export CORE_PEER_ADDRESS="$peer:7051"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_TLS_ROOTCERT_FILE="$(organizations_path)/peerOrganizations/$dom/tlsca/tlsca.$dom-cert.pem"
  export CORE_PEER_MSPCONFIGPATH="$(organizations_path)/peerOrganizations/$dom/users/Admin@$dom/msp"
}

log() { printf '[hrms-fabric] %s\n' "$*"; }