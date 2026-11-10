import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './local-store.js';
import { NativeFiles } from './native-files.js';
import { hash, hashes, invariant, nativeId, nativeOriginKey, validateOrigin, UUID } from './model.js';

const initial = () => ({ format: 1, agentsEnabled: false, exclusions: {}, pendingCloudDeletes: {}, baselineResets: {}, known: {} });
function isNative(asset) { return !!asset?.origin && ['prompt', 'skill'].includes(asset.type); }
function descriptor(asset) {
  return { id: asset.id, origin: asset.origin, type: asset.type, name: asset.name,
    fileCount: asset.type === 'skill' ? (asset.fileCount ?? Object.keys(asset.files ?? {}).length) : 1 };
}
export class NativeTracking {
  constructor({ directory, roots, targets = { prompt: true, skill: true } }) {
    this.targets = targets;
    this.file = path.join(directory, 'tracking.json'); this.files = new NativeFiles({ roots });
    this.config = initial(); this.savedHash = null; this.inventory = { items: [], issues: [], lastScan: null };
  }
  async start() {
    try {
      const text = await readFile(this.file, 'utf8'); invariant(Buffer.byteLength(text) <= 8 * 1024 * 1024, 'Native tracking settings are too large.');
      const config = JSON.parse(text);
      invariant(config?.format === 1 && typeof config.agentsEnabled === 'boolean', 'Unsupported native tracking settings.');
      for (const field of ['known','exclusions','pendingCloudDeletes','baselineResets']) {
        invariant(config[field] && typeof config[field] === 'object' && !Array.isArray(config[field]), 'Invalid native tracking settings.');
        for (const [id, item] of Object.entries(config[field])) {
          invariant(UUID.test(id) && item && item.id === id, 'Invalid local tracking identifier.');
          validateOrigin(item.origin, item.type); invariant(id === nativeId(item.origin), 'Local tracking target changed identity.');
          invariant(typeof item.name === 'string', 'Invalid local tracking name.');
        }
      }
      this.config = config; this.savedHash = hash(config);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.save();
  }
  async save() {
    const digest = hash(this.config); if (digest === this.savedHash) return;
    await atomicJson(this.file, this.config); this.savedHash = digest;
  }
  options() { return { includeAgents: this.config.agentsEnabled, types: ['prompt', 'skill'].filter(type => this.targets[type] === true),
    excluded: Object.values(this.config.exclusions).map(item => nativeOriginKey(item.origin)) }; }
  isEnabled(asset) { return isNative(asset) && this.targets[asset.type] === true &&
    (asset.origin.root === 'dsh' || asset.origin.root === 'agents' && this.config.agentsEnabled); }
  isActive(asset) { return this.isEnabled(asset) && !this.config.exclusions[asset.id]; }
  remember(assets) {
    for (const asset of assets) if (isNative(asset)) this.config.known[asset.id] = descriptor(asset);
  }
  resetDisabled(state) {
    for (const [id, item] of Object.entries(this.config.known)) if (!this.isEnabled(item)) {
      this.config.baselineResets[id] = descriptor(item); delete state.base[id];
    }
  }
  async refresh(state) {
    const scan = await this.files.scan(this.options());
    for (const item of scan.entries) this.config.known[item.id] = { ...this.config.known[item.id], ...item };
    this.remember(state.assets); this.resetDisabled(state);
    const sourceHash = hash(hashes(scan.assets));
    this.discoveryChanged = this.discoveryHash !== sourceHash; this.discoveryHash = sourceHash;
    this.sourceChanged = sourceHash !== hash(hashes(state.assets.filter(asset => this.isActive(asset))));
    const present = new Map(scan.entries.map(item => [item.id,item]));
    const items = [];
    for (const [id, saved] of Object.entries(this.config.known)) {
      if (!this.isEnabled(saved)) continue;
      const current = present.get(id);
      items.push({ id, origin: saved.origin, type: saved.type, name: saved.name,
        fileCount: current?.fileCount ?? saved.fileCount ?? null, present: !!current?.present,
        excluded: !!this.config.exclusions[id], pendingCloudDelete: !!this.config.pendingCloudDeletes[id],
        cloudPresent: typeof saved.cloudPresent === 'boolean' ? saved.cloudPresent : !!state.base[id] });
    }
    items.sort((a,b) => nativeOriginKey(a.origin).localeCompare(nativeOriginKey(b.origin)));
    this.inventory = { items, issues: scan.issues, lastScan: new Date().toISOString() };
    await this.save(); return this.status();
  }
  status() { return { agentsEnabled: this.config.agentsEnabled, ...this.inventory }; }
  async prepare(state, remoteAssets) {
    const scan = await this.files.scan(this.options());
    invariant(!scan.issues.length, scan.issues[0]?.message ?? 'Native asset discovery failed.', 'native-scan-failed');
    this.remember(state.assets); this.remember(scan.assets);
    for (const item of scan.entries) this.config.known[item.id] = { ...this.config.known[item.id], ...item };
    this.remember(remoteAssets.filter(asset => this.isEnabled(asset))); this.resetDisabled(state);
    const local = scan.assets.filter(asset => this.isActive(asset));
    const remote = remoteAssets.filter(asset => this.isActive(asset));
    const passthrough = remoteAssets.filter(asset => isNative(asset) && !this.isActive(asset) && !this.config.pendingCloudDeletes[asset.id]);
    const base = Object.fromEntries(Object.entries(state.base).filter(([id]) => {
      const known = this.config.known[id]; return !this.config.baselineResets[id] && known && this.isActive(known);
    }));
    state.assets = [...state.assets.filter(asset => !isNative(asset)), ...local];
    await this.save();
    return { base, local, remote, passthrough, before: scan.assets, options: this.options() };
  }
  async apply(plan, assets) {
    return this.files.apply({ before: plan.before, after: assets.filter(asset => this.isActive(asset)), ...plan.options });
  }
  async committed(state, publishedAssets) {
    const cloud = new Set(publishedAssets.filter(isNative).map(asset => asset.id));
    for (const [id,item] of Object.entries(this.config.known)) this.config.known[id] = { ...item, cloudPresent: cloud.has(id) };
    for (const id of Object.keys(this.config.pendingCloudDeletes)) if (!cloud.has(id)) delete this.config.pendingCloudDeletes[id];
    this.config.baselineResets = Object.fromEntries(Object.entries(this.config.baselineResets).filter(([, item]) => !this.isEnabled(item)));
    const local = new Set(state.assets.filter(isNative).map(asset => asset.id));
    for (const id of Object.keys(this.config.known)) {
      if (this.isEnabled(this.config.known[id]) && !cloud.has(id) && !local.has(id) && !this.config.exclusions[id] && !this.config.pendingCloudDeletes[id]) delete this.config.known[id];
    }
    await this.save(); await this.refresh(state);
  }
  async exclude(state, id, confirmCloudDelete) {
    invariant(confirmCloudDelete === true, 'Confirm removal of the current cloud copy before excluding this item.', 'confirmation-required');
    invariant(typeof id === 'string' && UUID.test(id) && Object.hasOwn(this.config.known,id), 'Native tracking item not found.');
    const item = this.config.known[id]; invariant(this.isEnabled(item), 'Native tracking item not found.');
    this.config.exclusions[id] = descriptor(item); this.config.pendingCloudDeletes[id] = descriptor(item);
    await this.save();
    state.assets = state.assets.filter(asset => asset.id !== id); delete state.base[id];
    await this.refresh(state); return { excluded: true, pendingCloudDelete: true };
  }
  async include(state, id) {
    invariant(typeof id === 'string' && UUID.test(id) && Object.hasOwn(this.config.exclusions,id), 'Excluded tracking item not found.');
    const item = this.config.exclusions[id]; invariant(this.isEnabled(item), 'Excluded tracking item not found.');
    this.config.baselineResets[id] = descriptor(item);
    delete this.config.exclusions[id]; delete this.config.pendingCloudDeletes[id]; delete state.base[id];
    await this.save(); await this.refresh(state); return { included: true };
  }
  async configure(state, agentsEnabled, confirmOverwrite) {
    invariant(typeof agentsEnabled === 'boolean', 'Choose whether to synchronize .agents.');
    if (agentsEnabled) invariant(confirmOverwrite === true, 'Confirm that .agents synchronization may overwrite data maintained by other applications.', 'confirmation-required');
    this.config.agentsEnabled = agentsEnabled;
    // Re-enabling starts from an unknown baseline, so existing unrelated files conflict rather than being replaced silently.
    for (const [id,item] of Object.entries(this.config.known)) if (item.origin.root === 'agents') {
      this.config.baselineResets[id] = descriptor(item); delete state.base[id];
    }
    state.assets = state.assets.filter(asset => asset.origin?.root !== 'agents');
    await this.save(); await this.refresh(state); return { agentsEnabled };
  }
}
