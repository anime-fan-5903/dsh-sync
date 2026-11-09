import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SyncEngine } from '../src/engine.js';
import { decodeEnvelope } from '../src/crypto.js';
import { nativeId } from '../src/model.js';
class Store {
  constructor(){this.state={format:1,assets:[],base:{},backups:[],settings:{},vaultId:null,keyring:null,encrypted:false};this.queue=Promise.resolve();}
  read(){return Promise.resolve(structuredClone(this.state));}
  write(state){this.state=structuredClone(state);return Promise.resolve();}
  exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next;}
}
class Backend {
  constructor(){this.remote=null;this.counter=0;this.rejectNext=false;}
  async read(){return structuredClone(this.remote);}
  async init(envelope){if(!this.remote)this.remote={revision:envelope.revision,etag:String(++this.counter),envelope};return this.read();}
  async publish(expected,envelope){
    if(this.rejectNext||expected.etag!==this.remote.etag){this.rejectNext=false;throw Object.assign(new Error('Remote changed.'),{code:'remote-changed'});}
    this.remote={revision:envelope.revision,etag:String(++this.counter),envelope};return this.read();
  }
}
const make=(backend)=>new SyncEngine({store:new Store(),backend});
const prompt=(content)=>{const origin={root:'dsh',path:`prompts/${randomUUID()}.md`};return {id:nativeId(origin),origin,type:'prompt',name:`.dsh/${origin.path}`,content};};
async function put(engine,asset){const state=await engine.store.read();state.assets=[...state.assets.filter(item=>item.id!==asset.id),asset];await engine.store.write(state);}
async function pair(){const backend=new Backend();const a=make(backend);const b=make(backend);await a.initialize();await b.initialize();await b.synchronize();return {backend,a,b};}
test('two devices synchronize independent asset updates',async()=>{
  const {a,b}=await pair();const p=prompt('one');await put(a,p);await a.synchronize();await b.synchronize();
  assert.deepEqual((await b.store.read()).assets,[p]);
  const q=prompt('two');await put(b,q);await b.synchronize();await a.synchronize();assert.equal((await a.store.read()).assets.length,2);
});
test('conflict selection backs up either discarded side and supports restoring',async()=>{
  const {a,b}=await pair();const p=prompt('base');await put(a,p);await a.synchronize();await b.synchronize();
  await put(a,{...p,content:'left'});await put(b,{...p,content:'right'});await a.synchronize();
  const pending=await b.synchronize();assert.equal(pending.conflicts.length,1);const c=pending.conflicts[0];
  await b.synchronize({[p.id]:{...c,side:'local'}});
  let state=await b.store.read();assert.equal(decodeEnvelope(state.backups[0].envelope)[0].content,'left');
  await b.restoreBackup(state.backups[0].id);state=await b.store.read();assert.equal(state.assets[0].content,'left');
});
test('remote CAS failure never replaces local assets or advances baseline',async()=>{
  const {a,backend}=await pair();const p=prompt('pending');await put(a,p);const before=await a.store.read();backend.rejectNext=true;
  await assert.rejects(a.synchronize(),{code:'remote-changed'});const after=await a.store.read();assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.base,before.base);
});
test('encryption can be enabled later and stale plaintext clients stop for unlock',async()=>{
  const {a,b,backend}=await pair();const p=prompt('not confidential yet');await put(a,p);await a.synchronize();await b.synchronize();
  const setup=await a.enableEncryption('a sufficiently long passphrase');assert.ok(setup.recoveryKey);assert.equal(backend.remote.envelope.mode,'encrypted');
  await put(b,{...p,content:'offline change'});await assert.rejects(b.synchronize(),{code:'locked'});
  await b.unlock(setup.recoveryKey,'recovery');await b.synchronize();assert.equal(decodeEnvelope(backend.remote.envelope,a.key)[0].content,'offline change');
  const changed=await b.changePassphrase('a different sufficiently long passphrase');b.lock();await b.unlock(changed.recoveryKey,'recovery');await b.synchronize();
});
test('passphrase rewrapping does not revoke an authenticated trusted master key',async()=>{
  const {a,b,backend}=await pair();const setup=await a.enableEncryption('a sufficiently long passphrase');
  await assert.rejects(b.synchronize(),{code:'locked'});await b.unlock(setup.recoveryKey,'recovery');await b.synchronize();
  await a.changePassphrase('another sufficiently long passphrase');await b.synchronize();
  assert.ok(b.key);assert.equal(b.unlockedKeyring,backend.remote.envelope.keyring.id);
});

test('a manually locked device can unlock with the remotely changed passphrase',async()=>{
  const {a,b}=await pair();const setup=await a.enableEncryption('a sufficiently long passphrase');
  await assert.rejects(b.synchronize(),{code:'locked'});await b.unlock(setup.recoveryKey,'recovery');await b.synchronize();b.lock();
  await a.changePassphrase('a newly changed remote passphrase');await b.unlock('a newly changed remote passphrase');
  assert.ok(b.key);await b.synchronize();
});

test('plaintext downgrade and wrong vault are refused',async()=>{
  const {a,backend}=await pair();await a.enableEncryption('a sufficiently long passphrase');const encrypted=structuredClone(backend.remote);
  backend.remote.envelope={format:1,vaultId:a.store.state.vaultId,revision:randomUUID(),mode:'plain',data:{assets:[]}};
  await assert.rejects(a.synchronize(),{code:'encryption-downgrade'});backend.remote=encrypted;backend.remote.envelope.vaultId=randomUUID();await assert.rejects(a.synchronize(),{code:'wrong-vault'});
});
