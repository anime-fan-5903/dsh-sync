import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createCipheriv } from 'node:crypto';
import { createKeyring,unlockKeyring,encodeEnvelope,decodeEnvelope } from '../src/crypto.js';
import { nativeId, canonical } from '../src/model.js';
import { controlAsset, preferencesAsset, TARGET_DEFAULTS } from '../src/preference-records.js';
import { configAsset } from '../src/portable-config.js';
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

test('shared preference records require format 3 in plaintext and cannot be downgraded', () => {
  const preferences = preferencesAsset({ targets: { ...TARGET_DEFAULTS }, autoSync: true, intervalSeconds: 30 });
  for (const records of [[controlAsset(false)], [preferences], [...assets, controlAsset(true), preferences]]) {
    const envelope = encodeEnvelope({ vaultId, assets: records });
    assert.equal(envelope.format, 3); assert.deepEqual(decodeEnvelope(envelope), records);
    for (const format of [1, 2]) {
      assert.throws(() => encodeEnvelope({ vaultId, assets: records, format }), { code: 'invalid-data' });
      assert.throws(() => decodeEnvelope({ ...envelope, format }), { code: 'invalid-data' });
    }
  }
  for (const format of [0, 4, '3']) assert.throws(() => encodeEnvelope({ vaultId, assets: [], format }), { code: 'invalid-data' });
});

test('encrypted format 3 binds its version and accepts both preference singleton types', () => {
  const key = randomBytes(32), keyring = { id: randomUUID() };
  const records = [controlAsset(true), preferencesAsset({ targets: { ...TARGET_DEFAULTS }, autoSync: false, intervalSeconds: 3600 })];
  const envelope = encodeEnvelope({ vaultId, assets: records, key, keyring });
  assert.equal(envelope.format, 3); assert.deepEqual(decodeEnvelope(envelope, key), records);
  assert.equal(JSON.stringify(envelope).includes('sync-preferences'), false);
  for (const format of [1, 2]) assert.throws(() => decodeEnvelope({ ...envelope, format }, key), { code: 'authentication-failed' });
  assert.throws(() => decodeEnvelope({ ...envelope, format: 4 }, key), { code: 'invalid-data' });
  assert.throws(() => decodeEnvelope(envelope), { code: 'locked' });
});

test('format 1 and 2 encryption purposes remain compatible and sticky format 3 can contain older assets', () => {
  const key = randomBytes(32), keyring = { id: randomUUID() };
  const configuration = [configAsset('settings', 'ui-theme', { preference: 'dark' })];
  for (const [format, records] of [[1, assets], [2, configuration]]) {
    const revision = randomUUID(), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const purpose = format === 1 ? 'snapshot' : 'snapshot-v2';
    cipher.setAAD(Buffer.from(`dsh-sync:1:${vaultId}:${revision}:${keyring.id}:${purpose}`));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonical({ assets: records }))), cipher.final()]);
    const legacy = { format, vaultId, revision, mode: 'encrypted', keyring,
      data: { iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') } };
    assert.deepEqual(decodeEnvelope(legacy, key), records);
    const encoded = encodeEnvelope({ vaultId, assets: records }); assert.equal(encoded.format, format);
    assert.deepEqual(decodeEnvelope(encoded), records);
    const sticky = encodeEnvelope({ vaultId, assets: records, format: 3, keyring, key });
    assert.equal(sticky.format, 3); assert.deepEqual(decodeEnvelope(sticky, key), records);
    assert.throws(() => decodeEnvelope({ ...sticky, format }, key), { code: 'authentication-failed' });
  }
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
