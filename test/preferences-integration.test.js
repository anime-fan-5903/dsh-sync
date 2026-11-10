import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Application } from '../src/application.js';
import { SyncPreferences } from '../src/sync-preferences.js';
import { SyncTargets } from '../src/sync-targets.js';
import { nativeId } from '../src/model.js';
import { CONTROL_ID, PREFERENCES_ID, controlAsset, preferencesAsset, isPreferenceRecord, TARGET_DEFAULTS } from '../src/preference-records.js';
import { encodeEnvelope, decodeEnvelope } from '../src/crypto.js';
import { hash } from '../src/model.js';

function cloudFixture() {
  return { remote: null, revision: 0, reads: 0, fail: false,
    async read() { this.reads++; return structuredClone(this.remote); },
    async init(envelope) { this.remote ??= { envelope, revision: envelope.revision, etag: String(++this.revision) }; return structuredClone(this.remote); },
    async publish(expected, envelope) {
      if (this.fail || expected.etag !== this.remote.etag) throw Object.assign(new Error('Concurrent cloud change'), { code: 'remote-changed' });
      this.remote = { envelope, revision: envelope.revision, etag: String(++this.revision) }; return structuredClone(this.remote);
    },
    assets(key) { return decodeEnvelope(this.remote.envelope, key); },
  };
}
async function fixture(t, cloud, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-preferences-integration-'));
  const manager = { rows: [], installs: [], async listBundles() { return structuredClone(this.rows); }, async installBundle(...args) { this.installs.push(args); throw new Error('No installation authorized'); } };
  const app = new Application({ directory, roots: { dsh: path.join(directory, 'home'), agents: path.join(directory, 'agents') }, pluginManager: manager,
    credentials: { readRecord: async () => undefined, modifyRecord: async () => { throw new Error('Credentials must stay local'); } }, deviceProtector: { available: false }, ...options });
  await app.start(); clearInterval(app.timer); app.engine.backend = cloud;
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { app, manager, directory, root: path.join(directory, 'home') };
}
async function pair(t) {
  const cloud = cloudFixture(), a = await fixture(t, cloud), b = await fixture(t, cloud);
  await a.app.operation('initialize'); await b.app.operation('initialize'); await b.app.operation('sync');
  return { cloud, a, b };
}
const setTargets = (app, enabled) => app.operation('targets-configure', { enabled, confirmRisk: true });
const control = (cloud, key) => cloud.assets(key).find(asset => asset.id === CONTROL_ID);
const preferences = (cloud, key) => cloud.assets(key).find(asset => asset.id === PREFERENCES_ID);
const choose = (app, result, side) => app.operation('sync', { decisions: Object.fromEntries(result.conflicts.map(item => [item.id, { side, localHash: item.localHash, remoteHash: item.remoteHash }])) });

test('pre-join legacy target choices are not mistaken for untouched new-device defaults', async t => {
  const f = await fixture(t, cloudFixture()); await setTargets(f.app, { prompt: false });
  const legacy = new SyncPreferences({ directory: f.directory }); legacy.file = path.join(f.directory, 'legacy-preferences.json');
  const targets = new SyncTargets({ directory: f.directory, native: f.app.tracking, preferences: legacy });
  const state = await f.app.store.read(); assert.equal(state.vaultId, null); await targets.start(state);
  const plan = legacy.plan(state, [controlAsset(true), preferencesAsset({ targets: { ...TARGET_DEFAULTS }, autoSync: true, intervalSeconds: 30 })], legacy.localValues(state, targets.policy.enabled));
  assert.equal(plan.blocked, true); assert.equal(plan.controlConflict, false); assert.equal(targets.policy.enabled.prompt, false);
});

test('native per-item baseline resets survive the shared preferences wrapper', async t => {
  const f = await fixture(t, cloudFixture()); await mkdir(f.root, { recursive: true });
  const origin = { root: 'dsh', path: 'AGENTS.md' }, id = nativeId(origin);
  const original = { id, type: 'prompt', name: '.dsh/AGENTS.md', origin, content: 'Previous baseline' };
  await writeFile(path.join(f.root, 'AGENTS.md'), original.content);
  const state = await f.app.store.read(); state.assets = [original]; state.base[id] = hash(original);
  f.app.tracking.config.known[id] = { id, type: 'prompt', name: original.name, origin };
  f.app.tracking.config.baselineResets[id] = f.app.tracking.config.known[id];
  const plan = await f.app.targets.prepare(state, [{ ...original, content: 'Changed cloud copy' }]);
  assert.equal(plan.base[id], undefined, 'Wrapper must not restore a native baseline intentionally excluded by the adapter');
});

