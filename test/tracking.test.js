import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStore } from '../src/local-store.js';
import { NativeTracking } from '../src/tracking.js';
import { SyncEngine } from '../src/engine.js';
import { decodeEnvelope } from '../src/crypto.js';
import { nativeId } from '../src/model.js';
import { randomUUID } from 'node:crypto';

class Cloud {
  constructor() { this.remote = null; this.counter = 0; this.failRead = false; this.onPublish = null; }
  async read() { if (this.failRead) throw Object.assign(new Error('Offline fixture.'), { code: 'offline' }); return structuredClone(this.remote); }
  async init(envelope) { if (!this.remote) this.remote = { revision: envelope.revision, etag: String(++this.counter), envelope }; return this.read(); }
  async publish(expected, envelope) {
    assert.equal(expected.etag, this.remote.etag); this.remote = { revision: envelope.revision, etag: String(++this.counter), envelope };
    if (this.onPublish) await this.onPublish(); return this.read();
  }
  assets(key) { return decodeEnvelope(this.remote.envelope, key); }
}
async function device(t, cloud) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-native-device-'));
  const roots = { dsh: path.join(directory,'home-dsh'), agents: path.join(directory,'home-agents') };
  const store = new LocalStore(path.join(directory,'runtime')); await store.acquire();
  const tracking = new NativeTracking({ directory: store.directory, roots }); await tracking.start();
  const engine = new SyncEngine({ store, backend: cloud, native: tracking });
  t.after(async () => { engine.lock(); await store.release(); await rm(directory, { recursive: true, force: true }); });
  return { directory, roots, store, tracking, engine };
}
async function put(device, root, relative, content) {
  const file = path.join(device.roots[root],...relative.split('/')); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file,content); return file;
}
const file = (device,root,relative) => path.join(device.roots[root],...relative.split('/'));
const text = (device,root,relative) => readFile(file(device,root,relative),'utf8');
const idFor = (root,relative) => nativeId({root,path:relative});
async function setting(device, action, ...args) {
  return device.store.exclusive(async () => { const state = await device.store.read(); const result = await device.tracking[action](state,...args); await device.store.write(state); return result; });
}
async function refresh(device) { return device.tracking.refresh(await device.store.read()); }
async function pair(t, seed = true) {
  const cloud = new Cloud(); const a = await device(t,cloud); const b = await device(t,cloud);
  if (seed) await put(a,'dsh','AGENTS.md','Original instructions');
  await a.engine.initialize(); await b.engine.initialize(); await b.engine.synchronize(); return {a,b,cloud};
}

test('native instructions, fragments and complete Skills synchronize into original directories', async t => {
  const cloud = new Cloud(); const a = await device(t,cloud); const b = await device(t,cloud);
  await put(a,'dsh','AGENTS.md','Global instructions'); await put(a,'dsh','fragments/team.md','Team fragment');
  await put(a,'dsh','prompts/review.txt','Review prompt'); await put(a,'dsh','skills/example/SKILL.md','---\nname: example\ndescription: Example\n---\nSkill body');
  await put(a,'dsh','skills/example/resources/template.json','{"example":true}');
  await put(a,'dsh','data/ignored.txt','Runtime content must stay local'); await put(a,'agents','AGENTS.md','Other application instructions');
  await a.engine.initialize(); assert.equal(cloud.assets().length,4); assert.ok(cloud.assets().every(asset => asset.origin.root === 'dsh'));
  await b.engine.initialize(); await b.engine.synchronize();
  assert.equal(await text(b,'dsh','AGENTS.md'),'Global instructions'); assert.equal(await text(b,'dsh','fragments/team.md'),'Team fragment');
  assert.equal(await text(b,'dsh','skills/example/resources/template.json'),'{"example":true}');
  await assert.rejects(access(file(b,'dsh','data/ignored.txt'))); await assert.rejects(access(b.roots.agents));
  await put(b,'dsh','AGENTS.md','Changed on second device'); await put(b,'dsh','skills/example/resources/template.json','{"example":2}');
  await b.engine.synchronize(); await a.engine.synchronize();
  assert.equal(await text(a,'dsh','AGENTS.md'),'Changed on second device'); assert.equal(await text(a,'dsh','skills/example/resources/template.json'),'{"example":2}');
  assert.ok((await a.store.read()).backups.length >= 2);
  await unlink(file(b,'dsh','fragments/team.md')); await b.engine.synchronize(); await a.engine.synchronize();
  await assert.rejects(access(file(a,'dsh','fragments/team.md'))); assert.equal(await text(a,'dsh','data/ignored.txt'),'Runtime content must stay local');
});

