import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(manifest.version!==pkg.version)throw new Error('Version mismatch');
for(const name of (await fs.readdir(root)).filter(name=>name.endsWith('.js'))){
  execFileSync(process.execPath,['--check',path.join(root,name)],{stdio:'pipe'});
}
const required=[manifest.background.service_worker,manifest.options_page,'offscreen.html','offscreen.js','worker.js','help.html','help.js','sentence-prompt.txt',
  ...manifest.content_scripts.flatMap(script=>script.js)];
for(const name of required)await fs.access(path.join(root,name));
if(manifest.host_permissions.some(host=>!['https://www.youtube.com/*','https://api.deepseek.com/*'].includes(host)))throw new Error('Unexpected host permission');
console.log(`Syntax and manifest checks passed for v${manifest.version}.`);
