import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { DeviceTrust, createDeviceProtector } from '../src/device-trust.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function checkKey(actual, expected) {
  assert.ok(Buffer.isBuffer(actual)); assert.equal(actual.length,32); assert.equal(digest(actual),digest(expected)); actual.fill(0);
}
function fixtureProtector() {
  const wrapping = randomBytes(32);
  return {
    available: true, provider: 'fixture-aes-gcm',
    async protect(value) { const nonce = randomBytes(12); const cipher=createCipheriv('aes-256-gcm',wrapping,nonce); const data=Buffer.concat([cipher.update(value),cipher.final()]); return Buffer.concat([nonce,cipher.getAuthTag(),data]); },
    async unprotect(value) { const decipher=createDecipheriv('aes-256-gcm',wrapping,value.subarray(0,12)); decipher.setAuthTag(value.subarray(12,28)); return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]); },
  };
}
async function fixture(t, protector=fixtureProtector()) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'dsh-device-trust-'));
  t.after(async()=>{await rm(directory,{recursive:true,force:true});});
  const make=()=>new DeviceTrust({directory,protector}); const trust=make(); await trust.start();
  return {directory,protector,trust,make,key:randomBytes(32)};
}

test('available device protection defaults to remember without creating a key cache',async t=>{
  const {trust}=await fixture(t); const status=trust.status();
  assert.deepEqual(status,{available:true,provider:'fixture-aes-gcm',remember:true,manualLocked:false,hasSavedKey:false});
  await assert.rejects(access(trust.file),{code:'ENOENT'}); assert.equal(await trust.restore('vault-a'),null);
});

test('restart restores only a protected vault-bound key and metadata never exposes secrets',async t=>{
  const {trust,make,key}=await fixture(t); const before=digest(key);
  assert.equal(await trust.rememberKey('vault-a',key),true); assert.equal(digest(key),before);
  const contents=await readFile(trust.file,'utf8');
  for(const value of [key.toString('base64'),key.toString('hex'),'passphrase','recoveryKey']) assert.ok(!contents.includes(value));
  const metadata=JSON.parse(contents); assert.equal(metadata.format,1); assert.equal(metadata.vaultId,'vault-a'); assert.equal(metadata.manualLocked,false);
  assert.ok(typeof metadata.blob==='string'); assert.equal(Object.hasOwn(trust.status(),'blob'),false); assert.equal(Object.hasOwn(trust.status(),'key'),false);
  const next=make(); await next.start(); checkKey(await next.restore('vault-a'),key);
  assert.equal(await next.restore('vault-b'),null); checkKey(await next.restore('vault-a'),key);
});

test('manual lock persists across restart and only explicit successful unlock clears it',async t=>{
  const {trust,make,key}=await fixture(t); await trust.rememberKey('vault-a',key); await trust.lock();
  const metadata=JSON.parse(await readFile(trust.file,'utf8')); assert.equal(metadata.manualLocked,true); assert.equal(metadata.blob,undefined);
  const next=make(); await next.start(); assert.equal(await next.restore('vault-a'),null); assert.equal(next.status().manualLocked,true);
  await next.configure(true,{vaultId:'vault-a',key}); assert.equal(next.status().manualLocked,true); assert.equal(next.status().hasSavedKey,false);
  assert.equal(await next.rememberKey('vault-a',key),true); assert.equal(next.status().manualLocked,false);
  const final=make(); await final.start(); checkKey(await final.restore('vault-a'),key);
});

test('disabling remember removes the cache without locking the current session key',async t=>{
  const {trust,make,key}=await fixture(t); await trust.rememberKey('vault-a',key); const before=digest(key);
  await trust.configure(false); assert.equal(trust.status().remember,false); assert.equal(trust.status().manualLocked,false); assert.equal(digest(key),before);
  assert.equal(trust.status().hasSavedKey,false); assert.equal(JSON.parse(await readFile(trust.file,'utf8')).blob,undefined);
  const next=make(); await next.start(); assert.equal(next.status().remember,false); assert.equal(await next.restore('vault-a'),null);
  assert.equal(await next.rememberKey('vault-a',key),false); assert.equal(next.status().hasSavedKey,false);
  await next.configure(true,{vaultId:'vault-a',key}); checkKey(await next.restore('vault-a'),key);
});

test('sign-out forgetting keeps the remember preference but removes unlock capability',async t=>{
  const {trust,make,key}=await fixture(t); await trust.rememberKey('vault-a',key); await trust.forget();
  const next=make(); await next.start(); assert.equal(next.status().remember,true); assert.equal(next.status().manualLocked,true); assert.equal(await next.restore('vault-a'),null);
});

