import { createHash } from 'node:crypto';
import { validateConfig } from './portable-config.js';
import { validatePlugin } from './plugin-sync.js';

export const MAX_BYTES = 24 * 1024 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function invariant(condition, message, code = 'invalid-data') {
  if (!condition) throw Object.assign(new Error(message), { code });
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function hash(value) {
  return value === undefined ? null : createHash('sha256').update(canonical(value)).digest('hex');
}
export function safeRelative(path) {
  invariant(typeof path === 'string' && path.length > 0 && path.length <= 200, 'Invalid resource path.');
  invariant(!/[\\\x00-\x1f:<>\"|?*]/.test(path) && !path.startsWith('/'), 'Unsafe resource path.');
  invariant(path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'Nonportable resource path.');
  return path;
}
export function nativeOriginKey(origin) {
  return `${origin.root}:${origin.path}`;
}
export function validateOrigin(origin, type = origin?.path?.startsWith('skills/') ? 'skill' : 'prompt') {
  invariant(origin && typeof origin === 'object' && !Array.isArray(origin), 'Invalid native origin.');
  invariant(Object.keys(origin).length === 2 && Object.keys(origin).every(key => ['root','path'].includes(key)), 'Unexpected native origin metadata.');
  invariant(['dsh','agents'].includes(origin.root), 'Unsupported native root.');
  safeRelative(origin.path);
  if (type === 'skill') invariant(/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(origin.path), 'Invalid native Skill target.');
  else {
    invariant(type === 'prompt', 'Only prompts and Skills can have native origins.');
    invariant(origin.path === 'AGENTS.md' || ((origin.path.startsWith('prompts/') || origin.path.startsWith('fragments/')) && /\.(md|txt|markdown)$/i.test(origin.path)), 'Native prompt target is outside the supported scope.');
    invariant(!origin.path.split('/').some(part => part.startsWith('.')), 'Hidden native targets are not supported.');
  }
  return origin;
}
export function nativeId(origin) {
  validateOrigin(origin);
  const bytes = createHash('sha256').update(`dsh-sync-native-v1:${nativeOriginKey(origin)}`).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function validateAsset(asset) {
  invariant(asset && UUID.test(asset.id), 'Invalid asset ID.');
  if (asset.type === 'plugins') { validatePlugin(asset); return asset; }
  if (['settings', 'model-config'].includes(asset.type)) { validateConfig(asset); invariant(Buffer.byteLength(canonical(asset)) <= MAX_BYTES, 'Asset is too large.'); return asset; }
  invariant(['prompt', 'skill'].includes(asset.type), 'Unsupported asset type.');
  validateOrigin(asset.origin, asset.type);
  invariant(asset.id === nativeId(asset.origin), 'Native asset ID does not match its logical target.');
  invariant(typeof asset.name === 'string' && asset.name.length > 0 && asset.name.length <= 240, 'Invalid asset name.');
  if (asset.type === 'prompt') invariant(typeof asset.content === 'string', 'Prompt content must be text.');
  if (asset.type === 'skill') {
    invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asset.name), 'Skill names must be kebab-case.');
    invariant(typeof asset.description === 'string' && asset.description.length > 0, 'Skill description is required.');
    invariant(asset.files && typeof asset.files === 'object' && !Array.isArray(asset.files), 'Skill files are required.');
    invariant(typeof asset.files['SKILL.md'] === 'string', 'A skill requires SKILL.md.');
    const seen = new Set();
    for (const [path, encoded] of Object.entries(asset.files)) {
      safeRelative(path);
      invariant(!seen.has(path.toLowerCase()), 'Case-insensitive resource collision.');
      seen.add(path.toLowerCase());
      invariant(typeof encoded === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded) && Buffer.from(encoded, 'base64').toString('base64') === encoded, 'Invalid resource encoding.');
    }
  }
  const allowed = { prompt: ['id','type','name','content','origin'], skill: ['id','type','name','description','files','origin'] }[asset.type];
  if (asset.type === 'skill') {
    invariant(asset.name === asset.origin.path.slice('skills/'.length), 'Native Skill name does not match its target.');
    invariant(asset.description === `Native Skill: ${asset.name}`, 'Native Skill metadata is inconsistent.');
  } else invariant(asset.name === `.${asset.origin.root}/${asset.origin.path}`, 'Native prompt name does not match its target.');
  invariant(Object.keys(asset).every(key => allowed.includes(key)), 'Unexpected asset field.');
  invariant(Buffer.byteLength(canonical(asset)) <= MAX_BYTES, 'Asset is too large.');
  return asset;
}
export function validateAssets(assets) {
  invariant(Array.isArray(assets) && assets.length <= 1000, 'Invalid asset list.');
  const ids = new Set(); const skillNames = new Set(); const targets = new Set();
  for (const asset of assets) {
    validateAsset(asset);
    invariant(!ids.has(asset.id), 'Duplicate asset ID.'); ids.add(asset.id);
    const target = asset.origin ? nativeOriginKey(asset.origin).toLowerCase() : `${asset.type}:${asset.namespace ?? asset.name}`.toLowerCase();
    invariant(!targets.has(target), 'Case-insensitive native target collision.'); targets.add(target);
    if (asset.type === 'skill') {
      const skillKey = `${asset.origin.root}:${asset.name}`;
      invariant(!skillNames.has(skillKey), 'Duplicate skill name.'); skillNames.add(skillKey);
    }
  }
  invariant(Buffer.byteLength(canonical(assets)) <= MAX_BYTES, 'Asset collection is too large.');
  return assets;
}
export function hashes(assets) { return Object.fromEntries(assets.map(asset => [asset.id, hash(asset)])); }
export function merge(base, local, remote, decisions = {}) {
  validateAssets(local); validateAssets(remote);
  const l = new Map(local.map(a => [a.id, a])); const r = new Map(remote.map(a => [a.id, a]));
  const ids = new Set([...Object.keys(base), ...l.keys(), ...r.keys()]);
  const assets = []; const conflicts = []; const discarded = [];
  for (const id of ids) {
    const left = l.get(id); const right = r.get(id); const lh = hash(left); const rh = hash(right); const bh = base[id] ?? null;
    let selected;
    if (lh === rh) selected = left;
    else if (lh === bh) { selected = right; if (left) discarded.push({ side: 'local', asset: left }); }
    else if (rh === bh) selected = left;
    else {
      const choice = decisions[id];
      if (!choice || choice.localHash !== lh || choice.remoteHash !== rh || !['local','remote'].includes(choice.side)) {
        conflicts.push({ id, name: left?.name ?? right?.name ?? id, type: left?.type ?? right?.type,
          ...((left?.origin ?? right?.origin) ? { origin: left?.origin ?? right?.origin } : {}),
          localHash: lh, remoteHash: rh, localDeleted: !left, remoteDeleted: !right });
        continue;
      }
      selected = choice.side === 'local' ? left : right;
      const rejected = choice.side === 'local' ? right : left;
      if (rejected) discarded.push({ side: choice.side === 'local' ? 'remote' : 'local', asset: rejected });
    }
    if (selected) assets.push(selected);
  }
  if (!conflicts.length) validateAssets(assets);
  return { assets: assets.sort((a,b) => a.id.localeCompare(b.id)), conflicts, discarded };
}
