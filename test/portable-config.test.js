import test from 'node:test';
import assert from 'node:assert/strict';
import { configId, configAsset, configFields, projectConfig, validateConfig } from '../src/portable-config.js';

const invalid = fn => assert.throws(fn, { code: 'invalid-data' });
const model = values => configAsset('model-config', 'llm-pi-ai', values);
const deepSeek = values => configAsset('model-config', 'llm-deepseek', values);

test('configuration identities are stable UUIDv8 values bound to an allowed namespace', () => {
  const id = configId('settings', 'locale');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, configId('settings', 'locale'));
  assert.notEqual(id, configId('settings', 'ui-theme'));
  assert.notEqual(configId('model-config', 'llm-deepseek'), configId('model-config', 'llm-deepseek-api-key'));
  assert.deepEqual(configAsset('settings', 'locale', { preference: 'en' }), { id, type: 'settings', name: 'locale', namespace: 'locale', values: { preference: 'en' } });
});

test('only explicit namespace and type pairs participate', () => {
  for (const [type, namespace] of [['settings', 'ui-settings'], ['settings', 'ui-settings-general'], ['settings', 'llm-pi-ai'], ['model-config', 'locale'], ['plugins', 'locale'], ['settings', '__proto__'], ['constructor', 'locale']]) {
    assert.equal(projectConfig(type, namespace, {}), undefined);
    assert.equal(configFields(type, namespace), undefined);
    invalid(() => configId(type, namespace));
    invalid(() => validateConfig({ id: configId('settings', 'locale'), type, name: namespace, namespace, values: {} }));
  }
});

test('settings projection excludes security and unrelated preferences', () => {
  const input = { preference: 'dark', fontSize: 14, codeFontSize: 11, terminalFontSize: 13, enabled: true, welcomeNoticeVersion: 2, textFontFamily: 'Private font', apiKeyEnv: 'PRIVATE_KEY' };
  const projected = projectConfig('settings', 'ui-theme', input);
  assert.deepEqual(projected, { preference: 'dark', fontSize: 14, codeFontSize: 11, terminalFontSize: 13 });
  assert.notEqual(projected, input);
  assert.deepEqual(configFields('settings', 'ui-theme'), ['preference', 'fontSize', 'codeFontSize', 'terminalFontSize']);
  assert.deepEqual(projectConfig('settings', 'locale', {}), {});
  invalid(() => configAsset('settings', 'ui-theme', input));
});

test('settings values match supported primitive types and bounds', () => {
  for (const preference of ['en', 'zh-CN', 'pt-BR', 'zh-Hant-TW']) configAsset('settings', 'locale', { preference });
  for (const preference of ['', 'bad locale', '123', null, true]) invalid(() => configAsset('settings', 'locale', { preference }));
  for (const [field, min, max] of [['fontSize', 10, 22], ['codeFontSize', 10, 16], ['terminalFontSize', 10, 20]]) {
    configAsset('settings', 'ui-theme', { [field]: min }); configAsset('settings', 'ui-theme', { [field]: max });
    for (const value of [min - 1, max + 1, 10.5, '14', null]) invalid(() => configAsset('settings', 'ui-theme', { [field]: value }));
  }
  for (const transcriptView of ['compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded', null]) configAsset('settings', 'ui-chat', { transcriptView });
  configAsset('settings', 'ui-chat', { collapseTiming: 'next-input', foldedReplies: 'final', performanceUsage: 'compact' });
  for (const values of [{ transcriptView: 'unknown' }, { collapseTiming: 'never' }, { foldedReplies: false }, { performanceUsage: 'hidden' }]) invalid(() => configAsset('settings', 'ui-chat', values));
});

test('incoming assets require exactly the envelope fields and matching identity', () => {
  const asset = configAsset('settings', 'locale', { preference: 'en' });
  assert.equal(validateConfig(asset), asset);
  for (const patch of [{ extra: true }, { id: configId('settings', 'ui-chat') }, { name: 'Other' }, { values: [] }, { values: null }]) invalid(() => validateConfig({ ...asset, ...patch }));
  for (const key of Object.keys(asset)) { const incomplete = { ...asset }; delete incomplete[key]; invalid(() => validateConfig(incomplete)); }
});

