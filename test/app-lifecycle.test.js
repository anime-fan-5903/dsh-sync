import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Application } from '../src/application.js';
import { decodeEnvelope, unlockKeyring, wipe } from '../src/crypto.js';

function fixtureProtector() {
  const key=randomBytes(32);
  return {available:true,provider:'fixture-aes',async protect(bytes){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(bytes),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},
    async unprotect(bytes){const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(12,28));return Buffer.concat([c.update(bytes.subarray(28)),c.final()]);}};
}
async function harness(t,protector=fixtureProtector()) {
  const base=await mkdtemp(path.join(os.tmpdir(),'dsh-sync-app-'));const directory=path.join(base,'runtime');
  const roots={dsh:path.join(base,'home-dsh'),agents:path.join(base,'home-agents')};const apps=[];
  const cloud={remote:null,async read(){return structuredClone(this.remote);},async init(envelope){this.remote??={envelope,revision:envelope.revision,etag:'1'};return this.read();},async publish(_expected,envelope){this.remote={envelope,revision:envelope.revision,etag:'2'};return this.read();}};
  const create=async()=>{const app=new Application({directory,roots,deviceProtector:protector,credentials:{readRecord:async()=>undefined,modifyRecord:async(_key,fn)=>fn(undefined)}});apps.push(app);await app.start();app.engine.backend=cloud;return app;};
  t.after(async()=>{for(const app of apps)if(!app.closed)await app.dispose();await rm(base,{recursive:true,force:true});});
  return {base,directory,roots,cloud,create};
}
const digest=key=>createHash('sha256').update(key).digest('hex');
const passphrase='A long lifecycle fixture passphrase';

test('ordinary restart restores the protected device key; manual lock survives until explicit unlock',async t=>{
  const h=await harness(t);let app=await h.create();const setup=await app.operation('initialize',{encrypted:true,passphrase});assert.ok(setup.recoveryKey);
  const fingerprint=digest(app.engine.key);assert.equal((await app.status()).deviceTrust.hasSavedKey,true);
  const oldKey=app.engine.key;await app.dispose();assert.ok(oldKey.every(byte=>byte===0));
  app=await h.create();assert.equal((await app.status()).locked,false);assert.equal(digest(app.engine.key),fingerprint);
  await app.operation('lock');assert.equal((await app.status()).deviceTrust.manualLocked,true);await app.dispose();
  app=await h.create();assert.equal((await app.status()).locked,true);assert.equal(app.engine.key,null);
  await app.operation('unlock',{secret:passphrase});assert.equal((await app.status()).deviceTrust.manualLocked,false);await app.dispose();
  app=await h.create();assert.equal((await app.status()).locked,false);assert.equal(digest(app.engine.key),fingerprint);
});

test('disabling device trust removes persistence without locking the current session',async t=>{
  const h=await harness(t);let app=await h.create();await app.operation('initialize',{encrypted:true,passphrase});
  await app.operation('device-trust-configure',{remember:false});assert.ok(app.engine.key);assert.equal((await app.status()).deviceTrust.hasSavedKey,false);
  await app.dispose();app=await h.create();assert.equal((await app.status()).locked,true);
  await app.operation('unlock',{secret:passphrase});assert.ok(app.engine.key);assert.equal((await app.status()).deviceTrust.hasSavedKey,false);
});

test('optional cache failure cannot hide a successful encryption recovery key or write plaintext',async t=>{
  const protector={available:true,provider:'failing-fixture',async protect(){throw new Error('Fixture protection failed.');},async unprotect(){throw new Error('Fixture protection failed.');}};
  const h=await harness(t,protector);const app=await h.create();const result=await app.operation('initialize',{encrypted:true,passphrase});
  assert.ok(result.recoveryKey);assert.ok(app.engine.key);const status=await app.status();assert.equal(status.locked,false);assert.equal(status.deviceTrust.hasSavedKey,false);
  assert.ok(status.deviceTrust.error);const disk=await readFile(path.join(h.directory,'device-trust.json'),'utf8');
  assert.ok(!disk.includes(passphrase));assert.ok(!disk.includes(result.recoveryKey));assert.ok(!disk.includes(app.engine.key.toString('base64')));
});

