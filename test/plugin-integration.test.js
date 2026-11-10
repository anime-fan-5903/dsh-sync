import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Application } from '../src/application.js';
import { pluginAsset } from '../src/plugin-sync.js';
import { decodeEnvelope } from '../src/crypto.js';
import { hash } from '../src/model.js';

const row = (name, version = '1.0.0', enabled = true) => ({ name, version, enabled, installed: true, availability: 'profile', source: `${name}@${version}`, rows: [], overrides: [] });
function managerFixture(rows = []) {
  return { rows: structuredClone(rows), calls: [], scans: 0,
    async listBundles() { this.scans++; return structuredClone(this.rows); },
    async installBundle(spec, options) {
      this.calls.push({ spec, options });
      const at = spec.lastIndexOf('@'), name = spec.slice(0, at), version = spec.slice(at + 1);
      this.rows.push(row(name, version, options.enabled)); return { application: 'applied', changed: true };
    },
    async setBundleEnabled(name, enabled) {
      this.calls.push({ name, enabled }); this.rows.find(item => item.name === name).enabled = enabled;
      return { application: 'applied', changed: true };
    },
  };
}
async function appFixture(t, manager) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-integration-'));
  const app = new Application({ directory, roots: { dsh: path.join(directory, 'home') }, pluginManager: manager,
    deviceProtector: { available: false }, credentials: { readRecord: async () => undefined, modifyRecord: async () => { throw new Error('No credential writes allowed'); } } });
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }); });
  await app.start(); return app;
}
const enable = app => app.operation('targets-configure', { enabled: { plugins: true }, confirmRisk: true });
function cloudFixture() {
  return { remote: null, count: 0,
    async read() { return structuredClone(this.remote); },
    async init(envelope) { this.remote ??= { envelope, revision: envelope.revision, etag: String(++this.count) }; return this.read(); },
    async publish(expected, envelope) { assert.equal(expected.etag, this.remote.etag); this.remote = { envelope, revision: envelope.revision, etag: String(++this.count) }; return this.read(); },
  };
}

test('new source installs automatically create a remote reminder and exact local quick-confirm plan', async t => {
  const sourceManager = managerFixture([row('example-first')]), targetManager = managerFixture();
  const a = await appFixture(t, sourceManager), b = await appFixture(t, targetManager);
  assert.equal(sourceManager.scans, 0, 'Disabled plugin target must not enumerate packages at startup');
  await enable(a); await enable(b);
  const cloud = cloudFixture(); a.engine.backend = cloud; b.engine.backend = cloud;
  await a.operation('initialize'); await b.operation('initialize'); await b.operation('sync');
  let status = await b.operation('plugins-status'); assert.equal(status.enabled, true); assert.equal(status.pendingCount, 1);
  assert.equal(status.items[0].kind, 'missing'); assert.equal(targetManager.calls.length, 0);
  assert.equal((await b.summary()).plugins.pendingCount, 1);
  await b.operation('sync'); await b.operation('tracking-refresh'); await b.operation('sync');
  assert.equal(decodeEnvelope(cloud.remote.envelope).filter(asset => asset.type === 'plugins').length, 1, 'A missing local package must not delete the shared desired declaration');
  const choices = status.items.filter(item => item.canInstall).map(({ id, fingerprint }) => ({ id, fingerprint }));
  await b.operation('plugins-install', { choices });
  assert.deepEqual(targetManager.calls, [{ spec: 'example-first@1.0.0', options: { enabled: true, saveExact: true } }]);
  assert.equal((await b.summary()).plugins.pendingCount, 0);
  sourceManager.rows.push(row('example-second', '2.1.0', false));
  await a.operation('tracking-refresh'); assert.equal(a.engine.phase, 'pending');
  await a.operation('sync'); await b.operation('sync');
  status = await b.operation('plugins-status'); assert.equal(status.pendingCount, 1);
  assert.equal(status.items.find(item => item.kind === 'missing').name, 'example-second');
  assert.equal(targetManager.calls.length, 1, 'Synchronizing a new declaration must not install without a new local confirmation');
});

