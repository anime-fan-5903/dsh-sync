import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apply } from '../index.js';
import { LocalStore } from '../src/local-store.js';
import { nativeId } from '../src/model.js';
import { Application } from '../src/application.js';
import { MICROSOFT_CLIENT_ID } from '../src/config.js';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

// Match the installed Connection carrier's buffered/streaming Request construction.
// A direct route.fetch call alone cannot exercise the GET-with-stream-body failure.
async function serveThroughBridge(route) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = `http://127.0.0.1:${server.address().port}${incoming.url}`;
      const method = incoming.method;
      let request;
      if (route.requestBody === 'streaming') {
        request = new Request(url, { method, headers: incoming.headers, body: Readable.toWeb(incoming), duplex: 'half' });
      } else {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        request = new Request(url, { method, headers: incoming.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      }
      const response = await route.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'Content-Type': 'text/plain' });
      outgoing.end('Bridge request construction failed.');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}${route.path}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('Host UI and agent operations share state, enforce UI-only authority, and dispose cleanly',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'dsh-sync-host-'));const disposers=[];let route;let tool;let provider;let credential;
  t.after(async()=>{for(const dispose of disposers.reverse())await dispose();await rm(directory,{recursive:true,force:true});});
  const ctx={
    credentials:{readRecord:async key=>{assert.equal(key,'dsh-sync/microsoft');return credential;},modifyRecord:async(key,fn)=>{assert.equal(key,'dsh-sync/microsoft');credential=await fn(credential);return credential;}},
    connection:{fetch:{register(value){route=value;return async()=>{route=null;};}}},
    tools:{register(value){tool=value;return()=>{tool=null;};}},
    get(){return undefined;},effect(effect){const value=effect();disposers.push(async()=>{const dispose=await value;await dispose?.();});},
    inject(_keys,fn){fn({skills:{registerProvider(factory){provider=factory({invalidate(){}});return()=>{};}}});},
  };
  await mkdir(path.join(directory,'fixture-dsh'),{recursive:true});await writeFile(path.join(directory,'fixture-dsh','AGENTS.md'),'Native fixture');
  await apply(ctx,{dataDirectory:directory,nativeRoots:{dsh:path.join(directory,'fixture-dsh'),agents:path.join(directory,'fixture-agents')}});assert.equal(route.path,'/api/dsh-sync');assert.equal(provider,undefined);assert.ok(tool);
  const request=async(action,payload={})=>{const response=await route.fetch(new Request('http://example.test/api/dsh-sync',{method:action?'POST':'GET',headers:action?{'Content-Type':'application/json'}:undefined,body:action?JSON.stringify({action,...payload}):undefined}));return response.json();};
  const bridge = await serveThroughBridge(route);
  try {
    const response = await fetch(bridge.url);
    assert.equal(response.status, 200, 'The browser status GET must pass through the HTTP bridge without a request body.');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).value.initialized, false);
    const post = await fetch(bridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'asset-open', id: 'missing-fixture' }) });
    assert.equal(post.status, 400);
    assert.equal((await post.json()).ok, false);
  } finally { await bridge.close(); }
  const initial=await request();assert.equal(initial.value.initialized,false);assert.equal(initial.value.signedIn,false);assert.equal(initial.value.encrypted,false);
  assert.equal(initial.value.settings.clientId, MICROSOFT_CLIENT_ID);
  const forbiddenChange = await request('configure', { clientId: randomUUID() });
  assert.equal(forbiddenChange.error.code, 'fixed-client-id');
  assert.equal((await request()).value.settings.clientId, MICROSOFT_CLIENT_ID);
  assert.equal((await request('configure', { enabled: false })).ok, true);
  const inventory=await tool.execute({action:'tracking-refresh'});const item=inventory.tracking.items[0];assert.equal(item.origin.path,'AGENTS.md');
  const target=await request('asset-open',{id:item.id});assert.deepEqual(target.value,{path:path.join(directory,'fixture-dsh','AGENTS.md')});
  assert.equal((await request('unsupported-fixture')).error.code,'unknown-action');
  await assert.rejects(tool.execute({action:'unsupported-fixture'}),{code:'user-only'});
  await assert.rejects(tool.execute({action:'unlock',secret:'not forwarded'}),{code:'user-only'});
  for (const action of ['tracking-exclude','tracking-include','tracking-configure','asset-open','device-trust-configure','lock']) await assert.rejects(tool.execute({action}),{code:'user-only'});
  const discovery = await tool.execute({action:'tracking-refresh'}); assert.equal(discovery.tracking.agentsEnabled,false);
  const denied=await request('sync');assert.equal(denied.error.code,'not-initialized');
  assert.equal((await tool.execute({action:'backup-list'})).backups.length,0);
  const malformed=await route.fetch(new Request('http://example.test/api/dsh-sync',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'}));assert.equal(malformed.status,400);
  const other=new LocalStore(directory);await assert.rejects(other.acquire(),{code:'local-locked'});
  assert.equal((await request()).value.assetCount,0);assert.deepEqual(tool.parameters.properties.action.enum,['status','tracking-refresh','sync','backup-list','backup-restore']);
});