test('DeepSeek models retain explicitly portable model metadata', () => {
  const values = { baseURL: 'https://api.example.test/v1', thinking: 'enabled', reasoningEffort: 'high', maxTokens: 4096, defaultContextWindow: 128000, streamIdleTimeoutMs: 300000,
    models: [{ id: 'example', name: 'Example', description: 'Example model', contextWindow: 128000, maxTokens: 4096, inputModalities: ['text', 'image'], imagePixelBudget: 'low', imageMaxBytes: 100000, systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' }] };
  for (const namespace of ['llm-deepseek', 'llm-deepseek-api-key']) {
    assert.deepEqual(projectConfig('model-config', namespace, { ...values, apiKeyEnv: 'PRIVATE_KEY', headers: { Authorization: 'secret' } }), values);
    validateConfig(configAsset('model-config', namespace, values));
  }
  for (const patch of [{ maxTokens: 0 }, { thinking: true }, { reasoningEffort: 'medium' }, { streamIdleTimeoutMs: Infinity }, { defaultContextWindow: 1.5 }, { models: [{ name: 'No id' }] }, { models: [{ id: 'same' }, { id: 'same' }] }]) invalid(() => deepSeek(patch));
});

test('pi-ai projection retains safe nested model fields without credentials or arbitrary configuration', () => {
  const values = { providers: { gateway: { displayName: 'Example gateway', api: 'openai-responses', baseURL: 'https://models.example.test/v1', defaultContextWindow: 128000, defaultMaxTokens: 4096, defaultInput: ['text'], reasoning: 'high',
    thinkingBudgets: { high: 4096 }, cacheRetention: 'short', transport: 'sse', timeoutMs: 60000, streamIdleTimeoutMs: 300000,
    models: [{ id: 'example', name: 'Example', contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } }],
    modelOverrides: { 'vendor/model': { maxTokens: 8192, reasoningEfforts: false } } } } };
  const input = structuredClone(values);
  input.providers.gateway.apiKeyEnv = 'PRIVATE_KEY'; input.providers.gateway.headers = { Authorization: 'secret' };
  input.providers.gateway.models[0].headers = { Authorization: 'secret' };
  input.providers.gateway.models[0].compat = { chatTemplateKwargs: { arbitrary: 'secret' } };
  input.providers.gateway.modelOverrides['vendor/model'].apiKeyEnv = 'PRIVATE_KEY';
  assert.deepEqual(projectConfig('model-config', 'llm-pi-ai', input), values);
  assert.deepEqual(model(values).values, values);
  assert.equal(input.providers.gateway.apiKeyEnv, 'PRIVATE_KEY');
});

test('remote nested secret and unknown fields are rejected rather than projected away', () => {
  for (const key of ['headers', 'apiKeyEnv', 'apiKey', 'credentials', 'config', 'compat']) {
    invalid(() => model({ providers: { gateway: { [key]: {} } } }));
    invalid(() => model({ providers: { gateway: { models: [{ id: 'example', [key]: {} }] } } }));
    invalid(() => model({ providers: { gateway: { modelOverrides: { example: { [key]: {} } } } } }));
    invalid(() => deepSeek({ models: [{ id: 'example', [key]: {} }] }));
  }
});

test('endpoint validation rejects credentials, query, fragment and unsupported protocols', () => {
  for (const baseURL of ['file:///private', 'javascript:alert(1)', '//example.test', 'ftp://example.test', 'https://user:pass@example.test', 'https://@example.test', 'https://example.test?token=secret', 'https://example.test?', 'https://example.test#secret', 'https://example.test#', 'https:\\example.test', ' https://example.test', 'https://example.test\n']) {
    invalid(() => deepSeek({ baseURL }));
    invalid(() => projectConfig('model-config', 'llm-deepseek', { baseURL }));
    invalid(() => model({ providers: { gateway: { baseURL } } }));
  }
  for (const baseURL of ['https://example.test/v1', 'http://localhost:8080/v1', 'http://[::1]:8080']) deepSeek({ baseURL });
});

test('prototype keys, inherited objects and getters never enter portable data', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const poisoned = JSON.parse(`{"providers":{"gateway":{"${key}":{}}}}`);
    invalid(() => model(poisoned)); invalid(() => projectConfig('model-config', 'llm-pi-ai', poisoned));
    invalid(() => model({ providers: JSON.parse(`{"${key}":{}}`) }));
    invalid(() => model({ providers: { gateway: { modelOverrides: JSON.parse(`{"${key}":{}}`) } } }));
  }
  invalid(() => projectConfig('settings', 'locale', Object.create({ preference: 'en' })));
  const value = {}; Object.defineProperty(value, 'preference', { enumerable: true, get() { assert.fail('Getter must not run'); } });
  invalid(() => projectConfig('settings', 'locale', value));
  invalid(() => deepSeek({ models: new Array(1) }));
  const disguised = [{ id: 'one' }]; disguised.length = 2; disguised.extra = { id: 'two' };
  invalid(() => deepSeek({ models: disguised }));
});

test('nested types, counts, depth and aggregate byte size are bounded', () => {
  for (const values of [{ providers: [] }, { providers: { gateway: [] } }, { providers: { gateway: { models: {} } } }, { providers: { gateway: { models: [{ id: 'a', input: ['audio'] }] } } }, { providers: { gateway: { models: [{ id: 'a', reasoningEfforts: { unknown: 'high' } }] } } }, { providers: { gateway: { api: 'unknown' } } }]) invalid(() => model(values));
  invalid(() => deepSeek({ models: Array.from({ length: 257 }, (_, index) => ({ id: `model-${index}` })) }));
  invalid(() => model({ providers: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`route-${index}`, {}])) }));
  invalid(() => deepSeek({ models: Array.from({ length: 100 }, (_, index) => ({ id: `model-${index}`, description: 'x'.repeat(4000) })) }));
  let nested = {}; for (let index = 0; index < 10; index++) nested = { child: nested };
  invalid(() => projectConfig('settings', 'locale', { ignored: nested }));
  const cyclic = {}; cyclic.self = cyclic;
  invalid(() => projectConfig('settings', 'locale', cyclic));
  invalid(() => deepSeek({ maxTokens: NaN }));
  invalid(() => deepSeek({ maxTokens: 1n }));
});