test('sign-out clears device trust, and a failed lock persistence still wipes memory',async t=>{
  const h=await harness(t);let app=await h.create();await app.operation('initialize',{encrypted:true,passphrase});
  await app.operation('sign-out');assert.equal(app.engine.key,null);assert.equal((await app.status()).deviceTrust.hasSavedKey,false);
  await app.operation('unlock',{secret:passphrase});const original=app.engine.key;
  app.deviceTrust.lock=async()=>{throw Object.assign(new Error('Unable to persist lock fixture.'),{code:'fixture-write-failed'});};
  await assert.rejects(app.operation('lock'),{code:'fixture-write-failed'});assert.equal(app.engine.key,null);assert.ok(original.every(byte=>byte===0));
});

test('opening an excluded local file is metadata-only, honors native roots, and opens Skill markers',async t=>{
  const h=await harness(t);await mkdir(path.join(h.roots.dsh,'skills','example'),{recursive:true});
  await writeFile(path.join(h.roots.dsh,'AGENTS.md'),'Fixture instructions');await writeFile(path.join(h.roots.dsh,'skills','example','SKILL.md'),'# Fixture Skill');
  const app=await h.create();let status=await app.status();const prompt=status.tracking.items.find(item=>item.type==='prompt');const skill=status.tracking.items.find(item=>item.type==='skill');
  await app.operation('tracking-exclude',{id:prompt.id,confirmCloudDelete:true});
  assert.deepEqual(await app.operation('asset-open',{id:prompt.id}),{path:path.join(h.roots.dsh,'AGENTS.md')});
  assert.deepEqual(await app.operation('asset-open',{id:skill.id}),{path:path.join(h.roots.dsh,'skills','example','SKILL.md')});
  for(const action of ['asset-open','device-trust-configure','lock','unlock'])await assert.rejects(app.operation(action,{id:prompt.id,remember:true},'agent'),{code:'user-only'});
  await assert.rejects(app.operation('unsupported-fixture'),{code:'unknown-action'});
  await assert.rejects(app.operation('asset-open',{id:'__proto__'}));
});

test('startup rejects invalid local assets without rewriting state or native files',async t=>{
  const h=await harness(t);
  const state={format:1,base:{},backups:[],settings:{},assets:[{id:'7f83ba59-5d21-4dbf-a0b3-701b85153630',type:'prompt',name:'Invalid fixture',content:'Must not be discarded'}]};
  const source=JSON.stringify(state);const stateFile=path.join(h.directory,'state.json');
  await mkdir(h.directory,{recursive:true});await writeFile(stateFile,source);
  await mkdir(h.roots.dsh,{recursive:true});await writeFile(path.join(h.roots.dsh,'AGENTS.md'),'Preserved native fixture');
  await assert.rejects(h.create(),{code:'invalid-data'});
  assert.equal(await readFile(stateFile,'utf8'),source);
  assert.equal(await readFile(path.join(h.roots.dsh,'AGENTS.md'),'utf8'),'Preserved native fixture');
});

for (const action of ['enable-encryption', 'change-passphrase']) {
  for (const failure of ['state-write', 'cache-read', 'cache-write']) {
    test(`${action} preserves the recovery key across ${failure} after remote publication`, async t => {
      const h = await harness(t); const app = await h.create();
      await app.operation('initialize', { encrypted: action === 'change-passphrase', passphrase });
      const revision = h.cloud.remote.revision;
      const read = app.store.read.bind(app.store); const write = app.store.write.bind(app.store);
      app.store.read = async () => {
        if (failure === 'cache-read' && h.cloud.remote.revision !== revision) throw new Error('Fixture cache state read failed.');
        return read();
      };
      app.store.write = async state => {
        if (failure === 'state-write' && h.cloud.remote.revision !== revision) throw new Error('Fixture local state write failed.');
        return write(state);
      };
      if (failure === 'cache-write') app.deviceTrust.rememberKey = async () => { throw new Error('Fixture cache write failed.'); };
      let result;
      try { result = await app.operation(action, { passphrase: 'A replacement lifecycle passphrase' }); }
      finally { app.store.read = read; app.store.write = write; }
      assert.ok(result.recoveryKey); assert.equal(result.remotePublished, true); assert.equal(result.localCompleted, false);
      assert.equal(result.error.code, failure === 'state-write' ? 'encryption-local-failed' : 'device-cache-failed');
      const remote = h.cloud.remote.envelope;
      const recovered = await unlockKeyring(remote.vaultId, remote.keyring, result.recoveryKey, 'recovery');
      assert.deepEqual(decodeEnvelope(remote, recovered), []); wipe(recovered);
      for (const caller of ['agent']) await assert.rejects(app.operation(action, { passphrase }, caller), { code: 'user-only' });
      assert.ok(!JSON.stringify(await app.status()).includes(result.recoveryKey));
    });
  }
}
