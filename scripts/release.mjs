import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shaPattern = /^[0-9a-f]{40}$/;
const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');

export function releasePlan(previous, current) {
  for (const version of [previous, current]) {
    assert.equal(typeof version, 'string', 'A package version is required.');
    assert.ok(stablePattern.test(version), `Expected a stable MAJOR.MINOR.PATCH version: ${version}`);
  }
  if (previous === current) return { publish: false, version: current, tag: `v${current}` };
  const before = previous.split('.').map(BigInt);
  const after = current.split('.').map(BigInt);
  const difference = after.findIndex((value, index) => value !== before[index]);
  assert.ok(after[difference] > before[difference], 'Package versions must increase, never decrease.');
  return { publish: true, version: current, tag: `v${current}` };
}

export async function planPush(event, { eventName, ref, sha }, manifestAt) {
  assert.equal(eventName, 'push', 'Releases only run for push events.');
  assert.equal(ref, 'refs/heads/main', 'Releases only run on main.');
  assert.equal(event.ref, ref, 'Event ref does not match the workflow ref.');
  assert.equal(event.deleted, false, 'Deleted branches cannot publish.');
  assert.equal(event.forced, false, 'Force pushes cannot publish.');
  for (const value of [event.before, event.after, sha]) {
    assert.ok(typeof value === 'string' && shaPattern.test(value) && !/^0+$/.test(value),
      'A nonzero full before/after commit SHA is required; bootstrap pushes do not publish.');
  }
  assert.equal(event.after, sha, 'Event source does not match the workflow commit.');
  // A push can contain several commits. Its first parent is not the previous main tip.
  const previous = await manifestAt(event.before);
  const current = await manifestAt(event.after);
  assert.equal(current.name, '@anime-fan-5903/dsh-sync', 'Unexpected package name.');
  assert.ok(previous.name === current.name || previous.name === 'dsh-sync', 'Unexpected previous package name.');
  return { ...releasePlan(previous.version, current.version), sha };
}

export async function planDispatch(event, { eventName, ref, sha }, manifestAt) {
  assert.equal(eventName, 'workflow_dispatch', 'Expected an explicit manual release request.');
  assert.equal(ref, 'refs/heads/main', 'Manual releases only run on main.');
  assert.ok(typeof sha === 'string' && shaPattern.test(sha) && !/^0+$/.test(sha), 'A full source commit SHA is required.');
  const current = await manifestAt(sha);
  assert.equal(current.name, '@anime-fan-5903/dsh-sync', 'Unexpected package name.');
  // Reuse the stable-version policy without pretending a manual request is a push.
  const plan = releasePlan(current.version, current.version);
  assert.equal(event.inputs?.version, current.version, 'The requested version must exactly match package.json at the selected main commit.');
  return { ...plan, publish: true, sha };
}

export function validatePack(pack, version) {
  assert.equal(pack.name, '@anime-fan-5903/dsh-sync', 'Unexpected packed package name.');
  assert.equal(pack.version, version, 'Packed version does not match the source version.');
  assert.equal(pack.filename, `anime-fan-5903-dsh-sync-${version}.tgz`, 'Unexpected archive filename.');
  assert.ok(Array.isArray(pack.files) && pack.files.length > 0, 'Package file list is required.');
  const files = pack.files.map(file => file.path);
  for (const name of files) {
    assert.ok(typeof name === 'string' && !name.includes('\\') && !name.startsWith('/') &&
      !name.split('/').some(part => !part || part === '.' || part === '..'), `Unsafe package path: ${name}`);
    assert.ok(!/(^|\/)(?:\.git|\.github|_local|_cache|node_modules|coverage|credentials?)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|tgz)$/i.test(name),
      `Private or generated file in package: ${name}`);
    assert.ok(['package.json', 'index.js', 'client.js', 'icon.svg', 'cordis.patch.yml', 'LICENSE',
      'README.md', 'README.zh-CN.md', 'README.ja.md', 'AGENTS.md', 'CONTRIBUTING.md'].includes(name) ||
      /^(?:src|locale|docs|scripts|test)\//.test(name), `Unexpected distribution file: ${name}`);
  }
  for (const name of ['package.json', 'index.js', 'client.js', 'LICENSE', 'cordis.patch.yml', 'locale/en.json']) {
    assert.ok(files.includes(name), `Missing distribution resource: ${name}`);
  }
  return pack;
}

