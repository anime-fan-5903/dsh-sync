import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GitHubApi, planDispatch, planPush, publishNpm, publishRelease, releasePlan, validatePack } from '../scripts/release.mjs';

const before = 'a'.repeat(40);
const sha = 'b'.repeat(40);
const version = '0.3.3';
const tag = `v${version}`;
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const files = [
  { name: `anime-fan-5903-dsh-sync-${version}.tgz`, bytes: Buffer.from('generated test archive'), type: 'application/gzip' },
  { name: 'SHA256SUMS', bytes: Buffer.from('generated test checksum'), type: 'text/plain' },
];
const assetFor = file => ({ name: file.name, state: 'uploaded', size: file.bytes.length, digest: hash(file.bytes) });

function fakeApi({ commit = null, release = null, assets = [], failAt = 0 } = {}) {
  return {
    commit, release, assets: structuredClone(assets), calls: [], mutations: 0, failAt,
    async request(method, resource, body, options) {
      this.calls.push({ method, resource, body, options });
      let result;
      if (method === 'GET' && resource === `/git/ref/tags/${tag}`) {
        result = this.commit ? { object: { type: 'commit', sha: this.commit } } : null;
      } else if (method === 'GET' && resource === `/releases/tags/${tag}`) {
        result = this.release?.draft ? null : this.release;
      } else if (method === 'GET' && resource === '/releases?per_page=100&page=1') {
        result = this.release ? [this.release] : [];
      } else if (method === 'POST' && resource === '/git/refs') {
        assert.equal(body.ref, `refs/tags/${tag}`);
        assert.equal(body.sha, sha);
        assert.equal(this.commit, null, 'Never replace a tag.');
        this.commit = body.sha;
        result = { object: { type: 'commit', sha } };
      } else if (method === 'POST' && resource === '/releases') {
        assert.equal(body.draft, true, 'Always create a draft first.');
        assert.equal(body.target_commitish, sha);
        this.release = { ...body, id: 123 };
        result = this.release;
      } else if (method === 'GET' && resource === '/releases/123/assets?per_page=100') {
        result = this.assets;
      } else if (method === 'POST' && resource.startsWith('/releases/123/assets?name=')) {
        const name = decodeURIComponent(resource.split('name=')[1]);
        assert.ok(!this.assets.some(asset => asset.name === name), 'Never replace an asset.');
        assert.equal(this.release.draft, true, 'Never modify published assets.');
        const expected = files.find(file => file.name === name);
        assert.deepEqual(body, expected.bytes);
        result = assetFor(expected);
        this.assets.push(result);
      } else if (method === 'PATCH' && resource === '/releases/123') {
        assert.deepEqual(this.assets, files.map(assetFor), 'Verify all assets before publishing.');
        assert.equal(body.make_latest, 'legacy');
        assert.equal(body.prerelease, false);
        Object.assign(this.release, body);
        result = this.release;
      } else {
        throw new Error(`Unexpected request: ${method} ${resource}`);
      }
      if (method !== 'GET' && ++this.mutations === this.failAt) throw new Error('Simulated lost response after mutation');
      return structuredClone(result);
    },
  };
}
const publish = api => publishRelease({ api, version, sha, files });
const existingRelease = (draft = false) => ({ id: 123, tag_name: tag, draft, prerelease: false });

test('release versions are stable, strictly increasing, and unchanged versions skip', () => {
  assert.equal(releasePlan('0.3.2', '0.3.2').publish, false);
  for (const [old, current] of [['0.3.2', version], ['0.9.9', '0.10.0'], ['1.9.9', '2.0.0'], ['1.0.0', '9007199254740993.0.0']]) {
    assert.equal(releasePlan(old, current).publish, true);
  }
  assert.throws(() => releasePlan('0.3.2', '0.3.1'), /increase/);
  for (const invalid of [undefined, null, 3, '', 'v0.3.3', '00.3.3', '0.03.3', '0.3.03', '0.3.3-rc.1', '0.3.3+build', '0.3.3\n']) {
    assert.throws(() => releasePlan('0.3.2', invalid));
  }
});

