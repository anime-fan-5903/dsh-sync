import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson } from './local-store.js';
import { hash, hashes, invariant, validateAsset } from './model.js';
import { TARGET_DEFAULTS, CONTROL_ID, PREFERENCES_ID, isPreferenceRecord } from './preference-records.js';
import { configAsset, projectConfig } from './portable-config.js';

export { TARGET_DEFAULTS } from './preference-records.js';
const isNative = asset => asset.type === 'prompt' || asset.type === 'skill';
const configTypes = ['settings', 'model-config'];

/** Field edits preserve credentials, device-only values and unrecognized provider fields. */
export function configOps(before, after, prefix = []) {
  const result = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key], right = after[key], target = [...prefix, key];
    if (hash(left) === hash(right)) continue;
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (object(left) || object(right)) result.push(...configOps(object(left) ? left : {}, object(right) ? right : {}, target));
    else result.push(right === undefined ? { op: 'unset', path: target } : { op: 'set', path: target, value: right });
  }
  return result;
}

/** Preserve device-only fields inside a model array when portable models change. */
export function modelOps(before, after, user) {
  const member = (value, path) => path.reduce((node, key) => node?.[key], value);
  const deleted = [];
  for (const [route, profile] of Object.entries(before.providers ?? {})) {
    if (!Object.hasOwn(after.providers ?? {}, route)) { deleted.push(['providers', route]); continue; }
    for (const id of Object.keys(profile.modelOverrides ?? {})) if (!Object.hasOwn(after.providers[route].modelOverrides ?? {}, id)) deleted.push(['providers', route, 'modelOverrides', id]);
  }
  return [...deleted.map(path => ({ op: 'unset', path })), ...configOps(before, after).filter(op => !deleted.some(path => path.every((part, index) => op.path[index] === part)))].map(op => {
    if (op.path.at(-1) !== 'models' || op.op !== 'set' || !Array.isArray(op.value)) return op;
    const local = member(user, op.path), previous = member(before, op.path);
    if (!Array.isArray(local)) return op;
    return { ...op, value: op.value.map(model => {
      const existing = local.find(item => item?.id === model.id);
      if (!existing) return model;
      const result = { ...existing, ...model };
      const old = Array.isArray(previous) ? previous.find(item => item?.id === model.id) : undefined;
      for (const key of Object.keys(old ?? {})) if (!Object.hasOwn(model, key)) delete result[key];
      return result;
    }) };
  });
}

