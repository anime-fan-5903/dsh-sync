import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { invariant } from './model.js';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPE = 'offline_access https://graph.microsoft.com/Files.ReadWrite';
const CALLBACK = '/dsh-sync/callback';
const TIMEOUT = 5 * 60 * 1000;
const validClient = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MicrosoftAuth {
  constructor({ clientId, credentials, fetchImpl = fetch, timeoutMs = TIMEOUT }) {
    this.clientId = clientId; this.credentials = credentials; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
    this.attempt = null; this.error = null; this.generation = 0; this.pendingRefresh = null;
  }
  status() { return { pending: !!this.attempt, error: this.error }; }
  async signedIn() { const payload = await this.credentials.read(); return !!payload?.accounts?.[this.clientId]?.refreshToken; }
  async tokenRequest(parameters) {
    const response = await this.fetch(`${AUTHORITY}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...parameters }), signal: AbortSignal.timeout(30000), redirect: 'error' });
    let value;
    try { value = await response.json(); } catch { throw Object.assign(new Error('Microsoft returned an invalid token response.'), { code: 'authorization-failed' }); }
    if (!response.ok || value.error) {
      const reauth = ['invalid_grant','interaction_required','consent_required','login_required'].includes(value.error);
      throw Object.assign(new Error(reauth ? 'Microsoft authorization expired or was revoked. Sign in again.' : 'Microsoft could not complete authorization. Check the application registration and consent.'), { code: reauth ? 'reauth-required' : 'authorization-failed' });
    }
    invariant(typeof value.access_token === 'string' && Number.isFinite(value.expires_in) && value.expires_in > 0, 'Microsoft returned an incomplete token response.');
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: Date.now() + value.expires_in * 1000 };
  }
  cancel() {
    this.generation++;
    if (this.attempt) { clearTimeout(this.attempt.timer); this.attempt.server.close(); this.attempt = null; }
  }
  async begin() {
    invariant(validClient.test(this.clientId), 'Configure a valid Microsoft application Client ID before signing in.', 'client-id-required');
    this.cancel(); this.error = null;
    const generation = this.generation;
    const verifier = randomBytes(32).toString('base64url'); const state = randomBytes(32).toString('base64url');
    const server = createServer(); const attempt = { server, timer: null, consumed: false };
    this.attempt = attempt;
    const stop = () => { clearTimeout(attempt.timer); server.close(); if (this.attempt === attempt) this.attempt = null; };
    server.on('request', async (request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
      const expectedHost = `localhost:${server.address()?.port}`;
      if (request.method !== 'GET' || request.headers.host !== expectedHost || !request.url?.startsWith(`${CALLBACK}?`)) { response.writeHead(400); response.end('Invalid callback.'); return; }
      const url = new URL(request.url, `http://${expectedHost}`); const supplied = url.searchParams.get('state') ?? '';
      const provided = Buffer.from(supplied); const expected = Buffer.from(state);
      if (url.pathname !== CALLBACK || attempt.consumed || provided.length !== expected.length || !timingSafeEqual(provided, expected)) { response.writeHead(400); response.end('Invalid or expired login state.'); return; }
      attempt.consumed = true;
      try {
        invariant(!url.searchParams.has('error') && url.searchParams.has('code'), 'Microsoft sign-in was canceled or denied.', 'authorization-canceled');
        const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE });
        invariant(tokens.refreshToken, 'Microsoft did not issue offline authorization. Sign in again.');
        invariant(generation === this.generation && this.attempt === attempt, 'This sign-in attempt was canceled.', 'authorization-canceled');
        await this.credentials.modify(async current => {
          invariant(generation === this.generation && this.attempt === attempt, 'This sign-in attempt was canceled.', 'authorization-canceled');
          return { ...current, accounts: { ...current?.accounts, [this.clientId]: tokens } };
        });
        response.end('You are signed in to DSH Sync. You can close this tab and return to DSH.');
      } catch (error) { this.error = { code: error.code ?? 'authorization-failed', message: error.message }; response.writeHead(400); response.end('DSH Sync could not complete sign-in. Return to DSH for details.'); }
      finally { stop(); }
    });
    try {
      await new Promise((resolve,reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    } catch (error) { stop(); throw Object.assign(new Error('Unable to start the local Microsoft sign-in callback.'), { code: 'callback-unavailable' }); }
    const redirectUri = `http://localhost:${server.address().port}${CALLBACK}`;
    attempt.timer = setTimeout(() => { this.error = { code: 'authorization-timeout', message: 'Microsoft sign-in timed out. Try again.' }; stop(); }, this.timeoutMs); attempt.timer.unref?.();
    const url = new URL(`${AUTHORITY}/authorize`);
    url.search = new URLSearchParams({ client_id: this.clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri,
      scope: SCOPE, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return { url: url.href };
  }
  async token() {
    invariant(validClient.test(this.clientId), 'Configure a Microsoft application Client ID.', 'client-id-required');
    const payload = await this.credentials.read(); const account = payload?.accounts?.[this.clientId];
    invariant(account?.refreshToken, 'Sign in with Microsoft first.', 'reauth-required');
    if (account.accessToken && account.expiresAt > Date.now() + 60000) return account.accessToken;
    if (this.pendingRefresh) return this.pendingRefresh;
    const generation = this.generation;
    this.pendingRefresh = (async () => {
      let access;
      await this.credentials.modify(async current => {
        const record = current?.accounts?.[this.clientId]; invariant(record?.refreshToken, 'Sign in with Microsoft again.', 'reauth-required');
        if (record.accessToken && record.expiresAt > Date.now() + 60000) { access = record.accessToken; return current; }
        const updated = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: record.refreshToken, scope: SCOPE });
        invariant(generation === this.generation, 'Authorization changed. Retry after signing in.', 'reauth-required');
        updated.refreshToken ??= record.refreshToken; access = updated.accessToken;
        return { ...current, accounts: { ...current.accounts, [this.clientId]: updated } };
      });
      return access;
    })();
    try { return await this.pendingRefresh; } finally { this.pendingRefresh = null; }
  }
  async signOut() {
    this.cancel();
    await this.credentials.modify(async current => { const accounts = { ...current?.accounts }; delete accounts[this.clientId]; return { ...current, accounts }; });
    this.error = null;
  }
  dispose() { this.cancel(); }
}
