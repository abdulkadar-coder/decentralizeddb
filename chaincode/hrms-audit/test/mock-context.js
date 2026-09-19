/*
 * Minimal chaincode mock context for unit tests. Implements only the state
 * API surface the contract uses; NOT a real peer.
 */
'use strict';

class MockClientIdentity {
  constructor(msp, attributes = {}) {
    this.msp = msp;
    this.attributes = attributes;
  }

  getMSPID() {
    return this.msp;
  }

  getAttributeValue(name) {
    return this.attributes[name] ?? '';
  }
}

class MockStateIterator {
  constructor(entries) {
    this.entries = entries;
    this.index = 0;
  }

  async next() {
    if (this.index >= this.entries.length) {
      return { done: true, value: undefined };
    }
    const [key, value] = this.entries[this.index];
    this.index += 1;
    return { done: false, value: { key, value } };
  }

  async close() {}

  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next: () => self.next(),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
  }
}

class MockStub {
  constructor() {
    this.state = new Map();
    this.txId = `tx-${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    this.timestamp = {
      seconds: Math.floor(now / 1000),
      nanos: (now % 1000) * 1e6,
    };
  }

  async getState(key) {
    const value = this.state.get(key);
    return value ? Buffer.from(value) : Buffer.alloc(0);
  }

  async putState(key, value) {
    this.state.set(key, Buffer.from(value));
    return Buffer.from(value);
  }

  getStateByRange(startKey, endKey) {
    const keys = [...this.state.keys()]
      .filter((k) => k >= startKey && (endKey === undefined || k < endKey))
      .sort();
    return new MockStateIterator(keys.map((k) => [k, this.state.get(k)]));
  }

  getTxID() {
    return this.txId;
  }

  getTxTimestamp() {
    return { ...this.timestamp };
  }

  setTxTimestamp(seconds, nanos) {
    this.timestamp = { seconds, nanos };
  }
}

class MockContext {
  constructor({ msp = 'HROrgMSP', attributes = {} } = {}) {
    this.stub = new MockStub();
    this.clientIdentity = new MockClientIdentity(msp, attributes);
  }
}

module.exports = { MockContext, MockStub, MockClientIdentity, MockStateIterator };