/** Owns device-local category grants and composes native files with portable settings. */
export class SyncTargets {
  constructor({ directory, native, settings, plugins, preferences }) {
    this.file = path.join(directory, 'targets.json'); this.native = native; this.settings = settings; this.plugins = plugins; this.preferences = preferences; this.projection = null;
    this.policy = { format: 1, enabled: { ...TARGET_DEFAULTS }, accepted: true, pending: {}, applied: {}, resetTypes: [] };
    this.observed = new Map(); this.available = new Set(); this.issues = [];
    this.sourceChanged = false; this.discoveryChanged = false;
  }
  async start(state) {
    let existingPolicy = false;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      invariant(saved?.format === 1 && typeof saved.accepted === 'boolean' && saved.pending && typeof saved.pending === 'object' && !Array.isArray(saved.pending), 'Invalid synchronization target policy.');
      invariant(saved.enabled && Object.keys(saved.enabled).length === Object.keys(TARGET_DEFAULTS).length && Object.keys(TARGET_DEFAULTS).every(key => typeof saved.enabled[key] === 'boolean'), 'Invalid synchronization targets.');
      for (const pending of Object.values(saved.pending)) {
        validateAsset(pending.asset); invariant(pending.asset.type === 'model-config' && /^[0-9a-f]{64}$/.test(pending.before), 'Invalid pending model configuration.');
      }
      invariant(saved.resetTypes === undefined || (Array.isArray(saved.resetTypes) && saved.resetTypes.every(type => Object.hasOwn(TARGET_DEFAULTS, type))), 'Invalid target baseline reset.');
      invariant(saved.applied === undefined || (saved.applied && typeof saved.applied === 'object' && !Array.isArray(saved.applied)), 'Invalid applied configuration ledger.');
      for (const entry of Object.values(saved.applied ?? {})) { validateAsset(entry.asset); invariant(configTypes.includes(entry.asset.type) && /^[0-9a-f]{64}$/.test(entry.materialized), 'Invalid applied configuration.'); }
      this.policy = { ...saved, applied: saved.applied ?? {}, resetTypes: saved.resetTypes ?? [] }; existingPolicy = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.policy.accepted = !state.vaultId;
      await this.save();
    }
    this.native.targets = this.policy.enabled;
    await this.preferences?.start({ legacy: !!state.vaultId || existingPolicy });
  }
  save() { return atomicJson(this.file, this.policy); }
  enabled(type) { return !!(this.projection?.enabled ?? this.policy.enabled)[type] && (isNative({ type }) || (this.projection?.accepted ?? this.policy.accepted)); }
  isActive(asset) {
    if (isNative(asset)) return this.native.isActive(asset);
    if (asset.type === 'plugins') return this.enabled('plugins') && !!this.plugins?.status().available;
    return configTypes.includes(asset.type) && this.enabled(asset.type) && this.available.has(`${asset.type}:${asset.namespace}`);
  }
  async capture({ includePlugins = true } = {}) {
    this.observed.clear(); this.available.clear(); this.issues = [];
    const plugins = includePlugins && this.enabled('plugins') && this.plugins ? await this.plugins.capture() : [];
    if (!configTypes.some(type => this.enabled(type))) return plugins;
    if (!this.settings?.describe || !this.settings?.mutate) {
      this.issues.push({ code: 'settings-unavailable' }); return plugins;
    }
    const descriptors = await this.settings.describe({ redactSecrets: true });
    const assets = [];
    for (const row of descriptors) for (const type of configTypes) {
      if (!this.enabled(type)) continue;
      const values = projectConfig(type, row.ns, row.user ?? {});
      if (values === undefined) continue;
      const actual = configAsset(type, row.ns, values);
      const applied = this.policy.applied[actual.id];
      if (applied && applied.materialized !== hash(actual)) { delete this.policy.applied[actual.id]; await this.save(); }
      const asset = this.policy.applied[actual.id]?.asset ?? actual;
      const trust = hash(row.value ?? row.user ?? {});
      this.available.add(`${type}:${row.ns}`); this.observed.set(asset.id, { asset, actual, revision: row.revision, user: row.user ?? {}, trust });
      const pending = this.policy.pending[asset.id];
      if (pending && (pending.before !== hash(asset) || pending.trust !== trust)) { delete this.policy.pending[asset.id]; await this.save(); }
      assets.push(this.policy.pending[asset.id]?.asset ?? asset);
    }
    return [...assets, ...plugins];
  }
  async refresh(state) {
    const tracking = await this.native.refresh(state); const configs = await this.capture();
    const current = [...this.native.inventory.items.filter(item => this.native.isActive(item)), ...configs];
    const discovery = hash([current, configs]);
    this.discoveryChanged = this.discoveryHash !== discovery || this.native.discoveryChanged; this.discoveryHash = discovery;
    const localPreferences = this.preferences?.local(state, this.policy.enabled) ?? [];
    const savedConfigs = state.assets.filter(asset => (!isNative(asset) && this.isActive(asset)) || isPreferenceRecord(asset));
    this.sourceChanged = this.native.sourceChanged || hash(hashes([...configs, ...localPreferences])) !== hash(hashes(savedConfigs));
    return tracking;
  }
  async withPreferences(preferences, operation) {
    const previous = this.projection;
    this.projection = preferences?.selectedValues ? { enabled: preferences.selectedValues.targets, accepted: this.policy.accepted || preferences.remotePreferences } : null;
    this.native.targets = this.projection?.enabled ?? this.policy.enabled;
    try { return await operation(); }
    finally { this.projection = previous; this.native.targets = previous?.enabled ?? this.policy.enabled; }
  }
  async prepare(state, remoteAssets, decisions = {}, options = {}) {
    let beforeValues;
    const preferences = this.preferences && !options.restore ? this.preferences.plan(state, remoteAssets,
      () => { beforeValues = this.preferences.localValues(state, this.policy.enabled); return beforeValues; }, decisions) : null;
    const specials = preferences?.local ?? (options.restore ? this.preferences?.local(state, this.policy.enabled) ?? [] : []);
    const priority = preferences?.control && !preferences.controlConflict ? {
      assets: [preferences.control], published: [...remoteAssets.filter(asset => asset.id !== CONTROL_ID), preferences.control].sort((a, b) => a.id.localeCompare(b.id)),
    } : undefined;
    if (preferences && (preferences.blocked || options.preferencesOnly)) {
      const retained = state.assets.filter(asset => !isPreferenceRecord(asset));
      const retainedBase = Object.fromEntries(Object.entries(state.base).filter(([id]) => ![CONTROL_ID, PREFERENCES_ID].includes(id)));
      state.assets = [...retained, ...specials];
      return { local: specials, remote: preferences.remote, base: preferences.base,
        passthrough: [...remoteAssets.filter(asset => !isPreferenceRecord(asset)), ...preferences.passthrough],
        retained, retainedBase, preferencesOnly: true, skipAssets: true, preferences, priority, beforeValues, state, observed: new Map() };
    }
    return this.withPreferences(preferences, async () => {
      const changedTypes = Object.keys(TARGET_DEFAULTS).filter(type => this.projection && this.policy.enabled[type] !== this.projection.enabled[type]);
      const resetTypes = new Set([...this.policy.resetTypes, ...changedTypes]);
      const configs = await this.capture();
      const plan = await this.native.prepare(state, remoteAssets.filter(isNative));
      const active = asset => !isNative(asset) && !isPreferenceRecord(asset) && this.isActive(asset);
      const local = [...plan.local, ...configs, ...specials];
      const remote = [...plan.remote, ...remoteAssets.filter(active), ...(preferences?.remote ?? [])];
      const passthrough = [...plan.passthrough, ...remoteAssets.filter(asset => !isNative(asset) && !isPreferenceRecord(asset) && !active(asset)), ...(preferences?.passthrough ?? [])];
      const base = { ...plan.base, ...(preferences?.base ?? {}) };
      for (const asset of [...plan.local, ...plan.remote, ...configs, ...remote.filter(asset => asset.type === 'plugins')]) {
        if (resetTypes.has(asset.type)) delete base[asset.id];
        else if (!isNative(asset) && Object.hasOwn(state.base, asset.id)) base[asset.id] = state.base[asset.id];
      }
      for (const id of Object.keys(base)) if (!local.some(asset => asset.id === id) && !remote.some(asset => asset.id === id)) delete base[id];
      state.assets = local;
      return { ...plan, local, remote, passthrough, base, observed: new Map(this.observed), preferences, priority, beforeValues, state };
    });
  }
  async commitPriority(plan) {
    const current = plan.preferences.before.valuesHash === null ? undefined : this.preferences.localValues(plan.state, this.policy.enabled);
    this.preferences.assertCurrent(plan.preferences, current);
    await this.preferences.commitControl(plan.preferences, current);
  }
  async applyPreferences(plan, assets) {
    if (!plan.preferences) return;
    const values = plan.preferences.selectedValues;
    if (values) {
      const changed = new Set(Object.keys(TARGET_DEFAULTS).filter(type => this.policy.enabled[type] !== values.targets[type]));
      this.policy.enabled = { ...values.targets };
      this.native.targets = this.projection?.enabled ?? this.policy.enabled;
      if (plan.preferences.remotePreferences) this.policy.accepted = true;
      this.policy.resetTypes = [...new Set([...this.policy.resetTypes, ...changed])];
      for (const [id, item] of Object.entries(this.native.config.known)) if (changed.has(item.type)) this.native.config.baselineResets[id] = item;
      for (const asset of plan.retained ?? []) if (changed.has(asset.type)) delete plan.retainedBase[asset.id];
      plan.state.settings.enabled = values.autoSync; plan.state.settings.intervalSeconds = values.intervalSeconds;
      await this.native.save(); await this.save();
    }
    await this.preferences.commit(plan.preferences, assets, plan.beforeValues);
    plan.preferencesCommitted = true;
  }
  async apply(plan, assets) {
    if (plan.preferences) {
      const current = plan.preferences.before.valuesHash === null ? undefined : this.preferences.localValues(plan.state, this.policy.enabled);
      this.preferences.assertCurrent(plan.preferences, current);
      if (plan.skipAssets) return this.applyPreferences(plan, assets);
    }
    return this.withPreferences(plan.preferences, async () => {
      const changes = [];
      const selected = new Map(assets.filter(asset => !isNative(asset)).map(asset => [asset.id, asset]));
      // Recheck configuration without replacing the plugin snapshot captured before publication.
      await this.capture({ includePlugins: false });
      for (const [id, before] of plan.observed) {
        const current = this.observed.get(id);
        invariant(current && hash(current.asset) === hash(before.asset) && current.revision === before.revision, 'Local settings changed during synchronization. Retry.', 'local-changed');
        const after = selected.get(id) ?? configAsset(before.asset.type, before.asset.namespace, {});
        if (hash(after) !== hash(before.asset)) changes.push({ before, after });
        else if (this.policy.pending[id]) { delete this.policy.pending[id]; await this.save(); }
      }
      await this.native.apply(plan, assets.filter(isNative));
      if (this.enabled('plugins') && this.plugins?.status().available) await this.plugins.apply(assets.filter(asset => asset.type === 'plugins'));
      for (const { before, after } of changes) {
        if (after.type === 'model-config') {
          this.policy.pending[after.id] = { asset: after, before: hash(before.asset), trust: before.trust, previous: before.asset.values };
          await this.save();
        } else {
          await this.settings.mutate(after.namespace, configOps(before.actual.values, after.values), before.revision);
          await this.recordApplied(after);
        }
      }
      await this.applyPreferences(plan, assets);
    });
  }
  async committed(state, published, plan) {
    if (plan?.preferences && !plan.preferencesCommitted) await this.preferences.commit(plan.preferences, published, plan.beforeValues);
    if (!plan?.preferencesOnly) {
      await this.native.committed(state, published.filter(isNative));
      this.policy.resetTypes = this.policy.resetTypes.filter(type => !this.enabled(type)); await this.save();
    }
  }
  status() {
    return { enabled: { ...this.policy.enabled }, needsConsent: !this.policy.accepted,
      syncConfigEnabled: this.preferences?.enabled ?? true,
      settingsAvailable: !!this.settings?.describe && !!this.settings?.mutate, issues: this.issues,
      pendingModels: this.enabled('model-config') ? Object.values(this.policy.pending).map(({ asset, previous }) => ({ id: asset.id, name: asset.name, fingerprint: hash(asset), values: asset.values, previous: previous ?? {} })) : [] };
  }
  async configure(state, input) {
    invariant(input.enabled && typeof input.enabled === 'object' && !Array.isArray(input.enabled), 'Choose synchronization targets.');
    for (const [key, value] of Object.entries(input.enabled)) {
      invariant(Object.hasOwn(TARGET_DEFAULTS, key) && typeof value === 'boolean', 'Invalid synchronization target.');
      if ((key === 'model-config' || key === 'plugins') && value && !this.policy.enabled[key]) invariant(input.confirmRisk === true, 'Acknowledge the increased exposure and attack surface.', 'confirmation-required');
    }
    if (!this.policy.accepted) invariant(input.confirmScope === true, 'Confirm the expanded synchronization scope.', 'confirmation-required');
    await this.preferences?.markEdited();
    const changed = Object.keys(input.enabled).filter(key => input.enabled[key] !== this.policy.enabled[key]);
    this.policy.enabled = { ...this.policy.enabled, ...input.enabled }; this.policy.accepted = true;
    this.native.targets = this.policy.enabled;
    const resetTypes = new Set(changed);
    if (input.confirmScope) resetTypes.add('settings');
    this.policy.resetTypes = [...new Set([...this.policy.resetTypes, ...resetTypes])];
    for (const asset of state.assets) if (resetTypes.has(asset.type)) delete state.base[asset.id];
    for (const [id, item] of Object.entries(this.native.config.known)) if (resetTypes.has(item.type)) { this.native.config.baselineResets[id] = item; delete state.base[id]; }
    state.assets = state.assets.filter(asset => !resetTypes.has(asset.type));
    await this.native.save(); await this.save();
    return { configured: true };
  }
  async recordApplied(asset) {
    const row = (await this.settings.describe({ redactSecrets: true })).find(item => item.ns === asset.namespace);
    invariant(row, 'The settings namespace is no longer available.', 'settings-unavailable');
    const actual = configAsset(asset.type, asset.namespace, projectConfig(asset.type, asset.namespace, row.user ?? {}));
    this.policy.applied[asset.id] = { asset, materialized: hash(actual) }; await this.save();
  }
  async applyModel(id, fingerprint) {
    invariant(this.enabled('model-config'), 'Enable model configuration synchronization first.', 'target-disabled');
    const pending = this.policy.pending[id];
    invariant(pending && hash(pending.asset) === fingerprint, 'The model configuration changed. Review it again.', 'stale-choice');
    await this.capture();
    const current = this.observed.get(id);
    invariant(this.policy.pending[id] === pending && current && hash(current.asset) === pending.before, 'Local model configuration changed. Synchronize and review again.', 'local-changed');
    await this.settings.mutate(pending.asset.namespace, modelOps(current.actual.values, pending.asset.values, current.user), current.revision);
    await this.recordApplied(pending.asset);
    delete this.policy.pending[id]; await this.save();
    return { applied: true };
  }
}