test('unsupported systems never fall back to a plaintext key file',async t=>{
  const protector=createDeviceProtector({platform:'unsupported'}); assert.equal(protector.available,false);
  await assert.rejects(protector.protect(randomBytes(32)),{code:'device-protection-unavailable'});
  await assert.rejects(protector.unprotect(randomBytes(32)),{code:'device-protection-unavailable'});
  const {trust,key}=await fixture(t,protector); assert.equal(trust.status().remember,false);
  await assert.rejects(trust.configure(true,{vaultId:'vault-a',key}),{code:'device-protection-unavailable'});
  assert.equal(await trust.rememberKey('vault-a',key),false); assert.equal(await trust.restore('vault-a'),null);
  const stored=await readFile(trust.file,'utf8'); assert.ok(!stored.includes(key.toString('base64'))); assert.equal(JSON.parse(stored).blob,undefined);
});

test('protection failure discards previous cache and exposes only a sanitized warning',async t=>{
  const {trust,key}=await fixture(t); await trust.rememberKey('vault-a',key);
  const secret=key.toString('base64'); trust.protector={available:true,provider:'failure-fixture',protect:async()=>{throw new Error(secret);},unprotect:async()=>{throw new Error(secret);}};
  assert.equal(await trust.rememberKey('vault-a',key),false); assert.equal(trust.status().hasSavedKey,false);
  assert.equal(trust.status().error.code,'device-protection-failed'); assert.ok(!JSON.stringify(trust.status()).includes(secret));
  assert.ok(!(await readFile(trust.file,'utf8')).includes(secret)); assert.equal(await trust.restore('vault-a'),null);
});

test('an identity protector is rejected rather than saving the cleartext payload',async t=>{
  const protector={available:true,provider:'invalid-identity',protect:async value=>Buffer.from(value),unprotect:async value=>Buffer.from(value)};
  const {trust,key}=await fixture(t,protector); assert.equal(await trust.rememberKey('vault-a',key),false);
  assert.equal(trust.status().hasSavedKey,false); assert.ok(!(await readFile(trust.file,'utf8')).includes(key.toString('base64')));
});

test('corrupt metadata loads locked without preventing application startup',async t=>{
  const {trust,make,key}=await fixture(t); await writeFile(trust.file,'{not-json');
  const next=make(); await next.start(); assert.equal(next.status().manualLocked,true); assert.equal(next.status().hasSavedKey,false); assert.ok(next.status().error);
  assert.equal(await next.restore('vault-a'),null); await next.rememberKey('vault-a',key); checkKey(await next.restore('vault-a'),key);
});

test('corrupt protected bytes and mismatched authenticated vault binding fail closed',async t=>{
  const {trust,make,key}=await fixture(t); await trust.rememberKey('vault-a',key);
  const original=JSON.parse(await readFile(trust.file,'utf8'));
  const corrupted={...original,blob:randomBytes(80).toString('base64')}; await writeFile(trust.file,JSON.stringify(corrupted));
  let next=make(); await next.start(); assert.equal(next.status().manualLocked,true); assert.equal(await next.restore('vault-a'),null);
  await writeFile(trust.file,JSON.stringify({...original,vaultId:'vault-b'})); next=make(); await next.start();
  assert.equal(next.status().manualLocked,true); assert.equal(next.status().hasSavedKey,false); assert.equal(await next.restore('vault-b'),null);
});

test('decrypt failures after startup clear the cache without revealing protector errors',async t=>{
  const {trust,key}=await fixture(t); await trust.rememberKey('vault-a',key); const secret=key.toString('hex');
  trust.protector={available:true,provider:'failure-fixture',unprotect:async()=>{throw new Error(secret);}};
  assert.equal(await trust.restore('vault-a'),null); assert.equal(trust.status().manualLocked,true); assert.equal(trust.status().hasSavedKey,false);
  assert.ok(!JSON.stringify(trust.status()).includes(secret)); assert.equal(JSON.parse(await readFile(trust.file,'utf8')).blob,undefined);
});

test('a missing protector dependency is not mistaken for missing cache metadata',async t=>{
  const {trust,key,directory,protector}=await fixture(t); await trust.rememberKey('vault-a',key);
  const next=new DeviceTrust({directory,protector:{...protector,unprotect:async()=>{throw Object.assign(new Error('Private fixture failure'),{code:'ENOENT'});}}});
  await next.start(); assert.equal(next.status().manualLocked,true); assert.equal(next.status().hasSavedKey,false); assert.ok(next.status().error);
  assert.equal(await next.restore('vault-a'),null);
});

test('invalid protected payload shape and key size are rejected without exposing payload data',async t=>{
  const {trust,key}=await fixture(t); await trust.rememberKey('vault-a',key); const invalid=randomBytes(16).toString('base64');
  trust.protector={available:true,provider:'invalid-fixture',unprotect:async()=>Buffer.from(JSON.stringify({format:1,vaultId:'vault-a',key:invalid}))};
  assert.equal(await trust.restore('vault-a'),null); assert.equal(trust.status().manualLocked,true); assert.ok(!JSON.stringify(trust.status()).includes(invalid));
});

