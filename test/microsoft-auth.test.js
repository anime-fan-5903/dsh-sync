import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MicrosoftAuth } from '../src/microsoft-auth.js';
const clientId='11111111-1111-4111-8111-111111111111';
function credentials(initial){let value=initial;let queue=Promise.resolve();return {read:async()=>structuredClone(value),modify(fn){const next=queue.then(async()=>{value=await fn(value);return value;});queue=next.catch(()=>{});return next;}};}
test('native browser login validates state and uses PKCE without a client secret',async t=>{
  const store=credentials();let posted;
  const auth=new MicrosoftAuth({clientId,credentials:store,fetchImpl:async(url,options)=>{assert.ok(url.endsWith('/token'));posted=new URLSearchParams(options.body);return Response.json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600});}});
  t.after(()=>auth.dispose());const {url}=await auth.begin();const authorize=new URL(url);const callback=new URL(authorize.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname,'localhost');assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');assert.ok(authorize.searchParams.get('scope').includes('Files.ReadWrite'));
  callback.search=new URLSearchParams({state:'wrong',code:'example'});assert.equal((await fetch(callback)).status,400);assert.equal(auth.status().pending,true);
  callback.search=new URLSearchParams({state:authorize.searchParams.get('state'),code:'example'});assert.equal((await fetch(callback)).status,200);
  assert.equal(posted.has('client_secret'),false);assert.equal(createHash('sha256').update(posted.get('code_verifier')).digest('base64url'),authorize.searchParams.get('code_challenge'));
  assert.equal(await auth.signedIn(),true);assert.equal(await auth.token(),'test-access');assert.equal(auth.status().pending,false);
  assert.ok(!JSON.stringify(auth.status()).includes('test-refresh'));await auth.signOut();assert.equal(await auth.signedIn(),false);
});
test('refresh is serialized and stores replacement refresh tokens',async()=>{
  const store=credentials({accounts:{[clientId]:{refreshToken:'old',expiresAt:0}}});let calls=0;
  const auth=new MicrosoftAuth({clientId,credentials:store,fetchImpl:async(_url,options)=>{calls++;assert.equal(new URLSearchParams(options.body).get('refresh_token'),'old');return Response.json({access_token:'new-access',refresh_token:'rotated',expires_in:3600});}});
  assert.deepEqual(await Promise.all([auth.token(),auth.token()]),['new-access','new-access']);assert.equal(calls,1);assert.equal((await store.read()).accounts[clientId].refreshToken,'rotated');
});
test('denied authorization is explicit and does not write tokens',async t=>{
  const store=credentials();const auth=new MicrosoftAuth({clientId,credentials:store});t.after(()=>auth.dispose());
  const authorize=new URL((await auth.begin()).url);const callback=new URL(authorize.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:authorize.searchParams.get('state'),error:'access_denied'});
  assert.equal((await fetch(callback)).status,400);assert.equal(auth.status().error.code,'authorization-canceled');assert.equal(await auth.signedIn(),false);
});
test('invalid registration and revoked refresh have bounded safe errors',async()=>{
  const invalid=new MicrosoftAuth({clientId:'',credentials:credentials()});await assert.rejects(invalid.begin(),{code:'client-id-required'});
  const auth=new MicrosoftAuth({clientId,credentials:credentials({accounts:{[clientId]:{refreshToken:'secret',expiresAt:0}}}),fetchImpl:async()=>Response.json({error:'invalid_grant',error_description:'secret diagnostic'},{status:400})});
  await assert.rejects(auth.token(),error=>error.code==='reauth-required'&&!error.message.includes('secret'));
});
