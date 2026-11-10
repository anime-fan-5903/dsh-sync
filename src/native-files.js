import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, readdir, open, mkdir, rename, link, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MAX_BYTES, canonical, hash, invariant, nativeId, nativeOriginKey, safeRelative, validateAsset, validateAssets, validateOrigin } from './model.js';

const TEXT = /\.(?:md|txt|markdown)$/i;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DEPTH = 16;
const MAX_FILES = 5000;
const MAX_SKILL_FILES = 500;
const MAX_ASSETS = 1000;
const MAX_RAW_BYTES = Math.floor(MAX_BYTES / 2);
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const ROOT_NAMES = ['AGENTS.md', 'prompts', 'fragments', 'skills'];

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function excludedPart(name, directory = false) {
  const lower = name.toLowerCase();
  if (directory && name.startsWith('.')) return true;
  if (['.git', 'node_modules', '__pycache__', '.ssh', '.aws', '.azure', '.gnupg', '.ds_store'].includes(lower)) return true;
  if (lower.startsWith('.env') || lower.startsWith('.credentials') || lower.startsWith('.dsh-sync-')) return true;
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..*)?$/.test(lower)) return true;
  if (/^(?:credentials?|secrets?|tokens?|access_token|refresh_token)(?:\.(?:json|ya?ml|toml|ini|txt|xml|config))?$/.test(lower)) return true;
  return /\.(?:pem|key|pfx|p12|keystore|jks|kdbx|swp|swo|tmp|temp)$/.test(lower) || lower.endsWith('~') || lower.startsWith('~$') || lower.startsWith('.#');
}
function cleanIssue(error, origin) {
  const code = typeof error?.code === 'string' && /^[a-zA-Z0-9_-]+$/.test(error.code) ? error.code : 'native-invalid';
  return { ...(origin ? { origin } : {}), code, message: code.startsWith('native-') || code === 'local-changed' ? error.message : `Unable to inspect an allowed native asset (${code}).` };
}
function equalFileInfo(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function assetName(origin, type) { return type === 'skill' ? origin.path.split('/')[1] : `.${origin.root}/${origin.path}`; }
function optionsOf({ includeAgents = false, excluded = [], types = ['prompt', 'skill'] } = {}) {
  invariant(typeof includeAgents === 'boolean' && Array.isArray(excluded) && excluded.every(key => typeof key === 'string') &&
    Array.isArray(types) && types.every(type => ['prompt', 'skill'].includes(type)), 'Invalid native synchronization options.');
  return { includeAgents, excluded: new Set(excluded), types: new Set(types) };
}
function scoped(asset, options) { return options.types.has(asset.type) && (asset.origin.root === 'dsh' || options.includeAgents) && !options.excluded.has(nativeOriginKey(asset.origin)); }
function resourcePaths(asset) {
  if (asset.type === 'prompt') {
    safeRelative(asset.origin.path);
    const components = asset.origin.path.split('/');
    invariant(components.every((part, index) => !excludedPart(part, index < components.length - 1)), 'A native prompt targets an excluded path.', 'native-unsafe-resource');
    invariant(Math.max(0, components.length - 2) <= MAX_DEPTH, 'A native prompt directory exceeds the depth limit.', 'native-limit');
    invariant(Buffer.byteLength(asset.content, 'utf8') <= MAX_RAW_BYTES, 'A native prompt exceeds the readable size limit.', 'native-limit');
    return new Map([[asset.origin.path, Buffer.from(asset.content, 'utf8')]]);
  }
  const resources = Object.entries(asset.files);
  invariant(resources.length <= MAX_SKILL_FILES, 'A native Skill exceeds the resource-count limit.', 'native-limit');
  const result = new Map(); let total = 0;
  for (const [relative, encoded] of resources) {
    safeRelative(relative);
    const components = relative.split('/');
    invariant(components.every((part, index) => !excludedPart(part, index < components.length - 1)), 'A native Skill contains an excluded or sensitive resource path.', 'native-unsafe-resource');
    invariant(components.length - 1 <= MAX_DEPTH, 'A native Skill exceeds the depth limit.', 'native-limit');
    const fullRelative = `${asset.origin.path}/${relative}`;
    safeRelative(fullRelative);
    total += Buffer.byteLength(encoded, 'base64');
    invariant(total <= MAX_RAW_BYTES, 'A native Skill exceeds the readable size limit.', 'native-limit');
    result.set(fullRelative, Buffer.from(encoded, 'base64'));
  }
  return result;
}
function assertNoPathCollisions(assets) {
  const paths = new Set(); const generated = new Set();
  const account = key => {
    let current = key;
    for (;;) {
      generated.add(current);
      invariant(generated.size <= MAX_FILES, 'Generated native files and directories exceed the discovery limit.', 'native-limit');
      const slash = current.lastIndexOf('/');
      if (slash === -1) break;
      current = current.slice(0, slash);
    }
  };
  for (const asset of assets.values()) {
    for (const relative of resourcePaths(asset).keys()) {
      const key = `${asset.origin.root}:${relative}`.toLowerCase();
      invariant(!paths.has(key), 'Native assets contain colliding file paths.', 'native-case-collision'); paths.add(key); account(key);
    }
  }
  for (const value of paths) {
    let parent = value.slice(0, value.lastIndexOf('/'));
    while (parent.includes('/')) {
      invariant(!paths.has(parent), 'A native file overlaps a native directory.', 'native-path-collision');
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
    invariant(!paths.has(parent), 'A native file overlaps a native directory.', 'native-path-collision');
  }
}

/** Reads and writes only explicitly authorized native roots; it never discovers home directories. */
export class NativeFiles {
  constructor({ roots }) {
    invariant(roots && typeof roots.dsh === 'string' && path.isAbsolute(roots.dsh), 'An absolute DSH root is required.');
    invariant(Object.keys(roots).every(key => ['dsh', 'agents'].includes(key)), 'Unknown native root.');
    this.roots = { dsh: path.resolve(roots.dsh) };
    if (roots.agents !== undefined) {
      invariant(typeof roots.agents === 'string' && path.isAbsolute(roots.agents), 'The agents root must be absolute.');
      this.roots.agents = path.resolve(roots.agents);
      const left = this.roots.dsh.toLowerCase(); const right = this.roots.agents.toLowerCase();
      invariant(left !== right && !left.startsWith(`${right}${path.sep}`) && !right.startsWith(`${left}${path.sep}`), 'Native roots must not overlap.');
    }
  }
  root(name) {
    invariant(this.roots[name], 'The requested native root is not configured.', 'native-root-missing'); return this.roots[name];
  }
  async checked(name, relative = '', caseCheck = false) {
    const root = this.root(name);
    if (relative) {
      // Internal recovery storage adds a fixed prefix to an already validated
      // native path. Do not charge that prefix against the protocol path limit.
      const saved = /^\.dsh-sync-recovery\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(.+)$/.exec(relative);
      safeRelative(saved ? saved[1] : relative);
    }
    const absolute = path.join(root, ...relative.split('/').filter(Boolean));
    const parsed = path.parse(root); const rootParts = path.relative(parsed.root, root).split(path.sep).filter(Boolean);
    const components = [...rootParts, ...relative.split('/').filter(Boolean)]; let current = parsed.root;
    let info = await lstat(current);
    if (info.isSymbolicLink()) throw failure('native-linked-path', 'Native roots and their parents cannot be links.');
    for (let index = 0; index < components.length; index++) {
      if (!info.isDirectory()) throw failure('native-invalid-parent', 'A native path parent is not a directory.');
      if (caseCheck && index >= rootParts.length) {
        const siblings = await readdir(current);
        const matches = siblings.filter(value => value.toLowerCase() === components[index].toLowerCase());
        if (matches.length > 1 || matches.some(value => value !== components[index])) throw failure('native-case-collision', 'A native path differs only by letter case.');
      }
      current = path.join(current, components[index]);
      try { info = await lstat(current); }
      catch (error) { if (error.code === 'ENOENT') return { absolute, exists: false, info: null }; throw error; }
      if (info.isSymbolicLink()) throw failure('native-linked-path', 'Native paths cannot contain symbolic links or junctions.');
    }
    return { absolute, exists: true, info };
  }
  async readBytes(name, relative) {
    const initial = await this.checked(name, relative);
    if (!initial.exists) return null;
    if (!initial.info.isFile()) throw failure('native-invalid-file', 'An allowed native file is not a regular file.');
    if (initial.info.size > MAX_RAW_BYTES) throw failure('native-limit', 'A native file exceeds the size limit.');
    const handle = await open(initial.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!equalFileInfo(initial.info, before)) throw failure('local-changed', 'A native file changed before it could be read.');
      const chunks = []; let received = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(65536, MAX_RAW_BYTES - received + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        received += bytesRead;
        if (received > MAX_RAW_BYTES) throw failure('native-limit', 'A native file exceeds the size limit.');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const bytes = Buffer.concat(chunks, received); const after = await handle.stat();
      const final = await this.checked(name, relative);
      if (bytes.length > MAX_RAW_BYTES || !equalFileInfo(before, after) || !final.exists || !equalFileInfo(after, final.info)) throw failure('local-changed', 'A native file changed while it was being read.');
      return bytes;
    } finally { await handle.close(); }
  }
  identity(origin, type) {
    validateOrigin(origin, type); const name = assetName(origin, type);
    invariant(name.length <= 240, 'A native asset name exceeds the size limit.', 'native-limit');
    return { id: nativeId(origin), origin: { ...origin }, type, name };
  }
  async directory(name, relative, context) {
    const inspected = await this.checked(name, relative);
    if (!inspected.exists) return null;
    if (!inspected.info.isDirectory()) throw failure('native-invalid-directory', 'An allowed native directory is not a directory.');
    const entries = (await readdir(inspected.absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const seen = new Set();
    for (const entry of entries) {
      if (excludedPart(entry.name, entry.isDirectory())) continue;
      const folded = entry.name.toLowerCase();
      if (seen.has(folded)) throw failure('native-case-collision', 'Native entries differ only by letter case.');
      seen.add(folded);
    }
    context.visited += entries.length;
    if (context.visited > MAX_FILES) throw failure('native-limit', 'Native discovery exceeds the file-count limit.');
    return entries;
  }
  async inventoryCount(name, relative, depth = 0, budget = { visited: 0 }) {
    if (depth > MAX_DEPTH || budget.visited >= MAX_FILES) return 0;
    try {
      const inspected = await this.checked(name, relative);
      if (!inspected.exists || !inspected.info.isDirectory()) return 0;
      let count = 0;
      for (const entry of await readdir(inspected.absolute, { withFileTypes: true })) {
        if (++budget.visited > MAX_FILES) break;
        if (excludedPart(entry.name, entry.isDirectory()) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) count += await this.inventoryCount(name, `${relative}/${entry.name}`, depth + 1, budget);
        else if (entry.isFile()) count++;
      }
      return count;
    } catch { return 0; }
  }
  async scan(input = {}) {
    const options = optionsOf(input); const result = { assets: [], entries: [], issues: [] };
    if (!options.types.size) return result;
    const context = { visited: 0, bytes: 2 };
    const issue = (error, origin) => result.issues.push(cleanIssue(error, origin));
    const add = asset => {
      validateAsset(asset); context.bytes += Buffer.byteLength(canonical(asset)) + 1;
      if (result.assets.length >= MAX_ASSETS || context.bytes > MAX_BYTES) throw failure('native-limit', 'Native assets exceed the collection limit.');
      result.assets.push(asset);
    };
    const prompt = async origin => {
      let entry;
      try {
        const identity = this.identity(origin, 'prompt');
        entry = { ...identity, fileCount: 1, present: true, excluded: options.excluded.has(nativeOriginKey(origin)) };
        result.entries.push(entry);
        if (entry.excluded) return;
        const inspected = await this.checked(origin.root, origin.path);
        if (!inspected.exists) throw failure('local-changed', 'A native prompt disappeared during discovery.');
        if (!inspected.info.isFile()) throw failure('native-invalid-file', 'An allowed native prompt is not a regular file.');
        const bytes = await this.readBytes(origin.root, origin.path);
        if (!bytes) throw failure('local-changed', 'A native prompt disappeared during discovery.');
        let content; try { content = DECODER.decode(bytes); } catch { throw failure('native-invalid-utf8', 'A native prompt is not valid UTF-8 text.'); }
        add({ ...identity, content });
      } catch (error) { issue(error, origin); }
    };
    const walkPrompts = async (name, relative, depth = 0) => {
      try {
        if (depth > MAX_DEPTH) throw failure('native-limit', 'A native prompt directory exceeds the depth limit.');
        const entries = await this.directory(name, relative, context); if (!entries) return;
        for (const entry of entries) {
          if (excludedPart(entry.name, entry.isDirectory())) continue;
          const child = `${relative}/${entry.name}`; safeRelative(child);
          if (entry.isSymbolicLink()) {
            const origin = { root: name, path: child };
            if (TEXT.test(entry.name)) await prompt(origin);
            else issue(failure('native-linked-path', 'A native prompt path is a link.'), origin);
            continue;
          }
          if (entry.isDirectory()) await walkPrompts(name, child, depth + 1);
          else if (TEXT.test(entry.name)) await prompt({ root: name, path: child });
        }
      } catch (error) { issue(error, { root: name, path: relative }); }
    };
    const skill = async origin => {
      try {
        const identity = this.identity(origin, 'skill'); const isExcluded = options.excluded.has(nativeOriginKey(origin));
        const entry = { ...identity, fileCount: 0, present: true, excluded: isExcluded }; result.entries.push(entry);
        if (isExcluded) { entry.fileCount = await this.inventoryCount(origin.root, origin.path); return; }
        const marker = await this.checked(origin.root, `${origin.path}/SKILL.md`);
        if (!marker.exists || !marker.info.isFile()) throw failure('native-missing-skill', 'A native Skill directory does not contain a regular SKILL.md.');
        const files = Object.create(null); let total = 0;
        const walk = async (relative = '', depth = 0) => {
          if (depth > MAX_DEPTH) throw failure('native-limit', 'A native Skill exceeds the depth limit.');
          const entries = await this.directory(origin.root, relative ? `${origin.path}/${relative}` : origin.path, context);
          if (!entries) throw failure('local-changed', 'A native Skill directory disappeared during discovery.');
          for (const child of entries) {
            if (excludedPart(child.name, child.isDirectory())) continue;
            const resource = relative ? `${relative}/${child.name}` : child.name; safeRelative(resource);
            if (child.isSymbolicLink()) throw failure('native-linked-path', 'A native Skill resource is a link.');
            if (child.isDirectory()) { await walk(resource, depth + 1); continue; }
            if (!child.isFile()) throw failure('native-invalid-file', 'A native Skill resource is not a regular file.');
            entry.fileCount++; if (entry.fileCount > MAX_SKILL_FILES) throw failure('native-limit', 'A native Skill exceeds the resource-count limit.');
            if (!isExcluded) {
              const bytes = await this.readBytes(origin.root, `${origin.path}/${resource}`);
              if (!bytes) throw failure('local-changed', 'A native Skill resource disappeared during discovery.');
              total += bytes.length; if (total > MAX_RAW_BYTES) throw failure('native-limit', 'A native Skill exceeds the size limit.');
              files[resource] = bytes.toString('base64');
            }
          }
        };
        await walk();
        if (!isExcluded) {
          try { DECODER.decode(Buffer.from(files['SKILL.md'], 'base64')); } catch { throw failure('native-invalid-utf8', 'Native SKILL.md is not valid UTF-8 text.'); }
          add({ ...identity, description: `Native Skill: ${identity.name}`, files });
        }
      } catch (error) { issue(error, origin); }
    };
    for (const name of options.includeAgents ? ['dsh', 'agents'] : ['dsh']) {
      try {
        const root = await this.checked(name); if (!root.exists) continue;
        if (!root.info.isDirectory()) throw failure('native-invalid-directory', 'A configured native root is not a directory.');
        const names = await readdir(root.absolute); const canonicalNames = new Set();
        for (const expected of ROOT_NAMES) {
          if (!options.types.has(expected === 'skills' ? 'skill' : 'prompt')) continue;
          const matches = names.filter(value => value.toLowerCase() === expected.toLowerCase());
          if (matches.length > 1 || matches.some(value => value !== expected)) {
            issue(failure('native-case-collision', 'A native discovery path differs only by letter case.'), { root: name, path: expected });
          } else if (matches.length) canonicalNames.add(expected);
        }
        if (canonicalNames.has('AGENTS.md')) await prompt({ root: name, path: 'AGENTS.md' });
        for (const directory of ['prompts', 'fragments']) if (canonicalNames.has(directory)) await walkPrompts(name, directory);
        if (canonicalNames.has('skills')) {
          const entries = await this.directory(name, 'skills', context);
          for (const entry of entries ?? []) {
            if (excludedPart(entry.name, entry.isDirectory())) continue;
            const origin = { root: name, path: `skills/${entry.name}` };
            if (entry.isSymbolicLink()) {
              if (SKILL_NAME.test(entry.name)) {
                const isExcluded = options.excluded.has(nativeOriginKey(origin));
                result.entries.push({ ...this.identity(origin, 'skill'), fileCount: 0, present: true, excluded: isExcluded });
                if (!isExcluded) issue(failure('native-linked-path', 'A native Skill directory is a link.'), origin);
              } else issue(failure('native-linked-path', 'A native Skill directory is a link.'), origin);
              continue;
            }
            if (!entry.isDirectory()) continue;
            if (!SKILL_NAME.test(entry.name)) { issue(failure('native-invalid-name', 'A native Skill directory name must be kebab-case.'), origin); continue; }
            await skill(origin);
          }
        }
      } catch (error) { issue(error, { root: name, path: '' }); }
    }
    result.assets.sort((a, b) => nativeOriginKey(a.origin).localeCompare(nativeOriginKey(b.origin), 'en'));
    result.entries.sort((a, b) => nativeOriginKey(a.origin).localeCompare(nativeOriginKey(b.origin), 'en'));
    result.issues.sort((a, b) => `${a.origin?.root ?? ''}:${a.origin?.path ?? ''}:${a.code}`.localeCompare(`${b.origin?.root ?? ''}:${b.origin?.path ?? ''}:${b.code}`, 'en'));
    return result;
  }
  selected(assets, options) {
    validateAssets(assets);
    const result = new Map(); const seen = new Set();
    for (const asset of assets) {
      validateAsset(asset); validateOrigin(asset.origin, asset.type);
      invariant(asset.id === nativeId(asset.origin), 'A native asset has an inconsistent ID.', 'native-invalid-id');
      invariant(asset.name === assetName(asset.origin, asset.type), 'A native asset has an inconsistent name.', 'native-invalid-name');
      if (asset.type === 'skill') invariant(asset.description === `Native Skill: ${asset.name}`, 'A native Skill has inconsistent metadata.', 'native-invalid-name');
      const key = nativeOriginKey(asset.origin); invariant(!seen.has(key), 'Duplicate native origin.', 'native-duplicate'); seen.add(key);
      if (scoped(asset, options)) result.set(key, asset);
    }
    assertNoPathCollisions(result); return result;
  }
  async assertSnapshot(expected, input) {
    const scanned = await this.scan(input);
    if (scanned.issues.length) throw Object.assign(failure('local-changed', 'Native discovery could not confirm an unchanged local snapshot.'), { issues: scanned.issues });
    const current = new Map(scanned.assets.map(asset => [nativeOriginKey(asset.origin), asset]));
    if (current.size !== expected.size || [...expected].some(([key, asset]) => hash(current.get(key)) !== hash(asset))) throw failure('local-changed', 'Native files changed outside DSH Sync. Retry from a fresh snapshot.');
  }
  async assertFile(name, relative, expected) {
    const inspected = await this.checked(name, relative, true);
    if (expected === undefined) {
      if (inspected.exists) throw failure('local-changed', 'A new native target already exists.');
      return;
    }
    const bytes = await this.readBytes(name, relative);
    if (!bytes || !bytes.equals(expected)) throw failure('local-changed', 'A native target changed before replacement.');
  }
  async ensureParents(name, relative) {
    const root = this.root(name); const parent = path.dirname(path.join(root, ...relative.split('/')));
    const parsed = path.parse(parent); let current = parsed.root;
    for (const component of path.relative(parsed.root, parent).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw failure('native-linked-path', 'A native write parent is not a real directory.');
    }
    await this.checked(name, relative, true);
  }
  async retainTarget(name, relative, expected, recovery) {
    await this.assertFile(name, relative, expected);
    if (!recovery[name]) {
      const directory = '.dsh-sync-recovery';
      await this.ensureParents(name, `${directory}/entry`);
      const parent = await this.checked(name, directory, true);
      if ((await readdir(parent.absolute)).length >= 10) throw failure('native-recovery-full', 'Native recovery storage is full. Preserve or remove old .dsh-sync-recovery batches before retrying.');
      const batch = `${directory}/${randomUUID()}`;
      await mkdir((await this.checked(name, batch, true)).absolute, { mode: 0o700 });
      recovery[name] = batch;
    }
    const saved = `${recovery[name]}/${relative}`;
    await this.ensureParents(name, saved);
    await this.assertFile(name, relative, expected);
    const source = await this.checked(name, relative, true);
    const destination = await this.checked(name, saved, true);
    // Move the actual directory entry, not a previously read copy. Keep its inode even
    // on success: an editor may still hold a writable handle to the displaced file.
    await rename(source.absolute, destination.absolute);
    const bytes = await this.readBytes(name, saved);
    if (!bytes || !bytes.equals(expected)) throw failure('local-changed', 'A native target changed during removal; its actual file is retained in .dsh-sync-recovery.');
  }
  async atomicWrite(name, relative, bytes, expected, recovery = {}) {
    await this.assertFile(name, relative, expected); await this.ensureParents(name, relative);
    const directory = path.posix.dirname(relative); const temp = `${directory === '.' ? '' : `${directory}/`}.dsh-sync-${randomUUID()}.tmp`;
    const inspected = await this.checked(name, temp, true);
    if (inspected.exists) throw failure('local-changed', 'A native temporary file already exists.');
    const handle = await open(inspected.absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    let owned;
    try {
      await handle.writeFile(bytes); await handle.sync(); owned = await handle.stat(); await handle.close();
      // Windows may finalize modification timestamps only when the write handle closes.
      const closed = await this.checked(name, temp);
      if (!closed.exists || closed.info.dev !== owned.dev || closed.info.ino !== owned.ino || closed.info.size !== bytes.length) throw failure('local-changed', 'A native temporary file changed after writing.');
      owned = closed.info;
      const written = await this.readBytes(name, temp);
      if (!written || !written.equals(bytes)) throw failure('local-changed', 'A native temporary file has unexpected contents.');
      await this.assertFile(name, relative, expected);
      const temporary = await this.checked(name, temp);
      if (!temporary.exists || !equalFileInfo(temporary.info, owned)) throw failure('local-changed', 'A native temporary file changed before publication.');
      const target = await this.checked(name, relative, true);
      if (expected !== undefined) await this.retainTarget(name, relative, expected, recovery);
      // Hard-link publication is atomic and fails if an external editor creates a
      // new target. A rename here would silently replace that newly created file.
      try { await link(temporary.absolute, target.absolute); }
      catch (error) { if (error.code === 'EEXIST') throw failure('local-changed', 'A native target appeared before publication; no file was overwritten.'); throw error; }
    } finally {
      await handle.close().catch(() => {});
      try { const temporary = await this.checked(name, temp); if (temporary.exists && owned && temporary.info.ino === owned.ino && temporary.info.dev === owned.dev && temporary.info.isFile()) await unlink(temporary.absolute); } catch {}
    }
  }
  async removeEmptyParents(name, relative) {
    const root = this.root(name); let relativeParent = path.posix.dirname(relative);
    while (relativeParent !== '.') {
      const inspected = await this.checked(name, relativeParent);
      if (!inspected.exists) { relativeParent = path.posix.dirname(relativeParent); continue; }
      if (!inspected.info.isDirectory()) throw failure('local-changed', 'A native directory changed during removal.');
      try { await rmdir(inspected.absolute); }
      catch (error) { if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return; if (error.code !== 'ENOENT') throw error; }
      relativeParent = path.posix.dirname(relativeParent);
    }
    // The caller-authorized root itself is deliberately retained.
    invariant(path.resolve(root) === root, 'Invalid native root.');
  }
  async assertTrackedSkill(asset, remainingFiles = asset.files) {
    const allowed = new Set(Object.keys(remainingFiles)); const directories = new Set();
    for (const file of allowed) { let directory = path.posix.dirname(file); while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory); } }
    const walk = async (relative = '') => {
      const inspected = await this.checked(asset.origin.root, relative ? `${asset.origin.path}/${relative}` : asset.origin.path);
      if (!inspected.exists || !inspected.info.isDirectory()) throw failure('local-changed', 'A native Skill changed before deletion.');
      for (const entry of await readdir(inspected.absolute, { withFileTypes: true })) {
        const resource = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw failure('local-changed', 'A native Skill gained a linked resource before deletion.');
        if (entry.isDirectory()) {
          if (!directories.has(resource)) throw failure('local-changed', 'A native Skill contains untracked directories; deletion was stopped.');
          await walk(resource);
        } else if (!entry.isFile() || !allowed.has(resource)) throw failure('local-changed', 'A native Skill contains untracked files; deletion was stopped.');
      }
    };
    await walk();
  }
  async apply({ before, after, includeAgents = false, excluded = [], types = ['prompt', 'skill'] }) {
    const input = { includeAgents, excluded, types }; const options = optionsOf(input);
    const previous = this.selected(before, options); const desired = this.selected(after, options);
    await this.assertSnapshot(previous, input);
    const changes = [...new Set([...previous.keys(), ...desired.keys()])].sort().filter(key => hash(previous.get(key)) !== hash(desired.get(key)));
    const oldPaths = new Map(); const newPaths = new Map();
    for (const asset of previous.values()) for (const [relative, bytes] of resourcePaths(asset)) oldPaths.set(`${asset.origin.root}:${relative}`, { root: asset.origin.root, relative, bytes });
    for (const asset of desired.values()) for (const [relative, bytes] of resourcePaths(asset)) newPaths.set(`${asset.origin.root}:${relative}`, { root: asset.origin.root, relative, bytes });
    const removed = [...oldPaths].filter(([key]) => !newPaths.has(key)).map(([, file]) => file);
    const removedKeys = new Set(removed.map(file => `${file.root}:${file.relative}`));
    // Validate the current tree, then model targets after tracked obstructions are
    // removed. Never accept an untracked file/directory as a planned obstruction.
    for (const file of oldPaths.values()) await this.assertFile(file.root, file.relative, file.bytes);
    const checkTarget = async (root, relative) => {
      const components = relative.split('/');
      for (let index = 1; index <= components.length; index++) {
        const prefix = components.slice(0, index).join('/');
        const inspected = await this.checked(root, prefix);
        const parent = path.posix.dirname(prefix);
        const parentPath = await this.checked(root, parent === '.' ? '' : parent);
        if (!parentPath.exists) return;
        const siblings = await readdir(parentPath.absolute);
        const matches = siblings.filter(value => value.toLowerCase() === components[index - 1].toLowerCase());
        if (matches.some(value => value !== components[index - 1])) {
          for (const match of matches) {
            const actual = parent === '.' ? match : `${parent}/${match}`;
            await removable(root, actual);
          }
          return;
        }
        if (!inspected.exists) return;
        if (index === components.length) {
          if (oldPaths.has(`${root}:${prefix}`)) return;
          await removable(root, prefix); return;
        }
        if (!inspected.info.isDirectory()) { await removable(root, prefix); return; }
      }
    };
    const removable = async (root, relative) => {
      const inspected = await this.checked(root, relative);
      if (!inspected.exists) return;
      if (inspected.info.isFile() && removedKeys.has(`${root}:${relative}`)) return;
      if (inspected.info.isDirectory()) {
        const entries = await readdir(inspected.absolute);
        // Empty untracked directories are not permission to remove user resources.
        const tracked = removed.some(file => file.root === root && file.relative.startsWith(`${relative}/`));
        if (tracked) { for (const entry of entries) await removable(root, `${relative}/${entry}`); return; }
      }
      throw failure('local-changed', 'A native target is obstructed by an untracked resource.');
    };
    for (const file of newPaths.values()) await checkTarget(file.root, file.relative);
    for (const key of changes) {
      const oldAsset = previous.get(key); const newAsset = desired.get(key);
      if (oldAsset?.type === 'skill' && !newAsset) await this.assertTrackedSkill(oldAsset);
    }
    const recovery = {};
    const order = (a, b) => {
      const markerA = a.relative.endsWith('/SKILL.md'); const markerB = b.relative.endsWith('/SKILL.md');
      return Number(markerA) - Number(markerB) || b.relative.split('/').length - a.relative.split('/').length || a.relative.localeCompare(b.relative, 'en');
    };
    // Remove obsolete tracked files first, deepest first, so legal file/directory
    // transitions and case-only renames no longer obstruct incoming resources.
    for (const file of removed.sort(order)) {
      const oldAsset = [...previous.values()].find(asset => asset.origin.root === file.root && asset.type === 'skill' && `${asset.origin.path}/SKILL.md` === file.relative);
      if (oldAsset && !desired.has(nativeOriginKey(oldAsset.origin))) await this.assertTrackedSkill(oldAsset, { 'SKILL.md': oldAsset.files['SKILL.md'] });
      await this.retainTarget(file.root, file.relative, file.bytes, recovery);
      await this.removeEmptyParents(file.root, file.relative);
    }
    for (const file of [...newPaths.values()].sort(order)) {
      const old = oldPaths.get(`${file.root}:${file.relative}`);
      if (old && old.bytes.equals(file.bytes)) continue;
      await this.atomicWrite(file.root, file.relative, file.bytes, old?.bytes, recovery);
    }
    await this.assertSnapshot(desired, input);
    return { changed: changes.length };
  }
}
