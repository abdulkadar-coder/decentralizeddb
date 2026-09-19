// Prints the audit chain with full validation status. Run after
// `node scripts/chain-demo.mjs` to show the tamper-detection result live.
//   npx tsx scripts/chain-verify.ts
import { DatabaseSync } from 'node:sqlite';
import { SqliteChainStore, validateChain } from '../src/blockchain/blockchain.js';

const db = new DatabaseSync('data/hrms.db', { readOnly: true });
const store = new SqliteChainStore(db as never);
const blocks = await store.all();
const result = validateChain(blocks);

console.log(`chain length : ${result.length}`);
console.log(`validation   : ${result.valid ? 'VALID' : 'INVALID'}`);
for (const issue of result.issues) {
  console.log(`  [height ${issue.height}] ${issue.reason}`);
}
for (const block of blocks) {
  console.log(
    `  #${block.height}  ${block.tx.type.padEnd(20)} prev=${block.prevHash.slice(0, 10)}… hash=${block.hash.slice(0, 10)}…`,
  );
}
db.close();

if (!result.valid) {
  console.log('\nThe chain was tampered with — the audit page shows this as INVALID.');
  process.exitCode = 2;
}