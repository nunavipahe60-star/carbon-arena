'use strict';
const fs=require('node:fs'),path=require('node:path'),{writeZip}=require('./zip.cjs');
const root=path.resolve(__dirname,'..');
// Explicit directories and extensions: runtime archives, keys and dependency installations are never traversed.
const files=['README.md','package.json','package-lock.json','.gitignore','.gitattributes','Start-Carbon-Arena.cmd',
  'Carbon-Arena-Rules-v0.5.md','Carbon-Arena-Harness-v0.5.md','Carbon-Arena-Analytics-v0.5.md'];
for(const dir of ['competition','competition/public','competition/examples','competition/tests','duel','duel/tests',
 'playable-v0.5','playable-v0.5/tests','tests','tests/fixtures','tools','tools/verification','docs','docs/images']){
  for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    if(e.isFile()&&/\.(cjs|js|json|md|html|css|png)$/.test(e.name))files.push(dir+'/'+e.name);
  }
}
const output=path.join(root,'Carbon-Arena-Competition-Entry-Kit-v1.zip');
// Rebuild only this generated public source kit, leaving all match archives alone.
if(fs.existsSync(output))fs.unlinkSync(output);
writeZip(output,[...new Set(files)].sort().map(n=>['carbon-arena/'+n,fs.readFileSync(path.join(root,n))]));
console.log('Built public source entry kit. Install its pinned dependencies with npm ci before running matches.');