test('native conflicts do not overwrite either side before choice, and backups restore the real file', async t => {
  const {a,b,cloud} = await pair(t); await put(a,'dsh','AGENTS.md','First device'); await put(b,'dsh','AGENTS.md','Second device');
  await a.engine.synchronize(); const result = await b.engine.synchronize(); const conflict = result.conflicts[0];
  assert.equal(conflict.origin.root,'dsh'); assert.equal(await text(b,'dsh','AGENTS.md'),'Second device');
  await b.engine.synchronize({[conflict.id]:{...conflict,side:'remote'}}); assert.equal(await text(b,'dsh','AGENTS.md'),'First device');
  const backup = (await b.store.read()).backups.find(item => decodeEnvelope(item.envelope)[0].content === 'Second device'); assert.ok(backup);
  await b.engine.restoreBackup(backup.id); assert.equal(await text(b,'dsh','AGENTS.md'),'Second device');
  await b.engine.synchronize(); assert.equal(cloud.assets().find(asset => asset.origin.path === 'AGENTS.md').content,'Second device');
});

test('an external edit during cloud publication survives and keeps the old baseline', async t => {
  const {a,cloud} = await pair(t); const before = await a.store.read(); const id = idFor('dsh','AGENTS.md');
  await put(a,'dsh','AGENTS.md','Captured edit'); cloud.onPublish = async () => { await put(a,'dsh','AGENTS.md','Late editor change'); };
  await assert.rejects(a.engine.synchronize(), {code:'local-changed'});
  assert.equal(await text(a,'dsh','AGENTS.md'),'Late editor change'); assert.equal((await a.store.read()).base[id],before.base[id]);
  assert.equal(cloud.assets().find(asset => asset.id === id).content,'Captured edit'); cloud.onPublish = null;
  const pending = await a.engine.synchronize(); assert.equal(pending.conflicts.length,1);
  const conflict = pending.conflicts[0]; await a.engine.synchronize({[id]:{...conflict,side:'local'}});
  assert.equal(cloud.assets().find(asset => asset.id === id).content,'Late editor change');
});

test('exclusions and metadata stay local; confirmed cloud removal is queued offline and retains original files', async t => {
  const {a,cloud} = await pair(t,false); const relative = 'prompts/excluded-note.md'; const id = idFor('dsh',relative);
  await put(a,'dsh',relative,'EXCLUDED-CONTENT-FIXTURE'); await a.engine.synchronize(); await refresh(a);
  await assert.rejects(setting(a,'exclude',id,false),{code:'confirmation-required'}); assert.equal(a.tracking.status().items.find(item=>item.id===id).excluded,false);
  await setting(a,'exclude',id,true); cloud.failRead = true;
  await assert.rejects(a.engine.synchronize(),{code:'offline'}); assert.equal(a.tracking.status().items.find(item=>item.id===id).pendingCloudDelete,true);
  // Invalid content proves excluded files are not read merely to construct a cloud payload.
  await put(a,'dsh',relative,Buffer.from([0xff])); cloud.failRead = false; await a.engine.synchronize();
  assert.deepEqual(await readFile(file(a,'dsh',relative)),Buffer.from([0xff]));
  const wire = JSON.stringify(cloud.remote.envelope);
  for (const value of [relative,id,'EXCLUDED-CONTENT-FIXTURE','exclusions','pendingCloudDeletes','baselineResets','agentsEnabled']) assert.ok(!wire.includes(value),value);
  const local = JSON.parse(await readFile(a.tracking.file,'utf8')); assert.equal(local.exclusions[id].origin.path,relative); assert.equal(local.pendingCloudDeletes[id],undefined);
  await put(a,'dsh',relative,'Re-included content'); await setting(a,'include',id); await a.engine.synchronize();
  assert.equal(cloud.assets().find(asset=>asset.id===id).content,'Re-included content'); assert.equal(await text(a,'dsh',relative),'Re-included content');
});

test('.agents is opt-in, preserves cloud content when off, and conflicts with existing other-application files', async t => {
  const {a,b,cloud} = await pair(t); await put(a,'agents','AGENTS.md','Cloud agents instructions');
  await assert.rejects(setting(a,'configure',true,false),{code:'confirmation-required'}); assert.equal(a.tracking.status().agentsEnabled,false);
  await setting(a,'configure',true,true); await a.engine.synchronize(); const id = idFor('agents','AGENTS.md'); assert.ok(cloud.assets().some(asset=>asset.id===id));
  await put(b,'agents','AGENTS.md','OTHER-APPLICATION-LOCAL'); await put(b,'dsh','AGENTS.md','Unrelated DSH edit'); await b.engine.synchronize();
  assert.equal(await text(b,'agents','AGENTS.md'),'OTHER-APPLICATION-LOCAL'); assert.ok(cloud.assets().some(asset=>asset.id===id));
  assert.ok(!(await b.store.read()).assets.some(asset=>asset.origin?.root==='agents'));
  await setting(b,'configure',true,true); const pending = await b.engine.synchronize(); const conflict = pending.conflicts.find(item=>item.id===id); assert.ok(conflict);
  assert.equal(await text(b,'agents','AGENTS.md'),'OTHER-APPLICATION-LOCAL'); await b.engine.synchronize({[id]:{...conflict,side:'remote'}});
  assert.equal(await text(b,'agents','AGENTS.md'),'Cloud agents instructions');
  await setting(b,'configure',false); await put(b,'agents','AGENTS.md','Edited while disabled');
  await put(b,'dsh','AGENTS.md','Another DSH edit'); await b.engine.synchronize();
  assert.equal(await text(b,'agents','AGENTS.md'),'Edited while disabled'); assert.equal(cloud.assets().find(asset=>asset.id===id).content,'Cloud agents instructions');
  assert.ok(!JSON.stringify(cloud.remote.envelope).includes('agentsEnabled'));
});

