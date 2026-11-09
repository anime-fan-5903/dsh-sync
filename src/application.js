import { nativeId, validateOrigin, invariant, UUID } from './model.js';
import { MicrosoftAuth } from './microsoft-auth.js';
import { OneDrive } from './onedrive.js';
import { LocalStore } from './local-store.js';
import { SyncEngine } from './engine.js';
import { MICROSOFT_CLIENT_ID } from './config.js';
import { NativeTracking } from './tracking.js';
import { DeviceTrust } from './device-trust.js';

export const AGENT_ACTIONS = ['status','tracking-refresh','sync','backup-list','backup-restore'];
export class Application {
  constructor({ directory, roots, credentials, deviceProtector, onChange = () => {} }) {
    this.directory = directory; this.credentials = credentials; this.onChange = onChange;
    this.store = new LocalStore(directory); this.tracking = new NativeTracking({ directory, roots });
    this.deviceTrust = new DeviceTrust({ directory, ...(deviceProtector ? { protector: deviceProtector } : {}) });
    this.deviceError = null; this.auth = null; this.engine = null; this.timer = null; this.closed = false;
    this.nextDiscovery = 0; this.discovering = false;
    this.nextAttempt = 0; this.failures = 0; this.operations = Promise.resolve();
  }
  async start() {
    await this.store.acquire(); await this.tracking.start(); await this.deviceTrust.start(); await this.build();
    await this.tracking.refresh(await this.store.read());
    this.timer = setInterval(() => this.tick().catch(() => {}), 1000); this.timer.unref?.();
  }
  async build() {
    const state = await this.store.read();
    this.auth?.dispose(); this.engine?.lock();
    const credentialAdapter = {
      read: async () => (await this.credentials.readRecord('dsh-sync/microsoft'))?.payload,
      modify: async fn => (await this.credentials.modifyRecord('dsh-sync/microsoft', async record => {
        const payload = await fn(record?.payload); return { kind: 'grant', payload };
      }))?.payload,
    };
    this.auth = new MicrosoftAuth({ clientId: MICROSOFT_CLIENT_ID, credentials: credentialAdapter });
    this.backend = new OneDrive({ auth: this.auth });
    this.engine = new SyncEngine({ store: this.store, backend: this.backend, native: this.tracking, onChange: () => {
      if (this.engine?.phase === 'pending') this.nextAttempt = Math.min(this.nextAttempt || Infinity, Date.now() + 1500);
      this.onChange();
    } });
    if (state.encrypted && state.vaultId && state.keyring) {
      const key = await this.deviceTrust.restore(state.vaultId);
      if (key) { this.engine.key = key; this.engine.unlockedKeyring = state.keyring.id; }
    }
  }
  async dispose() {
    this.closed = true; clearInterval(this.timer);
    await this.operations; await this.store.queue;
    this.auth?.dispose(); this.engine?.lock(); await this.store.release();
  }
  async status() {
    const state = await this.store.read(); const trust = this.deviceTrust.status();
    return { ...await this.engine.status(), signedIn: await this.auth.signedIn(), auth: this.auth.status(),
      backups: state.backups.filter(backup => backup.origin).map(({id,createdAt,side,origin}) => ({id,createdAt,side,origin})),
      dataDirectory: this.directory, tracking: this.tracking.status(), localAtRest: 'plaintext',
      deviceTrust: { ...trust, ...(this.deviceError ? { error: this.deviceError } : {}) } };
  }
  async tick() {
    if (this.closed || this.running) return;
    if (!this.discovering && Date.now() >= this.nextDiscovery) {
      this.discovering = true;
      try { await this.operation('tracking-refresh'); }
      finally { this.discovering = false; this.nextDiscovery = Date.now() + 5000; }
    }
    if (this.closed || this.running || Date.now() < this.nextAttempt) return;
    const state = await this.store.read();
    if (!state.settings.enabled || !state.vaultId || !await this.auth.signedIn() || this.engine.conflicts.length) return;
    if (state.encrypted && !this.engine.key) return;
    this.running = true;
    try { await this.operation('sync'); this.failures = 0; }
    catch { this.failures = Math.min(this.failures + 1, 5); }
    finally { this.running = false; this.nextAttempt = Date.now() + Math.min(300000, state.settings.intervalSeconds * 1000 * 2 ** this.failures); }
  }
  operation(action, input = {}, caller = 'user') {
    if (action === 'status') return this.perform(action, input, caller);
    const next = this.operations.then(() => this.perform(action, input, caller));
    this.operations = next.catch(() => {}); return next;
  }
  async saveDeviceKey() {
    const state = await this.store.read();
    if (!state.encrypted || !this.engine.key) return;
    try {
      await this.deviceTrust.rememberKey(state.vaultId, this.engine.key); this.deviceError = null;
    } catch {
      // An optional cache failure must not suppress a successfully issued one-time recovery key.
      this.deviceError = { code: 'device-cache-failed', message: 'Automatic unlock could not be saved. This session remains unlocked; enter the passphrase after restarting.' };
    }
    this.onChange();
  }
  async lockDevice() {
    try { await this.deviceTrust.lock(); this.deviceError = null; }
    finally { this.engine.lock(); this.onChange(); }
    return { locked: true };
  }
  async openAsset(id) {
    invariant(typeof id === 'string' && UUID.test(id) && Object.hasOwn(this.tracking.config.known,id), 'Native asset not found.');
    const item = this.tracking.config.known[id]; validateOrigin(item.origin,item.type);
    invariant(id === nativeId(item.origin) && this.tracking.isEnabled(item), 'This native root is not enabled.', 'root-disabled');
    const relative = item.type === 'skill' ? `${item.origin.path}/SKILL.md` : item.origin.path;
    const target = await this.tracking.files.checked(item.origin.root,relative,true);
    invariant(target.exists && target.info.isFile(), 'The original file no longer exists. Refresh the list.', 'file-not-found');
    return { path: target.absolute };
  }
  async perform(action, input = {}, caller = 'user') {
    invariant(!this.closed, 'DSH Sync is stopping.');
    if (caller === 'agent') invariant(AGENT_ACTIONS.includes(action), 'This action requires the settings UI.', 'user-only');
    switch (action) {
      case 'status': return this.status();
      case 'asset-open': return this.openAsset(input.id);
      case 'tracking-refresh': {
        const state = await this.store.read(); const tracking = await this.tracking.refresh(state);
        if (this.tracking.sourceChanged && this.tracking.discoveryChanged && !this.engine.conflicts.length) {
          this.engine.phase = 'pending'; this.nextAttempt = Math.min(this.nextAttempt || Infinity, Date.now() + 1500);
        }
        this.onChange(); return { tracking };
      }
      case 'tracking-exclude':
      case 'tracking-include':
      case 'tracking-configure': {
        return this.store.exclusive(async () => {
          const state = await this.store.read(); let result;
          if (action === 'tracking-exclude') result = await this.tracking.exclude(state,input.id,input.confirmCloudDelete);
          else if (action === 'tracking-include') result = await this.tracking.include(state,input.id);
          else result = await this.tracking.configure(state,input.agentsEnabled,input.confirmOverwrite);
          await this.store.write(state); this.nextAttempt = 0; this.engine.phase = 'pending'; this.onChange(); return result;
        });
      }
      case 'configure': {
        await this.store.exclusive(async () => {
          const state = await this.store.read();
          invariant(input.clientId === undefined, 'The Microsoft application ID is fixed by this release and cannot be edited.', 'fixed-client-id');
          if (input.enabled !== undefined) { invariant(typeof input.enabled === 'boolean', 'Invalid automatic sync preference.'); state.settings.enabled = input.enabled; }
          await this.store.write(state);
        });
        this.nextAttempt = 0; this.onChange(); return { configured: true };
      }
      case 'device-trust-configure': {
        const state = await this.store.read();
        await this.deviceTrust.configure(input.remember,state.encrypted && this.engine.key ? { vaultId: state.vaultId, key: this.engine.key } : {});
        this.deviceError = null; this.onChange(); return { deviceTrust: this.deviceTrust.status() };
      }
      case 'sign-in': return this.auth.begin();
      case 'sign-out': await this.lockDevice(); await this.auth.signOut(); return { signedOut: true };
      case 'lock': return this.lockDevice();
      case 'initialize':
      case 'unlock':
      case 'enable-encryption':
      case 'change-passphrase': {
        let result;
        if (action === 'initialize') result = await this.engine.initialize(input);
        else if (action === 'unlock') result = await this.engine.unlock(input.secret,input.method);
        else if (action === 'enable-encryption') result = await this.engine.enableEncryption(input.passphrase);
        else result = await this.engine.changePassphrase(input.passphrase);
        await this.saveDeviceKey(); return result;
      }
      case 'sync': {
        try { return await this.engine.synchronize(input.decisions ?? {}); }
        catch (error) {
          if (!this.engine.key && this.deviceTrust.status().hasSavedKey) {
            try { await this.deviceTrust.lock(); } catch { this.deviceError = { code: 'device-cache-clear-failed', message: 'The invalid device unlock cache could not be cleared.' }; }
          }
          throw error;
        }
      }
      case 'backup-list': return { backups: (await this.status()).backups };
      case 'backup-restore': return this.engine.restoreBackup(input.id);
      default: throw Object.assign(new Error('Unknown DSH Sync action.'), { code: 'unknown-action' });
    }
  }
}
