import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SyncTargets, configOps, modelOps } from '../src/sync-targets.js';
import { NativeTracking } from '../src/tracking.js';
import { LocalStore } from '../src/local-store.js';
import { SyncEngine } from '../src/engine.js';
import { configAsset } from '../src/portable-config.js';
import { hash } from '../src/model.js';
import { encodeEnvelope, decodeEnvelope, createKeyring } from '../src/crypto.js';

function settingsFixture(rows = []) {
  const calls = [];
  return { rows: structuredClone(rows), calls,
    describe() { return structuredClone(this.rows); },
    async mutate(ns, ops, revision) {
      const row = this.rows.find(item => item.ns === ns); assert.equal(row.revision, revision);
      calls.push({ ns, ops: structuredClone(ops) });
      for (const op of ops) {
        let node = row.user;
        for (const key of op.path.slice(0, -1)) node = node[key] ??= {};
        if (op.op === 'unset') delete node[op.path.at(-1)]; else node[op.path.at(-1)] = structuredClone(op.value);
      }
      row.revision++;
    },
  };
}
async function fixture(t, settings, initial) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-targets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory), state = initial ?? await store.read();
  const native = new NativeTracking({ directory, roots: { dsh: path.join(directory, 'home') } });
  const targets = new SyncTargets({ directory, native, settings });
  await targets.start(state); await native.start();
  return { directory, store, native, targets, state };
}

test('new defaults, upgrade consent and risk grants remain device-local', async t => {
  const f = await fixture(t, settingsFixture());
  assert.deepEqual(f.targets.status().enabled, { prompt: true, skill: true, settings: true, 'model-config': false, plugins: false });
  assert.equal(f.targets.status().needsConsent, false);
  await assert.rejects(f.targets.configure(f.state, { enabled: { 'model-config': true } }), { code: 'confirmation-required' });
  assert.equal(f.targets.enabled('model-config'), false);
  const upgrade = await fixture(t, settingsFixture(), { ...f.state, vaultId: randomUUID() });
  assert.equal(upgrade.targets.status().needsConsent, true); assert.equal(upgrade.targets.enabled('settings'), false);
  await assert.rejects(upgrade.targets.configure(upgrade.state, { enabled: { settings: true } }), { code: 'confirmation-required' });
  await upgrade.targets.configure(upgrade.state, { enabled: { settings: true }, confirmScope: true });
  assert.equal(upgrade.targets.enabled('settings'), true);
});

test('portable options apply field edits without restating secrets or unknown settings', async t => {
  const settings = settingsFixture([{ ns: 'ui-theme', revision: 2, user: { preference: 'light', secret: 'TEST-ONLY' } }]);
  const f = await fixture(t, settings);
  const before = configAsset('settings', 'ui-theme', { preference: 'light' }); f.state.assets = [before]; f.state.base = { [before.id]: hash(before) };
  const incoming = configAsset('settings', 'ui-theme', { preference: 'dark', fontSize: 16 });
  const plan = await f.targets.prepare(f.state, [incoming]); await f.targets.apply(plan, [incoming]);
  assert.equal(settings.rows[0].user.preference, 'dark'); assert.equal(settings.rows[0].user.secret, 'TEST-ONLY');
  assert.deepEqual(settings.calls[0].ops, [{ op: 'set', path: ['preference'], value: 'dark' }, { op: 'set', path: ['fontSize'], value: 16 }]);
  assert.equal(JSON.stringify(plan.local).includes('TEST-ONLY'), false);
});

test('model changes stage without connections or credential rebinding and require exact local confirmation', async t => {
  const settings = settingsFixture([{ ns: 'llm-deepseek', revision: 1, user: { baseURL: 'https://old.example/api', apiKeyEnv: 'LOCAL_KEY' } }]);
  const f = await fixture(t, settings);
  await f.targets.configure(f.state, { enabled: { 'model-config': true }, confirmRisk: true });
  const incoming = configAsset('model-config', 'llm-deepseek', { baseURL: 'https://new.example/api' });
  const plan = await f.targets.prepare(f.state, [incoming]); await f.targets.apply(plan, [incoming]);
  assert.equal(settings.calls.length, 0); assert.equal(f.targets.status().pendingModels.length, 1);
  await assert.rejects(f.targets.applyModel(incoming.id, 'stale'), { code: 'stale-choice' });
  assert.deepEqual((await f.targets.capture()).find(a => a.id === incoming.id), incoming);
  await f.targets.applyModel(incoming.id, hash(incoming));
  assert.equal(settings.rows[0].user.baseURL, 'https://new.example/api'); assert.equal(settings.rows[0].user.apiKeyEnv, 'LOCAL_KEY');
  assert.equal(f.targets.status().pendingModels.length, 0);
});

