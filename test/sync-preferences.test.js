import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SyncPreferences } from '../src/sync-preferences.js';
import { CONTROL_ID, PREFERENCES_ID, TARGET_DEFAULTS, controlAsset, preferencesAsset } from '../src/preference-records.js';
import { merge, hash, hashes } from '../src/model.js';

const state = () => ({ base: {}, settings: { enabled: false, intervalSeconds: 30 } });
const values = patch => ({ targets: { ...TARGET_DEFAULTS }, autoSync: false, intervalSeconds: 30, ...patch });
async function fixture(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-preferences-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preferences = new SyncPreferences({ directory }); await preferences.start(options);
  return { directory, preferences };
}
const selection = (plan, decisions = {}) => merge(plan.base, plan.local, plan.remote, decisions);
const remote = (enabled = true, config = values()) => [controlAsset(enabled), preferencesAsset(config)];
const throwingValues = () => { throw new Error('Disabled preference bodies must not be inspected'); };

test('fresh preferences are enabled with strict device-only metadata and no repeated initialization choice', async t => {
  const { preferences } = await fixture(t);
  assert.deepEqual(preferences.status(), { enabled: true });
  assert.deepEqual(JSON.parse(await readFile(preferences.file, 'utf8')), { format: 1, enabled: true, controlEdited: false, configEdited: false, configKnown: false, reset: false });
  const current = values(), plan = preferences.plan(state(), [], current);
  assert.equal(plan.blocked, false); assert.equal(plan.enabled, true); assert.deepEqual(plan.selectedValues, current);
  await preferences.commit(plan, selection(plan).assets, current);
  assert.equal(preferences.metadata.configKnown, true); assert.equal(preferences.metadata.configEdited, false);
});

test('first join follows remote switch and preferences without conflicts against untouched defaults', async t => {
  const { preferences } = await fixture(t);
  const current = values(), shared = values({ autoSync: true, intervalSeconds: 90, targets: { ...TARGET_DEFAULTS, plugins: true } });
  const plan = preferences.plan(state(), remote(true, shared), current);
  assert.equal(plan.blocked, false); assert.equal(plan.remotePreferences, true); assert.deepEqual(plan.selectedValues, shared);
  assert.deepEqual(selection(plan).conflicts, []);
  assert.equal(preferences.enabled, true); assert.equal(preferences.metadata.configKnown, false, 'Planning is not a local configuration mutation');
  await preferences.commit(plan, selection(plan).assets, current);
  assert.deepEqual(preferences.status(), { enabled: true });
});

test('remote off follows on first join without evaluating, comparing or serializing local configuration', async t => {
  const { preferences } = await fixture(t);
  const shared = preferencesAsset(values({ intervalSeconds: 75 }));
  const plan = preferences.plan(state(), [controlAsset(false), shared], throwingValues);
  assert.equal(plan.enabled, false); assert.equal(plan.blocked, false); assert.equal(plan.selectedValues, undefined);
  assert.deepEqual(plan.local, [controlAsset(false)]); assert.deepEqual(plan.remote, [controlAsset(false)]);
  assert.deepEqual(plan.passthrough, [shared]); assert.equal(plan.before.valuesHash, null); assert.equal(plan.remotePreferences, false);
  preferences.assertCurrent(plan, throwingValues);
  await preferences.commit(plan, [...selection(plan).assets, ...plan.passthrough], throwingValues);
  assert.equal(preferences.enabled, false); assert.equal(preferences.metadata.configKnown, false); assert.equal(preferences.metadata.reset, true);
  const forbiddenState = {}; Object.defineProperty(forbiddenState, 'settings', { get: throwingValues });
  assert.deepEqual(preferences.local(forbiddenState, new Proxy({}, { get: throwingValues })), [controlAsset(false)]);
});

test('legacy and explicitly edited local configuration do not silently follow a different cloud payload', async t => {
  const legacy = (await fixture(t, { legacy: true })).preferences;
  const plan = legacy.plan(state(), remote(true, values({ intervalSeconds: 120 })), values());
  assert.equal(plan.blocked, true); assert.equal(selection(plan).conflicts[0].id, PREFERENCES_ID);
  const fresh = (await fixture(t)).preferences; await fresh.markEdited();
  assert.equal(fresh.plan(state(), remote(true, values({ autoSync: true })), values()).blocked, true);
});