test('push planning compares exact before and after tips, including multi-commit pushes', async () => {
  const event = { ref: 'refs/heads/main', before, after: sha, deleted: false, forced: false };
  const context = { eventName: 'push', ref: event.ref, sha };
  const reads = [];
  const manifestAt = async commit => {
    reads.push(commit);
    return { name: '@anime-fan-5903/dsh-sync', version: commit === before ? '0.3.2' : version };
  };
  assert.deepEqual(await planPush(event, context, manifestAt), { publish: true, tag, version, sha });
  assert.deepEqual(reads, [before, sha]);
  assert.equal((await planPush(event, context, () => ({ name: '@anime-fan-5903/dsh-sync', version }))).publish, false);
  for (const change of [{ before: '0'.repeat(40) }, { before: undefined }, { after: before }, { deleted: true }, { forced: true }, { ref: 'refs/heads/feature' }]) {
    await assert.rejects(planPush({ ...event, ...change }, context, manifestAt));
  }
  for (const change of [{ eventName: 'pull_request' }, { ref: 'refs/heads/feature' }, { sha: before }]) {
    await assert.rejects(planPush(event, { ...context, ...change }, manifestAt));
  }
  await assert.rejects(planPush(event, context, () => ({ name: 'other', version })));
});

test('manual recovery requires main and an exact explicit stable source version', async () => {
  const event = { inputs: { version } };
  const context = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha };
  const reads = [];
  const manifestAt = commit => {
    reads.push(commit);
    return { name: '@anime-fan-5903/dsh-sync', version };
  };
  assert.deepEqual(await planDispatch(event, context, manifestAt), { publish: true, tag, version, sha });
  assert.deepEqual(reads, [sha]);
  for (const change of [{ eventName: 'push' }, { eventName: 'pull_request' }, { ref: 'refs/heads/feature' }, { ref: `refs/tags/${tag}` }, { sha: '0'.repeat(40) }, { sha: undefined }, { sha: 'HEAD' }]) {
    await assert.rejects(planDispatch(event, { ...context, ...change }, manifestAt));
  }
  for (const requested of [undefined, '', '0.3.2', 'v0.3.3', '0.3.3-rc.1', '0.3.3\n', '0.3.3; echo fixture']) {
    await assert.rejects(planDispatch({ inputs: { version: requested } }, context, manifestAt));
  }
  await assert.rejects(planDispatch({}, context, manifestAt));
  await assert.rejects(planDispatch(event, context, () => ({ name: 'other', version })));
  await assert.rejects(planDispatch({ inputs: { version: '0.3.3-rc.1' } }, context, () => ({ name: '@anime-fan-5903/dsh-sync', version: '0.3.3-rc.1' })));
});

test('publication creates the exact tag, uploads to a draft, and publishes last', async () => {
  const api = fakeApi();
  assert.deepEqual(await publish(api), { tag, status: 'published' });
  assert.equal(api.commit, sha);
  assert.equal(api.release.draft, false);
  assert.equal(api.release.prerelease, false);
  assert.equal(api.calls.at(-1).method, 'PATCH');
  assert.equal(api.mutations, 5);
});

test('a complete matching release is verified without any mutations', async () => {
  const api = fakeApi({ commit: sha, release: existingRelease(), assets: files.map(assetFor) });
  assert.equal((await publish(api)).status, 'already-published');
  assert.equal(api.mutations, 0);
});

test('published releases, conflicting tags and unexpected assets cannot be overwritten', async () => {
  const cases = [
    { commit: before },
    { commit: null, release: existingRelease() },
    { commit: sha, release: { ...existingRelease(), prerelease: true }, assets: files.map(assetFor) },
    { commit: sha, release: existingRelease(), assets: [] },
    { commit: sha, release: existingRelease(), assets: [{ ...assetFor(files[0]), digest: 'sha256:wrong' }, assetFor(files[1])] },
    { commit: sha, release: existingRelease(), assets: [{ ...assetFor(files[0]), size: 1 }, assetFor(files[1])] },
    { commit: sha, release: existingRelease(), assets: [{ ...assetFor(files[0]), digest: null }, assetFor(files[1])] },
    { commit: sha, release: existingRelease(), assets: [{ ...assetFor(files[0]), state: 'starter' }, assetFor(files[1])] },
    { commit: sha, release: existingRelease(true), assets: [{ ...assetFor(files[0]), name: 'unexpected.txt' }] },
    { commit: sha, release: existingRelease(true), assets: [assetFor(files[0]), assetFor(files[0])] },
  ];
  for (const state of cases) {
    const api = fakeApi(state);
    await assert.rejects(publish(api));
    assert.equal(api.mutations, 0);
  }
});