test('pending model changes survive restart but local edits invalidate the authorization', async t => {
  const settings = settingsFixture([{ ns: 'llm-deepseek', revision: 1, user: { maxTokens: 123 } }]);
  const f = await fixture(t, settings); await f.targets.configure(f.state, { enabled: { 'model-config': true }, confirmRisk: true });
  const incoming = configAsset('model-config', 'llm-deepseek', { maxTokens: 456 });
  const plan = await f.targets.prepare(f.state, [incoming]); await f.targets.apply(plan, [incoming]);
  const restart = new SyncTargets({ directory: f.directory, native: f.native, settings }); await restart.start(f.state);
  assert.equal(restart.status().pendingModels.length, 1);
  settings.rows[0].user.maxTokens = 789; settings.rows[0].revision++;
  await assert.rejects(restart.applyModel(incoming.id, hash(incoming)), { code: 'local-changed' });
  assert.equal(settings.calls.length, 0); assert.equal(restart.status().pendingModels.length, 0);
});

test('disabled configuration never asks settings service and preserves remote-only data', async t => {
  const settings = { describe() { throw new Error('Disabled settings must not be read'); }, mutate() {} };
  const f = await fixture(t, settings); await f.targets.configure(f.state, { enabled: { settings: false } });
  const incoming = configAsset('settings', 'ui-theme', { preference: 'dark' });
  const plan = await f.targets.prepare(f.state, [incoming]);
  assert.deepEqual(plan.local, []); assert.deepEqual(plan.remote, []); assert.deepEqual(plan.passthrough, [incoming]);
});

test('missing settings service preserves cloud settings and does not reinterpret absence as deletion', async t => {
  const f = await fixture(t); const incoming = configAsset('settings', 'ui-theme', { preference: 'dark' });
  const plan = await f.targets.prepare(f.state, [incoming]); assert.deepEqual(plan.passthrough, [incoming]);
  assert.equal(f.targets.status().settingsAvailable, false);
});

test('concurrent local option edits reject native application and keep current configuration', async t => {
  const settings = settingsFixture([{ ns: 'ui-theme', revision: 1, user: { preference: 'light' } }]);
  const f = await fixture(t, settings); const incoming = configAsset('settings', 'ui-theme', { preference: 'dark' });
  const plan = await f.targets.prepare(f.state, [incoming]); settings.rows[0].revision++;
  await assert.rejects(f.targets.apply(plan, [incoming]), { code: 'local-changed' }); assert.equal(settings.calls.length, 0);
});

test('field deletions never delete a provider root or excluded credential bindings', () => {
  const ops = configOps({ providers: { route: { baseURL: 'https://old.example', models: [{ id: 'test' }] } } }, {});
  assert.deepEqual(ops.map(op => op.path), [['providers', 'route', 'baseURL'], ['providers', 'route', 'models']]);
});

test('extended snapshots negotiate format 2 and authenticate the format while preserving v1 reads', async () => {
  const asset = configAsset('settings', 'ui-theme', { preference: 'dark' }), vaultId = randomUUID();
  const plain = encodeEnvelope({ vaultId, assets: [asset] }); assert.equal(plain.format, 2); assert.deepEqual(decodeEnvelope(plain), [asset]);
  assert.throws(() => decodeEnvelope({ ...plain, format: 1 }));
  const keys = await createKeyring(vaultId, 'TEST-only-passphrase');
  const encrypted = encodeEnvelope({ vaultId, assets: [asset], keyring: keys.keyring, key: keys.key });
  assert.deepEqual(decodeEnvelope(encrypted, keys.key), [asset]);
  assert.throws(() => decodeEnvelope({ ...encrypted, format: 1 }, keys.key), { code: 'authentication-failed' });
});

test('remote reversal retires a previously staged model change', async t => {
  const settings = settingsFixture([{ ns: 'llm-deepseek', revision: 1, user: { maxTokens: 123 } }]);
  const f = await fixture(t, settings); await f.targets.configure(f.state, { enabled: { 'model-config': true }, confirmRisk: true });
  const original = configAsset('model-config', 'llm-deepseek', { maxTokens: 123 });
  const incoming = configAsset('model-config', 'llm-deepseek', { maxTokens: 456 });
  let plan = await f.targets.prepare(f.state, [incoming]); await f.targets.apply(plan, [incoming]);
  plan = await f.targets.prepare(f.state, [original]); await f.targets.apply(plan, [original]);
  assert.equal(f.targets.status().pendingModels.length, 0);
  assert.deepEqual(await f.targets.capture(), [original]);
  await assert.rejects(f.targets.applyModel(incoming.id, hash(incoming)), { code: 'stale-choice' });
});

test('changed inherited endpoints or local credential bindings invalidate pending model approval', async t => {
  const settings = settingsFixture([{ ns: 'llm-deepseek', revision: 1, user: { maxTokens: 123 }, value: { maxTokens: 123, baseURL: 'https://old.example', apiKeyEnv: 'OLD_KEY' } }]);
  const f = await fixture(t, settings); await f.targets.configure(f.state, { enabled: { 'model-config': true }, confirmRisk: true });
  const incoming = configAsset('model-config', 'llm-deepseek', { maxTokens: 456 });
  const plan = await f.targets.prepare(f.state, [incoming]); await f.targets.apply(plan, [incoming]);
  settings.rows[0].value.apiKeyEnv = 'NEW_KEY';
  await assert.rejects(f.targets.applyModel(incoming.id, hash(incoming)), { code: 'local-changed' });
  assert.equal(settings.calls.length, 0);
});