test('known baselines prevent neutral first-join behavior even before a first metadata commit', async t => {
  const { preferences } = await fixture(t);
  const original = values(), local = values({ intervalSeconds: 60 }), shared = values({ intervalSeconds: 90 });
  const known = state(); known.base = hashes(remote(true, original));
  const plan = preferences.plan(known, remote(true, shared), local);
  assert.equal(plan.blocked, true); assert.equal(selection(plan).conflicts[0].id, PREFERENCES_ID);
});

test('switch conflicts stop preference planning and keep exact fingerprint-bound choices', async t => {
  const { preferences } = await fixture(t); await preferences.configure(false);
  const shared = preferencesAsset(values());
  const plan = preferences.plan(state(), [controlAsset(true), shared], throwingValues);
  assert.equal(plan.blocked, true); assert.equal(plan.before.valuesHash, null);
  assert.deepEqual(plan.local, [controlAsset(false)]); assert.deepEqual(plan.remote, [controlAsset(true)]);
  assert.deepEqual(plan.passthrough, [shared]);
  const conflict = selection(plan).conflicts[0]; assert.equal(conflict.id, CONTROL_ID);
  const stale = { [CONTROL_ID]: { side: 'remote', localHash: 'stale', remoteHash: conflict.remoteHash } };
  assert.equal(preferences.plan(state(), [controlAsset(true), shared], throwingValues, stale).blocked, true);
  const choices = { [CONTROL_ID]: { side: 'remote', localHash: conflict.localHash, remoteHash: conflict.remoteHash } };
  const resolved = preferences.plan(state(), [controlAsset(true), shared], values(), choices);
  assert.equal(resolved.blocked, false); assert.equal(resolved.enabled, true);
});

test('turning off always propagates the switch while preserving previously shared preferences unchanged', async t => {
  const { preferences } = await fixture(t); const original = values(); const known = state(); known.base = hashes(remote(true, original));
  await preferences.configure(false); await preferences.markEdited();
  const shared = preferencesAsset(values({ intervalSeconds: 120 }));
  const plan = preferences.plan(known, [controlAsset(true), shared], throwingValues);
  assert.equal(plan.enabled, false); assert.deepEqual(selection(plan).assets, [controlAsset(false)]);
  assert.deepEqual(plan.passthrough, [shared]);
  await preferences.commit(plan, selection(plan).assets, throwingValues);
  assert.equal(preferences.metadata.controlEdited, false); assert.equal(preferences.metadata.configEdited, true); assert.equal(preferences.metadata.reset, true);
  const restarted = new SyncPreferences({ directory: path.dirname(preferences.file) }); await restarted.start();
  assert.equal(restarted.enabled, false); assert.equal(restarted.metadata.configEdited, true);
});

test('re-enabling starts a fresh configuration baseline rather than publishing queued local changes', async t => {
  const { preferences } = await fixture(t); const original = values();
  let known = state(); let plan = preferences.plan(known, [], original);
  await preferences.commit(plan, selection(plan).assets, original); known.base = hashes(selection(plan).assets);
  await preferences.configure(false);
  plan = preferences.plan(known, remote(true, original), throwingValues);
  await preferences.commit(plan, selection(plan).assets, throwingValues); known.base = hashes(selection(plan).assets);
  await preferences.markEdited(); await preferences.configure(true);
  const local = values({ intervalSeconds: 60 });
  plan = preferences.plan(known, remote(false, original), local);
  assert.equal(plan.enabled, true); assert.equal(plan.blocked, true); assert.equal(Object.hasOwn(plan.base, PREFERENCES_ID), false);
  const conflict = selection(plan).conflicts.find(item => item.id === PREFERENCES_ID);
  const decisions = { [PREFERENCES_ID]: { side: 'remote', localHash: conflict.localHash, remoteHash: conflict.remoteHash } };
  const resolved = preferences.plan(known, remote(false, original), local, decisions);
  assert.equal(resolved.blocked, false); assert.deepEqual(resolved.selectedValues, original);
  await preferences.commit(resolved, selection(resolved, decisions).assets, local);
  assert.equal(preferences.metadata.reset, false); assert.equal(preferences.metadata.configEdited, false); assert.equal(preferences.metadata.configKnown, true);
});

