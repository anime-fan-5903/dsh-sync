import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const locales=spawnSync(process.execPath,[path.join(root,'scripts/locales.mjs'),'--check'],{stdio:'inherit'});assert.equal(locales.status,0,'Locale validation failed.');
async function walk(directory){const files=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(['.git','node_modules','_local','_cache'].includes(entry.name))continue;const full=path.join(directory,entry.name);if(entry.isDirectory())files.push(...await walk(full));else files.push(full);}return files;}
const files=await walk(root);
for(const file of files.filter(name=>/\.(?:js|mjs)$/.test(name))){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});assert.equal(result.status,0,`Syntax check failed: ${path.relative(root,file)}`);}
for(const file of files.filter(name=>name.endsWith('.md'))){const body=await readFile(file,'utf8');assert.ok(!/\{\{[a-z_]+\}\}/i.test(body),`Unresolved template in ${file}`);for(const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){let target=match[1].replace(/^<|>$/g,'').split('#')[0];if(!target||/^[a-z]+:/i.test(target))continue;target=decodeURIComponent(target);await stat(path.resolve(path.dirname(file),target)).catch(()=>{throw new Error(`Broken link in ${path.relative(root,file)}: ${target}`);});}}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.dsh.client.platform,'web');assert.ok(!pkg.dependencies&&!pkg.devDependencies,'The v1 project must remain dependency-free unless a reviewed dependency is explicitly introduced.');
for(const entry of ['index.js','client.js','cordis.patch.yml','icon.svg','locale/en.json'])await stat(path.join(root,entry));
const locale=JSON.parse(await readFile(path.join(root,'locale/en.json'),'utf8'));assert.ok(locale.meta.title&&locale.meta.description);
const icon=await readFile(path.join(root,'icon.svg'),'utf8');assert.ok(icon.includes('<svg'));assert.ok(Buffer.byteLength(icon)<256*1024);
assert.ok(!/https?:|<script|onload\s*=/i.test(icon.replace('http://www.w3.org/2000/svg','')),'Icon must not load remote content or scripts.');
for(const entry of ['index.js','client.js','src/','locale/','icon.svg','cordis.patch.yml','README.md','CONTRIBUTING.md','AGENTS.md','docs/'])assert.ok(pkg.files.includes(entry),`Missing distribution entry: ${entry}`);
console.log(`Checked ${files.length} project files: syntax, distribution resources, and Markdown links passed.`);
