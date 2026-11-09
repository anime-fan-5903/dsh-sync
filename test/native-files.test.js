import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { NativeFiles } from '../src/native-files.js';
import { nativeId, nativeOriginKey } from '../src/model.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-native-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const roots = { dsh: path.join(base, '.dsh'), agents: path.join(base, '.agents') };
  const write = async (relative, value, root = 'dsh') => {
    const absolute = path.join(roots[root], ...relative.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, value);
  };
  return { base, roots, write, files: new NativeFiles({ roots }) };
}
function prompt(relative, content, root = 'dsh') {
  const origin = { root, path: relative };
  return { id: nativeId(origin), origin, type: 'prompt', name: `.${root}/${relative}`, content };
}
function skill(name, resources = { 'SKILL.md': '# Example' }, root = 'dsh') {
  const origin = { root, path: `skills/${name}` };
  return { id: nativeId(origin), origin, type: 'skill', name, description: `Native Skill: ${name}`,
    files: Object.fromEntries(Object.entries(resources).map(([file, value]) => [file, Buffer.from(value).toString('base64')])) };
}
async function directoryLink(t, source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try { await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir'); return true; }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('This environment does not permit fixture directory links.'); return false; } throw error; }
}

test('discovers only allowed native assets with stable identities and complete safe Skill resources', async t => {
  const { files, write } = await fixture(t);
  await write('AGENTS.md', '# Global instructions\n');
  await write('prompts/nested/example.MD', 'A prompt'); await write('fragments/rules.txt', 'A fragment');
  await write('skills/example/SKILL.md', '# Example Skill'); await write('skills/example/references/source.md', 'Reference');
  await write('skills/example/assets/example.bin', Buffer.from([0, 1, 2, 255]));
  await write('skills/example/.env.local', 'NEVER-EXPORT'); await write('skills/example/id_ed25519', 'NEVER-EXPORT');
  await write('skills/example/credentials.json', 'NEVER-EXPORT'); await write('skills/example/key.pem', 'NEVER-EXPORT');
  await write('skills/example/.cache/ignored.md', 'NEVER-EXPORT'); await write('skills/example/node_modules/ignored.js', 'NEVER-EXPORT');
  await write('prompts/.tmp/ignored.md', 'NEVER-EXPORT'); await write('prompts/ignored.json', 'NEVER-EXPORT');
  await write('profile.json', 'NEVER-EXPORT'); await write('state.json', 'NEVER-EXPORT'); await write('.credentials.yaml', 'NEVER-EXPORT');
  await write('AGENTS.md', 'Optional root', 'agents');
  const result = await files.scan();
  assert.deepEqual(result.issues, []); assert.equal(result.assets.length, 4);
  assert.deepEqual(result.assets.map(asset => nativeOriginKey(asset.origin)), ['dsh:AGENTS.md', 'dsh:fragments/rules.txt', 'dsh:prompts/nested/example.MD', 'dsh:skills/example']);
  for (const asset of result.assets) assert.equal(asset.id, nativeId(asset.origin));
  const imported = result.assets.find(asset => asset.type === 'skill');
  assert.deepEqual(Object.keys(imported.files).sort(), ['SKILL.md', 'assets/example.bin', 'references/source.md']);
  assert.deepEqual(Buffer.from(imported.files['assets/example.bin'], 'base64'), Buffer.from([0, 1, 2, 255]));
  assert.ok(!JSON.stringify(result).includes('NEVER-EXPORT'));
  assert.equal(result.entries.find(entry => entry.type === 'skill').fileCount, 3);
  assert.equal((await files.scan({ includeAgents: true })).assets.length, 5);
});

test('excluded assets expose metadata without reading even invalid UTF-8 content', async t => {
  const { files, write } = await fixture(t);
  await write('AGENTS.md', Buffer.from([255])); await write('skills/excluded/SKILL.md', Buffer.from([255]));
  await write('skills/excluded/resource.bin', Buffer.from([255]));
  const original = files.readBytes.bind(files); let contentReads = 0;
  files.readBytes = async (...args) => { contentReads++; return original(...args); };
  const result = await files.scan({ excluded: ['dsh:AGENTS.md', 'dsh:skills/excluded'] });
  assert.deepEqual(result.assets, []); assert.deepEqual(result.issues, []); assert.equal(contentReads, 0);
  assert.equal(result.entries.length, 2); assert.ok(result.entries.every(entry => entry.excluded && entry.present));
  assert.equal(result.entries.find(entry => entry.type === 'skill').fileCount, 2);
});

test('excluded incomplete Skills remain metadata-only rather than blocking active assets', async t => {
  const { files, write } = await fixture(t); await write('AGENTS.md', 'Active instructions');
  await write('skills/incomplete/resource.txt', 'Excluded resource');
  const result = await files.scan({ excluded: ['dsh:skills/incomplete'] });
  assert.deepEqual(result.issues, []); assert.equal(result.assets.length, 1);
  const entry = result.entries.find(item => item.origin.path === 'skills/incomplete');
  assert.ok(entry.excluded); assert.equal(entry.fileCount, 1);
});

test('linked valid targets remain selectable in inventory and exclusion clears their issues', async t => {
  const { base, roots, files } = await fixture(t); const outside = path.join(base, 'excluded-link-target'); await mkdir(outside);
  await writeFile(path.join(outside, 'SKILL.md'), 'Must not read');
  if (!await directoryLink(t, outside, path.join(roots.dsh, 'skills', 'linked'))) return;
  if (!await directoryLink(t, outside, path.join(roots.dsh, 'AGENTS.md'))) return;
  if (!await directoryLink(t, outside, path.join(roots.dsh, 'prompts', 'linked.md'))) return;
  let contentReads = 0;
  files.readBytes = async () => { contentReads++; throw new Error('Linked content must not be read.'); };
  const active = await files.scan();
  assert.deepEqual(active.assets, []); assert.equal(active.entries.length, 3); assert.equal(active.issues.length, 3);
  assert.ok(active.issues.every(issue => issue.code === 'native-linked-path'));
  assert.ok(active.entries.every(entry => !entry.excluded && entry.present && entry.id === nativeId(entry.origin)));
  const excluded = active.entries.map(entry => nativeOriginKey(entry.origin));
  assert.deepEqual(excluded, ['dsh:AGENTS.md', 'dsh:prompts/linked.md', 'dsh:skills/linked']);
  const result = await files.scan({ excluded });
  assert.deepEqual(result.issues, []); assert.deepEqual(result.assets, []); assert.equal(result.entries.length, 3);
  assert.ok(result.entries.every(entry => entry.excluded && entry.id === nativeId(entry.origin)));
  assert.equal(contentReads, 0);
});

test('unreadable valid targets remain in inventory so the user can exclude them', async t => {
  const { files, write } = await fixture(t); await write('AGENTS.md', 'Unreadable fixture'); await write('skills/unreadable/SKILL.md', 'Unreadable fixture');
  const checked = files.checked.bind(files);
  files.checked = async (root, relative, ...args) => {
    if (relative === 'AGENTS.md' || relative === 'skills/unreadable/SKILL.md') throw Object.assign(new Error('Fixture permission denied.'), { code: 'EACCES' });
    return checked(root, relative, ...args);
  };
  const active = await files.scan(); assert.deepEqual(active.assets, []); assert.equal(active.entries.length, 2); assert.equal(active.issues.length, 2);
  assert.ok(active.entries.every(entry => entry.id === nativeId(entry.origin) && !entry.excluded));
  const excluded = active.entries.map(entry => nativeOriginKey(entry.origin));
  const ignored = await files.scan({ excluded }); assert.deepEqual(ignored.issues, []); assert.equal(ignored.entries.length, 2);
});

test('disabled agents root is never inspected, including when it is an invalid link', async t => {
  const { base, roots, files, write } = await fixture(t);
  await write('AGENTS.md', 'Local');
  const outside = path.join(base, 'linked-agents'); await mkdir(outside); await writeFile(path.join(outside, 'AGENTS.md'), 'Must not read');
  if (!await directoryLink(t, outside, roots.agents)) return;
  const checked = files.checked.bind(files);
  files.checked = async (root, ...args) => { assert.notEqual(root, 'agents', 'Disabled root must not perform metadata I/O.'); return checked(root, ...args); };
  const before = (await files.scan()).assets;
  const after = [...before, prompt('AGENTS.md', 'Cloud', 'agents')];
  assert.deepEqual(await files.apply({ before, after }), { changed: 0 });
  assert.equal(await readFile(path.join(outside, 'AGENTS.md'), 'utf8'), 'Must not read');
});

test('invalid UTF-8, incomplete Skills, and invalid Skill names produce metadata-only issues', async t => {
  const { files, write } = await fixture(t);
  await write('AGENTS.md', Buffer.from([255])); await write('skills/incomplete/reference.txt', 'Example'); await write('skills/Bad Name/SKILL.md', 'Example');
  const result = await files.scan(); assert.deepEqual(result.assets, []);
  assert.ok(result.issues.some(issue => issue.code === 'native-invalid-utf8'));
  assert.ok(result.issues.some(issue => issue.code === 'native-missing-skill'));
  assert.ok(result.issues.some(issue => issue.code === 'native-invalid-name'));
  assert.ok(result.issues.every(issue => !Object.hasOwn(issue, 'content')));
});

test('case-variant canonical root paths fail closed', async t => {
  const { roots, files } = await fixture(t);
  await mkdir(path.join(roots.dsh, 'Prompts'), { recursive: true });
  await writeFile(path.join(roots.dsh, 'Prompts', 'example.md'), 'Example');
  const result = await files.scan(); assert.equal(result.assets.length, 0); assert.ok(result.issues.some(issue => issue.code === 'native-case-collision'));
});

test('round-trips prompts and complete Skills into absent roots, edits, and deletes real files', async t => {
  const { roots, files } = await fixture(t);
  const incoming = [prompt('AGENTS.md', '# Global\n'), prompt('prompts/nested/example.txt', 'One'), skill('example', { 'SKILL.md': '# Example', 'references/a.md': 'A', 'binary/data.bin': Buffer.from([0, 255]) })];
  assert.deepEqual(await files.apply({ before: [], after: incoming }), { changed: 3 });
  const initial = await files.scan(); assert.deepEqual(initial.issues, []); assert.equal(initial.assets.length, 3);
  assert.equal(await readFile(path.join(roots.dsh, 'AGENTS.md'), 'utf8'), '# Global\n');
  const modified = incoming.map(asset => asset.type === 'skill' ? skill('example', { 'SKILL.md': '# Changed', 'references/b.md': 'B' }) : { ...asset, content: `${asset.content} changed` });
  assert.deepEqual(await files.apply({ before: initial.assets, after: modified }), { changed: 3 });
  await assert.rejects(lstat(path.join(roots.dsh, 'skills/example/references/a.md')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(roots.dsh, 'skills/example/references/b.md'), 'utf8'), 'B');
  assert.deepEqual(await files.apply({ before: (await files.scan()).assets, after: [] }), { changed: 3 });
  assert.deepEqual((await files.scan()).assets, []);
  assert.ok((await lstat(roots.dsh)).isDirectory()); assert.deepEqual(await readdir(roots.dsh), ['.dsh-sync-recovery']);
});

test('Skill creation writes SKILL.md after its resource files', async t => {
  const { roots } = await fixture(t); const order = [];
  class RecordingFiles extends NativeFiles { async atomicWrite(root, relative, ...args) { order.push(relative); return super.atomicWrite(root, relative, ...args); } }
  const files = new RecordingFiles({ roots });
  await files.apply({ before: [], after: [skill('example', { 'SKILL.md': 'Marker', 'resource.txt': 'Resource' })] });
  assert.deepEqual(order, ['skills/example/resource.txt', 'skills/example/SKILL.md']);
});

for (const kind of ['edit', 'addition', 'deletion']) {
  test(`external ${kind} rejects application before any overwrite`, async t => {
    const { roots, files, write } = await fixture(t); await write('AGENTS.md', 'Before');
    const before = (await files.scan()).assets;
    if (kind === 'edit') await write('AGENTS.md', 'External');
    if (kind === 'addition') await write('prompts/new.md', 'External');
    if (kind === 'deletion') await rm(path.join(roots.dsh, 'AGENTS.md'));
    await assert.rejects(files.apply({ before, after: [prompt('AGENTS.md', 'Cloud')] }), { code: 'local-changed' });
    if (kind !== 'deletion') assert.equal(await readFile(path.join(roots.dsh, 'AGENTS.md'), 'utf8'), kind === 'edit' ? 'External' : 'Before');
  });
}

test('target recheck preserves an external edit that occurs after preflight', async t => {
  const { roots, write } = await fixture(t); await write('AGENTS.md', 'Before'); await write('prompts/second.md', 'Before');
  class RacingFiles extends NativeFiles {
    async atomicWrite(root, relative, ...args) {
      await super.atomicWrite(root, relative, ...args);
      if (relative === 'AGENTS.md') await write('prompts/second.md', 'External after preflight');
    }
  }
  const files = new RacingFiles({ roots }); const before = (await files.scan()).assets;
  await assert.rejects(files.apply({ before, after: before.map(asset => ({ ...asset, content: 'Cloud' })) }), { code: 'local-changed' });
  assert.equal(await readFile(path.join(roots.dsh, 'prompts/second.md'), 'utf8'), 'External after preflight');
  assert.equal(await readFile(path.join(roots.dsh, 'AGENTS.md'), 'utf8'), 'Cloud');
});

test('postflight catches unexpected concurrent native additions', async t => {
  const { roots, write } = await fixture(t); await write('AGENTS.md', 'Before');
  class RacingFiles extends NativeFiles { async atomicWrite(...args) { await super.atomicWrite(...args); await write('prompts/unexpected.md', 'External addition'); } }
  const files = new RacingFiles({ roots }); const before = (await files.scan()).assets;
  await assert.rejects(files.apply({ before, after: [prompt('AGENTS.md', 'Cloud')] }), { code: 'local-changed' });
  assert.equal(await readFile(path.join(roots.dsh, 'prompts/unexpected.md'), 'utf8'), 'External addition');
});

test('deleting a Skill never removes skipped or untracked user resources', async t => {
  const { roots, files, write } = await fixture(t); await write('skills/example/SKILL.md', 'Marker'); await write('skills/example/known.txt', 'Known');
  await write('skills/example/.env.local', 'UNTRACKED-FIXTURE');
  const before = (await files.scan()).assets;
  await assert.rejects(files.apply({ before, after: [] }), { code: 'local-changed' });
  assert.equal(await readFile(path.join(roots.dsh, 'skills/example/.env.local'), 'utf8'), 'UNTRACKED-FIXTURE');
  assert.equal(await readFile(path.join(roots.dsh, 'skills/example/SKILL.md'), 'utf8'), 'Marker');
  assert.equal(await readFile(path.join(roots.dsh, 'skills/example/known.txt'), 'utf8'), 'Known');
});

test('exclusions prevent cloud writes and removals without reading excluded content', async t => {
  const { roots, files, write } = await fixture(t); await write('AGENTS.md', Buffer.from([255]));
  files.readBytes = async () => { throw new Error('Excluded content must not be opened.'); };
  assert.deepEqual(await files.apply({ before: [], after: [prompt('AGENTS.md', 'Cloud')], excluded: ['dsh:AGENTS.md'] }), { changed: 0 });
  assert.deepEqual(await readFile(path.join(roots.dsh, 'AGENTS.md')), Buffer.from([255]));
});

test('optional agents writes require explicit enablement', async t => {
  const { roots, files } = await fixture(t);
  const native = prompt('AGENTS.md', 'Optional instructions', 'agents');
  assert.deepEqual(await files.apply({ before: [], after: [native] }), { changed: 0 });
  await assert.rejects(lstat(roots.agents), { code: 'ENOENT' });
  assert.deepEqual(await files.apply({ before: [], after: [native], includeAgents: true }), { changed: 1 });
  assert.equal(await readFile(path.join(roots.agents, 'AGENTS.md'), 'utf8'), 'Optional instructions');
});

test('assets without native targets are rejected before any filesystem mutation', async t => {
  const { roots, files } = await fixture(t);
  const invalid = { id: randomUUID(), type: 'prompt', name: 'Invalid target', content: 'Example' };
  await assert.rejects(files.apply({ before: [], after: [invalid] }), { code: 'invalid-data' });
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
  await assert.rejects(lstat(roots.agents), { code: 'ENOENT' });
});

test('oversized incoming native prompt is rejected before the root is created', async t => {
  const { roots, files } = await fixture(t);
  const incoming = prompt('AGENTS.md', 'x'.repeat(12 * 1024 * 1024 + 512 * 1024));
  await assert.rejects(files.apply({ before: [], after: [incoming] }), { code: 'native-limit' });
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('too many incoming Skill resources are rejected before the root is created', async t => {
  const { roots, files } = await fixture(t); const resources = { 'SKILL.md': 'Marker' };
  for (let index = 0; index < 500; index++) resources[`resource-${index}.txt`] = 'Example';
  await assert.rejects(files.apply({ before: [], after: [skill('too-many', resources)] }), { code: 'native-limit' });
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('incoming Skill raw bytes are bounded independently of its JSON envelope', async t => {
  const { roots, files } = await fixture(t);
  const incoming = skill('too-large', { 'SKILL.md': 'Marker', 'data.bin': Buffer.alloc(12 * 1024 * 1024, 1) });
  await assert.rejects(files.apply({ before: [], after: [incoming] }), { code: 'native-limit' });
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('incoming depth and full relative paths must remain readable after application', async t => {
  const { roots, files } = await fixture(t);
  const excessiveDepth = `${Array(17).fill('d').join('/')}/example.txt`;
  const longResource = `${'a'.repeat(185)}.txt`;
  const cases = [
    prompt(`prompts/${excessiveDepth}`, 'Example'),
    skill('deep', { 'SKILL.md': 'Marker', [excessiveDepth]: 'Example' }),
    skill('long-name', { 'SKILL.md': 'Marker', [longResource]: 'Example' }),
  ];
  for (const incoming of cases) await assert.rejects(files.apply({ before: [], after: [incoming] }));
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('generated paths and ancestors are bounded across all incoming native assets', async t => {
  const { roots, files } = await fixture(t); const resources = { 'SKILL.md': 'Marker' };
  for (let index = 0; index < 499; index++) resources[`resource-${index}.txt`] = 'Example';
  const incoming = Array.from({ length: 11 }, (_, index) => skill(`example-${index}`, resources));
  await assert.rejects(files.apply({ before: [], after: incoming }), { code: 'native-limit' });
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('canonical collection count and JSON byte limits are checked before writes', async t => {
  const { roots, files } = await fixture(t);
  const tooMany = Array.from({ length: 1001 }, (_, index) => prompt(`prompts/example-${index}.md`, 'Example'));
  await assert.rejects(files.apply({ before: [], after: tooMany }));
  const content = 'x'.repeat(12 * 1024 * 1024);
  await assert.rejects(files.apply({ before: [], after: [prompt('AGENTS.md', content), prompt('prompts/another.md', content)] }));
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('unsafe cloud origins, IDs, resource names, and prefix collisions are rejected before writes', async t => {
  const { roots, files } = await fixture(t);
  const invalids = [
    { ...prompt('AGENTS.md', 'Cloud'), origin: { root: 'dsh', path: '../outside.md' } },
    { ...prompt('AGENTS.md', 'Cloud'), id: randomUUID() },
    prompt('prompts/credentials.txt', 'Must not materialize'),
    prompt('prompts/node_modules/example.md', 'Must not materialize'),
    skill('example', { 'SKILL.md': 'Marker', '.env.local': 'Bad' }),
    skill('example', { 'SKILL.md': 'Marker', 'a': 'File', 'a-other': 'Other', 'a/b.txt': 'Collision' }),
  ];
  for (const asset of invalids) await assert.rejects(files.apply({ before: [], after: [asset] }));
  await assert.rejects(lstat(roots.dsh), { code: 'ENOENT' });
});

test('root links and linked parents fail closed and do not write outside authorized roots', async t => {
  const { base, roots, files } = await fixture(t); const outside = path.join(base, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'AGENTS.md'), 'Outside fixture');
  if (!await directoryLink(t, outside, roots.dsh)) return;
  const result = await files.scan(); assert.equal(result.assets.length, 0); assert.ok(result.issues.some(issue => issue.code === 'native-linked-path'));
  await assert.rejects(files.apply({ before: [], after: [prompt('AGENTS.md', 'Cloud')] }), { code: 'local-changed' });
  assert.equal(await readFile(path.join(outside, 'AGENTS.md'), 'utf8'), 'Outside fixture');
});

test('a linked prompts subtree is reported instead of being interpreted as deletion', async t => {
  const { base, roots, files } = await fixture(t); const outside = path.join(base, 'outside-prompts'); await mkdir(outside);
  await writeFile(path.join(outside, 'example.md'), 'Outside fixture');
  if (!await directoryLink(t, outside, path.join(roots.dsh, 'prompts'))) return;
  const result = await files.scan(); assert.ok(result.issues.some(issue => issue.code === 'native-linked-path'));
  await assert.rejects(files.apply({ before: [], after: [prompt('prompts/new.md', 'Cloud')] }), { code: 'local-changed' });
  await assert.rejects(lstat(path.join(outside, 'new.md')), { code: 'ENOENT' });
});
