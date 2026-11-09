import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OneDrive } from '../src/onedrive.js';
import { encodeEnvelope } from '../src/crypto.js';
function graph(){
  const items=new Map();let serial=0;let losePatch=false;const calls=[];
  const error=(status,code)=>Response.json({error:{code}},{status});
  const add=(name,parentId,content,folder=false)=>{const id=`item${++serial}`;const item={id,name,parentReference:{id:parentId,driveId:'drive'},eTag:`\"${serial}\"`,...(folder?{folder:{}}:{file:{},content})};items.set(id,item);return item;};
  const metadata=item=>{const {content,...rest}=item;return rest;};
  const child=(parent,name)=>[...items.values()].find(item=>item.parentReference.id===parent&&item.name.toLowerCase()===name.toLowerCase());
  const fetchImpl=async(url,options={})=>{
    const parsed=new URL(url);const route=decodeURIComponent(parsed.pathname.slice('/v1.0'.length));const method=options.method??'GET';const headers=new Headers(options.headers);calls.push({url,method,headers,body:options.body});
    assert.equal(headers.get('authorization'),'Bearer example-access');
    if(route==='/me/drive/root:/DSH Sync'){const item=child('root','DSH Sync');return item?Response.json(metadata(item)):error(404,'itemNotFound');}
    if(route==='/me/drive/root/children'&&method==='POST'){const body=JSON.parse(options.body);assert.equal(body['@microsoft.graph.conflictBehavior'],'fail');if(child('root',body.name))return error(409,'nameAlreadyExists');return Response.json(metadata(add(body.name,'root',null,true)));}
    const match=/^\/me\/drive\/items\/([^/:]+)(.*)$/.exec(route);if(!match)return error(404,'itemNotFound');const item=items.get(match[1]);if(!item)return error(404,'itemNotFound');const suffix=match[2];
    if(suffix.startsWith(':/')){const upload=suffix.endsWith(':/content');const name=suffix.slice(2,upload?-9:undefined);const existing=child(item.id,name);
      if(upload&&method==='PUT'){assert.equal(parsed.searchParams.get('@microsoft.graph.conflictBehavior'),'fail');if(existing)return error(409,'nameAlreadyExists');return Response.json(metadata(add(name,item.id,JSON.parse(options.body))));}
      return existing?Response.json(metadata(existing)):error(404,'itemNotFound');
    }
    if(suffix==='/children')return Response.json({value:[...items.values()].filter(x=>x.parentReference.id===item.id).map(metadata)});
    if(suffix==='/content')return Response.json(item.content);
    if(method==='PATCH'){if(headers.get('if-match')!==item.eTag)return error(412,'preconditionFailed');const body=JSON.parse(options.body);item.name=body.name;item.eTag=`\"${++serial}\"`;if(losePatch){losePatch=false;throw new Error('Lost response.');}return Response.json(metadata(item));}
    if(method==='DELETE'){items.delete(item.id);return new Response(null,{status:204});}
    return Response.json(metadata(item));
  };
  return {fetchImpl,items,calls,loseNextPatch(){losePatch=true;},add};
}
const auth={token:async()=>'example-access'};
const envelope=(vaultId=randomUUID())=>encodeEnvelope({vaultId,assets:[]});
test('root initialization publishes a permanent marker and reloads the winning snapshot',async()=>{
  const remote=graph();const backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});assert.equal(await backend.read(),null);const initial=envelope();const result=await backend.init(initial);
  assert.equal(result.revision,initial.revision);assert.equal(result.envelope.vaultId,initial.vaultId);assert.ok(result.etag);
  const other=new OneDrive({auth,fetchImpl:remote.fetchImpl});assert.equal((await other.init(envelope())).revision,initial.revision);
});
test('concurrent bootstrap preserves exactly one permanent vault marker',async()=>{
  const remote=graph();const a=new OneDrive({auth,fetchImpl:remote.fetchImpl});const b=new OneDrive({auth,fetchImpl:remote.fetchImpl});
  const results=await Promise.all([a.init(envelope()),b.init(envelope())]);assert.equal(results[0].revision,results[1].revision);
  assert.equal([...remote.items.values()].filter(x=>x.name==='vault.json').length,1);
});
test('stale metadata publications fail instead of replacing a newer snapshot',async()=>{
  const remote=graph();const backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const a=envelope(initial.envelope.vaultId);const b=envelope(initial.envelope.vaultId);await backend.publish(initial,a);
  await assert.rejects(backend.publish(initial,b),{code:'remote-changed'});assert.equal((await backend.read()).revision,a.revision);
  const patch=remote.calls.find(x=>x.method==='PATCH');assert.equal(patch.headers.get('if-match'),initial.etag);
  assert.ok(![...remote.items.values()].some(x=>x.name===`snapshot-${initial.revision}.json`));
});
test('lost PATCH response is resolved by revision identity, not a second overwrite',async()=>{
  const remote=graph();const backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());const next=envelope(initial.envelope.vaultId);remote.loseNextPatch();await backend.publish(initial,next);
  assert.equal((await backend.read()).revision,next.revision);assert.equal(remote.calls.filter(x=>x.method==='PATCH').length,1);
});
test('unrelated root contents are never replaced by initialization',async()=>{
  const remote=graph();const folder=remote.add('DSH Sync','root',null,true);remote.add('unrelated.txt',folder.id,{});const backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});await assert.rejects(backend.init(envelope()),/unrelated files/);
});
test('signed download redirects do not receive the Microsoft bearer token',async()=>{
  const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
    if(url.startsWith('https://graph.microsoft.com/')){assert.equal(new Headers(options.headers).get('authorization'),'Bearer example-access');return new Response(null,{status:302,headers:{location:'https://download.example.test/object?signature=test'}});}
    assert.equal(new Headers(options.headers).get('authorization'),null);return Response.json({example:true});
  }});assert.deepEqual(await backend.content('example'),{example:true});
});

