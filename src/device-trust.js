import path from 'node:path';
import { existsSync, constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { spawn as spawnChild } from 'node:child_process';
import { atomicJson } from './local-store.js';

const MAX_INPUT = 4096;
const MAX_BLOB = 8192;
const MAX_FILE = 16384;
const failure = (code, message) => Object.assign(new Error(message), { code });
const unavailable = () => failure('device-protection-unavailable', 'Operating-system device protection is unavailable.');
const safeFailure = () => failure('device-protection-failed', 'Operating-system device protection failed. Unlock manually and try again.');
const isVault = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);
function validBase64(value, maximum) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  const valid = bytes.length > 0 && bytes.length <= maximum && bytes.toString('base64') === value;
  bytes.fill(0); return valid;
}
function scriptFor(operation) {
  // EncodedCommand contains only this static program. Payload bytes use the private stdin pipe.
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$data = $null; $result = $null; $memory = $null
try {
  Add-Type -AssemblyName System.Security
  $inputStream = [Console]::OpenStandardInput()
  $memory = New-Object System.IO.MemoryStream
  $chunk = New-Object byte[] 1024
  while (($count = $inputStream.Read($chunk, 0, $chunk.Length)) -gt 0) {
    if ($memory.Length + $count -gt ${operation === 'Protect' ? MAX_INPUT : MAX_BLOB}) { throw 'Input limit.' }
    $memory.Write($chunk, 0, $count)
    [Array]::Clear($chunk, 0, $chunk.Length)
  }
  $data = $memory.ToArray()
  $entropy = [Text.Encoding]::UTF8.GetBytes('dsh-sync-device-trust-v1')
  $result = [Security.Cryptography.ProtectedData]::${operation}($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ($result.Length -gt ${operation === 'Protect' ? MAX_BLOB : MAX_INPUT}) { throw 'Output limit.' }
  $outputStream = [Console]::OpenStandardOutput()
  $outputStream.Write($result, 0, $result.Length)
  $outputStream.Flush()
} catch {
  [Console]::Error.WriteLine('Device protection failed.')
  exit 1
} finally {
  if ($data) { [Array]::Clear($data, 0, $data.Length) }
  if ($result) { [Array]::Clear($result, 0, $result.Length) }
  if ($memory) { $memory.Dispose() }
}`;
}
const COMMANDS = Object.fromEntries(['Protect','Unprotect'].map(operation => [operation, Buffer.from(scriptFor(operation),'utf16le').toString('base64')]));

export function createDeviceProtector({ platform = process.platform, systemRoot = process.env.SystemRoot ?? process.env.WINDIR,
  spawn = spawnChild, exists = existsSync, timeoutMs = 10000 } = {}) {
  const executable = typeof systemRoot === 'string' && systemRoot ? path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe') : null;
  if (platform !== 'win32' || !executable || !exists(executable)) return {
    available: false, provider: 'unavailable', protect: async () => { throw unavailable(); }, unprotect: async () => { throw unavailable(); },
  };
  const run = (operation, input) => new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(input) || !input.length || input.length > (operation === 'Protect' ? MAX_INPUT : MAX_BLOB)) { reject(safeFailure()); return; }
    let child; let settled = false; let timer; let size = 0; let errorSize = 0; const chunks = [];
    const finish = (error, value) => {
      if (settled) { value?.fill(0); return; } settled = true; clearTimeout(timer);
      for (const chunk of chunks) chunk.fill(0);
      if (error) { child?.kill(); reject(error); } else resolve(value);
    };
    try {
      child = spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',COMMANDS[operation]], {
        windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'],
      });
      child.on('error', () => finish(safeFailure()));
      child.stdout.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > (operation === 'Protect' ? MAX_BLOB : MAX_INPUT)) { finish(safeFailure()); return; }
        chunks.push(Buffer.from(chunk));
      });
      child.stderr.on('data', chunk => { errorSize += chunk.length; if (errorSize > 8192) finish(safeFailure()); });
      child.stdin.on('error', () => finish(safeFailure()));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0 || !size || errorSize) finish(safeFailure());
        else finish(null,Buffer.concat(chunks,size));
      });
      timer = setTimeout(() => finish(safeFailure()),Math.min(30000,Math.max(1,timeoutMs))); timer.unref?.();
      child.stdin.end(input);
    } catch { finish(safeFailure()); }
  });
  return { available: true, provider: 'windows-dpapi-current-user', protect: input => run('Protect',input), unprotect: input => run('Unprotect',input) };
}

export class DeviceTrust {
  constructor({ directory, protector = createDeviceProtector() }) {
    this.file = path.join(directory,'device-trust.json'); this.protector = protector;
    this.state = { format: 1, remember: !!protector.available, manualLocked: false }; this.error = null; this.queue = Promise.resolve();
  }
  exclusive(action) { const next = this.queue.then(action); this.queue = next.catch(() => {}); return next; }
  status() {
    return { available: !!this.protector.available, provider: this.protector.provider, remember: this.state.remember,
      manualLocked: this.state.manualLocked, hasSavedKey: !!this.state.blob,
      ...(this.error ? { error: { ...this.error } } : {}) };
  }
  warning(code = 'device-trust-invalid') {
    this.error = { code, message: code === 'device-trust-write-failed' ? 'Device trust settings could not be saved. Automatic unlock is not guaranteed.'
      : code === 'device-protection-unavailable' ? 'Operating-system device protection is unavailable. Unlock manually.'
        : 'Saved device trust is unavailable or invalid. Unlock manually to establish trust again.' };
  }
  async persist() {
    try { await atomicJson(this.file,this.state); }
    catch {
      this.state = { format: 1, remember: this.state.remember, manualLocked: this.state.manualLocked };
      this.warning('device-trust-write-failed'); throw failure(this.error.code,this.error.message);
    }
  }
  async invalidate(code = 'device-trust-invalid') {
    this.state = { format: 1, remember: this.state.remember, manualLocked: true }; this.warning(code);
    try { await this.persist(); } catch { /* Remain locked in memory; a corrupt cache still fails closed after restart. */ }
  }
  async decode(vaultId) {
    let blob; let payload; let key;
    try {
      blob = Buffer.from(this.state.blob,'base64'); payload = await this.protector.unprotect(blob);
      if (!Buffer.isBuffer(payload) || payload.length > MAX_INPUT) throw safeFailure();
      const data = JSON.parse(payload.toString('utf8'));
      if (!data || Object.keys(data).length !== 3 || data.format !== 1 || data.vaultId !== vaultId || !validBase64(data.key,32)) throw safeFailure();
      key = Buffer.from(data.key,'base64'); if (key.length !== 32) throw safeFailure();
      const result = key; key = null; return result;
    } finally { blob?.fill(0); if (Buffer.isBuffer(payload)) payload.fill(0); key?.fill(0); }
  }
  async start() {
    return this.exclusive(async () => {
      this.state = { format: 1, remember: !!this.protector.available, manualLocked: false }; this.error = null;
      let handle; let found = false;
      try {
        const info = await lstat(this.file); found = true;
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE) throw safeFailure();
        handle = await open(this.file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw safeFailure();
        const buffer = Buffer.alloc(MAX_FILE+1); let length = 0;
        try {
          while (length < buffer.length) { const {bytesRead} = await handle.read(buffer,length,buffer.length-length,null); if (!bytesRead) break; length += bytesRead; }
          if (length > MAX_FILE) throw safeFailure();
          const value = JSON.parse(buffer.subarray(0,length).toString('utf8'));
          if (!value || value.format !== 1 || typeof value.remember !== 'boolean' || typeof value.manualLocked !== 'boolean'
            || !Object.keys(value).every(key => ['format','remember','manualLocked','vaultId','blob'].includes(key))) throw safeFailure();
          const cached = value.blob !== undefined || value.vaultId !== undefined;
          if (cached && (!value.remember || value.manualLocked || !isVault(value.vaultId) || !validBase64(value.blob,MAX_BLOB))) throw safeFailure();
          this.state = value;
        } finally { buffer.fill(0); }
        if (this.state.blob) {
          if (!this.protector.available) await this.invalidate('device-protection-unavailable');
          else { const key = await this.decode(this.state.vaultId); key.fill(0); }
        }
      } catch (error) {
        if (error.code !== 'ENOENT' || found) await this.invalidate();
      } finally { await handle?.close().catch(() => {}); }
      return this.status();
    });
  }
  async rememberKey(vaultId,key) {
    return this.exclusive(() => this.saveKey(vaultId,key));
  }
  async saveKey(vaultId,key) {
    if (!isVault(vaultId) || !Buffer.isBuffer(key) || key.length !== 32) throw failure('device-trust-invalid-key','A valid vault and a 32-byte key are required.');
    this.state = { format: 1, remember: this.state.remember, manualLocked: false }; this.error = null;
    if (!this.state.remember) { await this.persist(); return false; }
    let payload; let protectedBytes;
    try {
      if (!this.protector.available) throw unavailable();
      payload = Buffer.from(JSON.stringify({format:1,vaultId,key:key.toString('base64')}),'utf8');
      protectedBytes = await this.protector.protect(payload);
      if (!Buffer.isBuffer(protectedBytes) || !protectedBytes.length || protectedBytes.length > MAX_BLOB || protectedBytes.equals(payload)) throw safeFailure();
      this.state = { ...this.state, vaultId, blob: protectedBytes.toString('base64') };
    } catch (error) { this.warning(error.code === 'device-protection-unavailable' ? error.code : 'device-protection-failed'); }
    finally { payload?.fill(0); if (Buffer.isBuffer(protectedBytes)) protectedBytes.fill(0); }
    await this.persist(); return !!this.state.blob;
  }
  async restore(vaultId) {
    return this.exclusive(async () => {
      if (!isVault(vaultId) || !this.state.remember || this.state.manualLocked || !this.state.blob || this.state.vaultId !== vaultId) return null;
      try {
        if (!this.protector.available) throw unavailable();
        const key = await this.decode(vaultId); this.error = null; return key;
      } catch (error) { await this.invalidate(error.code === 'device-protection-unavailable' ? error.code : 'device-trust-invalid'); return null; }
    });
  }
  async lock() {
    return this.exclusive(async () => { this.state = {format:1,remember:this.state.remember,manualLocked:true}; this.error = null; await this.persist(); return this.status(); });
  }
  async forget() { return this.lock(); }
  async configure(remember,{vaultId,key} = {}) {
    return this.exclusive(async () => {
      if (typeof remember !== 'boolean') throw failure('device-trust-invalid-preference','Device trust preference must be boolean.');
      if (remember && !this.protector.available) { this.warning('device-protection-unavailable'); throw unavailable(); }
      this.state = { ...this.state, remember }; this.error = null;
      if (!remember) { this.state = {format:1,remember:false,manualLocked:this.state.manualLocked}; await this.persist(); }
      else if (!this.state.manualLocked && key !== undefined) await this.saveKey(vaultId,key);
      else await this.persist();
      return this.status();
    });
  }
}
