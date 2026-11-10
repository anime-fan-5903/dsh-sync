import { invariant, UUID, MAX_BYTES } from './model.js';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ROOT_NAME = 'DSH Sync';
const encode = value => encodeURIComponent(value);
const pointer = /^head-([0-9a-f-]{36})\.json$/i;
export class OneDrive {
  constructor({ auth, fetchImpl = fetch }) { this.auth = auth; this.fetch = fetchImpl; this.folder = null; this.marker = null; this.driveId = null; this.warning = null; this.snapshotCache = null; }
  async request(resource, options = {}) {
    invariant(resource.startsWith('/me/drive'), 'Invalid Graph resource.');
    let response;
    try { response = await this.fetch(`${GRAPH}${resource}`, { ...options, headers: { Authorization: `Bearer ${await this.auth.token()}`, ...options.headers },
      signal: AbortSignal.timeout(30000), redirect: 'manual' }); }
    catch (error) { if (error.code) throw error; throw Object.assign(new Error('Unable to reach OneDrive. Local changes remain on this device.'), { code: 'network-failed' }); }
    if (!response.ok && ![301,302,303,307,308].includes(response.status)) {
      let code = 'graph-error'; try { const body = await response.json(); if (/^[A-Za-z0-9_-]+$/.test(body?.error?.code)) code = body.error.code; } catch {}
      const message = response.status === 401 ? 'OneDrive authorization was rejected. Sign in again.' : response.status === 429 ? 'OneDrive is rate limiting requests. Retry later.' : `OneDrive request failed (${response.status}, ${code}).`;
      throw Object.assign(new Error(message), { code: response.status === 412 ? 'remote-changed' : response.status === 401 ? 'reauth-required' : code, status: response.status });
    }
    return response;
  }
  async json(resource, options = {}) {
    const response = await this.request(resource, options);
    invariant(response.status >= 200 && response.status < 300, 'Unexpected OneDrive redirect.');
    if (response.status === 204) return null;
    return this.readJson(response);
  }
  async readJson(response) {
    invariant(Number(response.headers.get('content-length') ?? 0) <= MAX_BYTES * 2, 'OneDrive data exceeds the size limit.');
    const reader = response.body?.getReader(); invariant(reader, 'OneDrive returned an empty response.');
    const chunks=[]; let size=0;
    try { for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.length; invariant(size<=MAX_BYTES*2,'OneDrive data exceeds the size limit.'); chunks.push(Buffer.from(part.value)); } }
    finally { await reader.cancel().catch(()=>{}); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('OneDrive contains invalid JSON data.'), { code:'invalid-data' }); }
  }
  async content(itemId) {
    let response = await this.request(`/me/drive/items/${encode(itemId)}/content`);
    if ([301,302,303,307,308].includes(response.status)) {
      let url; try { url = new URL(response.headers.get('location')); } catch {}
      invariant(url?.protocol === 'https:' && !url.username && !url.password, 'OneDrive returned an unsafe download URL.');
      try { response = await this.fetch(url.href, { signal: AbortSignal.timeout(30000), redirect:'follow' }); }
      catch { throw Object.assign(new Error('Unable to download the OneDrive snapshot.'), {code:'network-failed'}); }
      invariant(response.ok, 'OneDrive snapshot download failed.');
    }
    return this.readJson(response);
  }
  item(id) { invariant(typeof id==='string' && id.length>0 && id.length<=300, 'Invalid OneDrive item ID.'); return `/me/drive/items/${encode(id)}`; }
  async child(name) { return this.json(`${this.item(this.folder.id)}:/${encode(name)}`); }
  async upload(name, value) {
    const body=JSON.stringify(value); invariant(Buffer.byteLength(body)<=MAX_BYTES*2,'Snapshot exceeds the transport size limit.');
    return this.json(`${this.item(this.folder.id)}:/${encode(name)}:/content?%40microsoft.graph.conflictBehavior=fail`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body,
    });
  }
  async children() {
    const result=[]; let resource=`${this.item(this.folder.id)}/children?$select=id,name,folder,file&$top=200`;
    while(resource){const page=await this.json(resource); invariant(Array.isArray(page.value),'Invalid OneDrive folder listing.'); result.push(...page.value); invariant(result.length<=5000,'Too many files in the sync directory.');
      if(page['@odata.nextLink']) {const url=new URL(page['@odata.nextLink']); invariant(url.origin==='https://graph.microsoft.com' && url.pathname.startsWith('/v1.0/me/drive'),'Unsafe Graph pagination link.'); resource=url.pathname.slice('/v1.0'.length)+url.search;}else resource=null;
    }
    return result;
  }
  async connect({create=false}={}) {
    if(!this.folder){
      try {this.folder=await this.json(`/me/drive/root:/${encode(ROOT_NAME)}`);}
      catch(error){if(error.status!==404)throw error;if(!create)return {driveId:null,folderId:null,marker:null};
        try {this.folder=await this.json('/me/drive/root/children',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ROOT_NAME,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});}
        catch(failure){if(failure.status!==409)throw failure;this.folder=await this.json(`/me/drive/root:/${encode(ROOT_NAME)}`);}
      }
      invariant(this.folder.folder && !this.folder.remoteItem,'The OneDrive root already contains an incompatible DSH Sync item.');
      this.driveId=this.folder.parentReference?.driveId;
    }
    try {
      const markerItem=await this.child('vault.json'); invariant(markerItem.file,'The vault marker is not a file.');
      const marker=await this.content(markerItem.id);
      invariant(marker?.format===1 && UUID.test(marker.vaultId) && typeof marker.headItemId==='string','The sync folder contains an unsupported vault marker.');
      this.item(marker.headItemId); this.marker=marker;
    }catch(error){if(error.status!==404)throw error;this.marker=null;}
    return {driveId:this.driveId,folderId:this.folder.id,marker:this.marker};
  }
  /** Recheck publication metadata and announce only an uncached snapshot download. */
  async read({onDownload=()=>{}}={}) {
    try {
      const connected=await this.connect();
      if(!connected.marker){this.snapshotCache=null;return null;}
      const marker=connected.marker;
      for(let attempt=0;attempt<2;attempt++){
        const head=await this.json(this.item(marker.headItemId));
        invariant(head.file && head.parentReference?.id===connected.folderId,'The vault head is outside the sync folder.');
        const match=pointer.exec(head.name??''); invariant(match && UUID.test(match[1]) && typeof head.eTag==='string','The vault head is malformed.');
        const revision=match[1];
        try {
          const snapshot=await this.child(`snapshot-${revision}.json`); invariant(snapshot.file,'The snapshot is not a file.');
          const cacheable=typeof snapshot.id==='string' && typeof snapshot.eTag==='string';
          const key=JSON.stringify([connected.driveId,connected.folderId,marker.headItemId,marker.vaultId,revision,head.eTag,snapshot.id,snapshot.eTag]);
          if(cacheable && this.snapshotCache?.key===key)return structuredClone(this.snapshotCache.value);
          this.snapshotCache=null;
          onDownload();
          const envelope=await this.content(snapshot.id);
          invariant([1,2,3].includes(envelope?.format) && envelope.vaultId===marker.vaultId && envelope.revision===revision,'Snapshot identity does not match the published vault head.');
          const value={revision,etag:head.eTag,envelope};
          if(cacheable)this.snapshotCache={key,value:structuredClone(value)};
          return value;
        }catch(error){this.snapshotCache=null;if(error.status!==404 || attempt===1)throw error;}
      }
    }catch(error){this.snapshotCache=null;throw error;}
  }
  async init(envelope) {
    invariant(UUID.test(envelope?.vaultId) && UUID.test(envelope?.revision),'Invalid initial snapshot.');
    const connected=await this.connect({create:true}); if(connected.marker)return this.read();
    const entries=await this.children();
    if (entries.some(entry => entry.name === 'vault.json')) { await this.connect(); return this.read(); }
    invariant(entries.every(entry=>/^(head|snapshot)-[0-9a-f-]{36}\.json$/i.test(entry.name)), 'The existing DSH Sync folder contains unrelated files. Choose a clean folder before initialization.');
    await this.upload(`snapshot-${envelope.revision}.json`,envelope);
    const head=await this.upload(`head-${envelope.revision}.json`,{format:1,vaultId:envelope.vaultId});
    try {await this.upload('vault.json',{format:1,vaultId:envelope.vaultId,headItemId:head.id});}
    catch(error){if(error.status!==409){const check=await this.connect().catch(()=>null);if(!check?.marker)throw error;}}
    await this.connect(); invariant(this.marker,'The initialization outcome could not be confirmed. Retry joining the vault.');return this.read();
  }
  async publish(expected,envelope) {
    await this.connect(); invariant(this.marker && envelope.vaultId===this.marker.vaultId && UUID.test(envelope.revision),'Invalid vault publication.');
    invariant(typeof expected?.etag==='string' && UUID.test(expected.revision),'Publication requires the previously read version.');
    const candidate=structuredClone(envelope);
    const identity=[this.driveId,this.folder.id,this.marker.headItemId,this.marker.vaultId];
    const snapshot=await this.upload(`snapshot-${candidate.revision}.json`,candidate);
    this.snapshotCache=null;
    try {
      const head=await this.json(this.item(identity[2]),{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':expected.etag},body:JSON.stringify({name:`head-${candidate.revision}.json`})});
      if(typeof head?.eTag==='string' && typeof snapshot?.id==='string' && typeof snapshot.eTag==='string')this.snapshotCache={key:JSON.stringify([...identity,candidate.revision,head.eTag,snapshot.id,snapshot.eTag]),value:{revision:candidate.revision,etag:head.eTag,envelope:structuredClone(candidate)}};
    }catch(error){
      if(error.status===412)throw error;
      const observed=await this.read().catch(()=>null);
      if(observed?.revision!==candidate.revision)throw Object.assign(new Error('OneDrive publication could not be confirmed. Retry synchronization; local changes are preserved.'),{code:'publication-unknown'});
    }
    // Only retire the known predecessor, never another device's uncommitted candidate.
    if(expected.revision!==candidate.revision){
      try {const old=await this.child(`snapshot-${expected.revision}.json`);await this.request(this.item(old.id),{method:'DELETE'});}
      catch(error){if(error.status!==404)this.warning='The previous cloud snapshot could not be retired. It may still contain plaintext.';}
    }
    return {revision:candidate.revision,etag:null,envelope:structuredClone(candidate)};
  }
}