test('model arrays preserve local extras by identity and removed dictionaries reset complete entries', () => {
  const before = { providers: { route: { models: [{ id: 'a', maxTokens: 10 }], modelOverrides: { old: { maxTokens: 5 } } }, removed: { baseURL: 'https://old.example' } } };
  const user = structuredClone(before); user.providers.route.models[0].compat = { custom: 'local-only' };
  const after = { providers: { route: { models: [{ id: 'a', maxTokens: 20 }] } } };
  const ops = modelOps(before, after, user);
  assert.deepEqual(ops.find(op => op.path.at(-1) === 'models').value, [{ id: 'a', maxTokens: 20, compat: { custom: 'local-only' } }]);
  assert.ok(ops.some(op => JSON.stringify(op.path) === '["providers","removed"]'));
  assert.ok(ops.some(op => JSON.stringify(op.path) === '["providers","route","modelOverrides","old"]'));
});

test('real Host inherited-unset semantics retain synced intent across different defaults and restart', async t => {
  const settings = settingsFixture([{ ns: 'ui-theme', revision: 1, user: { preference: 'dark', textFontFamily: 'DeviceFont' }, base: { preference: 'system' } }]);
  const originalMutate = settings.mutate.bind(settings);
  settings.mutate = async (ns, ops, revision) => {
    const row = settings.rows.find(item => item.ns === ns);
    const materialized = ops.map(op => op.op === 'unset' && Object.hasOwn(row.base, op.path[0]) ? { op: 'set', path: op.path, value: row.base[op.path[0]] } : op);
    await originalMutate(ns, materialized, revision);
  };
  const f = await fixture(t, settings);
  const reset = configAsset('settings', 'ui-theme', {});
  let plan = await f.targets.prepare(f.state, [reset]); await f.targets.apply(plan, [reset]);
  assert.equal(settings.rows[0].user.preference, 'system'); assert.equal(settings.rows[0].user.textFontFamily, 'DeviceFont');
  assert.deepEqual(await f.targets.capture(), [reset]);
  const restart = new SyncTargets({ directory: f.directory, native: f.native, settings }); await restart.start(f.state);
  assert.deepEqual(await restart.capture(), [reset]);
  // Explicit incoming values equal to this device's base remain explicit intent.
  const explicit = configAsset('settings', 'ui-theme', { preference: 'system' });
  plan = await restart.prepare(f.state, [explicit]); await restart.apply(plan, [explicit]);
  assert.deepEqual(await restart.capture(), [explicit]);
  settings.rows[0].user.preference = 'light'; settings.rows[0].revision++;
  assert.deepEqual((await restart.capture())[0].values, { preference: 'light' });
});

test('configuration re-enable baseline reset survives policy and state persistence gap', async t => {
  const settings = settingsFixture([{ ns: 'ui-theme', revision: 1, user: { preference: 'dark' } }]);
  const f = await fixture(t, settings); const old = configAsset('settings', 'ui-theme', { preference: 'light' });
  f.state.assets = [old]; f.state.base = { [old.id]: hash(old) }; const stale = structuredClone(f.state);
  await f.targets.configure(f.state, { enabled: { settings: false } });
  const restart = new SyncTargets({ directory: f.directory, native: f.native, settings }); await restart.start(stale);
  await restart.configure(stale, { enabled: { settings: true } });
  stale.base = { [old.id]: hash(old) };
  const plan = await restart.prepare(stale, [old]); assert.equal(plan.base[old.id], undefined);
});

test('two devices converge options and stage models without executing pending settings during sync', async t => {
  const aSettings = settingsFixture([{ ns: 'ui-theme', revision: 1, user: { preference: 'dark' } }]);
  const bSettings = settingsFixture([{ ns: 'ui-theme', revision: 1, user: {} }]);
  const a = await fixture(t, aSettings), b = await fixture(t, bSettings);
  let cloud;
  const backend = { async read() { return cloud && structuredClone(cloud); }, async init(envelope) { cloud = { envelope, revision: envelope.revision }; return structuredClone(cloud); }, async publish(expected, envelope) { assert.equal(expected.revision, cloud.revision); cloud = { envelope, revision: envelope.revision }; } };
  const ae = new SyncEngine({ store: a.store, backend, native: a.targets }), be = new SyncEngine({ store: b.store, backend, native: b.targets });
  await ae.initialize(); await be.initialize();
  const conflict = await be.synchronize();
  // A newly joined device with an explicit empty override still requires a first-join choice.
  if (conflict.conflicts) {
    const choices = Object.fromEntries(conflict.conflicts.map(item => [item.id, { side: 'remote', localHash: item.localHash, remoteHash: item.remoteHash }]));
    await be.synchronize(choices);
  }
  assert.equal(bSettings.rows[0].user.preference, 'dark'); assert.equal(cloud.envelope.format, 2);
  await ae.synchronize(); assert.equal((await a.store.read()).assets.length, 1);
});
