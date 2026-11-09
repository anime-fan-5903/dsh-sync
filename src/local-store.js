import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { invariant, validateAssets } from './model.js';
import { MICROSOFT_CLIENT_ID } from './config.js';

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temp, file); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export class LocalStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'state.json'); this.queue = Promise.resolve(); }
  exclusive(fn) {
    const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next;
  }
  async acquire() {
    await mkdir(this.directory, { recursive: true });
    this.lockPath = path.join(this.directory, 'process.lock');
    try { this.lock = await open(this.lockPath, 'wx', 0o600); await this.lock.writeFile(JSON.stringify({ pid: process.pid })); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid;
      try { pid = JSON.parse(await readFile(this.lockPath, 'utf8')).pid; } catch {}
      invariant(Number.isSafeInteger(pid) && pid > 0, 'Invalid sync process lock. Remove it only after all DSH Sync processes have stopped.', 'local-locked');
      let alive = true;
      try { process.kill(pid, 0); } catch (failure) { if (failure.code === 'ESRCH') alive = false; }
      invariant(!alive, 'Another DSH process owns this sync directory.', 'local-locked');
      await unlink(this.lockPath); this.lock = await open(this.lockPath, 'wx', 0o600); await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    }
  }
  async release() { if (this.lock) { await this.lock.close(); this.lock = null; await unlink(this.lockPath).catch(() => {}); } }
  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      invariant(state.format === 1 && state.base && Array.isArray(state.backups), 'Invalid local sync state.');
      validateAssets(state.assets); return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { format: 1, assets: [], base: {}, backups: [], settings: { clientId: MICROSOFT_CLIENT_ID, enabled: false, intervalSeconds: 30 }, vaultId: null, keyring: null, encrypted: false, binding: null, lastSync: null };
    }
  }
  async write(state) { validateAssets(state.assets); await atomicJson(this.file, state); }
}
