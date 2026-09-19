#!/usr/bin/env bash
# network.sh up|down|status|logs - control the permissioned audit network.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"

cmd="${1:-status}"

case "$cmd" in
  up)
    log "Starting network (orderer + 4 org peers)..."
    docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms up -d
    log "Waiting for peers/orderer to be ready..."
    for i in $(seq 1 40); do
      if docker exec peer0.hr.hrms.com peer channel list >/dev/null 2>&1; then
        log "Network ready after ${i} checks."
        break
      fi
      [ "$i" -eq 40 ] && { echo "ERROR: network did not become ready" >&2; exit 1; }
      sleep 3
    done
    ;;
  down)
    log "Stopping network..."
    docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms down
    ;;
  reset)
    log "Stopping network and removing volumes/artifacts..."
    docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms down --volumes --remove-orphans
    ;;
  status)
    docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms ps
    ;;
  logs)
    docker compose -f "$ROOT_DIR/compose/docker-compose.yaml" --project-name fabric_hrms logs --tail="${2:-100}" "$3"
    ;;
  *)
    echo "usage: $0 up|down|reset|status|logs <service>" >&2
    exit 1
    ;;
esac