test('confirmed agents cloud removal remains local policy even after disabling that root', async t => {
  const {a,cloud} = await pair(t); await put(a,'agents','AGENTS.md','Retained local agents file'); await setting(a,'configure',true,true); await a.engine.synchronize();
  const id=idFor('agents','AGENTS.md'); await refresh(a); await setting(a,'exclude',id,true); await setting(a,'configure',false); await a.engine.synchronize();
  assert.ok(!cloud.assets().some(asset=>asset.id===id)); assert.equal(await text(a,'agents','AGENTS.md'),'Retained local agents file');
});

test('encryption transitions preserve opted-out remote assets without writing them locally', async t => {
  const {a,b,cloud} = await pair(t); await put(a,'agents','AGENTS.md','Remote agents fixture'); await setting(a,'configure',true,true); await a.engine.synchronize();
  await b.engine.synchronize(); const result=await b.engine.enableEncryption('A long encryption fixture passphrase');
  assert.ok(result.recoveryKey); assert.ok(cloud.assets(b.engine.key).some(asset=>asset.origin?.root==='agents'));
  await assert.rejects(access(b.roots.agents));
});

test('re-inclusion survives a settings/state persistence gap without deleting retained local files', async t => {
  const {a,cloud}=await pair(t); const original=await a.store.read(); const id=idFor('dsh','AGENTS.md');
  await refresh(a); await setting(a,'exclude',id,true); await a.engine.synchronize(); assert.equal(cloud.assets().length,0);
  const stale=await a.store.read(); stale.base[id]=original.base[id]; await a.store.write(stale);
  const unwritten=await a.store.read(); await a.tracking.include(unwritten,id);
  // Simulate restart after the policy file committed but before the main state file did.
  const tracking=new NativeTracking({directory:a.store.directory,roots:a.roots}); await tracking.start();
  const engine=new SyncEngine({store:a.store,backend:cloud,native:tracking}); await engine.synchronize();
  assert.equal(await text(a,'dsh','AGENTS.md'),'Original instructions'); assert.equal(cloud.assets()[0].content,'Original instructions');
  assert.deepEqual(JSON.parse(await readFile(tracking.file,'utf8')).baselineResets,{});
});

test('invalid cloud assets are rejected without deleting records or changing native files', async t => {
  const {a,cloud}=await pair(t); const original=await text(a,'dsh','AGENTS.md');
  const before=await a.store.read();
  cloud.remote.envelope.data.assets.push({id:randomUUID(),type:'prompt',name:'Invalid cloud fixture',content:'Must not be discarded'});
  const remote=structuredClone(cloud.remote);
  await assert.rejects(a.engine.synchronize(),{code:'invalid-data'});
  assert.deepEqual(await a.store.read(),before);assert.deepEqual(cloud.remote,remote);
  assert.equal(await text(a,'dsh','AGENTS.md'),original);
});

test('missing tracking fields are rejected without rewriting the configuration', async t => {
  const {a}=await pair(t);const config=JSON.parse(await readFile(a.tracking.file,'utf8'));
  delete config.baselineResets;const source=JSON.stringify(config);await writeFile(a.tracking.file,source);
  const other=new NativeTracking({directory:a.store.directory,roots:a.roots});
  await assert.rejects(other.start(),{code:'invalid-data'});
  assert.equal(await readFile(a.tracking.file,'utf8'),source);
});

test('invalid tracking identifiers and corrupted local policy fail closed', async t => {
  const {a} = await pair(t);
  for (const id of ['__proto__','constructor','missing']) await assert.rejects(setting(a,'exclude',id,true));
  await writeFile(a.tracking.file,'{"format":999}');
  const other = new NativeTracking({directory:a.store.directory,roots:a.roots}); await assert.rejects(other.start());
  assert.equal(JSON.parse(await readFile(a.tracking.file,'utf8')).format,999);
});
