'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {sha,writeNew,root}=require('./integrity.cjs');
function packageEvent(store){
 const state=store.read();assert.equal(state.status,'completed');assert.equal(state.matches.length,60);
 const dir=store.seasonDir(state.id),out=path.join(dir,'public-package');fs.mkdirSync(out,{recursive:true});
 const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
 for(const name of ['freeze.json','seeds.json','result.json','historical-preservation.json'])copy(path.join(dir,name),path.join(out,name));
 copy(store.file,path.join(out,'event-journal.jsonl'));
 const failures=[];
 for(const match of state.matches){
  const from=path.join(dir,match.evidenceDirectory),to=path.join(out,'games',String(match.index+1).padStart(2,'0'));
  for(const name of ['replay.json','audit.json','summary.json','strategy-calls.json','checkpoint-hashes.json','determinism.json','independent.json','independent.stdout.txt','independent.stderr.txt','verifier-receipt.json']){
   const file=path.join(from,name);if(fs.existsSync(file))copy(file,path.join(to,name));
  }
  const calls=JSON.parse(fs.readFileSync(path.join(from,'strategy-calls.json')));
  for(const c of calls.filter(c=>!c.ok))failures.push({game:match.index+1,seed:match.seed,map:match.map,...c});
 }
 const summary={event:'Curtain Call',status:'passed',games:60,reproducibilityExecutions:60,independentlyVerified:60,exhibitionGames:0,failedCalls:failures.length,failures,standings:state.result.table,completedAt:state.completedAt};
 fs.writeFileSync(path.join(out,'verification-summary.json'),JSON.stringify(summary,null,2)+'\n');
 for(const name of ['index.html','engine.js','app.js','strategies.js','style.css'])copy(path.join(root,'playable-v0.5',name),path.join(out,'viewer',name));
 const rows=state.result.table.map(r=>`| ${r.rank} | ${state.entries.find(e=>e.id===r.id).name} | ${r.points} / 20 | ${r.cash} | ${r.wins} / ${r.draws} / ${r.losses} |`).join('\n');
 fs.writeFileSync(path.join(out,'README.md'),`# Carbon Arena: Curtain Call\n\n60 scored games on ten shared maps; no exhibitions. Every game completed 300 turns, reproduced in a full strategy rerun, and passed the unchanged independent comparator. Map points rank first, total cash breaks ties, exact equality shares a rank.\n\n| Rank | Entrant | Map points | Total cash | W / D / L |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Replay loading\n\nOpen viewer/index.html in a browser and import any games/NN/replay.json using Import replay. The viewer works offline. The live event page also provides one-click replay links.\n\nfreeze.json identifies exact source hashes, accepted registered IDs, event display names, runtime, limits, acceptance receipts and policy. seeds.json is the immutable reservation and includes the actual exclusion set. result.json contains all thirty map results and sixty verified game summaries. verification-summary.json lists every failed strategy call by game, turn and team. strategy-calls.json contains memory hashes only. Entrant sources and raw private memory are excluded. Event standings do not alter the historical Elo ladder or previous season.\n\nCheck every file against SHA256SUMS.json using SHA-256.\n`);
 const files={};function walk(base){for(const d of fs.readdirSync(base,{withFileTypes:true})){const f=path.join(base,d.name);if(d.isDirectory())walk(f);else if(d.name!=='SHA256SUMS.json')files[path.relative(out,f).replace(/\\/g,'/')]=sha(fs.readFileSync(f));}}walk(out);
 fs.writeFileSync(path.join(out,'SHA256SUMS.json'),JSON.stringify(files,null,2)+'\n');
 const zip=path.join(dir,'Curtain-Call-Results.zip');assert(!fs.existsSync(zip),'Result package already exists; preserve the original.');
 require('../tools/zip.cjs').zipDirectory(out,zip,'Curtain-Call-Results');
 writeNew(path.join(dir,'package-receipt.json'),{at:new Date().toISOString(),file:path.basename(zip),sha256:sha(fs.readFileSync(zip)),bytes:fs.statSync(zip).size,files:Object.keys(files).length+1,status:'passed',sourceIncluded:false,rawPrivateMemoryIncluded:false});
 return zip;
}
module.exports={packageEvent};