const pathOf=call=>decodeURIComponent(new URL(call.url).pathname.slice('/v1.0'.length));
const snapshotDownloads=(remote,id)=>remote.calls.filter(call=>call.method==='GET'&&pathOf(call)===`/me/drive/items/${id}/content`);
const snapshotItem=(remote,revision)=>[...remote.items.values()].find(item=>item.name===`snapshot-${revision}.json`);
function replaceHead(remote,backend,value,{etag=randomUUID()}={}){
  const item=remote.add(`snapshot-${value.revision}.json`,backend.folder.id,value);
  const head=remote.items.get(backend.marker.headItemId);head.name=`head-${value.revision}.json`;head.eTag=etag;
  return item;
}
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}

test('repeated verified reads recheck marker, head, and snapshot metadata but skip snapshot bytes and download callbacks',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  remote.calls.length=0;let downloads=0;
  for(let index=0;index<3;index++)assert.deepEqual(await backend.read({onDownload:()=>{downloads++;}}),initial);
  assert.equal(downloads,0);assert.equal(remote.calls.length,12);
  const marker=[...remote.items.values()].find(item=>item.name==='vault.json');
  assert.deepEqual(remote.calls.map(pathOf),Array.from({length:3},()=>[
    `/me/drive/items/${backend.folder.id}:/vault.json`,
    `/me/drive/items/${marker.id}/content`,
    `/me/drive/items/${backend.marker.headItemId}`,
    `/me/drive/items/${backend.folder.id}:/snapshot-${initial.revision}.json`,
  ]).flat());
});

