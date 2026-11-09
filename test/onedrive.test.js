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
