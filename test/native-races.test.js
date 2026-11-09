import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeFiles } from '../src/native-files.js';
import { nativeId } from '../src/model.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-races-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new NativeFiles({ roots: { dsh: root } });
  const write = async (relative, bytes) => { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); };
  const recovery = async relative => {
    const batches = await readdir(path.join(root, '.dsh-sync-recovery'));
    return Promise.all(batches.map(batch => readFile(path.join(root, '.dsh-sync-recovery', batch, relative), 'utf8').catch(() => null)));
  };
  return { root, files, write, recovery };
}
function skill(resources) {
  const origin = { root: 'dsh', path: 'skills/example' };
  return { id: nativeId(origin), origin, type: 'skill', name: 'example', description: 'Native Skill: example', files: Object.fromEntries(Object.entries({ 'SKILL.md': 'Marker', ...resources }).map(([key, value]) => [key, Buffer.from(value).toString('base64')])) };
}

for (const operation of ['replace', 'delete']) {
  test(`retains an edit injected after the final content check during ${operation}`, async t => {
    const { root, files, write, recovery } = await fixture(t);
    await write('AGENTS.md', 'Before'); const before = (await files.scan()).assets;
    const after = operation === 'delete' ? [] : [{ ...before[0], content: 'Cloud' }];
    const checked = files.checked.bind(files); let armed = false; let injected = false; let destinationChecks = 0;
    const retain = files.retainTarget.bind(files);
    files.retainTarget = async (...args) => { armed = true; return retain(...args); };
    files.checked = async (name, relative, ...args) => {
      const result = await checked(name, relative, ...args);
      // The recovery destination lookup occurs after the last assertFile and
      // source lookup, immediately before the destructive rename.
      if (armed && !injected && relative?.startsWith('.dsh-sync-recovery/') && relative.endsWith('/AGENTS.md') && !result.exists) {
        // Only inject after the last source check, not during ensureParents.
        if (args[0] === true && ++destinationChecks === 2) { injected = true; await write('AGENTS.md', 'External late edit'); }
      }
      return result;
    };
    await assert.rejects(files.apply({ before, after }), { code: 'local-changed' });
    assert.ok(injected); assert.ok((await recovery('AGENTS.md')).includes('External late edit'));
    await assert.rejects(readFile(path.join(root, 'AGENTS.md')), { code: 'ENOENT' });
  });
}

test('new target appearing after final absence check is never overwritten', async t => {
  const { root, files, write } = await fixture(t);
  const checked = files.checked.bind(files); let injected = false;
  files.checked = async (name, relative, caseCheck) => {
    const result = await checked(name, relative, caseCheck);
    if (!injected && relative === 'AGENTS.md' && caseCheck && (await readdir(root)).some(value => value.startsWith('.dsh-sync-'))) {
      injected = true; await write('AGENTS.md', 'External new file');
    }
    return result;
  };
  const origin = { root: 'dsh', path: 'AGENTS.md' };
  await assert.rejects(files.apply({ before: [], after: [{ id: nativeId(origin), origin, type: 'prompt', name: '.dsh/AGENTS.md', content: 'Cloud' }] }), { code: 'local-changed' });
  assert.ok(injected); assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'External new file');
});

test('a writable handle to the displaced inode remains recoverable after publication', async t => {
  const { files, root, write, recovery } = await fixture(t);
  await write('AGENTS.md', 'Before'); const before = (await files.scan()).assets;
  const handle = await open(path.join(root, 'AGENTS.md'), 'r+');
  try {
    await files.apply({ before, after: [{ ...before[0], content: 'Cloud' }] });
    await handle.write(Buffer.from('External handle edit'), 0, 20, 0);
    assert.ok((await recovery('AGENTS.md')).includes('External handle edit'));
    assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'Cloud');
  } finally { await handle.close(); }
});

for (const [label, initial, desired] of [
  ['file to directory', { a: 'Old' }, { 'a/child.txt': 'New' }],
  ['directory to file', { 'a/child.txt': 'Old' }, { a: 'New' }],
  ['file case rename', { 'a.txt': 'Old' }, { 'A.txt': 'New' }],
  ['directory case rename', { 'a/child.txt': 'Old' }, { 'A/child.txt': 'New' }],
]) {
  test(`Skill supports ${label} and repeated synchronization`, async t => {
    const { files, write } = await fixture(t);
    for (const [relative, bytes] of Object.entries({ 'SKILL.md': 'Marker', ...initial })) await write(`skills/example/${relative}`, bytes);
    const before = (await files.scan()).assets; const after = [skill(desired)];
    assert.deepEqual(await files.apply({ before, after }), { changed: 1 });
    const scan = await files.scan(); assert.deepEqual(scan.issues, []); assert.deepEqual(JSON.parse(JSON.stringify(scan.assets)), after);
    assert.deepEqual(await files.apply({ before: scan.assets, after }), { changed: 0 });
  });
}

for (const untracked of ['.env.local', '.cache/note.txt', 'empty']) {
  test(`directory to file refuses untracked ${untracked} without deleting anything`, async t => {
    const { root, files, write } = await fixture(t);
    await write('skills/example/SKILL.md', 'Marker'); await write('skills/example/a/child.txt', 'Old');
    const target = `skills/example/a/${untracked}`;
    if (untracked === 'empty') await mkdir(path.join(root, target)); else await write(target, 'Untracked fixture');
    const before = (await files.scan()).assets;
    await assert.rejects(files.apply({ before, after: [skill({ a: 'New' })] }), { code: 'local-changed' });
    assert.equal(await readFile(path.join(root, 'skills/example/a/child.txt'), 'utf8'), 'Old');
    if (untracked !== 'empty') assert.equal(await readFile(path.join(root, target), 'utf8'), 'Untracked fixture');
  });
}

for (const operation of ['replace', 'delete']) {
  test(`recovery preserves a maximum-length native path during ${operation}`, async t => {
    const { files, write, recovery } = await fixture(t);
    const relative = `prompts/${'x'.repeat(189)}.md`;
    assert.equal(relative.length, 200);
    await write(relative, 'Before'); const before = (await files.scan()).assets;
    const after = operation === 'delete' ? [] : [{ ...before[0], content: 'Cloud' }];
    assert.deepEqual(await files.apply({ before, after }), { changed: 1 });
    assert.ok((await recovery(relative)).includes('Before'));
    assert.equal((await files.scan()).assets.length, after.length);
  });
}

test('recovery capacity fails closed without pruning retained edits', async t => {
  const { root, files, write } = await fixture(t);
  await write('AGENTS.md', 'Before'); const before = (await files.scan()).assets;
  for (let i = 0; i < 10; i++) await write(`.dsh-sync-recovery/batch-${i}/AGENTS.md`, `Retained ${i}`);
  await assert.rejects(files.apply({ before, after: [{ ...before[0], content: 'Cloud' }] }), { code: 'native-recovery-full' });
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'Before');
  assert.equal((await readdir(path.join(root, '.dsh-sync-recovery'))).length, 10);
});