test('a changed remote snapshot announces download immediately before delayed snapshot transport',async()=>{
  const remote=graph(),gate=deferred(),started=deferred(),events=[];let delayedId;
  const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
    if(new URL(url).pathname===`/v1.0/me/drive/items/${delayedId}/content`){events.push('content');started.resolve();await gate.promise;}
    return remote.fetchImpl(url,options);
  }});
  const initial=await backend.init(envelope()),next=envelope(initial.envelope.vaultId);
  delayedId=replaceHead(remote,backend,next).id;
  let completed=false;
  const reading=backend.read({onDownload:()=>{events.push('download');}}).then(value=>{completed=true;return value;});
  await started.promise;assert.deepEqual(events,['download','content']);assert.equal(completed,false);
  gate.resolve();assert.deepEqual((await reading).envelope,next);
  await backend.read({onDownload:()=>{events.push('unexpected');}});
  assert.deepEqual(events,['download','content']);assert.equal(snapshotDownloads(remote,delayedId).length,1);
});

test('confirmed publication seeds the next verified read without downloading its own uploaded snapshot',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const next=envelope(initial.envelope.vaultId),expected=structuredClone(next);const result=await backend.publish(initial,next);
  next.data.assets.push({fixture:'caller mutation'});result.envelope.data.assets.push({fixture:'result mutation'});
  let downloads=0;const reading=await backend.read({onDownload:()=>{downloads++;}});
  assert.deepEqual(reading.envelope,expected);assert.equal(downloads,0);
  assert.equal(snapshotDownloads(remote,snapshotItem(remote,expected.revision).id).length,0);
  reading.envelope.data.assets.push({fixture:'cached response mutation'});reading.etag='changed';
  assert.deepEqual((await backend.read()).envelope,expected);assert.notEqual((await backend.read()).etag,'changed');
});

test('downloaded and cached response mutations cannot change the single verified snapshot cache',async()=>{
  const remote=graph(),creator=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await creator.init(envelope());
  const backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});let downloads=0;
  const first=await backend.read({onDownload:()=>{downloads++;}});first.envelope.data.assets.push({fixture:'initial mutation'});first.revision='invalid';
  const second=await backend.read({onDownload:()=>{downloads++;}});assert.deepEqual(second,initial);
  second.envelope.mode='mutated';second.envelope.data.assets.push({fixture:'cache mutation'});
  assert.deepEqual(await backend.read(),initial);assert.equal(downloads,1);
});

for(const change of ['etag','revision','head item','snapshot item','vault','drive','folder']){
  test(`changing ${change} invalidates the verified snapshot cache`,async()=>{
    const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
    const head=remote.items.get(backend.marker.headItemId),marker=[...remote.items.values()].find(item=>item.name==='vault.json');
    let expected=structuredClone(initial.envelope);
    if(change==='etag')head.eTag='"replacement-tag"';
    if(change==='revision'){
      expected=envelope(initial.envelope.vaultId);replaceHead(remote,backend,expected,{etag:head.eTag});
    }
    if(change==='head item'){
      const replacement=remote.add(head.name,backend.folder.id,head.content);replacement.eTag=head.eTag;
      marker.content.headItemId=replacement.id;
    }
    if(change==='snapshot item'){
      const previous=snapshotItem(remote,initial.revision);remote.items.delete(previous.id);
      const replacement=remote.add(previous.name,backend.folder.id,structuredClone(previous.content));replacement.eTag=previous.eTag;
    }
    if(change==='vault'){
      expected={...expected,vaultId:randomUUID()};marker.content.vaultId=expected.vaultId;
      snapshotItem(remote,initial.revision).content=expected;
    }
    if(change==='drive')backend.driveId='another-drive';
    if(change==='folder'){
      const folder=remote.add('DSH Sync','root',null,true);remote.add('vault.json',folder.id,structuredClone(marker.content));
      head.parentReference.id=folder.id;snapshotItem(remote,initial.revision).parentReference.id=folder.id;backend.folder=folder;
    }
    let downloads=0;
    assert.deepEqual((await backend.read({onDownload:()=>{downloads++;}})).envelope,expected);assert.equal(downloads,1);
    await backend.read({onDownload:()=>{downloads++;}});assert.equal(downloads,1);
  });
}

