import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PluginSync, pluginAsset, pluginId, validatePlugin } from '../src/plugin-sync.js';

function row(name = 'example-plugin', version = '1.0.0', extra = {}) {
  return { name, version, enabled: true, installed: true, availability: 'profile', source: `${name}@^${version}`, ...extra };
}
async function fixture(t, rows = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-sync-'));
  const calls = []; let changes = 0;
  const manager = {
    rows,
    async listBundles() { return structuredClone(this.rows); },
    async installBundle(spec, options) {
      calls.push({ method: 'installBundle', spec, options });
      const split = spec.lastIndexOf('@');
      this.rows.push(row(spec.slice(0, split), spec.slice(split + 1), { enabled: options.enabled }));
      return { application: 'applied', changed: true };
    },
    async setBundleEnabled(name, enabled) {
      calls.push({ method: 'setBundleEnabled', name, enabled });
      this.rows.find(item => item.name === name).enabled = enabled;
      return { application: 'applied', changed: true };
    },
  };
  const sync = new PluginSync({ directory, manager, onChange() { changes++; } });
  t.after(async () => { await sync.dispose(); await rm(directory, { recursive: true, force: true }); });
  await sync.start();
  return { sync, manager, directory, calls, changes: () => changes };
}
function choice(sync, index = 0) {
  const { id, fingerprint } = sync.status().items[index]; return { id, fingerprint };
}

