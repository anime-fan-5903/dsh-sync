import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SyncEngine } from '../src/engine.js';
import { encodeEnvelope } from '../src/crypto.js';
import { hashes, nativeId } from '../src/model.js';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function prompt(content) {
  const origin = { root: 'dsh', path: 'prompts/example.md' };
  return { id: nativeId(origin), origin, type: 'prompt', name: '.dsh/prompts/example.md', content };
}
function fixture({ local = [], remote = [], base = [] } = {}) {
  const vaultId = randomUUID();
  let state = { format: 1, vaultId, encrypted: false, keyring: null, assets: local, base: hashes(base), backups: [],
    settings: { enabled: true }, lastSync: '2026-11-09T12:00:00Z' };
  const store = {
    queue: Promise.resolve(),
    async read() { return structuredClone(state); },
    async write(value) { state = structuredClone(value); },
    exclusive(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; },
  };
  const snapshot = encodeEnvelope({ vaultId, assets: remote });
  const cloud = { revision: snapshot.revision, etag: 'example-etag', envelope: snapshot };
  const backend = {
    async read() { return structuredClone(cloud); },
    async publish(_expected, envelope) { Object.assign(cloud, { envelope, revision: envelope.revision }); },
  };
  const events = [];
  const engine = new SyncEngine({ store, backend, onChange: () => events.push({ phase: engine.phase, error: engine.error }) });
  return { engine, store, backend, events, cloud };
}

for (const previous of ['synced', 'pending', 'idle', 'error', 'locked', 'conflict']) {
  test(`an unchanged check preserves ${previous} until its result is known and never reports a transfer`, async () => {
    const { engine, backend, events } = fixture();
    const entered = deferred(), release = deferred(), read = backend.read;
    engine.phase = previous;
    const oldError = previous === 'error' ? { code: 'network-failed', message: 'Previous attempt failed.' } : null;
    engine.error = oldError;
    backend.read = async () => { entered.resolve(); await release.promise; return read(); };
    const check = engine.synchronize(); await entered.promise;
    assert.equal(engine.phase, previous); assert.equal(engine.error, oldError); assert.equal(events.length, 0);
    release.resolve(); await check;
    assert.equal(engine.phase, 'synced'); assert.equal(engine.error, null);
    assert.ok(!events.some(event => event.phase === 'syncing'));
  });
}

test('local changes show syncing only when publication begins', async () => {
  const { engine, backend, events } = fixture({ local: [prompt('Local change')] });
  engine.phase = 'pending';
  const entered = deferred(), release = deferred(), publish = backend.publish;
  backend.publish = async (...args) => {
    assert.equal(engine.phase, 'syncing'); entered.resolve(); await release.promise; return publish(...args);
  };
  const transfer = engine.synchronize(); await entered.promise;
  assert.equal(engine.phase, 'syncing'); assert.equal(events.filter(event => event.phase === 'syncing').length, 1);
  release.resolve(); await transfer; assert.equal(engine.phase, 'synced');
});

test('a new snapshot download signals syncing before its body has arrived', async () => {
  const { engine, backend } = fixture({ remote: [prompt('Remote change')] });
  engine.phase = 'synced';
  const entered = deferred(), release = deferred(), read = backend.read;
  backend.read = async ({ onDownload }) => { onDownload(); entered.resolve(); await release.promise; return read(); };
  const transfer = engine.synchronize(); await entered.promise;
  assert.equal(engine.phase, 'syncing');
  release.resolve(); await transfer;
  assert.equal(engine.phase, 'synced'); assert.equal((await engine.store.read()).assets[0].content, 'Remote change');
});

test('applying a previously fetched remote change reports syncing before native writes', async () => {
  const { engine, backend, store } = fixture({ remote: [prompt('Remote change')] });
  engine.phase = 'synced';
  const entered = deferred(), release = deferred();
  let publications = 0;
  backend.publish = async () => { publications++; };
  engine.native = {
    async prepare(state, remote) { return { base: state.base, local: state.assets, remote, passthrough: [] }; },
    async apply() { assert.equal(engine.phase, 'syncing'); entered.resolve(); await release.promise; },
    async committed() {},
  };
  const transfer = engine.synchronize(); await entered.promise;
  assert.equal(publications, 0); assert.equal(engine.phase, 'syncing');
  release.resolve(); await transfer; assert.equal((await store.read()).assets[0].content, 'Remote change');
});

test('metadata failures report error directly without a transient syncing state', async () => {
  const { engine, backend, events } = fixture(); engine.phase = 'synced';
  backend.read = async () => { throw Object.assign(new Error('Network failed.'), { code: 'network-failed' }); };
  await assert.rejects(engine.synchronize(), { code: 'network-failed' });
  assert.equal(engine.phase, 'error'); assert.equal(engine.error.code, 'network-failed');
  assert.ok(!events.some(event => event.phase === 'syncing'));
});

test('a failed content transfer leaves error rather than retaining syncing', async () => {
  const { engine, backend } = fixture();
  backend.read = async ({ onDownload }) => { onDownload(); throw Object.assign(new Error('Download failed.'), { code: 'network-failed' }); };
  await assert.rejects(engine.synchronize(), { code: 'network-failed' });
  assert.equal(engine.phase, 'error'); assert.equal(engine.error.code, 'network-failed');
});

test('cached conflict checks stay in conflict until version choices authorize a transfer', async () => {
  const original = prompt('Original');
  const { engine, events } = fixture({ base: [original], local: [prompt('Local change')], remote: [prompt('Remote change')] });
  engine.phase = 'conflict';
  const result = await engine.synchronize();
  assert.equal(result.conflicts.length, 1); assert.equal(engine.phase, 'conflict');
  assert.ok(!events.some(event => event.phase === 'syncing'));
  const conflict = result.conflicts[0];
  await engine.synchronize({ [conflict.id]: { side: 'local', localHash: conflict.localHash, remoteHash: conflict.remoteHash } });
  assert.ok(events.some(event => event.phase === 'syncing')); assert.equal(engine.phase, 'synced');
});

test('cached locked-vault checks report locked without announcing a transfer', async () => {
  const { engine, store, backend, events } = fixture();
  const state = await store.read(); state.encrypted = true; state.keyring = { id: 'example-keyring' }; await store.write(state);
  const read = backend.read;
  backend.read = async () => { const remote = await read(); remote.envelope.mode = 'encrypted'; remote.envelope.keyring = state.keyring; return remote; };
  await assert.rejects(engine.synchronize(), { code: 'locked' });
  assert.equal(engine.phase, 'locked'); assert.ok(!events.some(event => event.phase === 'syncing'));
});
