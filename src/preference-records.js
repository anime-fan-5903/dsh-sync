import { createHash } from 'node:crypto';

export const TARGET_DEFAULTS = Object.freeze({ prompt: true, skill: true, settings: true, 'model-config': false, plugins: false });
const CONTROL_NAME = 'DSH Sync configuration sync';
const PREFERENCES_NAME = 'DSH Sync preferences';
function check(condition) {
  if (!condition) throw Object.assign(new Error('Invalid synchronization preference record.'), { code: 'invalid-data' });
}
function singletonId(kind) {
  const bytes = createHash('sha256').update(`dsh-sync-preferences-v1:${kind}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const CONTROL_ID = singletonId('control');
export const PREFERENCES_ID = singletonId('preferences');

function fields(value, expected) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  check([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  check(keys.length === expected.length && keys.every(key => typeof key === 'string' && expected.includes(key)));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
  }
}

/** Recognize the two singleton record types without granting validity to their fields. */
export function isPreferenceRecord(asset) {
  return asset?.type === 'sync-control' || asset?.type === 'sync-preferences';
}

/** Reject unsupported settings, device grants and malformed singleton identities. */
export function validatePreferenceRecord(asset) {
  check(asset !== null && typeof asset === 'object');
  const type = Object.getOwnPropertyDescriptor(asset, 'type');
  check(type && Object.hasOwn(type, 'value'));
  if (type.value === 'sync-control') {
    fields(asset, ['id', 'type', 'name', 'enabled']);
    check(asset.id === CONTROL_ID && asset.name === CONTROL_NAME && typeof asset.enabled === 'boolean');
  } else {
    fields(asset, ['id', 'type', 'name', 'values']);
    check(asset.type === 'sync-preferences' && asset.id === PREFERENCES_ID && asset.name === PREFERENCES_NAME);
    fields(asset.values, ['targets', 'autoSync', 'intervalSeconds']);
    fields(asset.values.targets, Object.keys(TARGET_DEFAULTS));
    check(Object.values(asset.values.targets).every(value => typeof value === 'boolean'));
    check(typeof asset.values.autoSync === 'boolean' && Number.isInteger(asset.values.intervalSeconds) && asset.values.intervalSeconds >= 5 && asset.values.intervalSeconds <= 3600);
  }
  return asset;
}

/** Build the shared control independently of its optional preference payload. */
export function controlAsset(enabled) {
  return validatePreferenceRecord({ id: CONTROL_ID, type: 'sync-control', name: CONTROL_NAME, enabled });
}

/** Build a detached payload containing only portable DSH Sync preferences. */
export function preferencesAsset(values) {
  validatePreferenceRecord({ id: PREFERENCES_ID, type: 'sync-preferences', name: PREFERENCES_NAME, values });
  return { id: PREFERENCES_ID, type: 'sync-preferences', name: PREFERENCES_NAME,
    values: { targets: { ...values.targets }, autoSync: values.autoSync, intervalSeconds: values.intervalSeconds } };
}

/** Select the minimum compatible envelope version without downgrading an observed version. */
export function snapshotFormat(assets, minimum = 1) {
  check(Array.isArray(assets) && [1, 2, 3].includes(minimum));
  check(assets.every(asset => asset !== null && typeof asset === 'object' && !Array.isArray(asset)));
  const required = assets.some(isPreferenceRecord) ? 3 : assets.some(asset => !asset.origin) ? 2 : 1;
  return Math.max(required, minimum);
}