test('rejected configuration input does not turn fresh defaults into edited preferences', async t => {
  const f = await fixture(t, cloudFixture()); assert.equal(f.app.preferences.metadata.configEdited, false);
  await assert.rejects(f.app.operation('configure', { intervalSeconds: 0 }));
  await assert.rejects(f.app.operation('configure', { enabled: 'invalid' }));
  assert.equal(f.app.preferences.metadata.configEdited, false);
});

test('a fresh device inherits five targets and automatic preferences without copying grants or installing code', async t => {
  const cloud = cloudFixture(), a = await fixture(t, cloud), b = await fixture(t, cloud);
  await a.app.operation('initialize');
  const enabled = { prompt: false, skill: false, settings: false, 'model-config': true, plugins: true };
  await setTargets(a.app, enabled); await a.app.operation('configure', { enabled: false, intervalSeconds: 15 });
  await a.app.operation('sync');
  a.app.tracking.config.agentsEnabled = true;
  a.app.plugins.state.ignored['local-only'] = 'local-only';
  await b.app.operation('initialize'); await b.app.operation('sync');
  assert.deepEqual(b.app.targets.policy.enabled, enabled);
  assert.equal((await b.app.store.read()).settings.enabled, false); assert.equal((await b.app.store.read()).settings.intervalSeconds, 15);
  assert.equal(b.app.tracking.config.agentsEnabled, false); assert.deepEqual(b.app.plugins.state.ignored, {});
  assert.equal(b.manager.installs.length, 0); assert.equal(cloud.remote.envelope.format, 3);
  assert.deepEqual(preferences(cloud).values, { targets: enabled, autoSync: false, intervalSeconds: 15 });
  assert.equal((await b.app.status()).targets.syncConfigEnabled, true);
});

test('received off wins before a changed payload; local edits while off never replace the frozen cloud configuration', async t => {
  const { cloud, a, b } = await pair(t); const frozen = structuredClone(preferences(cloud));
  await a.app.operation('preferences-configure', { enabled: false });
  await setTargets(a.app, { prompt: false, plugins: true }); await a.app.operation('configure', { intervalSeconds: 12 });
  await a.app.operation('sync');
  assert.equal(control(cloud).enabled, false); assert.deepEqual(preferences(cloud), frozen);
  // A peer can contain a newer body in the same snapshot; off still prevents application.
  const altered = preferencesAsset({ targets: { ...TARGET_DEFAULTS, 'model-config': true }, autoSync: false, intervalSeconds: 20 });
  cloud.remote.envelope = encodeEnvelope({ vaultId: cloud.remote.envelope.vaultId, assets: [controlAsset(false), altered] });
  cloud.remote.revision = cloud.remote.envelope.revision; cloud.remote.etag = String(++cloud.revision);
  const before = structuredClone(b.app.targets.policy.enabled);
  await b.app.operation('sync');
  assert.equal(b.app.preferences.enabled, false); assert.deepEqual(b.app.targets.policy.enabled, before);
  assert.equal((await b.app.store.read()).settings.enabled, true);
  await setTargets(b.app, { skill: false }); await b.app.operation('configure', { intervalSeconds: 25 }); await b.app.operation('sync');
  assert.deepEqual(preferences(cloud), altered); assert.equal(control(cloud).enabled, false);
  assert.equal((await b.app.store.read()).assets.some(asset => asset.id === PREFERENCES_ID), false);
});

test('reopening advances the shared switch despite preference conflicts and does not replay deferred edits', async t => {
  const { cloud, a, b } = await pair(t); const frozen = structuredClone(preferences(cloud));
  await a.app.operation('preferences-configure', { enabled: false }); await a.app.operation('sync'); await b.app.operation('sync');
  await setTargets(a.app, { prompt: false }); await setTargets(b.app, { skill: false });
  await a.app.operation('preferences-configure', { enabled: true });
  const first = await a.app.operation('sync'); assert.ok(first.conflicts.some(item => item.id === PREFERENCES_ID));
  assert.equal(control(cloud).enabled, true, 'Switch publication is independent of unresolved configuration');
  assert.deepEqual(preferences(cloud), frozen);
  const second = await b.app.operation('sync'); assert.ok(second.conflicts.some(item => item.id === PREFERENCES_ID));
  assert.equal(b.app.preferences.enabled, true); assert.equal(b.app.targets.policy.enabled.skill, false);
  assert.deepEqual(preferences(cloud), frozen);
  await choose(a.app, first, 'remote'); assert.equal(a.app.targets.policy.enabled.prompt, true);
  await choose(b.app, second, 'remote'); assert.equal(b.app.targets.policy.enabled.skill, true);
  assert.deepEqual(preferences(cloud), frozen);
});