export async function packRelease(version, directory) {
  assert.ok(stablePattern.test(version), 'Invalid release version.');
  await mkdir(directory, { recursive: true });
  const npm = args => {
    // The publishing job runs on Ubuntu; no npm install or lifecycle script is needed.
    const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', ...args], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    });
    const records = JSON.parse(output);
    assert.equal(records.length, 1, 'Expected exactly one package.');
    return validatePack(records[0], version);
  };
  const preview = npm(['--dry-run']);
  const packed = npm(['--pack-destination', directory]);
  assert.deepEqual(packed.files, preview.files, 'Distribution contents changed after inspection.');
  const archive = { name: packed.filename, bytes: await readFile(path.join(directory, packed.filename)), type: 'application/gzip' };
  assert.equal(archive.bytes.length, packed.size, 'Archive size differs from npm pack metadata.');
  const sums = { name: 'SHA256SUMS', bytes: Buffer.from(`${checksum(archive.bytes)}  ${archive.name}\n`), type: 'text/plain' };
  await writeFile(path.join(directory, sums.name), sums.bytes);
  return [archive, sums];
}

export class GitHubApi {
  constructor(repository, token, fetcher = fetch) {
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid GitHub repository.');
    assert.ok(token, 'GITHUB_TOKEN is required.');
    this.base = `https://api.github.com/repos/${repository}`;
    this.uploadBase = `https://uploads.github.com/repos/${repository}`;
    this.token = token;
    this.fetcher = fetcher;
  }