test('partial drafts resume without replacing verified assets', async () => {
  for (const assets of [[], [assetFor(files[0])], [assetFor(files[1])], files.map(assetFor)]) {
    const api = fakeApi({ commit: sha, release: existingRelease(true), assets });
    // The fake API enforces ordering only for the final set, not upload order.
    const request = api.request.bind(api);
    api.request = async (...args) => {
      if (args[0] === 'PATCH') api.assets.sort((a, b) => files.findIndex(f => f.name === a.name) - files.findIndex(f => f.name === b.name));
      return request(...args);
    };
    assert.equal((await publish(api)).status, 'published');
    assert.equal(api.mutations, files.length - assets.length + 1);
  }
});

test('draft lookup follows release-list pagination and rejects duplicate drafts', async () => {
  for (const duplicate of [false, true]) {
    const api = fakeApi({ commit: sha, release: existingRelease(true), assets: files.map(assetFor) });
    const original = api.request.bind(api);
    api.request = async (...args) => {
      if (args[1] === '/releases?per_page=100&page=1') {
        return Array.from({ length: 100 }, (_, index) => ({ tag_name: `v0.0.${index}`, draft: false }));
      }
      if (args[1] === '/releases?per_page=100&page=2') {
        return duplicate ? [existingRelease(true), { ...existingRelease(true), id: 124 }] : [existingRelease(true)];
      }
      return original(...args);
    };
    if (duplicate) {
      await assert.rejects(publish(api), /Multiple releases/);
      assert.equal(api.mutations, 0);
    } else {
      assert.equal((await publish(api)).status, 'published');
      assert.equal(api.mutations, 1);
    }
  }
});

test('reruns recover after a lost response at every mutation boundary', async () => {
  for (let failAt = 1; failAt <= 5; failAt++) {
    const api = fakeApi({ failAt });
    await assert.rejects(publish(api), /Simulated lost response/);
    const mutations = api.mutations;
    api.failAt = 0;
    const result = await publish(api);
    assert.ok(['published', 'already-published'].includes(result.status));
    assert.equal(api.release.draft, false);
    assert.equal(api.mutations, 5, `Must not repeat successful mutations after failure ${failAt}, previously ${mutations}`);
  }
});

test('annotated tags are resolved to commits rather than trusting release target metadata', async () => {
  const api = fakeApi({ commit: sha, release: existingRelease(), assets: files.map(assetFor) });
  const original = api.request.bind(api);
  api.request = async (...args) => {
    if (args[1] === `/git/ref/tags/${tag}`) return { object: { type: 'tag', sha: before } };
    if (args[1] === `/git/tags/${before}`) return { object: { type: 'commit', sha } };
    return original(...args);
  };
  assert.equal((await publish(api)).status, 'already-published');
  assert.equal(api.mutations, 0);
});

test('API failures are not absence and credentials stay on fixed GitHub API origins', async () => {
  const calls = [];
  let status = 404;
  const api = new GitHubApi('example/dsh-sync', 'fixture-token', async (url, options) => {
    calls.push({ url, options });
    return new Response(status === 200 ? JSON.stringify({ ok: true }) : 'redacted fixture', { status });
  });
  assert.equal(await api.request('GET', '/releases/tags/v0.3.3', undefined, { optional: true }), null);
  for (status of [401, 403, 422, 429, 500, 302]) {
    await assert.rejects(api.request('GET', '/releases/tags/v0.3.3', undefined, { optional: true }), /HTTP/);
  }
  status = 200;
  await api.request('POST', '/releases/123/assets?name=test', Buffer.from('fixture'), { type: 'text/plain' });
  assert.equal(calls.at(-1).url, 'https://uploads.github.com/repos/example/dsh-sync/releases/123/assets?name=test');
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  await assert.rejects(api.request('GET', 'https://example.com'));
  await assert.rejects(api.request('GET', '/../other'));
  await assert.rejects(api.request('POST', '/git/refs', Buffer.from('fixture'), { type: 'text/plain' }));
  const malformed = new GitHubApi('example/dsh-sync', 'fixture-token', async () => new Response('private-response-fixture', { status: 200 }));
  await assert.rejects(malformed.request('GET', '/releases'), error => {
    assert.match(error.message, /invalid JSON/);
    assert.ok(!error.message.includes('private-response-fixture'));
    return true;
  });
});