test('a changed head tag reloads changed encryption metadata instead of retaining a prior keyring',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const encrypted=encodeEnvelope({vaultId:initial.envelope.vaultId,revision:initial.revision,assets:[],keyring:{id:randomUUID()},key:Buffer.alloc(32,7)});
  snapshotItem(remote,initial.revision).content=encrypted;remote.items.get(backend.marker.headItemId).eTag='"encrypted-head-tag"';
  let downloads=0;const result=await backend.read({onDownload:()=>{downloads++;}});
  assert.deepEqual(result.envelope,encrypted);assert.equal(downloads,1);
  result.envelope.keyring.id='caller-mutation';assert.equal((await backend.read()).envelope.keyring.id,encrypted.keyring.id);
});

test('the cache retains only one snapshot when publication metadata moves between revisions',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const next=envelope(initial.envelope.vaultId);replaceHead(remote,backend,next);let downloads=0;
  await backend.read({onDownload:()=>{downloads++;}});
  const head=remote.items.get(backend.marker.headItemId);head.name=`head-${initial.revision}.json`;head.eTag=initial.etag;
  await backend.read({onDownload:()=>{downloads++;}});assert.equal(downloads,2);
});

test('a lost PATCH response verifies one remote download then reuses that observed snapshot',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope()),next=envelope(initial.envelope.vaultId);
  remote.loseNextPatch();await backend.publish(initial,next);
  const snapshot=snapshotItem(remote,next.revision);assert.equal(snapshotDownloads(remote,snapshot.id).length,1);
  let downloads=0;assert.deepEqual((await backend.read({onDownload:()=>{downloads++;}})).envelope,next);
  assert.equal(downloads,0);assert.equal(snapshotDownloads(remote,snapshot.id).length,1);
});

test('a PATCH without an eTag does not seed an unverified publication cache',async()=>{
  const remote=graph();let omitTag=false;
  const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
    const response=await remote.fetchImpl(url,options);
    if(omitTag&&options.method==='PATCH'){const value=await response.json();delete value.eTag;return Response.json(value);}
    return response;
  }});
  const initial=await backend.init(envelope()),next=envelope(initial.envelope.vaultId);omitTag=true;await backend.publish(initial,next);
  let downloads=0;assert.deepEqual((await backend.read({onDownload:()=>{downloads++;}})).envelope,next);
  assert.equal(downloads,1);
});

test('unconfirmed publication never caches the proposed snapshot as a successful remote version',async()=>{
  const remote=graph();let failPatch=false;
  const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
    if(failPatch&&options.method==='PATCH')throw new Error('Unsent publication.');
    return remote.fetchImpl(url,options);
  }});
  const initial=await backend.init(envelope()),next=envelope(initial.envelope.vaultId);failPatch=true;
  await assert.rejects(backend.publish(initial,next),{code:'publication-unknown'});
  assert.deepEqual(await backend.read(),initial);
  assert.equal(snapshotDownloads(remote,snapshotItem(remote,next.revision).id).length,0);
});

