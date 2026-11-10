import path from 'node:path';
import os from 'node:os';
import { Application, AGENT_ACTIONS } from './src/application.js';
import { invariant, MAX_BYTES } from './src/model.js';

export const inject = ['connection', 'credentials', 'tools'];
export const toolParameters = { type: 'object', properties: {
  action: { type: 'string', enum: AGENT_ACTIONS },
  id: { type: 'string', description: 'Native backup ID for restore; restoring replaces the original file and backs up the discarded version.' },
  decisions: { type: 'object', description: 'Conflict choices keyed by asset ID: side (local or remote), localHash, and remoteHash from current status.' },
}, required: ['action'], additionalProperties: false };
export async function apply(ctx, config = {}) {
  const directory = path.resolve(config.dataDirectory ?? path.join(process.env.DSH_PROFILE_DIR ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'data', 'dsh-sync'));
  const roots = config.nativeRoots ?? { dsh: path.resolve(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')), agents: path.join(os.homedir(), '.agents') };
  const app = new Application({ directory, roots, credentials: ctx.credentials, settings: ctx.get?.('settings') });
  try { await app.start(); } catch (error) { await app.dispose(); throw error; }
  ctx.effect(() => () => app.dispose());
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dsh-sync', methods: ['GET','POST'], requestBody: 'buffered',
    fetch: async request => {
      const respond = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      const summary = request.method === 'GET' && new URL(request.url).searchParams.get('view') === 'summary';
      try {
        if (request.method === 'GET') return respond({ ok: true, value: summary ? await app.summary() : await app.operation('status') });
        invariant(request.headers.get('content-type')?.split(';')[0] === 'application/json', 'Use application/json.', 'bad-content-type');
        invariant(Number(request.headers.get('content-length') ?? 0) <= MAX_BYTES * 2, 'Request is too large.');
        const reader = request.body?.getReader(); invariant(reader, 'A JSON request body is required.');
        const chunks = []; let size = 0;
        try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; invariant(size <= MAX_BYTES * 2, 'Request is too large.'); chunks.push(Buffer.from(part.value)); } }
        finally { await reader.cancel().catch(() => {}); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        invariant(body && typeof body.action === 'string', 'An action is required.');
        return respond({ ok: true, value: await app.operation(body.action, body, 'user') });
      } catch (error) { return respond({ ok: false, error: summary ? { code: 'status-unavailable' } : { code: error.code ?? 'operation-failed', message: error.message } }, 400); }
    },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'dsh_sync',
    description: 'Synchronize native DSH files with OneDrive. Status lists tracked paths and conflict fingerprints; tracking-refresh rescans allowed roots. Edit original files with filesystem tools. Exclusions, .agents opt-in, device trust, login and encryption controls are user-only. Backup restore writes the original native target.',
    parameters: toolParameters,
    output: { schema: { type: 'object' }, render: (_args,value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async args => {
      invariant(args && AGENT_ACTIONS.includes(args.action), 'This action is not available to agents.', 'user-only');
      return app.operation(args.action,args,'agent');
    },
  }));
}
