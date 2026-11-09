import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createKeyring,unlockKeyring,encodeEnvelope,decodeEnvelope } from '../src/crypto.js';
import { nativeId } from '../src/model.js';
const origin = { root: 'dsh', path: 'AGENTS.md' };
const vaultId=randomUUID(); const assets=[{id:nativeId(origin),type:'prompt',name:'.dsh/AGENTS.md',content:'Sensitive example text',origin}];
test('plaintext is an explicit supported mode',()=> { const env=encodeEnvelope({vaultId,assets}); assert.equal(env.mode,'plain'); assert.deepEqual(decodeEnvelope(env),assets); });
test('passphrase and recovery independently unlock; tampering and substitution fail',async()=> {
  const setup=await createKeyring(vaultId,'a sufficiently long example passphrase');
  const env=encodeEnvelope({vaultId,assets,keyring:setup.keyring,key:setup.key});
  assert.ok(!JSON.stringify(env).includes(assets[0].content));
  assert.deepEqual(decodeEnvelope(env,await unlockKeyring(vaultId,setup.keyring,'a sufficiently long example passphrase')),assets);
  assert.deepEqual(decodeEnvelope(env,await unlockKeyring(vaultId,setup.keyring,setup.recoveryKey,'recovery')),assets);
  await assert.rejects(unlockKeyring(vaultId,setup.keyring,'the wrong long passphrase'),{code:'unlock-failed'});
  assert.throws(()=>decodeEnvelope({...env,revision:randomUUID()},setup.key),{code:'authentication-failed'});
  assert.throws(()=>decodeEnvelope(env),{code:'locked'});
  const changed=structuredClone(env); changed.data.tag=Buffer.alloc(16).toString('base64url'); assert.throws(()=>decodeEnvelope(changed,setup.key));
});
test('hostile KDF parameters are rejected without performing expensive derivation',async()=> {
  await assert.rejects(unlockKeyring(vaultId,{id:randomUUID(),passphrase:{algorithm:'scrypt',N:2**30}},'a long enough passphrase'),{code:'unlock-failed'});
});

test('snapshot encoding and decoding reject records without native targets and unsupported types', () => {
  const { origin, ...missingOrigin } = assets[0];
  for (const asset of [
    { ...missingOrigin, id: randomUUID() },
    { id: randomUUID(), type: 'plugins', name: 'Unsupported declaration', packages: [] },
  ]) {
    assert.throws(() => encodeEnvelope({ vaultId, assets: [asset] }), { code: 'invalid-data' });
    const envelope = { format: 1, vaultId, revision: randomUUID(), mode: 'plain', data: { assets: [asset] } };
    assert.throws(() => decodeEnvelope(envelope), { code: 'invalid-data' });
  }
});