test('package inspection requires expected resources and excludes local or private files', () => {
  const pack = { name: '@anime-fan-5903/dsh-sync', version, filename: `anime-fan-5903-dsh-sync-${version}.tgz`, files: ['package.json', 'index.js', 'client.js', 'LICENSE', 'cordis.patch.yml', 'locale/en.json'].map(path => ({ path })) };
  assert.equal(validatePack(pack, version), pack);
  for (const name of ['../secret', '/secret', 'src/../secret', 'src\\secret', '_local/state.json', '.github/workflows/ci.yml', 'src/.env', 'src/key.pem', 'src/credentials/token.json', 'node_modules/a.js', 'unknown.txt']) {
    assert.throws(() => validatePack({ ...pack, files: [...pack.files, { path: name }] }, version), name);
  }
  assert.throws(() => validatePack({ ...pack, version: '0.3.2' }, version));
  assert.throws(() => validatePack({ ...pack, filename: '../archive.tgz' }, version));
  assert.throws(() => validatePack({ ...pack, files: pack.files.filter(file => file.path !== 'LICENSE') }, version));
});

test('workflow keeps PRs read-only, pins approved actions and gates publication on both platforms', async context => {
  let workflow;
  try {
    workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // npm distributions deliberately omit repository-only GitHub configuration.
    const { existsSync } = await import('node:fs');
    if (existsSync(new URL('../.git', import.meta.url))) throw error;
    context.skip('Repository-only workflow is not included in the npm distribution.');
    return;
  }
  const lf = workflow.replace(/\r\n/g, '\n');
  for (const [name, source] of [['LF', lf], ['CRLF', lf.replace(/\n/g, '\r\n')]]) {
    await context.test(`${name} checkout`, () => assertWorkflowContract(source));
  }
});

function assertWorkflowContract(source) {
  // Git may check out YAML with CRLF on Windows; line endings are not policy.
  const workflow = source.replace(/\r\n/g, '\n');
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /if: github.event_name != 'workflow_dispatch' \|\| github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /if: \(github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'\) && github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /needs: check/);
  assert.match(workflow, /permissions:\n      contents: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /group: release-dsh-sync/);
  const releaseJob = workflow.slice(workflow.indexOf('\n  release:'));
  assert.match(releaseJob, /permissions:\n      contents: write\n      id-token: write/);
  assert.ok(!workflow.slice(0, workflow.indexOf('\n  release:')).includes('id-token: write'));
  assert.match(releaseJob, /node-version: '24'/);
  assert.ok(!workflow.includes('NODE_AUTH_TOKEN') && !workflow.includes('NPM_TOKEN'));
  assert.match(releaseJob, /run: node scripts\/release.mjs/);
  for (const line of workflow.split('\n').filter(line => line.includes('uses:'))) {
    assert.match(line, /actions\/(?:checkout@3d3c42e5aac5ba805825da76410c181273ba90b1|setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1)/);
  }
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.ok(!workflow.includes('pull_request_target'));
  assert.ok(!workflow.includes('npm install'));
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      version:\n        description: [^\n]+\n        required: true\n        type: string/);
  assert.ok(!workflow.includes('${{ inputs.'));
  assert.ok(!workflow.includes('${{ github.event.inputs.'));
}