test('remote re-enable also drops an old preference baseline but untouched fresh devices still follow', async t => {
  const { preferences } = await fixture(t);
  let known = state(); const original = values(); let plan = preferences.plan(known, [], original);
  await preferences.commit(plan, selection(plan).assets, original); known.base = hashes(selection(plan).assets);
  await preferences.configure(false); plan = preferences.plan(known, remote(true, original), throwingValues);
  await preferences.commit(plan, selection(plan).assets, throwingValues);
  known.base = { [CONTROL_ID]: hash(controlAsset(false)), [PREFERENCES_ID]: hash(preferencesAsset(original)) };
  plan = preferences.plan(known, remote(true, original), values({ autoSync: true }));
  assert.equal(plan.blocked, true); assert.equal(Object.hasOwn(plan.base, PREFERENCES_ID), false);
  const fresh = (await fixture(t)).preferences; await fresh.configure(false);
  const off = fresh.plan(state(), remote(false, original), throwingValues); await fresh.commit(off, selection(off).assets, throwingValues);
  const joined = state(); joined.base = hashes(selection(off).assets);
  const on = fresh.plan(joined, remote(true, values({ intervalSeconds: 90 })), values());
  assert.equal(on.blocked, false); assert.equal(on.selectedValues.intervalSeconds, 90);
});

test('known shared switch and enabled configuration cannot disappear implicitly', async t => {
  const { preferences } = await fixture(t); const known = state(); known.base = hashes(remote());
  assert.throws(() => preferences.plan(known, [preferencesAsset(values())], values()), { code: 'control-missing' });
  assert.throws(() => preferences.plan(known, [controlAsset(true)], values()), { code: 'config-missing' });
  assert.equal(preferences.plan(known, [controlAsset(false)], throwingValues).enabled, false);
});

test('duplicate or mismatched singleton records are rejected before merge', async t => {
  const { preferences } = await fixture(t);
  assert.throws(() => preferences.plan(state(), [controlAsset(true), controlAsset(false)], values()), { code: 'invalid-data' });
  assert.throws(() => preferences.plan(state(), [preferencesAsset(values()), preferencesAsset(values())], values()), { code: 'invalid-data' });
  assert.throws(() => preferences.plan(state(), [{ ...controlAsset(true), id: PREFERENCES_ID }], values()), { code: 'invalid-data' });
});

test('local extraction allows only five target flags and ordinary synchronization settings', async t => {
  const { preferences } = await fixture(t);
  const input = state(); input.settings.clientId = 'TEST-only-client'; input.settings.enabled = true; input.settings.intervalSeconds = 3600;
  input.credentials = 'TEST-only-secret'; input.accepted = true;
  const targets = { ...TARGET_DEFAULTS, accepted: true, recoveryKey: 'TEST-only-not-exported', localPath: 'TEST-only-not-exported' };
  const extracted = preferences.localValues(input, targets);
  assert.deepEqual(extracted, values({ autoSync: true, intervalSeconds: 3600 }));
  assert.equal(JSON.stringify(extracted).includes('TEST-only'), false);
  assert.throws(() => preferences.localValues({ settings: { enabled: true, intervalSeconds: 4 } }, targets));
  assert.throws(() => preferences.localValues(input, { ...targets, plugins: 'yes' }));
});

test('configuration and switch concurrent edits reject the captured plan before local metadata changes', async t => {
  const { preferences } = await fixture(t); const current = values(); const plan = preferences.plan(state(), [], current);
  assert.throws(() => preferences.assertCurrent(plan, values({ autoSync: true })), { code: 'local-changed' });
  await assert.rejects(preferences.commit(plan, selection(plan).assets, values({ intervalSeconds: 60 })), { code: 'local-changed' });
  assert.equal(preferences.metadata.configKnown, false);
  await preferences.configure(false);
  assert.throws(() => preferences.assertCurrent(plan, current), { code: 'local-changed' });
  await assert.rejects(preferences.commit(plan, selection(plan).assets, current), { code: 'local-changed' });
});

test('commit checks the actual selected records and refuses blocked or replaced decisions', async t => {
  const { preferences } = await fixture(t); const current = values(); const plan = preferences.plan(state(), [], current);
  await assert.rejects(preferences.commit(plan, remote(false, current), current), { code: 'local-changed' });
  await assert.rejects(preferences.commit(plan, remote(true, values({ autoSync: true })), current), { code: 'local-changed' });
  await preferences.markEdited(); const conflict = preferences.plan(state(), remote(true, values({ autoSync: true })), current);
  await assert.rejects(preferences.commit(conflict, remote(true, current), current), { code: 'conflict' });
});

