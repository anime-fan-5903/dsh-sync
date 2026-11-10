import { randomBytes, randomUUID, createCipheriv, createDecipheriv, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { invariant, canonical, UUID, validateAssets, MAX_BYTES } from './model.js';
const scrypt = promisify(scryptCallback);
const KDF = Object.freeze({ algorithm: 'scrypt', N: 131072, r: 8, p: 1 });
const context = (...parts) => Buffer.from(['dsh-sync', '1', ...parts].join(':'));
function decode(value, length) {
  invariant(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'Invalid encrypted encoding.');
  const bytes = Buffer.from(value, 'base64url');
  invariant(bytes.toString('base64url') === value && (!length || bytes.length === length), 'Invalid encrypted length.');
  return bytes;
}
function seal(data, key, aad) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return { iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}
function open(value, key, aad) {
  invariant(value && typeof value === 'object', 'Invalid encrypted payload.');
  const decipher = createDecipheriv('aes-256-gcm', key, decode(value.iv, 12));
  decipher.setAAD(aad); decipher.setAuthTag(decode(value.tag, 16));
  return Buffer.concat([decipher.update(decode(value.ciphertext)), decipher.final()]);
}
async function passKey(passphrase, salt) {
  invariant(typeof passphrase === 'string' && passphrase.length >= 12 && passphrase.length <= 1024, 'Use a passphrase of 12 to 1024 characters.', 'invalid-passphrase');
  return scrypt(passphrase.normalize('NFKC'), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 192 * 1024 * 1024 });
}
export async function createKeyring(vaultId, passphrase, existingKey) {
  invariant(UUID.test(vaultId), 'Invalid vault ID.');
  const key = existingKey ? Buffer.from(existingKey) : randomBytes(32);
  const recovery = randomBytes(32); const salt = randomBytes(16); const id = randomUUID();
  const derived = await passKey(passphrase, salt);
  try {
    return { key, recoveryKey: recovery.toString('base64url'), keyring: {
      id, passphrase: { ...KDF, salt: salt.toString('base64url'), wrapped: seal(key, derived, context(vaultId, id, 'passphrase')) },
      recovery: { wrapped: seal(key, recovery, context(vaultId, id, 'recovery')) },
    } };
  } finally { derived.fill(0); recovery.fill(0); }
}
export async function unlockKeyring(vaultId, keyring, secret, method = 'passphrase') {
  invariant(UUID.test(vaultId) && keyring && UUID.test(keyring.id), 'Invalid keyring.');
  invariant(['passphrase','recovery'].includes(method), 'Invalid unlock method.');
  let wrapping;
  try {
    if (method === 'passphrase') {
      const p = keyring.passphrase;
      invariant(p?.algorithm === KDF.algorithm && p.N === KDF.N && p.r === KDF.r && p.p === KDF.p, 'Unsupported password derivation parameters.');
      wrapping = await passKey(secret, decode(p.salt, 16));
    } else wrapping = decode(secret.trim(), 32);
    const key = open(keyring[method].wrapped, wrapping, context(vaultId, keyring.id, method));
    invariant(key.length === 32, 'Invalid master key.'); return key;
  } catch { throw Object.assign(new Error('Unable to unlock. Check your passphrase or recovery key.'), { code: 'unlock-failed' }); }
  finally { wrapping?.fill(0); }
}
export function encodeEnvelope({ vaultId, revision = randomUUID(), assets, keyring = null, key = null, format = assets.some(asset => !asset.origin) ? 2 : 1 }) {
  invariant(UUID.test(vaultId) && UUID.test(revision), 'Invalid snapshot identity.'); validateAssets(assets);
  invariant([1, 2].includes(format) && (format === 2 || assets.every(asset => asset.origin)), 'Unsupported snapshot format.');
  const payload = { assets };
  if (!keyring) return { format, vaultId, revision, mode: 'plain', data: payload };
  invariant(key?.length === 32 && UUID.test(keyring.id), 'Unlock the vault before encryption.', 'locked');
  return { format, vaultId, revision, mode: 'encrypted', keyring,
    data: seal(Buffer.from(canonical(payload)), key, context(vaultId, revision, keyring.id, format === 1 ? 'snapshot' : 'snapshot-v2')) };
}
export function decodeEnvelope(envelope, key = null) {
  invariant([1, 2].includes(envelope?.format) && UUID.test(envelope.vaultId) && UUID.test(envelope.revision), 'Unsupported snapshot format.');
  invariant(Buffer.byteLength(JSON.stringify(envelope)) <= MAX_BYTES * 2, 'Snapshot is too large.');
  let payload;
  if (envelope.mode === 'plain') {
    invariant(!envelope.keyring, 'Plain snapshots cannot carry a keyring.'); payload = envelope.data;
  } else {
    invariant(envelope.mode === 'encrypted' && UUID.test(envelope.keyring?.id), 'Invalid snapshot encryption.');
    invariant(key?.length === 32, 'Unlock the vault to continue.', 'locked');
    try { payload = JSON.parse(open(envelope.data, key, context(envelope.vaultId, envelope.revision, envelope.keyring.id, envelope.format === 1 ? 'snapshot' : 'snapshot-v2')).toString('utf8')); }
    catch { throw Object.assign(new Error('Snapshot authentication failed.'), { code: 'authentication-failed' }); }
  }
  invariant(payload && Object.keys(payload).length === 1, 'Invalid snapshot payload.');
  validateAssets(payload.assets);
  invariant(envelope.format === 2 || payload.assets.every(asset => asset.origin), 'Extended assets require snapshot format 2.');
  return payload.assets;
}
export function wipe(key) { key?.fill(0); }