test('two devices exchange built-in switches across Host versions with local activation confirmation', async t => {
  const name = '@deepseek-ai/dsh-experimental-auto-review';
  const builtin = (version, enabled) => ({ name, version, enabled, official: true, optional: true, installed: false, availability: 'installation', rows: [], overrides: [] });
  const left = managerFixture([builtin('0.2.2-rc.1', false)]), right = managerFixture([builtin('0.3.0', false)]);
  const a = await appFixture(t, left), b = await appFixture(t, right);
  await enable(a); await enable(b);
  const cloud = cloudFixture(); a.engine.backend = cloud; b.engine.backend = cloud;
  await a.operation('initialize'); await b.operation('initialize'); await b.operation('sync');
  left.rows[0].enabled = true;
  await a.operation('sync'); await b.operation('sync');
  const manifest = decodeEnvelope(cloud.remote.envelope).find(asset => asset.name === name);
  assert.deepEqual(manifest, pluginAsset(name, null, true, 'builtin'));
  const status = await b.operation('plugins-status');
  assert.equal(status.pendingCount, 1); assert.equal(status.items[0].kind, 'activation');
  assert.equal(status.items[0].canInstall, true); assert.deepEqual(right.calls, []);
  await b.operation('sync'); assert.equal(right.rows[0].enabled, false);
  await b.operation('plugins-install', { choices: status.items.map(({ id, fingerprint }) => ({ id, fingerprint })) });
  assert.deepEqual(right.calls, [{ name, enabled: true }]);
  await b.operation('sync'); await a.operation('sync');
  assert.equal((await a.summary()).plugins.pendingCount, 0);
  assert.equal((await b.summary()).plugins.pendingCount, 0);
  right.rows[0].enabled = false;
  await b.operation('sync'); await a.operation('sync');
  const item = (await a.operation('plugins-status')).items[0];
  assert.equal(item.enabled, false); assert.equal(item.kind, 'activation'); assert.deepEqual(left.calls, []);
  await a.operation('plugins-install', { choices: [{ id: item.id, fingerprint: item.fingerprint }] });
  assert.deepEqual(left.calls, [{ name, enabled: false }]);
});

test('combined adapter preserves source packages added while a cloud publication is in flight', async t => {
  const manager = managerFixture([row('example-existing')]); const app = await appFixture(t, manager); await enable(app);
  const state = await app.store.read(); const plan = await app.targets.prepare(state, []);
  manager.rows.push(row('example-new-during-publication'));
  await assert.rejects(app.targets.apply(plan, plan.local), { code: 'local-changed' });
  const captured = await app.targets.capture();
  assert.deepEqual(captured.filter(item => item.type === 'plugins').map(item => item.name).sort(), ['example-existing', 'example-new-during-publication']);
});

test('disabled targets reject shortcuts at the executor and agent callers cannot approve installation', async t => {
  const manager = managerFixture(); const app = await appFixture(t, manager);
  await assert.rejects(app.operation('plugins-install', { choices: [] }), { code: 'target-disabled' });
  await assert.rejects(app.operation('plugins-ignore', {}), { code: 'target-disabled' });
  for (const action of ['targets-configure', 'plugins-install', 'plugins-ignore', 'plugins-status']) await assert.rejects(app.operation(action, {}, 'agent'), { code: 'user-only' });
  assert.equal(manager.scans, 0); assert.equal(manager.calls.length, 0);
  const status = await app.operation('plugins-status'); assert.equal(status.enabled, false); assert.deepEqual(status.items, []);
});

test('unavailable manager preserves remote declarations and does not erase known cloud assets', async t => {
  const app = await appFixture(t); await enable(app);
  const asset = pluginAsset('example-unavailable', '1.0.0', true), state = await app.store.read();
  state.assets = [asset]; state.base = { [asset.id]: hash(asset) };
  const plan = await app.targets.prepare(state, [asset]);
  assert.deepEqual(plan.passthrough, [asset]); assert.equal(plan.local.some(item => item.type === 'plugins'), false);
  assert.equal((await app.operation('plugins-status')).available, false);
});

test('cached plugin progress is readable while a confirmed install occupies the serialized operation queue', async t => {
  const manager = managerFixture(); let release, started;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const install = manager.installBundle.bind(manager);
  manager.installBundle = async (...args) => { started(); await gate; return install(...args); };
  const app = await appFixture(t, manager); await enable(app);
  await app.plugins.apply([pluginAsset('example-progress', '1.0.0', true)]);
  const item = app.pluginStatus().items[0];
  const pending = app.operation('plugins-install', { choices: [{ id: item.id, fingerprint: item.fingerprint }] });
  await entered;
  try {
    const status = await app.operation('plugins-status'); assert.equal(status.progress.total, 1); assert.equal(status.progress.name, 'example-progress');
    assert.equal((await app.summary()).plugins.installing, true);
  } finally { release(); }
  await pending; assert.equal(app.pluginStatus().pendingCount, 0);
});