test('paused asset synchronization still receives the shared switch without reading or acknowledging ordinary files', async t => {
  const { cloud, a, b } = await pair(t);
  await a.app.operation('configure', { enabled: false }); await a.app.operation('sync'); await b.app.operation('sync');
  await mkdir(a.root, { recursive: true }); await writeFile(path.join(a.root, 'AGENTS.md'), 'Remote pending instruction');
  await a.app.operation('sync');
  const bState = await b.app.store.read(); const oldBase = structuredClone(bState.base), oldTime = bState.lastSync;
  const scan = b.app.tracking.files.scan;
  b.app.tracking.files.scan = () => { throw new Error('Preference-only polling cannot inspect files'); };
  b.app.nextDiscovery = Infinity; b.app.auth.signedIn = async () => true;
  try {
    await a.app.operation('preferences-configure', { enabled: false }); await a.app.operation('sync');
    b.app.nextAttempt = 0; await b.app.tick();
  } finally { b.app.tracking.files.scan = scan; }
  assert.equal(b.app.preferences.enabled, false);
  const after = await b.app.store.read(); assert.equal(after.lastSync, oldTime);
  for (const [id, baseline] of Object.entries(oldBase)) if (!isPreferenceRecord({ type: id === CONTROL_ID ? 'sync-control' : id === PREFERENCES_ID ? 'sync-preferences' : 'prompt' })) assert.equal(after.base[id], baseline);
  await assert.rejects(readFile(path.join(b.root, 'AGENTS.md')), { code: 'ENOENT' });
  assert.ok(cloud.assets().some(asset => asset.type === 'prompt'));
  assert.equal(after.assets.some(asset => asset.type === 'prompt'), false);
});

test('paused preference-only application immediately updates native discovery targets', async t => {
  const { a, b } = await pair(t);
  await a.app.operation('configure', { enabled: false }); await a.app.operation('sync'); await b.app.operation('sync');
  await setTargets(a.app, { prompt: false, skill: false }); await a.app.operation('sync');
  b.app.auth.signedIn = async () => true; b.app.nextDiscovery = Infinity; b.app.nextAttempt = 0; await b.app.tick();
  assert.equal(b.app.targets.policy.enabled.prompt, false); assert.equal(b.app.targets.policy.enabled.skill, false);
  assert.deepEqual(b.app.tracking.options().types, []);
  assert.strictEqual(b.app.tracking.targets, b.app.targets.policy.enabled);
});

test('asset conflicts do not prevent shared off from propagating and preference polls retain the conflict', async t => {
  const { cloud, a, b } = await pair(t);
  await mkdir(a.root, { recursive: true }); await mkdir(b.root, { recursive: true });
  await writeFile(path.join(a.root, 'AGENTS.md'), 'Left instruction'); await writeFile(path.join(b.root, 'AGENTS.md'), 'Right instruction');
  await a.app.operation('sync'); const conflict = await b.app.operation('sync'); assert.ok(conflict.conflicts.some(item => item.type === 'prompt'));
  await b.app.operation('preferences-configure', { enabled: false });
  const still = await b.app.operation('sync'); assert.ok(still.conflicts.some(item => item.type === 'prompt')); assert.equal(control(cloud).enabled, false);
  await a.app.operation('sync'); assert.equal(a.app.preferences.enabled, false);
  b.app.auth.signedIn = async () => true; b.app.nextDiscovery = Infinity; b.app.nextAttempt = 0; await b.app.tick();
  assert.ok(b.app.engine.conflicts.some(item => item.type === 'prompt')); assert.equal(b.app.engine.phase, 'conflict');
  assert.equal(await readFile(path.join(b.root, 'AGENTS.md'), 'utf8'), 'Right instruction');
});

test('a failed cloud publication never applies projected target preferences to the local device', async t => {
  const { cloud, a, b } = await pair(t);
  const before = structuredClone(b.app.targets.policy.enabled); const beforeBase = (await b.app.store.read()).base[PREFERENCES_ID];
  await setTargets(a.app, { skill: false, 'model-config': true }); await a.app.operation('sync');
  await mkdir(b.root, { recursive: true }); await writeFile(path.join(b.root, 'AGENTS.md'), 'Preserve local publication candidate');
  cloud.fail = true;
  await assert.rejects(b.app.engine.synchronize(), { code: 'remote-changed' });
  assert.deepEqual(b.app.targets.policy.enabled, before); assert.equal((await b.app.store.read()).base[PREFERENCES_ID], beforeBase);
  assert.equal(await readFile(path.join(b.root, 'AGENTS.md'), 'utf8'), 'Preserve local publication candidate');
  cloud.fail = false; await b.app.operation('sync'); assert.equal(b.app.targets.policy.enabled.skill, false);
});

