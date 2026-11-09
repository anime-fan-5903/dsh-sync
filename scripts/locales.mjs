import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const languages = ['en', 'zh-CN', 'ja'];
if (process.argv.includes('--check')) {
  const files = (await readdir(new URL('locale/', root))).filter(name => name.endsWith('.json')).sort();
  assert.deepEqual(files, [...languages.map(language => `${language}.json`), 'zh.json'].sort(), 'Unexpected or missing locale resources.');
}
const dictionaries = {};
const resources = {};
for (const language of languages) {
  const dictionary = JSON.parse(await readFile(new URL(`locale/${language}.json`, root), 'utf8'));
  assert.ok(dictionary.meta?.title && dictionary.meta?.description, `Missing metadata: ${language}`);
  resources[language] = dictionary;
  const { meta, ...messages } = dictionary;
  if (language !== 'en') assert.deepEqual(Object.keys(messages).sort(), Object.keys(dictionaries.en).sort(), `Translation keys differ: ${language}`);
  for (const [key, value] of Object.entries(messages)) assert.ok(typeof value === 'string' && value.trim(), `Empty translation: ${language}.${key}`);
  dictionaries[language] = messages;
}
// DSH's built-in Simplified Chinese locale uses the language-wide zh id.
const alias = new URL('locale/zh.json', root);
const aliasSource = `${JSON.stringify(resources['zh-CN'], null, 2)}\n`;
if (process.argv.includes('--check')) assert.equal(await readFile(alias, 'utf8'), aliasSource, 'Chinese metadata alias is stale; run node scripts/locales.mjs');
else await writeFile(alias, aliasSource);
const target = new URL('client.js', root);
const source = await readFile(target, 'utf8');
const start = '    // BEGIN GENERATED LOCALES\n';
const end = '    // END GENERATED LOCALES';
const from = source.indexOf(start);
const to = source.indexOf(end, from);
assert.ok(from >= 0 && to > from, 'Missing generated locale markers');
const generated = `${start}    const dictionaries = ${JSON.stringify(dictionaries, null, 2)};\n${end}`;
const updated = source.slice(0, from) + generated + source.slice(to + end.length);
if (process.argv.includes('--check')) assert.equal(source, updated, 'Embedded locales are stale; run node scripts/locales.mjs');
else await writeFile(target, updated);
console.log(`Validated ${languages.length} locale dictionaries${process.argv.includes('--check') ? ' and embedded resources' : ' and updated embedded resources'}.`);