test('oversized metadata is bounded and invalid calls cannot save key material',async t=>{
  const {trust,make,key}=await fixture(t); await writeFile(trust.file,' '.repeat(16385));
  const next=make(); await next.start(); assert.equal(next.status().manualLocked,true);
  await assert.rejects(next.rememberKey('',key),{code:'device-trust-invalid-key'});
  await assert.rejects(next.rememberKey('vault-a',randomBytes(31)),{code:'device-trust-invalid-key'});
  await assert.rejects(next.configure('yes'),{code:'device-trust-invalid-preference'});
  assert.equal(await next.restore(''),null);
});

test('failed lock persistence remains locked in memory and reports a safe write failure',async t=>{
  const {trust,key,directory}=await fixture(t); await trust.rememberKey('vault-a',key);
  trust.file=path.join(directory,'directory-instead-of-file'); await mkdir(trust.file);
  await assert.rejects(trust.lock(),{code:'device-trust-write-failed'});
  assert.equal(trust.status().manualLocked,true); assert.equal(trust.status().hasSavedKey,false); assert.equal(await trust.restore('vault-a'),null);
  assert.ok(!JSON.stringify(trust.status()).includes(key.toString('base64')));
});

function childFixture({reply=Buffer.from('protected-fixture'),code=0,stderr=null,hang=false}={}) {
  let invocation; let input; let killed=false;
  const spawn=(file,args,options)=>{
    const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.stdin=new Writable({write(chunk,_encoding,done){input=Buffer.from(chunk);done();},final(done){done();if(!hang)queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(reply));if(stderr)child.stderr.emit('data',Buffer.from(stderr));child.emit('close',code);});}});
    child.kill=()=>{killed=true;}; invocation={file,args,options}; return child;
  };
  return {spawn,get invocation(){return invocation;},get input(){return input;},get killed(){return killed;}};
}
test('DPAPI child receives payload only through stdin and uses a static encoded script',async()=>{
  const fixture=childFixture(); const protector=createDeviceProtector({platform:'win32',systemRoot:path.parse(process.cwd()).root,exists:()=>true,spawn:fixture.spawn});
  const key=randomBytes(32); const result=await protector.protect(key); assert.ok(Buffer.isBuffer(result)); assert.equal(digest(fixture.input),digest(key));
  const invocation=fixture.invocation; assert.ok(invocation.args.includes('-NoProfile')); assert.ok(invocation.args.includes('-NonInteractive')); assert.ok(invocation.args.includes('-EncodedCommand'));
  assert.equal(invocation.options.shell,false); assert.equal(invocation.options.env,undefined); assert.ok(!JSON.stringify(invocation.args).includes(key.toString('base64')));
  const program=Buffer.from(invocation.args.at(-1),'base64').toString('utf16le'); assert.ok(program.includes('DataProtectionScope]::CurrentUser')); assert.ok(!program.includes(key.toString('base64')));
});

test('DPAPI child output, stderr and exit failures are bounded and sanitized',async()=>{
  for(const options of [{reply:Buffer.alloc(8193)},{stderr:'SENSITIVE-FIXTURE',code:1},{reply:Buffer.alloc(0),code:0}]){
    const fixture=childFixture(options); const protector=createDeviceProtector({platform:'win32',systemRoot:path.parse(process.cwd()).root,exists:()=>true,spawn:fixture.spawn});
    await assert.rejects(protector.protect(randomBytes(32)),error=>error.code==='device-protection-failed'&&!error.message.includes('SENSITIVE-FIXTURE'));
  }
});

test('DPAPI child timeout terminates the process without surfacing payloads',async()=>{
  const fixture=childFixture({hang:true}); const protector=createDeviceProtector({platform:'win32',systemRoot:path.parse(process.cwd()).root,exists:()=>true,spawn:fixture.spawn,timeoutMs:20});
  const keepAlive=setTimeout(()=>{},1000);
  try { await assert.rejects(protector.protect(randomBytes(32)),{code:'device-protection-failed'}); assert.equal(fixture.killed,true); }
  finally {clearTimeout(keepAlive);}
});

test('real Windows CurrentUser DPAPI protects and restores only generated fixture bytes',{skip:process.platform!=='win32'},async()=>{
  const protector=createDeviceProtector(); assert.equal(protector.available,true);
  const fixture=randomBytes(32); const protectedBytes=await protector.protect(fixture);
  assert.notEqual(digest(protectedBytes),digest(fixture)); assert.ok(!protectedBytes.includes(fixture));
  const restored=await protector.unprotect(protectedBytes); assert.equal(digest(restored),digest(fixture));
  restored.fill(0); fixture.fill(0); protectedBytes.fill(0);
});
