import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTROL_ID, PREFERENCES_ID, TARGET_DEFAULTS, controlAsset, preferencesAsset, validatePreferenceRecord, isPreferenceRecord, snapshotFormat } from '../src/preference-records.js';
import { nativeId, validateAsset, validateAssets } from '../src/model.js';
import { configAsset } from '../src/portable-config.js';
import { pluginAsset } from '../src/plugin-sync.js';

const values = () => ({ targets: { ...TARGET_DEFAULTS }, autoSync: true, intervalSeconds: 30 });
const invalid = fn => assert.throws(fn, { code: 'invalid-data' });
function expectedId(kind) {
  const bytes = createHash('sha256').update(`dsh-sync-preferences-v1:${kind}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test('control and payload have fixed independent UUIDv8 identities and exact names', () => {
  assert.equal(CONTROL_ID, expectedId('control')); assert.equal(PREFERENCES_ID, expectedId('preferences'));
  assert.notEqual(CONTROL_ID, PREFERENCES_ID);
  for (const id of [CONTROL_ID, PREFERENCES_ID]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(controlAsset(false), { id: CONTROL_ID, type: 'sync-control', name: 'DSH Sync configuration sync', enabled: false });
  assert.deepEqual(preferencesAsset(values()), { id: PREFERENCES_ID, type: 'sync-preferences', name: 'DSH Sync preferences', values: values() });
  assert.deepEqual(TARGET_DEFAULTS, { prompt: true, skill: true, settings: true, 'model-config': false, plugins: false });
  assert.equal(Object.isFrozen(TARGET_DEFAULTS), true);
});

test('preference type recognition does not substitute for record validation', () => {
  for (const asset of [controlAsset(true), preferencesAsset(values()), { type: 'sync-control' }, { type: 'sync-preferences' }]) assert.equal(isPreferenceRecord(asset), true);
  for (const asset of [null, undefined, false, [], {}, { type: 'settings' }, { type: 'sync-control-extra' }]) assert.equal(isPreferenceRecord(asset), false);
  invalid(() => validatePreferenceRecord({ type: 'sync-control' }));
});

test('control accepts only a boolean and the fixed singleton schema', () => {
  for (const enabled of [true, false]) assert.equal(validateAsset(controlAsset(enabled)).enabled, enabled);
  for (const enabled of [null, undefined, 0, 1, 'true', [], {}]) invalid(() => controlAsset(enabled));
  const asset = controlAsset(true);
  for (const patch of [{ id: PREFERENCES_ID }, { name: 'Other name' }, { type: 'settings' }, { values: values() }, { tokens: {} }, { accepted: true }]) invalid(() => validatePreferenceRecord({ ...asset, ...patch }));
  for (const key of Object.keys(asset)) { const missing = { ...asset }; delete missing[key]; invalid(() => validatePreferenceRecord(missing)); }
});

test('payload requires exactly five boolean targets, automatic sync and a bounded integer interval', () => {
  for (const intervalSeconds of [5, 30, 3600]) for (const autoSync of [true, false]) validatePreferenceRecord(preferencesAsset({ ...values(), intervalSeconds, autoSync }));
  for (const intervalSeconds of [0, 4, 3601, -1, 5.5, NaN, Infinity, null, '30', true]) invalid(() => preferencesAsset({ ...values(), intervalSeconds }));
  for (const autoSync of [null, 0, 'true', {}]) invalid(() => preferencesAsset({ ...values(), autoSync }));
  for (const key of Object.keys(TARGET_DEFAULTS)) {
    const missing = values(); delete missing.targets[key]; invalid(() => preferencesAsset(missing));
    for (const value of [null, undefined, 0, 'true', []]) invalid(() => preferencesAsset({ ...values(), targets: { ...TARGET_DEFAULTS, [key]: value } }));
  }
  for (const key of ['targets', 'autoSync', 'intervalSeconds']) { const missing = values(); delete missing[key]; invalid(() => preferencesAsset(missing)); }
});

test('payload cannot carry grants, tokens, paths, credentials or future target fields', () => {
  for (const key of ['accepted', 'agentsEnabled', 'exclusions', 'remember', 'approvedBuilds', 'versionExemptions', 'tokens', 'apiKey', 'dataDirectory', 'path']) {
    invalid(() => preferencesAsset({ ...values(), [key]: key === 'approvedBuilds' ? ['example'] : true }));
    invalid(() => preferencesAsset({ ...values(), targets: { ...TARGET_DEFAULTS, [key]: true } }));
    invalid(() => validatePreferenceRecord({ ...preferencesAsset(values()), [key]: true }));
  }
  for (const patch of [{ id: CONTROL_ID }, { name: 'Other name' }, { type: 'sync-control' }, { enabled: true }]) invalid(() => validatePreferenceRecord({ ...preferencesAsset(values()), ...patch }));
});

test('strict JSON records reject prototype fields, arrays and accessors without invoking getters', () => {
  for (const value of [null, [], 'bad', 1]) invalid(() => preferencesAsset(value));
  invalid(() => preferencesAsset({ ...values(), targets: [] }));
  invalid(() => preferencesAsset(Object.assign(Object.create({ extra: true }), values())));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = values(); Object.defineProperty(input.targets, key, { value: true, enumerable: true }); invalid(() => preferencesAsset(input));
  }
  const input = controlAsset(true);
  Object.defineProperty(input, 'enabled', { enumerable: true, get() { assert.fail('Getter must not execute'); } }); invalid(() => validatePreferenceRecord(input));
  const typeGetter = {}; Object.defineProperty(typeGetter, 'type', { enumerable: true, get() { assert.fail('Getter must not execute'); } }); invalid(() => validatePreferenceRecord(typeGetter));
  const symbol = controlAsset(true); symbol[Symbol('extra')] = true; invalid(() => validatePreferenceRecord(symbol));
});

test('builders detach preference values from the caller without changing singleton defaults', () => {
  const input = values(), asset = preferencesAsset(input);
  input.targets.prompt = false; input.autoSync = false;
  assert.equal(asset.values.targets.prompt, true); assert.equal(asset.values.autoSync, true);
  asset.values.targets.plugins = true; assert.equal(TARGET_DEFAULTS.plugins, false);
});

test('both singletons coexist with all supported native, configuration and plugin asset types', () => {
  const promptOrigin = { root: 'dsh', path: 'AGENTS.md' }, skillOrigin = { root: 'dsh', path: 'skills/example' };
  const assets = [
    { id: nativeId(promptOrigin), type: 'prompt', name: '.dsh/AGENTS.md', origin: promptOrigin, content: 'Example' },
    { id: nativeId(skillOrigin), type: 'skill', name: 'example', origin: skillOrigin, description: 'Native Skill: example', files: { 'SKILL.md': Buffer.from('Example').toString('base64') } },
    configAsset('settings', 'ui-theme', { preference: 'dark' }), configAsset('model-config', 'llm-deepseek', { maxTokens: 4096 }),
    pluginAsset('example-addon', '1.0.0', true), controlAsset(false), preferencesAsset(values()),
  ];
  assert.equal(validateAssets(assets).length, 7);
  invalid(() => validateAssets([...assets, controlAsset(true)]));
  invalid(() => validateAssets([...assets, preferencesAsset({ ...values(), autoSync: false })]));
});

test('snapshot format selection requires version 3 for either singleton and preserves higher observed versions', () => {
  const native = { origin: { root: 'dsh', path: 'AGENTS.md' } }, configuration = configAsset('settings', 'locale', { preference: 'en' });
  assert.equal(snapshotFormat([]), 1); assert.equal(snapshotFormat([native]), 1);
  assert.equal(snapshotFormat([configuration]), 2); assert.equal(snapshotFormat([native, configuration]), 2);
  assert.equal(snapshotFormat([controlAsset(false)]), 3); assert.equal(snapshotFormat([preferencesAsset(values())]), 3);
  assert.equal(snapshotFormat([], 3), 3); assert.equal(snapshotFormat([native], 2), 2); assert.equal(snapshotFormat([configuration], 3), 3);
  for (const minimum of [0, 4, 1.5, '3', null]) invalid(() => snapshotFormat([], minimum));
  for (const malformed of [null, {}, [null], [false], [[]]]) invalid(() => snapshotFormat(malformed));
});