for(const failure of ['marker missing','marker malformed','marker network','head missing','head malformed','head outside folder','head network','cached snapshot missing','snapshot metadata network','changed snapshot missing','changed snapshot mismatched','changed snapshot network']){
  test(`${failure} does not fall back to stale cached success and clears the retained response`,async()=>{
    const remote=graph();let failPath=null;
    const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
      if(new URL(url).pathname===failPath)throw new Error('Fixture transport failure.');
      return remote.fetchImpl(url,options);
    }});
    const initial=await backend.init(envelope());const head=remote.items.get(backend.marker.headItemId),originalHead=structuredClone(head);
    const marker=[...remote.items.values()].find(item=>item.name==='vault.json'),originalMarker=structuredClone(marker);
    const originalSnapshot=structuredClone(snapshotItem(remote,initial.revision));
    if(failure==='marker missing')remote.items.delete(marker.id);
    if(failure==='marker malformed')marker.content={format:0};
    if(failure==='marker network')failPath=`/v1.0/me/drive/items/${marker.id}/content`;
    if(failure==='cached snapshot missing')remote.items.delete(originalSnapshot.id);
    if(failure==='snapshot metadata network')failPath=`/v1.0/me/drive/items/${backend.folder.id}:/snapshot-${initial.revision}.json`;
    if(failure==='head missing')remote.items.delete(head.id);
    if(failure==='head malformed')head.name='unexpected-head.json';
    if(failure==='head outside folder')head.parentReference.id='another-folder';
    if(failure==='head network')failPath=`/v1.0/me/drive/items/${head.id}`;
    if(failure.startsWith('changed snapshot')){
      const next=envelope(initial.envelope.vaultId),snapshot=replaceHead(remote,backend,next);
      if(failure==='changed snapshot missing')remote.items.delete(snapshot.id);
      if(failure==='changed snapshot mismatched')snapshot.content.vaultId=randomUUID();
      if(failure==='changed snapshot network')failPath=`/v1.0/me/drive/items/${snapshot.id}/content`;
    }
    if(failure==='marker missing')assert.equal(await backend.read(),null);
    else await assert.rejects(backend.read());
    failPath=null;remote.items.set(originalMarker.id,originalMarker);remote.items.set(originalHead.id,originalHead);remote.items.set(originalSnapshot.id,originalSnapshot);
    let downloads=0;assert.deepEqual(await backend.read({onDownload:()=>{downloads++;}}),initial);assert.equal(downloads,1);
  });
}

test('missing snapshot metadata does not announce a content transfer',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const next=envelope(initial.envelope.vaultId),snapshot=replaceHead(remote,backend,next);remote.items.delete(snapshot.id);
  let downloads=0;await assert.rejects(backend.read({onDownload:()=>{downloads++;}}),{status:404});assert.equal(downloads,0);
});

test('a changed snapshot eTag reloads encryption metadata even when the head eTag and revision are unchanged',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  const snapshot=snapshotItem(remote,initial.revision);
  const encrypted=encodeEnvelope({vaultId:initial.envelope.vaultId,revision:initial.revision,assets:[],keyring:{id:randomUUID()},key:Buffer.alloc(32,9)});
  snapshot.content=encrypted;snapshot.eTag='"changed-snapshot-content"';
  let downloads=0;assert.deepEqual((await backend.read({onDownload:()=>{downloads++;}})).envelope,encrypted);
  assert.equal(downloads,1);assert.equal((await backend.read()).etag,initial.etag);
  snapshot.content={...encrypted,vaultId:randomUUID()};snapshot.eTag='"invalid-snapshot-content"';
  await assert.rejects(backend.read(),/Snapshot identity/);
});

test('snapshot metadata without an eTag is downloaded each time rather than cached',async()=>{
  const remote=graph(),backend=new OneDrive({auth,fetchImpl:remote.fetchImpl});const initial=await backend.init(envelope());
  delete snapshotItem(remote,initial.revision).eTag;
  let downloads=0;
  for(let index=0;index<2;index++)assert.deepEqual(await backend.read({onDownload:()=>{downloads++;}}),initial);
  assert.equal(downloads,2);
});

test('publication without an uploaded snapshot eTag waits for a verified remote download before caching',async()=>{
  const remote=graph();let omitTag=false;
  const backend=new OneDrive({auth,fetchImpl:async(url,options)=>{
    const response=await remote.fetchImpl(url,options);
    if(omitTag&&options.method==='PUT'&&decodeURIComponent(new URL(url).pathname).includes(':/snapshot-')){
      const value=await response.json();delete value.eTag;return Response.json(value);
    }
    return response;
  }});
  const initial=await backend.init(envelope()),next=envelope(initial.envelope.vaultId);omitTag=true;
  await backend.publish(initial,next);let downloads=0;
  assert.deepEqual((await backend.read({onDownload:()=>{downloads++;}})).envelope,next);
  await backend.read({onDownload:()=>{downloads++;}});assert.equal(downloads,1);
});