test('same-value switch updates are inert and failed persistence does not acknowledge new policy', async t => {
  const { preferences } = await fixture(t);
  await preferences.configure(true); assert.equal(preferences.metadata.controlEdited, false); assert.equal(preferences.metadata.reset, false);
  const save = preferences.save.bind(preferences); preferences.save = async () => { throw Object.assign(new Error('fixture write failure'), { code: 'EACCES' }); };
  await assert.rejects(preferences.configure(false), { code: 'EACCES' }); assert.equal(preferences.enabled, true);
  await assert.rejects(preferences.markEdited(), { code: 'EACCES' }); assert.equal(preferences.metadata.configEdited, false);
  const plan = preferences.plan(state(), [], values());
  await assert.rejects(preferences.commit(plan, selection(plan).assets, values()), { code: 'EACCES' }); assert.equal(preferences.metadata.configKnown, false);
  preferences.save = save;
});

test('a resolved remote switch advances while configuration conflicts remain pending', async t => {
  const { directory, preferences } = await fixture(t); const original = values(); let known = state();
  let plan = preferences.plan(known, [], original);
  await preferences.commit(plan, selection(plan).assets, original); known.base = hashes(selection(plan).assets);
  await preferences.configure(false); plan = preferences.plan(known, remote(true, original), throwingValues);
  await preferences.commit(plan, selection(plan).assets, throwingValues);
  known.base = { [CONTROL_ID]: hash(controlAsset(false)), [PREFERENCES_ID]: hash(preferencesAsset(original)) };
  await preferences.markEdited(); const local = values({ intervalSeconds: 60 });
  plan = preferences.plan(known, remote(true, original), local);
  assert.equal(plan.blocked, true); assert.equal(plan.controlConflict, false); assert.deepEqual(plan.control, controlAsset(true));
  await preferences.commitControl(plan, local);
  assert.equal(preferences.enabled, true); assert.equal(preferences.metadata.controlEdited, false);
  assert.equal(preferences.metadata.configEdited, true); assert.equal(preferences.metadata.configKnown, true); assert.equal(preferences.metadata.reset, true);
  const restarted = new SyncPreferences({ directory }); await restarted.start();
  assert.equal(restarted.enabled, true); assert.equal(restarted.metadata.configEdited, true); assert.equal(restarted.metadata.reset, true);
  known.base[CONTROL_ID] = hash(plan.control);
  const retry = restarted.plan(known, remote(true, original), local);
  assert.equal(retry.blocked, true); assert.equal(retry.controlConflict, false, 'The independent switch commit does not acknowledge the unresolved configuration');
});

test('an unresolved switch conflict cannot advance independently', async t => {
  const { preferences } = await fixture(t); await preferences.configure(false);
  const plan = preferences.plan(state(), remote(true), throwingValues);
  assert.equal(plan.controlConflict, true); assert.equal(Object.hasOwn(plan, 'control'), false);
  const before = await readFile(preferences.file, 'utf8');
  await assert.rejects(preferences.commitControl(plan, throwingValues), { code: 'conflict' });
  assert.equal(preferences.enabled, false); assert.equal(await readFile(preferences.file, 'utf8'), before);
});

test('control-only commits still enforce captured values and atomic persistence', async t => {
  const { preferences } = await fixture(t); await preferences.configure(false);
  const known = state(); known.base[CONTROL_ID] = hash(controlAsset(false));
  const current = values(); const plan = preferences.plan(known, remote(true), current);
  assert.equal(plan.controlConflict, false);
  await assert.rejects(preferences.commitControl(plan, values({ intervalSeconds: 60 })), { code: 'local-changed' });
  preferences.save = async () => { throw Object.assign(new Error('fixture write failure'), { code: 'EACCES' }); };
  await assert.rejects(preferences.commitControl(plan, current), { code: 'EACCES' });
  assert.equal(preferences.enabled, false); assert.equal(preferences.metadata.controlEdited, true);
});

test('malformed local metadata fails without replacement or secret-bearing diagnostics', async t => {
  for (const invalid of [null, [], { format: 2, enabled: true, controlEdited: false, configEdited: false, configKnown: false, reset: false }, { format: 1, enabled: 'true', controlEdited: false, configEdited: false, configKnown: false, reset: false }, { format: 1, enabled: true, controlEdited: false, configEdited: false, configKnown: false }, { format: 1, enabled: true, controlEdited: false, configEdited: false, configKnown: false, reset: false, secret: 'TEST-only' }]) {
    const { directory, preferences } = await fixture(t);
    const source = JSON.stringify(invalid); await writeFile(preferences.file, source);
    await assert.rejects(new SyncPreferences({ directory }).start(), { code: 'invalid-data' });
    assert.equal(await readFile(preferences.file, 'utf8'), source);
  }
});
