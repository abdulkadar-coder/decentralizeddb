/*
 * Chaincode entrypoint. The peer launches `npm start`, which runs
 * fabric-shim's CLI bootstrap (see package.json). The bootstrap reads this
 * module (package.json "main") and expects `module.exports.contracts`.
 */
'use strict';

const { HRMSAuditContract } = require('./lib/contract');

module.exports.contracts = [HRMSAuditContract];
module.exports.HRMSAuditContract = HRMSAuditContract;