test('public sync and scheduled checks propagate the switch despite broken ordinary asset discovery', async t => {
  const { cloud, a, b } = await pair(t);
  const scan = b.app.tracking.files.scan;
  b.app.tracking.files.scan = () => { throw Object.assign(new Error('Unreadable local asset fixture'), { code: 'native-scan-failed' }); };
  try {
    await b.app.operation('preferences-configure', { enabled: false });
    await assert.rejects(b.app.operation('sync'), { code: 'native-scan-failed' });
    assert.equal(control(cloud).enabled, false); assert.equal(b.app.preferences.enabled, false);
    assert.equal(b.app.engine.phase, 'error');
    await a.app.operation('sync'); await a.app.operation('preferences-configure', { enabled: true }); await a.app.operation('sync');
    b.app.auth.signedIn = async () => true; b.app.nextAttempt = 0; b.app.nextDiscovery = 0;
    await b.app.tick(); assert.equal(b.app.preferences.enabled, true);
    assert.equal(b.app.engine.phase, 'error'); assert.equal(b.app.engine.error.code, 'native-scan-failed');
  } finally { b.app.tracking.files.scan = scan; }
});

test('shared configuration changes cannot evict recoverable native backup history', async t => {
  const { a } = await pair(t); const state = await a.app.store.read();
  const origin = { root: 'dsh', path: 'prompts/recovery-fixture.md' };
  const prompt = { id: nativeId(origin), type: 'prompt', name: '.dsh/prompts/recovery-fixture.md', origin, content: 'Recoverable fixture' };
  await a.app.engine.backupDiscarded(state, [{ side: 'local', asset: prompt }]); const backup = state.backups[0].id;
  for (let index = 0; index < 12; index++) await a.app.engine.backupDiscarded(state, [{ side: 'local', asset: controlAsset(index % 2 === 0) }]);
  assert.equal(state.backups.length, 1); assert.equal(state.backups[0].id, backup);
  assert.equal((await a.app.operation('backup-list')).backups[0].id, backup);
});

test('unchanged preference-only checks retain asset status and never claim a full synchronization', async t => {
  const { a } = await pair(t); await a.app.operation('sync'); const time = (await a.app.store.read()).lastSync;
  const result = await a.app.operation('sync', { preferencesOnly: true });
  assert.equal(result.preferencesChecked, true); assert.equal(Object.hasOwn(result, 'synced'), false);
  assert.equal(a.app.engine.phase, 'synced'); assert.equal((await a.app.store.read()).lastSync, time);
  a.app.engine.phase = 'error'; a.app.engine.error = { code: 'native-scan-failed', message: 'Fixture failure' };
  await a.app.operation('sync', { preferencesOnly: true }); assert.equal(a.app.engine.phase, 'error'); assert.equal(a.app.engine.error.code, 'native-scan-failed');
});

test('lock and sign-out prevent control transfer, and user-only controls cannot be approved by an agent', async t => {
  const cloud = cloudFixture(), a = await fixture(t, cloud), b = await fixture(t, cloud);
  const setup = await a.app.operation('initialize', { encrypted: true, passphrase: 'TEST-only-preference-passphrase' });
  await a.app.operation('preferences-configure', { enabled: false }); await a.app.operation('sync');
  await b.app.operation('initialize'); assert.equal(b.app.preferences.enabled, true);
  await assert.rejects(b.app.operation('sync'), { code: 'locked' });
  b.app.auth.signedIn = async () => true; b.app.nextDiscovery = Infinity; b.app.nextAttempt = 0;
  const reads = cloud.reads; await b.app.tick(); assert.equal(cloud.reads, reads);
  await b.app.operation('unlock', { secret: setup.recoveryKey, method: 'recovery' }); await b.app.operation('sync');
  assert.equal(b.app.preferences.enabled, false);
  await assert.rejects(b.app.operation('preferences-configure', { enabled: true }, 'agent'), { code: 'user-only' });
  await assert.rejects(b.app.operation('sync', { decisions: { [CONTROL_ID]: { side: 'local' } } }, 'agent'), { code: 'user-only' });
  const readsAfter = cloud.reads; b.app.auth.signedIn = async () => false; b.app.nextAttempt = 0; await b.app.tick(); assert.equal(cloud.reads, readsAfter);
});