test('plugin assets have stable UUIDv8 identities and exact portable fields', () => {
  const first = pluginAsset('@example/plugin', '1.2.3-rc.1+build.2', false);
  assert.equal(validatePlugin(first), first);
  assert.match(first.id, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(first.id, pluginAsset(first.name, '2.0.0', true).id);
  assert.notEqual(first.id, pluginId('different-plugin'));
  for (const name of ['dsh-sync', '@anime-fan-5903/dsh-sync', '../plugin', 'UPPER', '_private', '@scope', '@scope/../x', 'https://example.test/plugin', 'a;command', '', 'x'.repeat(215)]) {
    assert.throws(() => pluginAsset(name, '1.0.0', true), { code: 'invalid-data' });
  }
  for (const version of ['latest', '^1.0.0', '~1.0.0', '1', '1.2', '01.2.3', '1.2.3-01', 'v1.2.3', '1.2.3 ', '1.2.3\n', '1.2.3+' + 'a'.repeat(129)]) {
    assert.throws(() => pluginAsset('plugin', version, true), { code: 'invalid-data' });
  }
  for (const edit of [{ source: 'https://registry.test' }, { registry: 'secret' }, { command: 'run' }, { id: pluginId('other') }, { enabled: 1 }, { type: 'plugin' }]) {
    assert.throws(() => validatePlugin({ ...first, ...edit }), { code: 'invalid-data' });
  }
  const incomplete = { ...first }; delete incomplete.enabled;
  assert.throws(() => validatePlugin(incomplete));
});

test('remote apply never installs and missing desired records survive scans and restart', async t => {
  const { sync, directory, manager, calls } = await fixture(t);
  const desired = pluginAsset('remote-plugin', '2.0.0', true);
  await sync.apply([desired]);
  for (let attempt = 0; attempt < 3; attempt++) assert.deepEqual(await sync.capture(), [desired]);
  assert.deepEqual(calls, []);
  assert.equal(sync.status().items[0].kind, 'missing');
  assert.equal(sync.summary().pendingCount, 1);
  const restarted = new PluginSync({ directory, manager });
  await restarted.start();
  assert.deepEqual(await restarted.capture(), [desired]);
  assert.equal(restarted.status().pendingCount, 1);
  await restarted.dispose();
});

const builtinName = '@deepseek-ai/dsh-experimental-auto-review';
const builtinRow = (extra = {}) => row(builtinName, '0.2.2-rc.1', {
  source: undefined, installed: false, availability: 'installation', official: true, optional: true, ...extra,
});
const builtinAsset = enabled => pluginAsset(builtinName, null, enabled, 'builtin');

test('built-in declarations contain activation only and reject versions or extra authority', () => {
  const asset = builtinAsset(false);
  assert.equal(validatePlugin(asset), asset);
  assert.equal(asset.id, pluginId(builtinName));
  for (const edit of [{ version: '0.2.2-rc.1' }, { source: 'installation' }, { source: 'registry' }, { optional: true }, { enabled: null }]) {
    assert.throws(() => validatePlugin({ ...asset, ...edit }), { code: 'invalid-data' });
  }
});

test('capture includes only manageable shipped official optional switches without Host version churn', async t => {
  const { sync, manager } = await fixture(t, [builtinRow(),
    builtinRow({ name: 'core', optional: false }), builtinRow({ name: 'third-party', official: false }),
    builtinRow({ name: 'catalog', availability: 'missing' }), builtinRow({ name: 'broken', error: { code: 'not-bundle' } }),
    builtinRow({ name: 'readonly', readOnlyReason: 'management-required' }),
  ]);
  assert.deepEqual(await sync.capture(), [builtinAsset(true)]);
  manager.rows[0].version = '0.3.0';
  assert.deepEqual(await sync.capture(), [builtinAsset(true)]);
  manager.rows[0].enabled = false;
  assert.deepEqual(await sync.capture(), [builtinAsset(false)]);
});

test('built-in activation waits for exact local confirmation and never installs a package', async t => {
  const { sync, manager, calls, directory } = await fixture(t, [builtinRow({ enabled: false })]);
  await sync.capture();
  await sync.apply([builtinAsset(true)]);
  assert.deepEqual(await sync.capture(), [builtinAsset(true)]);
  assert.deepEqual(calls, []);
  assert.equal(sync.status().items[0].kind, 'activation');
  assert.equal(sync.status().items[0].canInstall, true);
  await sync.install([choice(sync)]);
  assert.deepEqual(calls, [{ method: 'setBundleEnabled', name: builtinName, enabled: true }]);
  assert.equal(sync.summary().pendingCount, 0);
  await sync.capture();
  await sync.apply([builtinAsset(false)]);
  const stale = choice(sync); manager.rows[0].enabled = false;
  await assert.rejects(sync.install([stale]), { code: 'stale-choice' });
  manager.rows[0].enabled = true;
  await sync.capture();
  manager.setBundleEnabled = async (_name, enabled) => { manager.rows[0].enabled = enabled; return { application: 'restart-required' }; };
  await sync.install([choice(sync)]);
  assert.equal(sync.summary().restartRequiredCount, 1);
  const restarted = new PluginSync({ directory, manager }); await restarted.start();
  assert.equal(restarted.summary().pendingCount, 0); await restarted.dispose();
});

test('missing, core, read-only and wrong-source built-ins cannot authorize installation or activation', async t => {
  for (const actual of [null, builtinRow({ optional: false }), builtinRow({ readOnlyReason: 'management-required' }),
    builtinRow({ error: { code: 'incompatible-version' } }), row(builtinName)]) {
    const { sync, calls } = await fixture(t, actual ? [actual] : []);
    await sync.apply([builtinAsset(false)]);
    assert.equal(sync.status().items[0].canInstall, false);
    await assert.rejects(sync.install([choice(sync)]), { code: 'manual-required' });
    assert.deepEqual(calls, []);
    assert.deepEqual(await sync.capture(), [builtinAsset(false)]);
  }
  const { sync, calls } = await fixture(t, [builtinRow({ enabled: false })]);
  await sync.apply([pluginAsset(builtinName, '0.2.2-rc.1', true)]);
  assert.equal(sync.status().items[0].kind, 'source-difference');
  assert.equal(sync.status().items[0].canInstall, false); assert.deepEqual(calls, []);
});

test('built-in activation detects local edits during publication and verifies manager results', async t => {
  const { sync, manager } = await fixture(t, [builtinRow({ enabled: false })]);
  const selected = await sync.capture(); manager.rows[0].enabled = true;
  await assert.rejects(sync.apply(selected), { code: 'local-changed' });
  await sync.capture(); await sync.apply([builtinAsset(false)]);
  manager.setBundleEnabled = async () => ({ application: 'applied' });
  await sync.install([choice(sync)]);
  assert.equal(sync.status().items[0].code, 'failed');
});

test('capture exports only eligible registry bundles and detects new local installations', async t => {
  const { sync, manager } = await fixture(t, [
    row('registry-plugin'), row('@example/scoped', '2.3.4'), row('dsh-sync'),
    row('built-in', '1.0.0', { availability: 'builtin' }),
    row('git-plugin', '1.0.0', { source: 'git+https://example.test/repo' }),
    row('path-plugin', '1.0.0', { source: 'file:../plugin' }),
    row('alias-plugin', '1.0.0', { source: 'alias-plugin@npm:another@1.0.0' }),
    row('tar-plugin', '1.0.0', { source: 'https://example.test/p.tgz' }),
    row('broken-plugin', '1.0.0', { error: 'private diagnostic' }),
    row('readonly-plugin', '1.0.0', { readOnlyReason: 'deployment' }),
    row('absent-plugin', '1.0.0', { installed: false }),
  ]);
  assert.deepEqual((await sync.capture()).map(item => item.name).sort(), ['@example/scoped', 'registry-plugin']);
  manager.rows.push(row('new-plugin', '4.5.6'));
  assert.equal((await sync.capture()).find(item => item.name === 'new-plugin').version, '4.5.6');
});

test('remote desired differences survive unchanged local observations; actual changes update desired', async t => {
  const { sync, manager } = await fixture(t, [row()]);
  await sync.capture();
  const remote = pluginAsset('example-plugin', '2.0.0', false);
  await sync.apply([remote]);
  assert.deepEqual(await sync.capture(), [remote]);
  manager.rows[0].version = '3.0.0';
  assert.deepEqual(await sync.capture(), [pluginAsset('example-plugin', '3.0.0', true)]);
  manager.rows = [];
  assert.deepEqual(await sync.capture(), [pluginAsset('example-plugin', '3.0.0', true)]);
  assert.equal(sync.status().items[0].kind, 'missing');
});

test('confirm rechecks the entire batch before any installation', async t => {
  const { sync, manager, calls } = await fixture(t);
  await sync.apply([pluginAsset('first-plugin', '1.0.0', true), pluginAsset('second-plugin', '1.0.0', true)]);
  const choices = sync.status().items.map(({ id, fingerprint }) => ({ id, fingerprint }));
  manager.rows.push(row('second-plugin'));
  await assert.rejects(sync.install(choices), { code: 'stale-choice' });
  assert.deepEqual(calls, []);
  const stale = choice(sync);
  await sync.apply([pluginAsset('first-plugin', '2.0.0', true)]);
  await assert.rejects(sync.install([stale]), { code: 'stale-choice' });
  assert.deepEqual(calls, []);
});

test('explicit missing install and exact-version activation use restricted manager arguments', async t => {
  const { sync, calls, changes } = await fixture(t);
  await sync.apply([pluginAsset('@example/plugin', '1.2.3', false)]);
  await sync.install([choice(sync)]);
  assert.deepEqual(calls, [{ method: 'installBundle', spec: '@example/plugin@1.2.3', options: { enabled: false, saveExact: true } }]);
  assert.equal(sync.status().items[0].kind, 'installed');
  await sync.apply([pluginAsset('@example/plugin', '1.2.3', true)]);
  assert.equal(sync.status().items[0].kind, 'activation');
  await sync.install([choice(sync)]);
  assert.deepEqual(calls[1], { method: 'setBundleEnabled', name: '@example/plugin', enabled: true });
  assert.equal(sync.summary().pendingCount, 0);
  assert.ok(changes() > 5);
});

test('existing versions and unsupported sources are manual and never reinstalled', async t => {
  for (const actual of [row('example-plugin', '0.5.0'), row('example-plugin', '9.0.0'), row('example-plugin', '1.0.0', { source: 'file:/private/path' })]) {
    const { sync, calls } = await fixture(t, [actual]);
    await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
    assert.equal(sync.status().items[0].canInstall, false);
    await assert.rejects(sync.install([choice(sync)]), { code: 'manual-required' });
    assert.deepEqual(calls, []);
    assert.ok(!JSON.stringify(sync.status()).includes('/private/path'));
  }
});

test('ignore is device-local, persistent, and bound to desired plus actual state', async t => {
  const { sync, manager, directory } = await fixture(t);
  const asset = pluginAsset('example-plugin', '1.0.0', true);
  await sync.apply([asset]);
  const selected = choice(sync); await sync.ignore(selected.id, selected.fingerprint);
  assert.equal(sync.status().items[0].kind, 'ignored');
  assert.equal(sync.summary().pendingCount, 0);
  assert.deepEqual(await sync.capture(), [asset]);
  const restarted = new PluginSync({ directory, manager }); await restarted.start();
  assert.equal(restarted.status().items[0].kind, 'ignored'); await restarted.dispose();
  await sync.apply([pluginAsset('example-plugin', '2.0.0', true)]);
  assert.equal(sync.status().items[0].kind, 'missing');
  await assert.rejects(sync.ignore(selected.id, selected.fingerprint), { code: 'stale-choice' });
  const next = choice(sync); await sync.ignore(next.id, next.fingerprint);
  manager.rows.push(row('example-plugin', '2.0.0', { source: 'file:/local' }));
  await sync.capture();
  assert.equal(sync.status().items[0].kind, 'source-difference');
});

test('manager outcomes expose only safe codes and never grant scripts or exemptions', async t => {
  for (const [result, code] of [
    [{ application: 'failed', packageResult: { kind: 'build-blocked', output: 'SECRET' }, pendingBuilds: ['native'] }, 'build-blocked'],
    [{ application: 'failed', error: { code: 'incompatible-version', diagnostic: 'SECRET' } }, 'incompatible-version'],
    [{ application: 'restart-required', diagnostic: 'SECRET' }, 'restart-required'],
    [{ application: 'failed', error: { code: 'arbitrary-secret', message: 'SECRET' } }, 'failed'],
    [{ application: 'overridden', error: 'SECRET' }, 'failed'],
  ]) {
    const { sync, manager, directory } = await fixture(t);
    await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
    let received;
    manager.installBundle = async (spec, options) => { received = { spec, options }; return result; };
    await sync.install([choice(sync)]);
    assert.deepEqual(received, { spec: 'example-plugin@1.0.0', options: { enabled: true, saveExact: true } });
    assert.equal(sync.status().items[0].code, code);
    assert.ok(!JSON.stringify(sync.status()).includes('SECRET'));
    assert.ok(!(await readFile(path.join(directory, 'plugins.json'), 'utf8')).includes('SECRET'));
    if (code === 'restart-required') assert.equal(sync.status().items[0].canInstall, false);
  }
});

test('restart-required stays pending until lifecycle restart verifies the installed bundle', async t => {
  const { sync, manager, directory } = await fixture(t);
  await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
  manager.installBundle = async () => { manager.rows.push(row()); return { application: 'restart-required' }; };
  await sync.install([choice(sync)]);
  assert.equal(sync.status().items[0].kind, 'installed');
  assert.equal(sync.summary().restartRequiredCount, 1);
  assert.equal(sync.summary().pendingCount, 1);
  await sync.capture();
  assert.equal(sync.summary().pendingCount, 1);
  const restarted = new PluginSync({ directory, manager }); await restarted.start();
  assert.equal(restarted.summary().restartRequiredCount, 0);
  assert.equal(restarted.summary().pendingCount, 0);
  await restarted.dispose();
});

test('concurrent writes and installs are blocked and dispose waits for active installation', async t => {
  const { sync, manager } = await fixture(t);
  await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
  let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  manager.installBundle = async () => { started(); await new Promise(resolve => { release = resolve; }); return { application: 'applied' }; };
  const installing = sync.install([choice(sync)]); await entered;
  assert.equal(sync.summary().installing, true);
  assert.deepEqual(sync.status().progress, { total: 1, current: 0, name: 'example-plugin' });
  await assert.rejects(sync.capture(), { code: 'operation-busy' });
  await assert.rejects(sync.apply([]), { code: 'operation-busy' });
  await assert.rejects(sync.install([choice(sync)]), { code: 'operation-busy' });
  let disposed = false; const disposal = sync.dispose().then(() => { disposed = true; });
  await Promise.resolve(); assert.equal(disposed, false);
  release(); await installing; await disposal;
  assert.equal(sync.summary().installing, false);
  await assert.rejects(sync.capture(), { code: 'disposed' });
});

test('unavailable manager has no active capture and does not erase desired records', async t => {
  const { sync, manager } = await fixture(t);
  const asset = pluginAsset('example-plugin', '1.0.0', true); await sync.apply([asset]);
  manager.listBundles = async () => { throw new Error('SECRET'); };
  assert.deepEqual(await sync.capture(), []);
  assert.equal(sync.status().available, false);
  await assert.rejects(sync.install([choice(sync)]), { code: 'manager-unavailable' });
  manager.listBundles = async () => [];
  assert.deepEqual(await sync.capture(), [asset]);
});

test('status is detached and malformed persisted declarations are refused', async t => {
  const { sync, directory, manager } = await fixture(t);
  await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
  const status = sync.status(); status.items[0].name = 'mutated';
  assert.equal(sync.status().items[0].name, 'example-plugin');
  const state = JSON.parse(await readFile(path.join(directory, 'plugins.json'), 'utf8'));
  state.desired[pluginId('example-plugin')].source = 'file:/secret';
  await writeFile(path.join(directory, 'plugins.json'), JSON.stringify(state));
  const restarted = new PluginSync({ directory, manager });
  await assert.rejects(restarted.start(), { code: 'invalid-data' }); await restarted.dispose();
});

test('disabled startup loads persisted policy without reading manager inventory', async t => {
  const { sync, directory } = await fixture(t);
  await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
  const selected = choice(sync); await sync.ignore(selected.id, selected.fingerprint);
  let reads = 0;
  const disabled = new PluginSync({ directory, manager: { async listBundles() { reads++; throw new Error('must not read'); } } });
  await disabled.start({ enabled: false });
  assert.equal(reads, 0);
  assert.equal(disabled.status().available, false);
  assert.equal(disabled.status().items[0].kind, 'ignored');
  assert.equal(disabled.status().items[0].canInstall, false);
  await disabled.dispose();
});

test('installation-owned rows without profile installation remain manual local presence', async t => {
  const { sync, calls } = await fixture(t, [row('shipped-plugin', '1.0.0', { installed: false, availability: 'installation' })]);
  assert.deepEqual(await sync.capture(), []);
  await sync.apply([pluginAsset('shipped-plugin', '1.0.0', true)]);
  assert.equal(sync.status().items[0].kind, 'source-difference');
  assert.equal(sync.status().items[0].localVersion, '1.0.0');
  assert.equal(sync.status().items[0].canInstall, false);
  await assert.rejects(sync.install([choice(sync)]), { code: 'manual-required' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await sync.capture(), [pluginAsset('shipped-plugin', '1.0.0', true)]);
});

test('apply refuses a new local bundle installed during cloud publication without observing it away', async t => {
  const { sync, manager, directory } = await fixture(t, [row('first-plugin')]);
  const selected = await sync.capture();
  const before = await readFile(path.join(directory, 'plugins.json'), 'utf8');
  manager.rows.push(row('new-plugin', '2.0.0'));
  await assert.rejects(sync.apply(selected), { code: 'local-changed' });
  assert.equal(await readFile(path.join(directory, 'plugins.json'), 'utf8'), before);
  const retry = await sync.capture();
  assert.deepEqual(retry.map(asset => asset.name).sort(), ['first-plugin', 'new-plugin']);
  await sync.apply(retry);
  assert.deepEqual(await sync.capture(), retry);
});

test('capture guard detects changed activation, version, source and disappearance but ignores list order', async t => {
  const { sync, manager } = await fixture(t, [row('first-plugin'), row('second-plugin')]);
  let selected = await sync.capture(); manager.rows.reverse();
  await sync.apply(selected);
  for (const change of [
    () => { manager.rows[0].enabled = false; },
    () => { manager.rows[0].version = '2.0.0'; },
    () => { manager.rows[0].source = 'file:/manual'; },
    () => { manager.rows.pop(); },
  ]) {
    selected = await sync.capture(); change();
    await assert.rejects(sync.apply(selected), { code: 'local-changed' });
  }
});

test('applied manager responses require fresh matching version and enablement', async t => {
  for (const actual of [null, row('example-plugin', '2.0.0'), row('example-plugin', '1.0.0', { enabled: false }), row('example-plugin', '1.0.0', { source: 'file:/manual' })]) {
    const { sync, manager } = await fixture(t);
    await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
    manager.installBundle = async () => { if (actual) manager.rows.push(actual); return { application: 'applied' }; };
    await sync.install([choice(sync)]);
    assert.equal(sync.status().items[0].code, 'failed');
  }
  const { sync, manager } = await fixture(t, [row('example-plugin', '1.0.0', { enabled: false })]);
  await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
  manager.setBundleEnabled = async () => ({ application: 'applied' });
  await sync.install([choice(sync)]);
  assert.equal(sync.status().items[0].code, 'failed');
});

test('installed manifests with incomplete outcomes remain pending and can be ignored', async t => {
  for (const [result, code] of [
    [{ application: 'failed' }, 'failed'],
    [{ application: 'failed', packageResult: { kind: 'build-blocked' } }, 'build-blocked'],
    [{ application: 'failed', error: { code: 'incompatible-version' } }, 'incompatible-version'],
    [{ application: 'restart-required' }, 'restart-required'],
  ]) {
    const { sync, manager } = await fixture(t);
    await sync.apply([pluginAsset('example-plugin', '1.0.0', true)]);
    manager.installBundle = async () => { manager.rows.push(row()); return result; };
    await sync.install([choice(sync)]);
    assert.equal(sync.status().items[0].kind, 'installed');
    assert.equal(sync.status().items[0].code, code);
    assert.equal(sync.status().pendingCount, 1);
    assert.equal(sync.summary().pendingCount, 1);
    const selected = choice(sync); await sync.ignore(selected.id, selected.fingerprint);
    assert.equal(sync.status().items[0].kind, 'ignored');
    assert.equal(sync.status().items[0].canInstall, false);
    assert.equal(sync.status().pendingCount, 0);
    assert.equal(sync.summary().pendingCount, 0);
    assert.equal(sync.summary().failedCount, 0);
    assert.equal(sync.summary().restartRequiredCount, 0);
    assert.equal(sync.summary().ignoredCount, 1);
    await sync.capture();
    assert.equal(sync.status().items[0].kind, 'ignored');
  }
});

test('confirmed installation preserves unrelated new and changed bundles for the next capture', async t => {
  const { sync, manager } = await fixture(t);
  assert.deepEqual(await sync.capture(), []);
  await sync.apply([pluginAsset('restore-plugin', '1.0.0', true)]);
  const selected = choice(sync);
  manager.rows.push(row('new-local-plugin', '2.0.0'));
  await sync.install([selected]);
  const captured = await sync.capture();
  assert.deepEqual(captured.map(asset => asset.name).sort(), ['new-local-plugin', 'restore-plugin']);
  await sync.apply([...captured, pluginAsset('another-restore', '1.0.0', true)]);
  const another = sync.status().items.find(item => item.name === 'another-restore');
  manager.rows.find(item => item.name === 'new-local-plugin').version = '3.0.0';
  await sync.install([{ id: another.id, fingerprint: another.fingerprint }]);
  assert.equal((await sync.capture()).find(asset => asset.name === 'new-local-plugin').version, '3.0.0');
});
