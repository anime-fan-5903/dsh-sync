import { randomUUID } from 'node:crypto';
import { hash, hashes, merge, invariant, validateAssets } from './model.js';
import { createKeyring, unlockKeyring, encodeEnvelope, decodeEnvelope, wipe } from './crypto.js';

export class SyncEngine {
  constructor({ store, backend, native = null, onChange = () => {} }) {
    this.store = store; this.backend = backend; this.native = native; this.onChange = onChange;
    this.key = null; this.unlockedKeyring = null; this.conflicts = []; this.phase = 'idle'; this.error = null;
  }
  async status() {
    const state = await this.store.read();
    return { phase: this.phase, error: this.error, conflicts: this.conflicts, encrypted: state.encrypted,
      locked: state.encrypted && (!this.key || this.unlockedKeyring !== state.keyring?.id), initialized: !!state.vaultId,
      lastSync: state.lastSync, settings: state.settings, assetCount: state.assets.length,
      assets: state.assets.map(asset => ({ id: asset.id, type: asset.type, name: asset.name, native: !!asset.origin,
        ...(asset.origin ? { origin: asset.origin } : {}), revisionHash: hash(asset) })), backupCount: state.backups.length };
  }
  lock() { wipe(this.key); this.key = null; this.unlockedKeyring = null; this.onChange(); }
  async unlock(secret, method = 'passphrase') {
    return this.store.exclusive(async () => {
      const state = await this.store.read(); invariant(state.keyring, 'No encrypted vault has been discovered.');
      let key;
      try { key = await unlockKeyring(state.vaultId,state.keyring,secret,method); }
      catch (original) {
        // A locked device may still have the previous passphrase wrapper. Refresh only after local unlock fails;
        // offline unlocking with a usable local wrapper must remain possible.
        let renewed;
        try {
          const remote = await this.backend.read(); this.assertRemote(state,remote);
          invariant(remote.envelope.mode === 'encrypted' && remote.envelope.keyring?.id !== state.keyring.id, 'No newer keyring.');
          renewed = await unlockKeyring(state.vaultId,remote.envelope.keyring,secret,method);
          decodeEnvelope(remote.envelope,renewed);
          state.keyring = remote.envelope.keyring; state.encrypted = true; await this.store.write(state);
          key = renewed; renewed = null;
        } catch { throw original; }
        finally { wipe(renewed); }
      }
      this.lock(); this.key = key; this.unlockedKeyring = state.keyring.id; this.onChange(); return { unlocked: true };
    });
  }
  async reconcile(state, remoteAssets, decisions = {}) {
    const plan = this.native ? await this.native.prepare(state, remoteAssets)
      : { base: state.base, local: state.assets, remote: remoteAssets, passthrough: [] };
    // Persist freshly observed files before network publication. The baseline is deliberately unchanged.
    await this.store.write(state);
    const result = merge(plan.base, plan.local, plan.remote, decisions);
    const published = [...plan.passthrough, ...result.assets].sort((a,b) => a.id.localeCompare(b.id));
    if (!result.conflicts.length) validateAssets(published);
    return { ...result, plan, published };
  }
  async backupDiscarded(state, discarded) {
    const backups = discarded.map(item => ({ id: randomUUID(), createdAt: new Date().toISOString(), side: item.side,
      origin: item.asset.origin,
      envelope: encodeEnvelope({ vaultId: state.vaultId, assets: [item.asset], keyring: state.keyring, key: this.key }) }));
    if (backups.length) { state.backups = [...backups, ...state.backups].slice(0,10); await this.store.write(state); }
  }
  async finish(state, result) {
    // Recheck the real working files after publication. A concurrent editor must never be overwritten.
    // On any failure the persisted baseline stays old, so the next attempt detects the intervening edit.
    if (this.native) await this.native.apply(result.plan, result.assets);
    state.assets = result.assets; state.base = hashes(result.assets); state.lastSync = new Date().toISOString();
    await this.store.write(state);
    if (this.native) await this.native.committed(state, result.published);
    this.onChange();
  }
  async initialize({ encrypted = false, passphrase } = {}) {
    return this.store.exclusive(async () => {
      const state = await this.store.read(); invariant(!state.vaultId, 'This device is already initialized.');
      invariant(typeof encrypted === 'boolean', 'Choose whether the new vault is encrypted.'); state.settings.enabled = true;
      const remote = await this.backend.read();
      if (remote) { await this.adoptMetadata(state, remote.envelope); return { joined: true, encrypted: state.encrypted }; }
      const result = await this.reconcile(state, []);
      invariant(!result.conflicts.length, 'Resolve local assets before initializing.', 'conflict');
      const vaultId = randomUUID(); let setup;
      if (encrypted) setup = await createKeyring(vaultId, passphrase);
      const envelope = encodeEnvelope({ vaultId, assets: result.published, keyring: setup?.keyring, key: setup?.key });
      let published;
      try { published = await this.backend.init(envelope); } catch (error) { wipe(setup?.key); throw error; }
      if (published.envelope.vaultId !== vaultId || published.revision !== envelope.revision) {
        wipe(setup?.key); await this.adoptMetadata(state, published.envelope); return { joined: true, encrypted: state.encrypted };
      }
      this.lock(); this.key = setup?.key ?? null; this.unlockedKeyring = setup?.keyring.id ?? null;
      Object.assign(state, { vaultId, encrypted, keyring: setup?.keyring ?? null, assets: result.assets,
        base: hashes(result.assets), lastSync: new Date().toISOString() });
      // Initialization only uploads a snapshot; it does not replace working files.
      await this.store.write(state); if (this.native) await this.native.committed(state, result.published); this.onChange();
      return { initialized: true, encrypted, ...(setup ? { recoveryKey: setup.recoveryKey } : {}) };
    });
  }
  async adoptMetadata(state, envelope) {
    invariant(envelope?.format === 1 && ['plain','encrypted'].includes(envelope.mode), 'Unsupported remote vault.');
    state.vaultId = envelope.vaultId; state.encrypted = envelope.mode === 'encrypted'; state.keyring = envelope.keyring ?? null;
    state.base = {}; state.lastSync = null; state.settings.enabled = true; this.lock(); await this.store.write(state); this.onChange();
  }
  assertRemote(state, remote) {
    invariant(remote, 'The remote vault is missing. No data was replaced.', 'remote-missing');
    invariant(remote.envelope.vaultId === state.vaultId, 'The signed-in account contains a different vault. Disconnect before switching vaults.', 'wrong-vault');
  }
  async synchronize(decisions = {}) {
    return this.store.exclusive(async () => {
      this.phase = 'syncing'; this.error = null; this.onChange();
      try {
        const state = await this.store.read(); invariant(state.vaultId, 'Initialize or join a vault first.', 'not-initialized');
        const remote = await this.backend.read(); this.assertRemote(state, remote);
        let remoteAssets;
        if (remote.envelope.mode === 'encrypted' && remote.envelope.keyring?.id !== state.keyring?.id) {
          // A new passphrase wrapper does not revoke an already trusted master key.
          if (this.key) { try { remoteAssets = decodeEnvelope(remote.envelope,this.key); } catch { this.lock(); } }
          state.keyring = remote.envelope.keyring; state.encrypted = true;
          if (this.key) this.unlockedKeyring = state.keyring.id;
          await this.store.write(state);
        }
        invariant(!(state.encrypted && remote.envelope.mode === 'plain'), 'Refusing an unexpected plaintext downgrade.', 'encryption-downgrade');
        if (state.encrypted) invariant(this.key && this.unlockedKeyring === state.keyring?.id, 'Unlock the vault to synchronize.', 'locked');
        remoteAssets ??= decodeEnvelope(remote.envelope, this.key);
        const result = await this.reconcile(state, remoteAssets, decisions); this.conflicts = result.conflicts;
        if (result.conflicts.length) { this.phase = 'conflict'; return { conflicts: result.conflicts }; }
        await this.backupDiscarded(state, result.discarded);
        if (hash(hashes(result.published)) !== hash(hashes(remoteAssets))) {
          await this.backend.publish(remote, encodeEnvelope({ vaultId: state.vaultId, assets: result.published, keyring: state.keyring, key: this.key }));
        }
        await this.finish(state, result); this.phase = 'synced'; this.conflicts = [];
        return { synced: true, assetCount: state.assets.length };
      } catch (error) { this.phase = error.code === 'locked' ? 'locked' : 'error'; this.error = { code: error.code ?? 'sync-failed', message: error.message }; throw error; }
      finally { this.onChange(); }
    });
  }
  async finishEncryption(state, result, recoveryKey, outcome) {
    // Publication cannot be rolled back by a local failure. Always return the newly
    // issued recovery key to the user, without putting it in status or diagnostics.
    try {
      await this.finish(state, result);
      return { ...outcome, recoveryKey, remotePublished: true, localCompleted: true };
    } catch {
      this.phase = 'error';
      this.error = { code: 'encryption-local-failed', message: 'The encryption change was published, but local completion failed. Save the new recovery key and retry synchronization after fixing local storage or file access.' };
      return { ...outcome, recoveryKey, remotePublished: true, localCompleted: false, error: this.error };
    }
  }
  async enableEncryption(passphrase) {
    return this.store.exclusive(async () => {
      const state = await this.store.read(); invariant(state.vaultId && !state.encrypted, 'Initialize a plaintext vault before enabling encryption.');
      const remote = await this.backend.read(); this.assertRemote(state, remote);
      invariant(remote.envelope.mode === 'plain', 'Refresh the vault before changing encryption.');
      const result = await this.reconcile(state, decodeEnvelope(remote.envelope));
      invariant(!result.conflicts.length, 'Resolve all conflicts before enabling encryption.', 'conflict');
      await this.backupDiscarded(state, result.discarded);
      const setup = await createKeyring(state.vaultId, passphrase);
      try {
        // Prepare encrypted backups before the irreversible cloud transition.
        const backups = state.backups.map(backup => ({ ...backup, envelope: encodeEnvelope({ vaultId: state.vaultId,
          assets: decodeEnvelope(backup.envelope), keyring: setup.keyring, key: setup.key }) }));
        await this.backend.publish(remote, encodeEnvelope({ vaultId: state.vaultId, assets: result.published, keyring: setup.keyring, key: setup.key }));
        wipe(this.key); this.key = setup.key; this.unlockedKeyring = setup.keyring.id;
        Object.assign(state, { encrypted: true, keyring: setup.keyring, backups });
        return await this.finishEncryption(state, result, setup.recoveryKey, { encrypted: true,
          warning: 'Previously uploaded plaintext may remain in OneDrive snapshots, version history, recycle bins, and other devices.' });
      } catch (error) { if (this.key !== setup.key) wipe(setup.key); throw error; }
    });
  }
  async changePassphrase(passphrase) {
    return this.store.exclusive(async () => {
      const state = await this.store.read(); invariant(state.encrypted && this.key && this.unlockedKeyring === state.keyring?.id, 'Unlock the encrypted vault first.', 'locked');
      const remote = await this.backend.read(); this.assertRemote(state, remote);
      invariant(remote.envelope.keyring?.id === state.keyring.id, 'Refresh and unlock the current vault first.');
      const result = await this.reconcile(state, decodeEnvelope(remote.envelope, this.key));
      invariant(!result.conflicts.length, 'Resolve conflicts first.', 'conflict'); await this.backupDiscarded(state, result.discarded);
      const setup = await createKeyring(state.vaultId, passphrase, this.key);
      try {
        await this.backend.publish(remote, encodeEnvelope({ vaultId: state.vaultId, assets: result.published, keyring: setup.keyring, key: setup.key }));
        const oldKey = this.key; this.key = setup.key; this.unlockedKeyring = setup.keyring.id; wipe(oldKey);
        state.keyring = setup.keyring;
        return await this.finishEncryption(state, result, setup.recoveryKey, { changed: true });
      } catch (error) { if (this.key !== setup.key) wipe(setup.key); throw error; }
    });
  }
  async restoreBackup(id) {
    return this.store.exclusive(async () => {
      const state = await this.store.read(); const backup = state.backups.find(item => item.id === id); invariant(backup, 'Backup not found.');
      const [asset] = decodeEnvelope(backup.envelope, this.key); let plan;
      if (this.native) {
        invariant(this.native && this.native.isActive(asset), 'Re-include the native item and enable its root before restoring.', 'native-not-tracked');
        plan = await this.native.prepare(state, []);
      }
      const current = state.assets.find(a => a.id === asset.id);
      if (current) state.backups.unshift({ id: randomUUID(), createdAt: new Date().toISOString(), side: 'local', origin: current.origin, envelope: encodeEnvelope({ vaultId: state.vaultId, assets: [current], keyring: state.keyring, key: this.key }) });
      state.backups = state.backups.slice(0,10); await this.store.write(state);
      const assets = [...state.assets.filter(a => a.id !== asset.id), asset]; validateAssets(assets);
      if (plan) await this.native.apply(plan, assets);
      state.assets = assets; await this.store.write(state);
      if (this.native) await this.native.refresh(state);
      this.phase = 'pending'; this.onChange(); return { restored: true };
    });
  }
}
