# HRMS permissioned audit network

Hyperledger Fabric **v2.5** network for the ZeroTrust HRMS audit ledger: 4
organizations (HR, IT, Finance, Admin), 1 orderer, channel `hrmsaudit`,
chaincode `hrmsauditcc`, endorsement **2-of-4**.

```
orderer.hrms.com      OrdererMSP        (Raft, single node - dev only)
peer0.hr.hrms.com     HROrgMSP          7051 (host: 7051)
peer0.it.hrms.com     ITOrgMSP          7051 (host: 7151)
peer0.finance.hrms.com FinanceOrgMSP     7051 (host: 7251)
peer0.admin.hrms.com AdminOrgMSP       7051 (host: 7351)
```

Compose project `fabric_hrms`; all peers use docker-network DNS so TLS SANs,
gossip and service discovery line up (no /etc/hosts hacks).

## Requirements

- Docker + Compose **inside WSL2** (the repo may live on a Windows mount; the
  scripts run inside WSL). The backend on Windows reaches `peer0.hr.hrms.com`
  through the published `localhost:7051` + a `checkServerIdentity` override.
- `jq` in the runner.
- Fabric tools (`cryptogen`, `configtxgen`, `peer`): `fabric/scripts/bootstrap-tools.sh`.

## Run the network

```bash
# tools (one-time; downloads v2.5.15 tools into $HOME/hrms-fabric/bin)
fabric/scripts/bootstrap-tools.sh

# full cycle
fabric/scripts/network.sh reset
fabric/scripts/network.sh up
fabric/scripts/channel.sh              # channel 'hrmsaudit' + join 4 peers
fabric/scripts/deploy-chaincode.sh     # package/install/approve/commit -> seq, 2-of-4 policy
fabric/scripts/demo.sh                 # 3 valid txs + queries + verifyChain + rejection demo
```

Other: `network.sh down`, `network.sh reset`, `network.sh status`,
`network.sh logs <service>`.

## Connecting the backend

```
LEDGER_BACKEND=fabric
FABRIC_MSP_CONFIG_DIR=fabric/organizations/peerOrganizations/hr.hrms.com/users/Admin@hr.hrms.com/msp
FABRIC_TLS_CA=fabric/organizations/peerOrganizations/hr.hrms.com/tlsca/tlsca.hr.hrms.com-cert.pem
FABRIC_PEER_ENDPOINT=localhost:7051
FABRIC_TLS_HOST_OVERRIDE=peer0.hr.hrms.com
FABRIC_CHANNEL=hrmsaudit
FABRIC_CHAINCODE=hrmsauditcc
FABRIC_ENDORSE_ORGS=HROrgMSP,FinanceOrgMSP
```

Then:

```bash
npm run fabric:probe        # read-only connectivity + ledger integrity check
# and optionally:
FABRIC_PROBE_SUBMIT=1 npm run fabric:probe   # same as above + commits one test record
```

## Governance / operational notes

- **Upgrades = new sequence.** The lifecycle endorsement policy is
  `MAJORITY`; re-approving the *same* sequence with a new package fails with
  `ENDORSEMENT_POLICY_FAILURE`, so `deploy-chaincode.sh` auto-detects the
  committed sequence and uses `current + 1`.
- `approveformyorg` is called **per organization without orderer** — adding
  peer addresses there is rejected by the channelless `Admins` ACL.
- **MVCC serialization:** every append writes the shared `seq` key. Two
  submissions issued back-to-back land in the same block and the second fails
  MVCC_READ_CONFLICT. The demo serializes with `wait_seq()` (poll `querySeq`
  after each submit). Treat Fabric's "invoke successful!" as *proposal* success
  and confirm commit via `querySeq`/`querycommitted`.
- Hash-chain integrity is verified on-chain with `verifyChain`.

## Reset / rebuild

`network.sh reset` drops volumes (deletes the ledger) and containers; follow
with `up`, `channel.sh`, `deploy-chaincode.sh` for a pristine network.

## Security disclaimer

Dev-only `cryptogen` key material — never for production. Single orderer. See
`docs/PHASE2_NETWORK_DESIGN.md` §7 for the honest limitation list.