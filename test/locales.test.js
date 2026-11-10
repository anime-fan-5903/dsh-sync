import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = path.join(project, '_local');

async function fixture(context, ending) {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'locale-check-'));
  context.after(async () => {
    assert.equal(path.dirname(directory), temporaryRoot, 'Only remove the generated fixture.');
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'locale'));
  await writeFile(path.join(directory, 'scripts/locales.mjs'), await readFile(new URL('../scripts/locales.mjs', import.meta.url)));
  for (const language of ['en', 'zh-CN', 'ja']) {
    await writeFile(path.join(directory, `locale/${language}.json`), JSON.stringify({
      meta: { title: 'Fixture', description: 'Generated test dictionary' }, message: `fixture-${language}`,
    }, null, 2) + '\n');
  }
  await writeFile(path.join(directory, 'client.js'), '    // BEGIN GENERATED LOCALES\n    // END GENERATED LOCALES\n');
  const run = (...args) => spawnSync(process.execPath, [path.join(directory, 'scripts/locales.mjs'), ...args], {
    cwd: directory, encoding: 'utf8', timeout: 15_000,
  });
  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  const names = ['scripts/locales.mjs', 'client.js', ...['en', 'zh-CN', 'ja', 'zh'].map(language => `locale/${language}.json`)];
  for (const name of names) {
    const target = path.join(directory, name);
    const source = await readFile(target, 'utf8');
    await writeFile(target, source.replace(/\r\n/g, '\n').replace(/\n/g, ending));
  }
  return { directory, names, run };
}

for (const [label, ending] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`locale check accepts a ${label} checkout without rewriting files`, async context => {
    const { directory, names, run } = await fixture(context, ending);
    const before = await Promise.all(names.map(name => readFile(path.join(directory, name))));
    const result = run('--check');
    assert.equal(result.status, 0, result.stderr);
    for (let index = 0; index < names.length; index++) {
      assert.deepEqual(await readFile(path.join(directory, names[index])), before[index], names[index]);
    }
  });

  for (const resource of ['alias', 'embedded', 'markers']) {
    test(`locale check still rejects stale ${resource} with ${label} endings`, async context => {
      const { directory, run } = await fixture(context, ending);
      const target = path.join(directory, resource === 'alias' ? 'locale/zh.json' : 'client.js');
      const before = await readFile(target, 'utf8');
      const changed = resource === 'alias' ? before.replace('fixture-zh-CN', 'stale-alias') :
        resource === 'embedded' ? before.replace('fixture-en', 'stale-embedded') : before.replace('BEGIN GENERATED LOCALES', 'BEGIN MISSING LOCALES');
      assert.notEqual(changed, before);
      await writeFile(target, changed);
      const result = run('--check');
      assert.equal(result.status, 1);
      assert.match(result.stderr, resource === 'alias' ? /Chinese metadata alias is stale/ :
        resource === 'embedded' ? /Embedded locales are stale/ : /Missing generated locale markers/);
      assert.equal(await readFile(target, 'utf8'), changed, 'Check mode must not repair or rewrite stale resources.');
    });
  }
}
