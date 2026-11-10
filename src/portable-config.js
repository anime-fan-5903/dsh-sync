import { createHash } from 'node:crypto';

const MAX_BYTES = 256 * 1024;
const MAX_NODES = 4096;
const MAX_DEPTH = 8;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = () => { throw Object.assign(new Error('Invalid portable configuration.'), { code: 'invalid-data' }); };
const requireValue = condition => { if (!condition) fail(); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (max = 256, min = 1) => value => typeof value === 'string' && value.length >= min && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const choice = (...values) => value => values.includes(value);
const integer = (min = 1, max = Number.MAX_SAFE_INTEGER) => value => Number.isSafeInteger(value) && value >= min && value <= max;
const timeout = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2147483647;
const object = (fields, required = []) => ({ fields, required });
const list = (item, min = 0, max = 256) => ({ item, min, max });
const dictionary = (entry, key = text(256), max = 256) => ({ entry, key, max });
const modalities = min => ({ ...list(choice('text', 'image'), min, 2), unique: true });
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function endpoint(value) {
  if (!text(2048)(value) || value.trim() !== value || !/^https?:\/\//.test(value) || /[\\?#]/.test(value) || /^https?:\/\/[^/]*@/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

const deepSeekModel = object({
  id: text(), name: text(), description: text(4096, 0), contextWindow: integer(), maxTokens: integer(),
  inputModalities: modalities(1), imagePixelBudget: value => value === 'low' || integer()(value),
  imageMaxBytes: integer(), systemPromptUpdate: choice('in-history'), toolUpdate: choice('in-history', 'addition-only'),
}, ['id']);
const deepSeek = object({
  baseURL: endpoint, thinking: choice('enabled', 'disabled'), reasoningEffort: choice('off', 'low', 'high', 'max'),
  maxTokens: integer(), defaultContextWindow: integer(), models: { ...list(deepSeekModel), uniqueId: true }, streamIdleTimeoutMs: timeout,
});
const reasoningEfforts = { alternatives: [choice(false), object(Object.fromEntries(levels.map(level => [level, value => value === null || text(128)(value)])))] };
const piModelFields = {
  name: text(), contextWindow: integer(), maxTokens: integer(), input: modalities(0), reasoningEfforts,
};
const piProfile = object({
  displayName: text(), api: choice('openai-completions', 'openai-responses', 'anthropic-messages'), baseURL: endpoint,
  models: { ...list(object({ id: text(), ...piModelFields }, ['id'])), uniqueId: true },
  modelOverrides: dictionary(object(piModelFields)), defaultContextWindow: integer(), defaultMaxTokens: integer(),
  defaultInput: modalities(1), reasoning: choice(...levels),
  thinkingBudgets: object({ minimal: integer(0), low: integer(0), medium: integer(0), high: integer(0) }),
  cacheRetention: choice('none', 'short', 'long'), transport: choice('sse', 'websocket', 'websocket-cached', 'auto'),
  timeoutMs: integer(0, 2147483647), websocketConnectTimeoutMs: integer(0, 2147483647), streamIdleTimeoutMs: timeout,
});
const schemas = {
  settings: {
    locale: object({ preference: value => text(128)(value) && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value) }),
    'ui-theme': object({ preference: choice('light', 'dark', 'system'), fontSize: integer(10, 22), codeFontSize: integer(10, 16), terminalFontSize: integer(10, 20) }),
    'ui-chat': object({ transcriptView: choice(null, 'compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded'), collapseTiming: choice('completion', 'next-input'), foldedReplies: choice('all', 'final'), performanceUsage: choice('compact', 'detailed') }),
  },
  'model-config': {
    'llm-deepseek': deepSeek,
    'llm-deepseek-api-key': deepSeek,
    'llm-pi-ai': object({ providers: dictionary(piProfile, value => text(128)(value) && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value), 100) }),
  },
};
function schemaFor(type, namespace) {
  return typeof type === 'string' && typeof namespace === 'string' && Object.hasOwn(schemas, type) && Object.hasOwn(schemas[type], namespace) ? schemas[type][namespace] : undefined;
}

/** Reject non-JSON objects, prototype keys and excessive input before recursive projection. */
function bounded(value) {
  let nodes = 0, bytes = 0;
  const visit = (current, depth) => {
    requireValue(++nodes <= MAX_NODES && depth <= MAX_DEPTH);
    if (typeof current === 'string') bytes += Buffer.byteLength(current) + 2;
    else if (current === null || typeof current === 'boolean') bytes += 5;
    else if (typeof current === 'number') { requireValue(Number.isFinite(current)); bytes += 24; }
    else {
      requireValue(Array.isArray(current) || plain(current));
      const keys = Reflect.ownKeys(current);
      requireValue(keys.length <= 1024);
      if (Array.isArray(current)) requireValue(keys.length === current.length + 1 && Array.from({ length: current.length }, (_, index) => Object.hasOwn(current, index)).every(Boolean));
      for (const key of keys) {
        if (Array.isArray(current) && key === 'length') continue;
        requireValue(typeof key === 'string' && !forbidden.has(key));
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        requireValue(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
        bytes += Buffer.byteLength(key) + 4;
        visit(descriptor.value, depth + 1);
      }
    }
    requireValue(bytes <= MAX_BYTES);
  };
  visit(value, 0);
  requireValue(Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES);
}

function transform(schema, value, project) {
  if (typeof schema === 'function') { requireValue(schema(value)); return value; }
  if (schema.alternatives) {
    for (const alternative of schema.alternatives) {
      try { return transform(alternative, value, project); } catch (error) { if (error.code !== 'invalid-data') throw error; }
    }
    fail();
  }
  if (schema.item) {
    requireValue(Array.isArray(value) && value.length >= schema.min && value.length <= schema.max);
    const result = value.map(item => transform(schema.item, item, project));
    if (schema.unique) requireValue(new Set(result).size === result.length);
    if (schema.uniqueId) requireValue(new Set(result.map(item => item.id)).size === result.length);
    return result;
  }
  requireValue(plain(value));
  const result = {};
  if (schema.entry) {
    requireValue(Object.keys(value).length <= schema.max);
    for (const [key, item] of Object.entries(value)) {
      requireValue(schema.key(key) && !forbidden.has(key));
      result[key] = transform(schema.entry, item, project);
    }
  } else {
    for (const key of schema.required) requireValue(Object.hasOwn(value, key));
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.fields, key)) { requireValue(project); continue; }
      result[key] = transform(schema.fields[key], item, project);
    }
  }
  return result;
}