  async request(method, resource, body, { optional = false, type } = {}) {
    assert.ok(resource.startsWith('/') && !resource.includes('..') && !resource.includes('://'), 'Invalid API resource.');
    const uploading = type !== undefined;
    assert.ok(!uploading || /^\/releases\/\d+\/assets\?name=/.test(resource), 'Invalid upload resource.');
    const response = await this.fetcher(`${uploading ? this.uploadBase : this.base}${resource}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-sync-release',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': type ?? 'application/json',
      },
      ...(body === undefined ? {} : { body: uploading ? body : JSON.stringify(body) }),
    });
    if (optional && method === 'GET' && response.status === 404) return null;
    // Do not print API bodies, signed upload URLs or request credentials in CI logs.
    assert.ok(response.ok, `GitHub ${method} ${resource.split('?')[0]} failed (HTTP ${response.status}). Rerun after resolving the cause.`);
    try {
      return await response.json();
    } catch {
      throw new Error(`GitHub ${method} ${resource.split('?')[0]} returned invalid JSON.`);
    }
  }
}

async function tagCommit(api, tag) {
  const ref = await api.request('GET', `/git/ref/tags/${tag}`, undefined, { optional: true });
  if (!ref) return null;
  let object = ref.object;
  // Support existing annotated tags without treating target_commitish as provenance.
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
    assert.match(object.sha, shaPattern);
    object = (await api.request('GET', `/git/tags/${object.sha}`)).object;
  }
  assert.equal(object?.type, 'commit', 'Release tag must resolve to a commit.');
  assert.match(object.sha, shaPattern);
  return object.sha;
}

async function releaseForTag(api, tag) {
  const published = await api.request('GET', `/releases/tags/${tag}`, undefined, { optional: true });
  if (published) return published;
  // The by-tag endpoint only guarantees published releases. Authenticated listing
  // also exposes drafts, including a draft left by an interrupted upload.
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await api.request('GET', `/releases?per_page=100&page=${page}`);
    assert.ok(Array.isArray(releases) && releases.length <= 100, 'Invalid release listing.');
    matches.push(...releases.filter(release => release.tag_name === tag));
    assert.ok(matches.length <= 1, 'Multiple releases use this tag; manual inspection is required.');
    if (releases.length < 100) break;
  }
  return matches[0] ?? null;
}

function validateAsset(asset, file) {
  assert.equal(asset.state, 'uploaded', `Incomplete asset: ${file.name}`);
  assert.equal(asset.size, file.bytes.length, `Existing asset size differs: ${file.name}`);
  assert.equal(asset.digest, `sha256:${checksum(file.bytes)}`, `Existing asset digest differs or is unavailable: ${file.name}`);
}

export async function publishRelease({ api, version, sha, files }) {
  assert.ok(stablePattern.test(version), 'Invalid release version.');
  assert.match(sha, shaPattern, 'Invalid source commit.');
  assert.ok(!/^0+$/.test(sha), 'Invalid source commit.');
  assert.deepEqual(files.map(file => file.name), [`anime-fan-5903-dsh-sync-${version}.tgz`, 'SHA256SUMS']);
  const tag = `v${version}`;
  let commit = await tagCommit(api, tag);
  assert.ok(commit === null || commit === sha, `${tag} already belongs to another commit; it will not be moved.`);
  let release = await releaseForTag(api, tag);
  assert.ok(!release || commit === sha, 'An existing release must have a matching source tag.');
  if (!commit) {
    await api.request('POST', '/git/refs', { ref: `refs/tags/${tag}`, sha });
    commit = await tagCommit(api, tag);
    assert.equal(commit, sha, 'Created tag does not match the source commit.');
  }
  if (!release) {
    release = await api.request('POST', '/releases', {
      tag_name: tag, target_commitish: sha, name: tag, draft: true, prerelease: false,
      body: `Source commit: \`${sha}\`\n\nChecks: Node.js 22 on Ubuntu and Windows (offline tests and project checks).\n\nLive Microsoft account, two-device synchronization and DSH UI acceptance are not performed by this workflow.\n\nThe attached npm tarball is the distribution package. Verify it using SHA256SUMS.`,
    });
  }
  assert.equal(release.tag_name, tag, 'Release tag does not match.');
  assert.equal(release.prerelease, false, 'An existing prerelease cannot be overwritten as a stable release.');
  assert.equal(typeof release.draft, 'boolean', 'Invalid release draft state.');
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release ID.');
  const assets = await api.request('GET', `/releases/${release.id}/assets?per_page=100`);
  assert.ok(Array.isArray(assets) && assets.length <= files.length, 'Unexpected release attachments.');
  assert.equal(new Set(assets.map(asset => asset.name)).size, assets.length, 'Duplicate release attachments.');
  for (const asset of assets) {
    const file = files.find(file => file.name === asset.name);
    assert.ok(file, `Unexpected release attachment: ${asset.name}`);
    validateAsset(asset, file);
  }
  if (!release.draft) {
    assert.equal(assets.length, files.length, 'Published release is incomplete; it will not be modified.');
    return { tag, status: 'already-published' };
  }
  for (const file of files) {
    if (assets.some(asset => asset.name === file.name)) continue;
    const asset = await api.request('POST', `/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, file.bytes, { type: file.type });
    assert.equal(asset.name, file.name, 'Uploaded asset name differs.');
    validateAsset(asset, file);
  }
  // Re-read the server state before exposing the release to users.
  const complete = await api.request('GET', `/releases/${release.id}/assets?per_page=100`);
  assert.equal(complete.length, files.length, 'Release assets are incomplete.');
  for (const file of files) {
    const matching = complete.filter(asset => asset.name === file.name);
    assert.equal(matching.length, 1, `Missing or duplicate asset: ${file.name}`);
    validateAsset(matching[0], file);
  }
  assert.equal(await tagCommit(api, tag), sha, 'Tag changed during publication.');
  const published = await api.request('PATCH', `/releases/${release.id}`, { draft: false, prerelease: false, make_latest: 'legacy' });
  assert.equal(published.draft, false, 'Release is still a draft.');
  return { tag, status: 'published' };
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const planner = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? planDispatch : planPush;
  const plan = await planner(event, {
    eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA,
  }, sha => JSON.parse(git(['show', `${sha}:package.json`])));
  assert.equal(git(['rev-parse', 'HEAD']), plan.sha, 'Checkout does not match the release source.');
  let message = `Package version ${plan.version} is unchanged; no tag, Release or assets were modified.`;
  if (plan.publish) {
    assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, plan.version);
    const files = await packRelease(plan.version, path.join(root, '_local', 'release'));
    const api = new GitHubApi(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
    const result = await publishRelease({ api, version: plan.version, sha: plan.sha, files });
    message = `${result.tag}: ${result.status} (source ${plan.sha}).`;
  }
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
