import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NativeFiles } from '../src/native-files.js';
import { NativeTracking } from '../src/tracking.js';
import { hashes, merge } from '../src/model.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-targets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const roots = { dsh: path.join(directory, 'home'), agents: path.join(directory, 'agents') };
  const put = async (relative, content, root = 'dsh') => {
    const file = path.join(roots[root], ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content);
  };
  await put('AGENTS.md', 'Original prompt');
  await put('prompts/example.md', 'Example prompt');
  await put('fragments/example.txt', 'Example fragment');
  await put('skills/example/SKILL.md', '# Original Skill');
  const files = new NativeFiles({ roots });
  const assets = (await files.scan()).assets;
  return { directory, roots, put, files, assets };
}
function observe(files) {
  const calls = [];
  for (const method of ['checked', 'readBytes', 'directory', 'inventoryCount']) {
    const original = files[method].bind(files);
    files[method] = async (...args) => { calls.push({ method, relative: args[1] ?? '' }); return original(...args); };
  }
  return calls;
}
function changed(asset) {
  return asset.type === 'prompt' ? { ...asset, content: 'Remote prompt' } :
    { ...asset, files: { 'SKILL.md': Buffer.from('# Remote Skill').toString('base64') } };
}

for (const disabled of ['prompt', 'skill']) {
  const enabled = disabled === 'prompt' ? 'skill' : 'prompt';
  test(`disabled ${disabled} category is not inspected or inventoried`, async t => {
    const { files, put } = await fixture(t);
    if (disabled === 'prompt') {
      await put('AGENTS.md', Buffer.from([255]));
      await put('prompts/example.md', Buffer.from([255]));
      await put('fragments/example.txt', Buffer.from([255]));
    } else await put('skills/example/SKILL.md', Buffer.from([255]));
    const calls = observe(files);
    const result = await files.scan({ types: [enabled] });
    assert.deepEqual(result.issues, []);
    assert.ok(result.assets.length > 0);
    assert.ok(result.entries.every(asset => asset.type === enabled));
    assert.ok(calls.every(call => !call.relative || (call.relative.startsWith('skills') ? 'skill' : 'prompt') === enabled));
  });
  test(`apply neither reads, deletes nor replaces disabled ${disabled} assets`, async t => {
    const { files, roots, assets } = await fixture(t);
    const disabledAssets = assets.filter(asset => asset.type === disabled);
    const enabledAssets = assets.filter(asset => asset.type === enabled);
    const calls = observe(files);
    await files.apply({ before: assets, after: enabledAssets, types: [enabled] });
    await files.apply({ before: assets, after: [...enabledAssets, ...disabledAssets.map(changed)], types: [enabled] });
    assert.ok(calls.every(call => !call.relative || (call.relative.startsWith('skills') ? 'skill' : 'prompt') === enabled));
    assert.equal(await readFile(path.join(roots.dsh, 'AGENTS.md'), 'utf8'), 'Original prompt');
    assert.equal(await readFile(path.join(roots.dsh, 'skills/example/SKILL.md'), 'utf8'), '# Original Skill');
  });
}

test('both disabled categories avoid all native root access during scan and apply', async t => {
  const { files, assets } = await fixture(t);
  const calls = observe(files);
  assert.deepEqual(await files.scan({ types: [], includeAgents: true }), { assets: [], entries: [], issues: [] });
  assert.deepEqual(await files.apply({ before: assets, after: [], types: [], includeAgents: true }), { changed: 0 });
  assert.deepEqual(calls, []);
  await assert.rejects(files.scan({ types: ['settings'] }), { code: 'invalid-data' });
});

test('default tracking targets retain both native categories', async t => {
  const { directory, roots } = await fixture(t);
  const tracking = new NativeTracking({ directory, roots }); await tracking.start();
  const state = { assets: [], base: {} };
  await tracking.refresh(state);
  assert.deepEqual(tracking.options().types, ['prompt', 'skill']);
  assert.equal(tracking.inventory.items.length, 4);
  assert.equal(tracking.isEnabled({ type: 'settings' }), false);
  assert.equal(tracking.isEnabled({ type: 'prompt' }), false);
  assert.equal(tracking.isEnabled({ type: 'settings', origin: { root: 'dsh' } }), false);
});

for (const disabled of ['prompt', 'skill']) {
  test(`tracking preserves disabled ${disabled} cloud assets and ignores composite settings`, async t => {
    const { directory, roots, assets } = await fixture(t);
    const targets = { prompt: true, skill: true }; targets[disabled] = false;
    const tracking = new NativeTracking({ directory, roots, targets }); await tracking.start();
    const settings = { id: 'settings-fixture', type: 'settings', value: { theme: 'dark' } };
    const state = { assets: [...assets, settings], base: { ...hashes(assets), [settings.id]: 'settings-baseline' } };
    const calls = observe(tracking.files);
    await tracking.refresh(state);
    assert.ok(tracking.inventory.items.every(asset => asset.type !== disabled));
    assert.equal(tracking.config.known[settings.id], undefined);
    const remote = assets.map(changed);
    const plan = await tracking.prepare(state, [...remote, settings]);
    assert.deepEqual(plan.passthrough, remote.filter(asset => asset.type === disabled));
    assert.ok(plan.local.every(asset => asset.type !== disabled));
    assert.ok(plan.remote.every(asset => asset.type !== disabled));
    assert.equal(plan.base[settings.id], undefined);
    assert.equal(state.base[settings.id], 'settings-baseline');
    assert.ok(state.assets.includes(settings));
    await tracking.apply(plan, [...plan.local, ...plan.passthrough, settings]);
    await tracking.committed(state, [...remote, settings]);
    assert.equal(tracking.config.known[settings.id], undefined);
    assert.ok(tracking.inventory.items.every(asset => asset.type !== disabled));
    assert.ok(calls.every(call => !call.relative || (call.relative.startsWith('skills') ? 'skill' : 'prompt') !== disabled));
    await tracking.configure(state, false);
    assert.ok(state.assets.includes(settings));
  });
}

test('re-enabled categories conflict after a disabled commit and restart with stale state', async t => {
  const { directory, roots, assets } = await fixture(t);
  const targets = { prompt: true, skill: true };
  const tracking = new NativeTracking({ directory, roots, targets }); await tracking.start();
  const state = { assets, base: hashes(assets) };
  const stale = structuredClone(state);
  await tracking.refresh(state);
  targets.prompt = false;
  await tracking.refresh(state);
  const remote = assets.map(changed);
  const plan = await tracking.prepare(state, remote);
  await tracking.committed(state, [...plan.local, ...plan.passthrough]);
  assert.ok(assets.filter(asset => asset.type === 'prompt').every(asset => tracking.config.baselineResets[asset.id]));
  targets.prompt = true;
  const restarted = new NativeTracking({ directory, roots, targets }); await restarted.start();
  const resumed = await restarted.prepare(stale, remote);
  assert.ok(assets.filter(asset => asset.type === 'prompt').every(asset => !(asset.id in resumed.base)));
  const result = merge(resumed.base, resumed.local, resumed.remote);
  assert.equal(result.conflicts.filter(asset => asset.type === 'prompt').length, 3);
});