/** Stable UUIDv8 identity for an explicitly supported configuration namespace. */
export function configId(type, namespace) {
  requireValue(!!schemaFor(type, namespace));
  const bytes = createHash('sha256').update(`dsh-sync-config-v1:${type}:${namespace}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Allowed root fields, or undefined when the namespace does not participate. */
export function configFields(type, namespace) {
  const schema = schemaFor(type, namespace);
  return schema ? Object.keys(schema.fields) : undefined;
}

/** Select safe fields from redacted user overrides; malformed allowed values fail closed. */
export function projectConfig(type, namespace, value) {
  const schema = schemaFor(type, namespace);
  if (!schema) return undefined;
  bounded(value);
  return transform(schema, value, true);
}

/** Validate the entire incoming asset, rejecting fields that projection would omit. */
export function validateConfig(asset) {
  bounded(asset);
  requireValue(plain(asset));
  const keys = ['id', 'type', 'name', 'namespace', 'values'];
  requireValue(Object.keys(asset).length === keys.length && keys.every(key => Object.hasOwn(asset, key)));
  const schema = schemaFor(asset.type, asset.namespace);
  requireValue(!!schema && asset.id === configId(asset.type, asset.namespace) && asset.name === asset.namespace);
  transform(schema, asset.values, false);
  return asset;
}

/** Construct a validated configuration asset without projecting unknown fields. */
export function configAsset(type, namespace, values) {
  return validateConfig({ id: configId(type, namespace), type, name: namespace, namespace, values });
}
