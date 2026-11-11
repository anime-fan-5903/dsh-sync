import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const NUMBER = '(?:0|[1-9][0-9]*)';
const IDENTIFIER = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const DIGEST = /^[a-f0-9]{64}$/;
const CODES = new Set(['applied', 'build-blocked', 'incompatible-version', 'restart-required', 'failed']);
const initial = () => ({ format: 1, desired: {}, observed: {}, ignored: {}, results: {} });
function check(condition, code = 'invalid-data') {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function validName(name) { return typeof name === 'string' && name.length <= 214 && NAME.test(name) && name !== 'dsh-sync' && name !== '@anime-fan-5903/dsh-sync'; }
function validVersion(version) { return typeof version === 'string' && version.length <= 128 && VERSION.test(version); }

export function pluginId(name) {
  check(validName(name));
  const bytes = createHash('sha256').update(`dsh-sync-plugin-v1:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function pluginAsset(name, version, enabled, source = 'registry') {
  return validatePlugin({ id: pluginId(name), type: 'plugins', name, version, enabled, source });
}
export function validatePlugin(asset) {
  check(object(asset) && Object.keys(asset).length === 6 && Object.keys(asset).every(key => ['id', 'type', 'name', 'version', 'enabled', 'source'].includes(key)));
  check(validName(asset.name) && typeof asset.enabled === 'boolean');
  check((asset.source === 'registry' && validVersion(asset.version)) || (asset.source === 'builtin' && asset.version === null));
  check(asset.type === 'plugins' && asset.id === pluginId(asset.name));
  return asset;
}
function registrySource(name, source) {
  if (source === name) return true;
  if (typeof source !== 'string' || !source.startsWith(`${name}@`)) return false;
  const selector = source.slice(name.length + 1);
  return selector.length > 0 && selector.length <= 160 && /^[0-9A-Za-z.*^~<>=| +_-]+$/.test(selector) && !/^(?:file|link|workspace|npm|git|http)/i.test(selector);
}
function localRecord(row) {
  const registry = registrySource(row.name, row.source);
  const builtin = row.official === true && row.optional === true && row.availability === 'installation';
  const exportable = (builtin || (registry && row.availability === 'profile' && validVersion(row.version))) &&
    !row.error && !row.readOnlyReason && typeof row.enabled === 'boolean';
  return {
    name: row.name,
    version: !builtin && validVersion(row.version) ? row.version : null,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
    source: builtin ? 'builtin' : registry ? 'registry' : 'unsupported',
    sourceHash: hash(typeof row.source === 'string' ? row.source : null),
    exportable,
  };
}
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, file); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function pendingOutcome(code) { return CODES.has(code) && code !== 'applied'; }
function safeOutcome(result) {
  if (result?.error?.code === 'incompatible-version' || result?.packageResult?.incompatible?.length) return 'incompatible-version';
  if (result?.packageResult?.kind === 'build-blocked' || result?.error?.code === 'build-blocked') return 'build-blocked';
  if (result?.application === 'restart-required') return 'restart-required';
  return result?.application === 'applied' ? 'applied' : 'failed';
}

/** Device-local plugin declarations and explicit, fingerprint-bound installation. */
export class PluginSync {
  constructor({ directory, manager, onChange = () => {} }) {
    this.file = path.join(directory, 'plugins.json'); this.manager = manager; this.onChange = onChange;
    this.state = initial(); this.local = new Map(); this.available = false;
    this.cached = { available: false, pendingCount: 0, items: [] };
    this.active = null; this.disposed = false; this.progress = null; this.capturedHash = null;
  }
  exclusive(operation) {
    if (this.disposed) return Promise.reject(Object.assign(new Error('disposed'), { code: 'disposed' }));
    if (this.active) return Promise.reject(Object.assign(new Error('operation-busy'), { code: 'operation-busy' }));
    const active = Promise.resolve().then(operation);
    this.active = active;
    return active.finally(() => { if (this.active === active) this.active = null; });
  }
  async save() {
    for (const key of ['desired', 'observed', 'ignored', 'results']) check(Object.keys(this.state[key]).length <= 1000);
    check(Buffer.byteLength(JSON.stringify(this.state)) <= 2 * 1024 * 1024);
    await atomicJson(this.file, this.state);
  }
  async start({ enabled = true } = {}) {
    return this.exclusive(async () => {
      check(typeof enabled === 'boolean');
      try {
        const text = await readFile(this.file, 'utf8'); check(Buffer.byteLength(text) <= 2 * 1024 * 1024);
        const state = JSON.parse(text);
        check(object(state) && state.format === 1 && Object.keys(state).length === 5);
        for (const key of ['desired', 'observed', 'ignored', 'results']) check(object(state[key]) && Object.keys(state[key]).length <= 1000);
        for (const [id, asset] of Object.entries(state.desired)) check(validatePlugin(asset).id === id);
        for (const [id, value] of Object.entries(state.observed)) check(/^[a-f0-9-]{36}$/.test(id) && (value === null || DIGEST.test(value)));
        for (const [id, value] of Object.entries(state.ignored)) check(/^[a-f0-9-]{36}$/.test(id) && DIGEST.test(value));
        for (const [id, value] of Object.entries(state.results)) check(/^[a-f0-9-]{36}$/.test(id) && object(value) && Object.keys(value).length === 2 && DIGEST.test(value.fingerprint) && CODES.has(value.code));
        this.state = state;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (enabled) await this.scan();
      else { this.available = false; this.local = new Map(); }
      let changed = false;
      if (this.available) for (const [id, result] of Object.entries(this.state.results)) {
        const desired = this.state.desired[id]; const local = this.local.get(id);
        if (result.code === 'restart-required' && desired && local?.exportable && local.source === desired.source && local.version === desired.version && local.enabled === desired.enabled) {
          delete this.state.results[id]; changed = true;
        }
      }
      if (changed) await this.save();
      this.publish();
    });
  }
  async scan() {
    if (typeof this.manager?.listBundles !== 'function') { this.available = false; this.local = new Map(); return; }
    let rows;
    try { rows = await this.manager.listBundles(); }
    catch { this.available = false; return; }
    if (!Array.isArray(rows)) { this.available = false; return; }
    this.available = true; this.local = new Map();
    for (const row of rows) {
      if ((!row?.installed && row?.availability !== 'installation') || !validName(row.name)) continue;
      const id = pluginId(row.name); const record = localRecord(row);
      if (this.local.has(id)) record.exportable = false;
      this.local.set(id, record);
    }
  }
  fingerprint(asset) { return hash({ desired: asset, local: this.local.get(asset.id) ?? null }); }
  publish() {
    const items = Object.values(this.state.desired).sort((a, b) => a.name.localeCompare(b.name)).map(asset => {
      const local = this.local.get(asset.id); const fingerprint = this.fingerprint(asset);
      let kind = !local ? 'missing' : !local.exportable || local.source !== asset.source ? 'source-difference' : local.version !== asset.version ? 'version-difference' : local.enabled !== asset.enabled ? 'activation' : 'installed';
      const result = this.state.results[asset.id];
      const code = result?.fingerprint === fingerprint ? result.code : undefined;
      if (this.state.ignored[asset.id] === fingerprint && (kind !== 'installed' || pendingOutcome(code))) kind = 'ignored';
      const canInstall = this.available && ((kind === 'missing' && asset.source === 'registry') || kind === 'activation') && code !== 'restart-required' &&
        typeof this.manager?.[kind === 'missing' ? 'installBundle' : 'setBundleEnabled'] === 'function';
      const { id, name, version, enabled, source } = asset;
      return { id, name, version, enabled, source, kind, fingerprint, ...(local?.version ? { localVersion: local.version } : {}), ...(code ? { code } : {}), canInstall };
    });
    this.cached = { available: this.available, pendingCount: items.filter(item => item.kind !== 'ignored' && (item.kind !== 'installed' || pendingOutcome(item.code))).length, items,
      progress: this.progress ? { ...this.progress } : null };
    this.onChange();
  }
  status() { return structuredClone(this.cached); }
  summary() {
    const { items, available, pendingCount } = this.cached;
    return { available, pendingCount, installing: this.progress !== null, installableCount: items.filter(item => item.canInstall).length,
      ignoredCount: items.filter(item => item.kind === 'ignored').length,
      failedCount: items.filter(item => item.kind !== 'ignored' && ['failed', 'build-blocked', 'incompatible-version'].includes(item.code)).length,
      restartRequiredCount: items.filter(item => item.kind !== 'ignored' && item.code === 'restart-required').length };
  }
  async capture() {
    return this.exclusive(async () => {
      await this.scan();
      if (!this.available) { this.capturedHash = null; this.publish(); return []; }
      for (const [id, local] of this.local) {
        const actual = hash(local);
        if (local.exportable && this.state.observed[id] !== actual) {
          this.state.desired[id] = pluginAsset(local.name, local.version, local.enabled, local.source);
        }
      }
      this.observe(); await this.save(); this.capturedHash = hash(Object.fromEntries(this.local)); this.publish();
      return structuredClone(Object.values(this.state.desired));
    });
  }
  observe() {
    for (const id of Object.keys(this.state.observed)) if (!this.local.has(id)) this.state.observed[id] = null;
    for (const [id, local] of this.local) this.state.observed[id] = hash(local);
  }
  async apply(assets) {
    return this.exclusive(async () => {
      check(Array.isArray(assets) && assets.length <= 1000);
      const desired = {};
      for (const asset of assets) { validatePlugin(asset); check(!Object.hasOwn(desired, asset.id)); desired[asset.id] = structuredClone(asset); }
      await this.scan();
      if (this.capturedHash !== null) {
        check(this.available, 'manager-unavailable');
        if (hash(Object.fromEntries(this.local)) !== this.capturedHash) {
          this.publish(); check(false, 'local-changed');
        }
      }
      this.state.desired = desired;
      if (this.available) this.observe();
      await this.save(); this.capturedHash = null; this.publish();
    });
  }
  async committed() { /* Capture and apply persist their own device-local state. */ }
  async ignore(id, fingerprint) {
    return this.exclusive(async () => {
      await this.scan(); this.publish(); check(this.available, 'manager-unavailable');
      const item = this.cached.items.find(item => item.id === id);
      check(item && item.fingerprint === fingerprint, 'stale-choice');
      this.state.ignored[id] = fingerprint; await this.save(); this.publish();
    });
  }
  async install(choices) {
    return this.exclusive(async () => {
      check(Array.isArray(choices) && choices.length > 0 && choices.length <= 1000);
      await this.scan(); this.publish(); check(this.available, 'manager-unavailable');
      const selected = []; const ids = new Set();
      for (const choice of choices) {
        check(object(choice) && Object.keys(choice).length === 2 && typeof choice.id === 'string' && DIGEST.test(choice.fingerprint));
        const item = this.cached.items.find(item => item.id === choice.id);
        check(!ids.has(choice.id) && item && item.fingerprint === choice.fingerprint, 'stale-choice');
        check(item.canInstall, 'manual-required'); ids.add(choice.id); selected.push(item);
      }
      this.progress = { total: selected.length, current: 0, name: selected[0].name }; this.publish();
      try {
        for (const item of selected) {
          this.progress.name = item.name; this.publish();
          // Recheck remaining choices after earlier asynchronous installations.
          await this.scan();
          if (!this.available || this.fingerprint(this.state.desired[item.id]) !== item.fingerprint) {
            check(false, 'stale-choice');
          }
          let code;
          try {
            const result = item.kind === 'missing'
              ? await this.manager.installBundle(`${item.name}@${item.version}`, { enabled: item.enabled, saveExact: true })
              : await this.manager.setBundleEnabled(item.name, item.enabled);
            code = safeOutcome(result);
          } catch (error) { code = safeOutcome({ error, packageResult: error?.packageResult }); }
          await this.scan();
          const actual = this.local.get(item.id);
          if (code === 'applied' && (!this.available || !actual?.exportable || actual.source !== item.source || actual.version !== item.version || actual.enabled !== item.enabled)) code = 'failed';
          this.state.results[item.id] = { fingerprint: this.fingerprint(this.state.desired[item.id]), code };
          if (this.available) this.state.observed[item.id] = actual ? hash(actual) : null;
          this.progress.current++; await this.save(); this.publish();
        }
      } finally { this.progress = null; this.publish(); }
      return this.status();
    });
  }
  async dispose() { this.disposed = true; if (this.active) await this.active.catch(() => {}); }
}
