'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function filesBelow(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const f=path.join(dir,e.name);if(e.isDirectory())return filesBelow(f);if(e.isFile())return [f];throw Error('Unexpected runtime link');
});}
function fingerprint(){
  const names=['playable-v0.5/engine.js','competition/core.cjs','competition/ledger.cjs','competition/integrity.cjs',
    'competition/runner.cjs','competition/server.cjs','competition/access.cjs','competition/practice.cjs',
    'competition/curtain-call-core.cjs','competition/curtain-call-store.cjs','competition/curtain-call-runner.cjs','competition/curtain-call-package.cjs','competition/curtain-call-preservation.cjs',
    'competition/season-core.cjs','competition/season-store.cjs','competition/season-runner.cjs',
    'competition/seed-history.json','Carbon-Arena-Rules-v0.5.md','duel/config.cjs','duel/sandbox.cjs','duel/sandbox-worker.cjs','duel/guest.cjs',
    'duel/package-lock.json','tools/zip.cjs','tools/verification/independent-resolver.js',
    'tools/verification/compare-claude.cjs'];
  const files=Object.fromEntries(names.map(n=>[n,sha(fs.readFileSync(path.join(root,n)))]));
  const dependencies=filesBelow(path.join(root,'duel/node_modules')).sort().map(f=>[
    path.relative(root,f).replace(/\\/g,'/'),sha(fs.readFileSync(f))]);
  return {files,dependenciesSHA256:sha(JSON.stringify(dependencies)),nodeVersion:process.version,
    platform:process.platform,architecture:process.arch,nodeSHA256:sha(fs.readFileSync(process.execPath))};
}
function writeNew(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
module.exports={root,sha,fingerprint,writeNew};
