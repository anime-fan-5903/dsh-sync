import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './local-store.js';
import { hash, merge, invariant } from './model.js';
import { CONTROL_ID, PREFERENCES_ID, TARGET_DEFAULTS, controlAsset, preferencesAsset, validatePreferenceRecord, isPreferenceRecord } from './preference-records.js';

const fields = ['format', 'enabled', 'controlEdited', 'configEdited', 'configKnown', 'reset'];
const initial = legacy => ({ format: 1, enabled: true, controlEdited: false, configEdited: legacy, configKnown: false, reset: false });
const own = (value, key) => Object.hasOwn(value ?? {}, key);

/** Select and validate the two shared records without interpreting ordinary assets. */
function records(assets) {
  invariant(Array.isArray(assets), 'Invalid preference record collection.');
  const result = new Map();
  for (const asset of assets) {
    if (!isPreferenceRecord(asset) && asset?.id !== CONTROL_ID && asset?.id !== PREFERENCES_ID && !['sync-control', 'sync-preferences'].includes(asset?.type)) continue;
    validatePreferenceRecord(asset);
    invariant(!result.has(asset.id), 'Duplicate preference record.');
    result.set(asset.id, asset);
  }
  return result;
}

/** Shared configuration policy; device grants and working configuration remain owned by the caller. */
export class SyncPreferences {
  constructor({ directory }) {
    this.file = path.join(directory, 'preferences.json'); this.metadata = initial(false);
  }
  get enabled() { return this.metadata.enabled; }
  status() { return { enabled: this.enabled }; }
  async start({ legacy = false } = {}) {
    invariant(typeof legacy === 'boolean', 'Invalid preference migration state.');
    try {
      const text = await readFile(this.file, 'utf8');
      invariant(Buffer.byteLength(text) <= 16384, 'Preference metadata is too large.');
      const saved = JSON.parse(text);
      invariant(saved && typeof saved === 'object' && !Array.isArray(saved) && Object.keys(saved).length === fields.length && fields.every(key => own(saved, key)), 'Invalid preference metadata.');
      invariant(saved.format === 1 && fields.filter(key => key !== 'format').every(key => typeof saved[key] === 'boolean'), 'Unsupported preference metadata.');
      this.metadata = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.metadata = initial(legacy); await this.save();
    }
  }
  save(metadata = this.metadata) { return atomicJson(this.file, metadata); }
  async configure(enabled) {
    invariant(typeof enabled === 'boolean', 'Choose whether to synchronize DSH Sync configuration.');
    if (enabled !== this.enabled) {
      const metadata = { ...this.metadata, enabled, controlEdited: true, reset: true };
      await this.save(metadata); this.metadata = metadata;
    }
    return this.status();
  }
  async markEdited() {
    if (this.metadata.configEdited) return;
    const metadata = { ...this.metadata, configEdited: true };
    await this.save(metadata); this.metadata = metadata;
  }
  localValues(state, targets) {
    const values = {
      targets: Object.fromEntries(Object.keys(TARGET_DEFAULTS).map(key => [key, targets?.[key] ?? TARGET_DEFAULTS[key]])),
      autoSync: state.settings?.enabled ?? false,
      intervalSeconds: state.settings?.intervalSeconds ?? 30,
    };
    return preferencesAsset(values).values;
  }
  local(state, targets) {
    const control = controlAsset(this.enabled);
    return this.enabled ? [control, preferencesAsset(this.localValues(state, targets))] : [control];
  }
  plan(state, remoteAssets, values, decisions = {}) {
    const remoteRecords = records(remoteAssets), remoteControl = remoteRecords.get(CONTROL_ID), remotePreferences = remoteRecords.get(PREFERENCES_ID);
    const originalControl = controlAsset(this.enabled);
    const before = { controlHash: hash(originalControl), valuesHash: null };
    const base = {};
    if (own(state.base, CONTROL_ID)) {
      invariant(remoteControl, 'The shared configuration switch is missing. No local policy was changed.', 'control-missing');
      base[CONTROL_ID] = state.base[CONTROL_ID];
    }
    const followControl = remoteControl && !own(state.base, CONTROL_ID) && !this.metadata.controlEdited;
    const local = [followControl ? remoteControl : originalControl], remote = remoteControl ? [remoteControl] : [];
    const controlResult = merge(base, local, remote, decisions);
    const common = { base, local, remote, passthrough: remotePreferences ? [remotePreferences] : [], before, remotePreferences: false, controlConflict: controlResult.conflicts.length > 0 };
    if (common.controlConflict) return { ...common, blocked: true, enabled: this.enabled };
    const enabled = controlResult.assets[0]?.enabled;
    invariant(typeof enabled === 'boolean', 'The configuration switch cannot be removed.', 'control-missing');
    common.control = controlAsset(enabled);
    if (!enabled) return { ...common, blocked: false, enabled: false };

    if (own(state.base, PREFERENCES_ID)) invariant(remotePreferences, 'The shared configuration is missing. No local options were changed.', 'config-missing');
    const originalPreferences = preferencesAsset(typeof values === 'function' ? values() : values);
    before.valuesHash = hash(originalPreferences.values);
    const followPreferences = remotePreferences && !own(state.base, PREFERENCES_ID) && !this.metadata.configKnown && !this.metadata.configEdited;
    if (own(state.base, PREFERENCES_ID) && this.enabled && !this.metadata.reset) base[PREFERENCES_ID] = state.base[PREFERENCES_ID];
    local.push(followPreferences ? remotePreferences : originalPreferences);
    if (remotePreferences) remote.push(remotePreferences);
    const result = merge(base, local, remote, decisions);
    const selected = result.assets.find(asset => asset.id === PREFERENCES_ID);
    return { base, local, remote, passthrough: [], blocked: result.conflicts.length > 0, enabled: true, before, controlConflict: false, control: common.control,
      ...(result.conflicts.length === 0 && selected ? { selectedValues: structuredClone(selected.values) } : {}),
      remotePreferences: result.conflicts.length === 0 && !!remotePreferences && hash(selected) === hash(remotePreferences) };
  }
  assertCurrent(plan, valuesNow) {
    invariant(plan && plan.before && hash(controlAsset(this.enabled)) === plan.before.controlHash, 'Configuration policy changed during synchronization. Retry.', 'local-changed');
    if (plan.before.valuesHash !== null) invariant(hash(preferencesAsset(valuesNow).values) === plan.before.valuesHash, 'DSH Sync options changed during synchronization. Retry.', 'local-changed');
  }
  async commitControl(plan, valuesNow) {
    this.assertCurrent(plan, valuesNow);
    invariant(!plan.controlConflict && plan.control, 'Resolve the configuration switch conflict first.', 'conflict');
    const control = validatePreferenceRecord(plan.control);
    invariant(control.id === CONTROL_ID && control.enabled === plan.enabled, 'The selected configuration switch changed. Retry.', 'local-changed');
    const metadata = { ...this.metadata, enabled: control.enabled, controlEdited: false,
      reset: this.metadata.reset || this.enabled !== control.enabled };
    await this.save(metadata); this.metadata = metadata;
    return this.status();
  }
  async commit(plan, selectedAssets, valuesNow) {
    this.assertCurrent(plan, valuesNow);
    invariant(!plan.blocked, 'Resolve configuration conflicts first.', 'conflict');
    const selected = records(selectedAssets), control = selected.get(CONTROL_ID);
    invariant(control && control.enabled === plan.enabled, 'The selected configuration switch changed. Retry.', 'local-changed');
    const metadata = { ...this.metadata, enabled: control.enabled, controlEdited: false };
    if (control.enabled) {
      const preferences = selected.get(PREFERENCES_ID);
      invariant(preferences && plan.selectedValues && hash(preferences.values) === hash(plan.selectedValues), 'The selected configuration changed. Retry.', 'local-changed');
      metadata.configKnown = true; metadata.configEdited = false; metadata.reset = false;
    } else metadata.reset = true;
    await this.save(metadata); this.metadata = metadata;
    return this.status();
  }
}
