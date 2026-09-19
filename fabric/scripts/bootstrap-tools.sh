#!/usr/bin/env bash
# bootstrap-tools.sh - install the Fabric dev tools this repo needs into
# $FABRIC_TOOLS_DIR (default "$HOME/hrms-fabric"):
#   * cryptogen / configtxgen / peer / orderer / osnadmin / fabric-ca-client
#     (from the Hyperledger Fabric v2.5.15 release tarball for this OS/arch)
#   * the Docker images the local network + containerized peer CLI rely on
#
# Requires: curl + tar + docker. Run from anywhere; nothing else needed.
set -euo pipefail
FABRIC_VERSION="${FABRIC_VERSION:-2.5.15}"
FABRIC_TOOLS_DIR="${FABRIC_TOOLS_DIR:-$HOME/hrms-fabric}"
IMG_TAG="${FABRIC_VERSION%.${FABRIC_VERSION#*.}*}"
BIN_DIR="$FABRIC_TOOLS_DIR/bin"
mkdir -p "$BIN_DIR"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) OS=linux;  ARCH=amd64 ;;
  Linux-aarch64) OS=linux; ARCH=arm64 ;;
  Darwin-x86_64) OS=darwin; ARCH=amd64 ;;
  Darwin-arm64) OS=darwin; ARCH=arm64 ;;
  *) echo "ERROR: unsupported platform $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

log() { printf '[bootstrap-tools] %s\n' "$*"; }

if [ ! -x "$BIN_DIR/cryptogen" ] || [ ! -x "$BIN_DIR/configtxgen" ] \
   || [ ! -x "$BIN_DIR/peer" ]; then
  log "Downloading Fabric ${FABRIC_VERSION} tools (${OS}-${ARCH})..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  TARBALL="hyperledger-fabric-${OS}-${ARCH}-${FABRIC_VERSION}.tar.gz"
  curl -fsSL "https://github.com/hyperledger/fabric/releases/download/v${FABRIC_VERSION}/${TARBALL}" -o "$TMP/$TARBALL"
  log "Extracting to $BIN_DIR ..."
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  find "$TMP/bin" -maxdepth 1 -type f -exec cp -v {} "$BIN_DIR/" \;
else
  log "Binaries already present in $BIN_DIR (delete to re-bootstrap)."
fi

log "Pulling Fabric Docker images (peer/orderer/ccenv/baseos @ ${IMG_TAG}, nodeenv, fabric-tools)..."
docker pull "hyperledger/fabric-peer:${IMG_TAG}"
docker pull "hyperledger/fabric-orderer:${IMG_TAG}"
docker pull "hyperledger/fabric-ccenv:${IMG_TAG}"
docker pull "hyperledger/fabric-baseos:${IMG_TAG}"
docker pull hyperledger/fabric-nodeenv:2.5
docker pull hyperledger/fabric-tools:2.5

log "Done. Binaries: $BIN_DIR"
log "For runtimes only (no tool re-download): FABRIC_TOOLS_DIR + CUSTOM_FABRIC_BIN=$BIN_DIR"