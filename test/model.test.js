import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { merge, hashes, safeRelative, validateAssets, validateAsset, nativeId, validateOrigin } from '../src/model.js';
const prompt = (content, path = `prompts/example-${randomUUID()}.md`) => {
  const origin = { root: 'dsh', path };
  return { id: nativeId(origin), type: 'prompt', name: `.dsh/${path}`, content, origin };
};
test('independent assets converge without a conflict', () => {
  const a = prompt('base'); const b = prompt('base'); const base = hashes([a,b]);
  const result = merge(base,[{...a,content:'left'},b],[a,{...b,content:'right'}]);
  assert.equal(result.conflicts.length,0); assert.equal(result.assets.length,2);
  assert.equal(result.assets.find(x=>x.id===a.id).content,'left');
});
test('same asset conflict requires a fingerprint-bound choice and preserves rejected side', () => {
  const a = prompt('base'); const local = {...a,content:'local'}; const remote = {...a,content:'remote'};
  const pending = merge(hashes([a]),[local],[remote]); const conflict = pending.conflicts[0];
  assert.equal(merge(hashes([a]),[local],[remote],{[a.id]:{...conflict,side:'remote'}}).discarded[0].asset.content,'local');
  assert.equal(merge(hashes([a]),[{...local,content:'new'}],[remote],{[a.id]:{...conflict,side:'remote'}}).conflicts.length,1);
});
test('delete versus modification conflicts; unchanged side accepts deletion', () => {
  const a = prompt('base');
  assert.equal(merge(hashes([a]),[],[{...a,content:'changed'}]).conflicts[0].localDeleted,true);
  assert.deepEqual(merge(hashes([a]),[a],[]).assets,[]);
});
test('same resulting content converges even from a stale baseline', () => { const a=prompt('same'); assert.equal(merge({},[a],[a]).conflicts.length,0); });
test('resource paths are portable and reject traversal', () => {
  for (const value of ['../x','C:/x','/x','a\\b','a//b','NUL.txt','a.','a/../x']) assert.throws(()=>safeRelative(value));
  assert.equal(safeRelative('references/example.md'),'references/example.md');
});
test('duplicate asset identities fail validation', () => { const a=prompt('a'); assert.throws(()=>validateAssets([a,a])); });

const nativePrompt = (root, path) => ({ id: nativeId({root,path}), type:'prompt', name:`.${root}/${path}`, content:'Fixture', origin:{root,path} });
test('native identities are deterministic, root-specific and cannot lose their target metadata', () => {
  const asset = nativePrompt('dsh','AGENTS.md'); assert.equal(asset.id,nativeId(asset.origin));
  assert.notEqual(asset.id,nativeId({root:'agents',path:'AGENTS.md'})); validateAsset(asset);
  const {origin,...stripped} = asset; assert.throws(()=>validateAsset(stripped));
  assert.throws(()=>validateAsset({...asset,id:randomUUID()}));
  assert.throws(()=>validateAsset({...asset,name:'Unrelated target'}));
});
test('native origins allow only instruction scopes and never credentials, profiles or arbitrary roots', () => {
  for (const path of ['../AGENTS.md','state.json','profiles/default/AGENTS.md','data/private.md','skills/../private','prompts/.hidden/private.md','PROMPTS/private.md']) {
    assert.throws(()=>validateOrigin({root:'dsh',path}));
  }
  assert.throws(()=>validateOrigin({root:'other',path:'AGENTS.md'}));
  assert.throws(()=>validateOrigin({root:'dsh',path:'AGENTS.md',excluded:true}));
  assert.throws(()=>validateAssets([nativePrompt('dsh','prompts/Case.md'),nativePrompt('dsh','prompts/case.md')]));
});
test('same-name Skills can exist in separate native roots', () => {
  const skill = (root) => ({ id:nativeId({root,path:'skills/example'}), origin:{root,path:'skills/example'}, type:'skill', name:'example', description:'Native Skill: example', files:{'SKILL.md':Buffer.from('Example').toString('base64')} });
  assert.equal(validateAssets([skill('dsh'),skill('agents')]).length,2);
  const { origin, ...missingOrigin } = skill('dsh');
  assert.throws(() => validateAsset({ ...missingOrigin, id: randomUUID() }), { code: 'invalid-data' });
});

test('only native prompt and Skill records are accepted', () => {
  const { origin, ...missingOrigin } = nativePrompt('dsh', 'AGENTS.md');
  assert.throws(() => validateAsset({ ...missingOrigin, id: randomUUID() }), { code: 'invalid-data' });
  assert.throws(() => validateAsset({ id: randomUUID(), type: 'plugins', name: 'Unsupported declaration', packages: [] }), /Unsupported asset type/);
});