test('startup loads native assets and existing grants without rewriting either record', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sync-config-'));
  const store = new LocalStore(directory); const state = await store.read();
  const origin={root:'dsh',path:'AGENTS.md'};const native={id:nativeId(origin),type:'prompt',name:'.dsh/AGENTS.md',content:'Native fixture',origin};
  state.assets = [native];
  await mkdir(path.join(directory,'fixture-dsh'),{recursive:true});await writeFile(path.join(directory,'fixture-dsh','AGENTS.md'),'Native fixture');
  await store.write(state); const stateBefore=await readFile(store.file,'utf8');
  const credential = { kind: 'grant', payload: { accounts: { [MICROSOFT_CLIENT_ID]: { refreshToken: 'TEST-ONLY-REFRESH' } } } };
  let credentialWrites = 0;
  const app = new Application({ directory, roots: { dsh: path.join(directory,'fixture-dsh'), agents: path.join(directory,'fixture-agents') }, credentials: {
    readRecord: async () => credential,
    modifyRecord: async () => { credentialWrites++; throw new Error('Startup must not replace credentials.'); },
  } });
  t.after(async () => { await app.dispose(); await rm(directory, { recursive: true, force: true }); });
  await app.start(); const status = await app.status(); const saved = await app.store.read();
  assert.equal(status.settings.clientId, MICROSOFT_CLIENT_ID); assert.equal(status.signedIn, true);
  assert.equal(app.auth.clientId, MICROSOFT_CLIENT_ID); assert.equal(credentialWrites, 0);
  assert.deepEqual(saved.assets,[native]);assert.equal(await readFile(store.file,'utf8'),stateBefore);
  await assert.rejects(app.operation('configure', { clientId: randomUUID() }), { code: 'fixed-client-id' });
  assert.equal((await app.status()).signedIn, true); assert.equal(credentialWrites, 0);
});

test('discovery respects offline retry backoff and reschedules changed native Skills',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'dsh-sync-skill-priority-'));
  const roots={dsh:path.join(directory,'home-dsh'),agents:path.join(directory,'home-agents')};
  await mkdir(path.join(roots.dsh,'skills','example'),{recursive:true});
  await writeFile(path.join(roots.dsh,'skills','example','SKILL.md'),'# Native fixture');
  const app=new Application({directory:path.join(directory,'runtime'),roots,credentials:{readRecord:async()=>undefined,modifyRecord:async()=>{throw new Error('No credential writes expected.');}}});
  t.after(async()=>{await app.dispose();await rm(directory,{recursive:true,force:true});});await app.start();
  const backoff=Date.now()+300000; app.nextAttempt=backoff; app.engine.phase='error';
  await app.operation('tracking-refresh'); assert.equal(app.nextAttempt,backoff); assert.equal(app.engine.phase,'error');
  await writeFile(path.join(roots.dsh,'skills','example','SKILL.md'),'# Newly changed native fixture');
  await app.operation('tracking-refresh'); assert.ok(app.nextAttempt<backoff); assert.equal(app.engine.phase,'pending');
});

test('local state survives reopening and a live owner cannot be displaced',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'dsh-sync-store-'));const first=new LocalStore(directory);await first.acquire();
  t.after(async()=>{await first.release();await rm(directory,{recursive:true,force:true});});
  const state=await first.read();const origin={root:'dsh',path:'prompts/example.md'};
  state.assets=[{id:nativeId(origin),origin,type:'prompt',name:'.dsh/prompts/example.md',content:'Persistent'}];await first.write(state);
  const second=new LocalStore(directory);await assert.rejects(second.acquire(),{code:'local-locked'});await first.release();await second.acquire();
  assert.deepEqual((await second.read()).assets,state.assets);await second.release();await assert.rejects(access(path.join(directory,'process.lock')));
});