function npmFixture({ latest, existing = false, mismatch = false, missingAfter = false, lostResponse = false } = {}) {
  const name = '@anime-fan-5903/dsh-sync';
  const archive = { ...files[0], path: '/generated-fixture/' + files[0].name };
  const integrity = `sha512-${createHash('sha512').update(archive.bytes).digest('base64')}`;
  const record = { name, version, dist: { integrity: mismatch ? 'sha512-different' : integrity } };
  const data = { name, versions: existing ? { [version]: record } : {}, 'dist-tags': latest ? { latest } : {} };
  const calls = [];
  return { archive, data, calls,
    async fetcher(url, options) {
      assert.equal(url, 'https://registry.npmjs.org/' + encodeURIComponent(name));
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify(data));
    },
    async run(args) {
      calls.push(args);
      assert.equal(args[0], 'publish'); assert.equal(args[1], archive.path);
      for (const flag of ['--ignore-scripts', '--provenance', '--registry=https://registry.npmjs.org/']) assert.ok(args.includes(flag));
      assert.equal(args[args.indexOf('--access') + 1], 'public');
      if (!missingAfter) data.versions[version] = record;
      const tag = args[args.indexOf('--tag') + 1]; data['dist-tags'][tag] = version;
      if (lostResponse) throw new Error('Lost npm response after publication');
    },
  };
}

test('npm publishes exact Release archive bytes and verifies remote integrity', async () => {
  const fixture = npmFixture({ latest: '0.3.2' });
  assert.deepEqual(await publishNpm({ version, ...fixture }), { version, status: 'published', latest: version });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][fixture.calls[0].indexOf('--tag') + 1], 'latest');
});

test('npm matching version reruns verify without mutation; changed bytes fail closed', async () => {
  const fixture = npmFixture({ latest: version, existing: true });
  assert.equal((await publishNpm({ version, ...fixture })).status, 'already-published');
  assert.deepEqual(fixture.calls, []);
  const mismatch = npmFixture({ latest: version, existing: true, mismatch: true });
  await assert.rejects(publishNpm({ version, ...mismatch }), /different archive bytes/);
  assert.deepEqual(mismatch.calls, []);
});

test('npm older releases cannot demote latest even when jobs arrive out of order', async () => {
  const fixture = npmFixture({ latest: '0.4.0' });
  assert.equal((await publishNpm({ version, ...fixture })).latest, '0.4.0');
  assert.equal(fixture.calls[0][fixture.calls[0].indexOf('--tag') + 1], `release-${version}`);
});

test('npm lost publication response is recoverable without republishing', async () => {
  const fixture = npmFixture({ latest: '0.3.2', lostResponse: true });
  await assert.rejects(publishNpm({ version, ...fixture }), /Lost npm response/);
  assert.equal((await publishNpm({ version, ...fixture })).status, 'already-published');
  assert.equal(fixture.calls.length, 1);
});

test('npm metadata errors never authorize a publish; only 404 means absent', async () => {
  for (const status of [401, 403, 429, 500]) {
    const fixture = npmFixture();
    fixture.fetcher = async () => new Response('', { status });
    await assert.rejects(publishNpm({ version, ...fixture }), /metadata request failed/);
    assert.deepEqual(fixture.calls, []);
  }
  const fixture = npmFixture(); const read = fixture.fetcher; let reads = 0;
  fixture.fetcher = (...args) => ++reads === 1 ? new Response('', { status: 404 }) : read(...args);
  assert.equal((await publishNpm({ version, ...fixture })).status, 'published');
});

test('npm malformed metadata, unconfirmed publication and stale latest fail visibly', async () => {
  const absent = npmFixture({ missingAfter: true });
  await assert.rejects(publishNpm({ version, ...absent }), /missing or has a different name/);
  for (const latest of ['0.3.2', undefined]) {
    const fixture = npmFixture({ existing: true, latest });
    await assert.rejects(publishNpm({ version, ...fixture }), /latest/);
    assert.deepEqual(fixture.calls, []);
  }
  const fixture = npmFixture({ latest: '0.4.0-rc.1' });
  await assert.rejects(publishNpm({ version, ...fixture }), /stable version/);
  assert.deepEqual(fixture.calls, []);
  fixture.fetcher = async () => new Response(JSON.stringify({ name: 'wrong', versions: {}, 'dist-tags': {} }));
  await assert.rejects(publishNpm({ version, ...fixture }), /identity/);
});
