# Phase 2 Report — Hyperledger Fabric permissioned audit network

Environment: Docker daemon inside WSL2 (Debian/kali), repo on Windows OneDrive,
Node backend on Windows reaching the network via published `localhost` ports.

## Deliverables

1. **Real 4-org permissioned Fabric v2.5 network** — Docker Compose
   (`fabric/compose/docker-compose.yaml`), orderer + peers for HR/IT/Finance/
   Admin, TLS everywhere.
2. **Audit chaincode** `hrmsauditcc` (fabric-contract-api) deployed at
   **sequence 1** with a **2-of-4 endorsement policy**
   (`OutOf(2, HROrgMSP, ITOrgMSP, FinanceOrgMSP, AdminOrgMSP)`).
3. **Scripts** (`fabric/scripts/`): `setup.sh`, `network.sh up|down|reset`,
   `channel.sh`, `deploy-chaincode.sh`, `demo.sh`, `bootstrap-tools.sh`;
   all `bash -n` clean.
4. **Backend Fabric Gateway adapter** (`src/ledger/fabric.ts` + `types.ts`)
   gated by `LEDGER_BACKEND=fabric|off` — default `off` keeps Phase 1 behavior.
5. **`/api/audit/network`** (ADMIN/MANAGER) exposing connection + ledger
   integrity + records from the real network.
6. **Test sweep**: backend `npm run check` green; chaincode unit tests 12/12.

## Commands that were executed (live, no fabrication)

```bash
# one-time host tool bootstrap (WSL):
fabric/scripts/bootstrap-tools.sh            # downloads v2.5.15 tools to $HOME/hrms-fabric/bin

# full clean cycle (each verified):
fabric/scripts/network.sh reset              # down --volumes --remove-orphans
fabric/scripts/network.sh up                 # start 5 containers, wait ready
fabric/scripts/channel.sh                    # create channel 'hrmsaudit', join 4 peers
fabric/scripts/deploy-chaincode.sh           # package+install(4)+approve(4)+commit(4) -> seq 1
fabric/scripts/demo.sh                       # 3 valid txs, queries, verifyChain, rejection
```

The final clean run produced the transcript summarized below (exact hashes from
that run; commit reported `VALID` at all four HR/IT/Finance/Admin peers with all
four approvals true).

### Deployment

```
Committed chaincode definition for chaincode 'hrmsauditcc' on channel 'hrmsaudit':
Version: 1.0, Sequence: 1, Approvals: [AdminOrgMSP: true, FinanceOrgMSP: true,
HROrgMSP: true, ITOrgMSP: true]
committed with status (VALID) at peer0.hr/it/finance/admin.hrms.com:7051
```

### Demo results

| # | Action | Endorse (2-of-4) | Result |
| --- | --- | --- | --- |
| 1 | `DOCUMENT_ACCESSED user-4f2a1c emp-0050` | HR + Finance | seq **1**, `hash cd927a84…` (`prevHash` = 64 zeros) |
| 2 | `EMPLOYEE_CREATED user-7810b2 emp-0091` | IT + Admin | seq **2**, `prevHash 4b05ec14…` |
| 3 | `ACCESS_REVOKED user-4f2a1c doc-9f8e3c` | Admin + Finance | seq **3**, `prevHash 56964b03…` |
| 4 | `querySeq/queryAll/queryBySubject` | org peer | all 3 records returned; `verifyChain → {"seq":3,"intact":true,"issues":[]}` |
| 5 | Unauthorized submit as **OrdererMSP** admin | none | **REJECTED** — `Failed evaluating policy … /Channel/Application/Writers … 0 sub-policies were satisfied`; `querySeq` after the attempt still returns **seq 3** |

Trailing-hash link (leading bytes, records 1→2): `…hash cd927a84` →
`next.prevHash 4b05ec14`  (recomputed by `verifyChain`, intact=true).

### Backend live checks (Windows → WSL network)

`$env:LEDGER_BACKEND='fabric'; npm run fabric:probe` →

```
connected: true, endpoint: localhost:7051, mspId: HROrgMSP,
seq: 3, records: 3, valid: true, issues: [],
lastRecord: { seq:3, eventType:ACCESS_REVOKED, creatorMsp:AdminOrgMSP, … }
```

Write path verified once with `FABRIC_PROBE_SUBMIT=1`: `submitAudit` committed
record **seq 4** (`committed: true`) and the follow-up query re-read it — the
network reset after that test restored the canonical 3-record ledger above.

## Automated verification

```bash
cd chaincode/hrms-audit && npm test      # 12 passed / 0 failed  (fabric-mock)
cd ../../ && npm run check               # tsc: clean · eslint: clean · vitest: 61 passed, 3 skipped (MinIO gated)
```

Backend tests added for Phase 2 (`test/ledger.test.ts`, 7 cases): submittable
events forwarded before local append; non-submittable events stay local;
`LEDGER_BACKEND=off` behaves like Phase 1; network failure → `LEDGER_FAILURE`
(503) with **no** local append (network is authoritative); `networkBridge`
exposure; event-type allow-list membership; config parsing incl.
`LEDGER_BACKEND=fabric`.

## Judgment checklist

- [x] Real Hyperledger Fabric network running via Docker (not simulated)
- [x] 4 organizations + orderer, TLS, real identities
- [x] Chaincode deployed with 2-of-4 endorsement; unauthorized submission rejected
- [x] Backend writes/reads the actual network through the Fabric Gateway SDK
- [x] Hash-chain integrity proved on-chain (`verifyChain`)
- [x] Honest docs: `docs/PHASE2_NETWORK_DESIGN.md`, incl. limitations
      (single orderer, dev keys, permissioned not public)

## Known limitations (restated from design doc §7)

- Single Raft orderer (ordering SPOF; no BFT).
- One peer per org (org-level dissent impossible to observe).
- cryptogen dev-only key material in `fabric/organizations/`.
- Permissioned network: "decentralized" = no single org controls the history.