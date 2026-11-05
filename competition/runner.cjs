'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const E=require('../playable-v0.5/engine.js');
const {Sandbox}=require('../duel/sandbox.cjs');
const limits=require('../duel/config.cjs');
const {POLICY,score}=require('./core.cjs');
const {sha,fingerprint,writeNew,root}=require('./integrity.cjs');
const {id,chooseSeeds,seedExclusions}=require('./ledger.cjs');
const COMPARATOR=path.join(root,'tools/verification/compare-claude.cjs');
const RESOLVER=path.join(root,'tools/verification/independent-resolver.js');
// Detect changes since this process loaded its resolver and competition modules.
let loadedFingerprint;
function checkRuntime(){const now=fingerprint();if(!loadedFingerprint)loadedFingerprint=now;
  assert.deepEqual(now,loadedFingerprint,'Arena changed during this process; restart before continuing');return now;}
checkRuntime();
async function checkSource(source){
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>1024*1024)throw Error('Choose a JavaScript file up to 1 MiB');
  const box=new Sandbox();
  try{for(const team of E.TEAMS){const snapshot=E.snapshot(E.create(1));
    const a=await box.call(source,snapshot,team,null),b=await box.call(source,snapshot,team,null);
    if(!a.ok||!b.ok)throw Error('Entry check failed for '+team+': '+(a.code||b.code));
    assert.deepEqual([a.decision,a.memory],[b.decision,b.memory],'First decision must be reproducible');
  }}finally{await box.close();}
  return {status:'passed',scope:'Repeated turn-zero calls in both colors; full-match determinism is checked during challenges'};
}
function prepare(ledger,entryIds,rated=true){
  const state=ledger.read();
  if(!Array.isArray(entryIds)||entryIds.length!==2||entryIds[0]===entryIds[1])throw Error('Choose two different entries');
  const selected=entryIds.map(eid=>{const e=state.entries.find(e=>e.id===eid);if(!e)throw Error('Entry not found');return e;});
  if(selected.some(e=>e.banned))throw Error('This entry is banned from new challenges, including practice');
  const entries=selected.map(e=>{ledger.source(e);return e;});
  if(rated&&entries.some(e=>e.practiceOnly))throw Error('Practice examples cannot enter rated challenges');
  if(rated&&state.challenges.some(c=>c.rated&&c.entries.every(eid=>entryIds.includes(eid))))throw Error('This pair of frozen strategies already has an official attempt. Register a revised strategy to challenge again.');
  const cid=id(),dir=ledger.challengeDir(cid),freeze={format:'carbon-arena-competition-freeze-v1',policy:POLICY,
    id:cid,rated,createdAt:new Date().toISOString(),entries,limits,archiveHead:state.head,archiveRevision:state.revision,integrity:checkRuntime()};
  // Commit exact entrants, runtime, rules and scoring before drawing any seeds.
  writeNew(path.join(dir,'freeze.json'),freeze);
  const freezeSHA256=sha(fs.readFileSync(path.join(dir,'freeze.json'))),excluded=seedExclusions(ledger),seeds=chooseSeeds(excluded);
  writeNew(path.join(dir,'seeds.json'),{freezeSHA256,seeds,excludedSeeds:[...excluded].sort((a,b)=>a-b),selectedAt:new Date().toISOString(),method:'crypto.randomBytes; rejection against prior exclusions and all reserved maps'});
  ledger.append('prepared',{id:cid,entries:entryIds,rated,seeds,freezeSHA256,createdAt:freeze.createdAt});
  return cid;
}
function physical(s){return {turn:s.turn,ground:s.ground,vehicles:s.vehicles,trees:s.trees,teams:s.teams,
  nextTreeId:s.nextTreeId,initialCarbon:s.initialCarbon,generatedCarbon:s.generatedCarbon,
  treeGeneratedCarbon:s.treeGeneratedCarbon,soldCarbon:s.soldCarbon,ended:s.ended,winner:s.winner};}
async function play({seed,colors,entries,box,freezeSHA256,progress=()=>{}}){
  const state=E.create(seed),memory={Red:null,Blue:null},calls=[],checkpoints=[];
  const replay={format:'carbon-arena-replay-v1',rulesVersion:E.VERSION,generator:E.GENERATOR,coordinateSystem:'zero-based-xy',
    seed,settings:state.settings,strategies:{protocol:'carbon-arena-competition-v1',freezeSHA256,
      entrants:Object.fromEntries(E.TEAMS.map(t=>[t,{id:colors[t],name:entries[colors[t]].name,sha256:entries[colors[t]].sha256}]))},decisions:[]};
  checkpoints.push(sha(JSON.stringify(physical(state))));
  while(!state.ended){const snapshot=E.snapshot(state),input=sha(JSON.stringify(snapshot)),decisions={};
    for(const team of E.TEAMS){const previous=sha(JSON.stringify(memory[team]));
      const r=await box.call(entries[colors[team]].source,snapshot,team,memory[team]);
      if(r.ok){decisions[team]=r.decision;memory[team]=r.memory;}else decisions[team]={failure:r.code,vehicles:[],purchases:[]};
      calls.push({turn:state.turn+1,team,entrant:colors[team],snapshotSHA256:input,inputMemorySHA256:previous,
        outputMemorySHA256:sha(JSON.stringify(memory[team])),ok:r.ok,failure:r.ok?null:r.code});
    }
    replay.decisions.push(E.resolve(state,decisions).decisions);
    assert.equal(state.history.at(-1).carbonError,0,'Carbon conservation failed');
    checkpoints.push(sha(JSON.stringify(physical(state))));
    if(state.turn%50===0)progress(state.turn);
  }
  assert.deepEqual(E.replay(replay),state,'Saved decisions do not reproduce the live state');
  return {replay,audit:E.audit(state),calls,checkpoints,summary:{seed,colors,cash:{Red:state.teams.Red.cash,Blue:state.teams.Blue.cash},
    turns:state.turn,failures:calls.filter(c=>!c.ok).length,treeGenerated:state.treeGeneratedCarbon}};
}
function compareIndependent(dir){return new Promise((resolve,reject)=>{
  const out=path.join(dir,'independent.json'),proc=spawn(process.execPath,[COMPARATOR,RESOLVER,out,dir],{windowsHide:true});let stdout='',stderr='';
  proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);proc.once('error',reject);
  proc.once('exit',code=>{fs.writeFileSync(path.join(dir,'independent.stdout.txt'),stdout);fs.writeFileSync(path.join(dir,'independent.stderr.txt'),stderr);
    if(code!==0)return reject(Error('Independent verification failed; evidence retained'));
    try{const result=JSON.parse(fs.readFileSync(out));assert.equal(result.total,1);assert.equal(result.passed,1);resolve(result);}catch(e){reject(e);}
  });
});}
async function runPrepared(ledger,cid,progress=()=>{}){
  const c=ledger.read().challenges.find(c=>c.id===cid);assert.ok(c);assert.equal(c.status,'prepared');
  const dir=ledger.challengeDir(cid),file=path.join(dir,'freeze.json'),freeze=JSON.parse(fs.readFileSync(file));
  const verify=()=>{assert.equal(sha(fs.readFileSync(file)),c.freezeSHA256,'Freeze changed');
    assert.deepEqual(fingerprint(),freeze.integrity,'Arena/runtime changed after freeze');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'seeds.json'))).seeds,c.seeds,'Map reservation changed');
    for(const entry of freeze.entries)ledger.source(entry);};
  const box=new Sandbox();
  try{
    verify();assert.deepEqual(freeze.policy,POLICY);assert.deepEqual(freeze.entries.map(e=>e.id),c.entries);
    ledger.append('started',{id:cid});
    const entries=Object.fromEntries(freeze.entries.map(e=>[e.id,{...e,source:ledger.source(e)}])),matches=[];
    for(let i=0;i<3;i++)for(let swap=0;swap<2;swap++){
      verify();const colors={Red:c.entries[swap],Blue:c.entries[1-swap]},name=`map-${i+1}-${swap?'swapped':'first'}`;
      const matchDir=path.join(dir,name);fs.mkdirSync(matchDir);
      const options={seed:c.seeds[i],colors,entries,box,freezeSHA256:c.freezeSHA256,
        progress:turn=>progress({match:matches.length+1,total:6,turn,phase:'Playing'})};
      progress({match:matches.length+1,total:6,turn:0,phase:'Playing'});
      const first=await play(options);
      for(const [f,value]of Object.entries({replay:first.replay,audit:first.audit,'strategy-calls':first.calls,'checkpoint-hashes':first.checkpoints,summary:first.summary}))writeNew(path.join(matchDir,f+'.json'),value);
      progress({match:matches.length+1,total:6,turn:first.summary.turns,phase:'Checking reproducibility'});
      const second=await play({...options,progress:()=>{}});
      assert.deepEqual(second.replay,first.replay,'Frozen strategy decisions differ on repeat');
      assert.deepEqual(second.calls,first.calls,'Frozen strategy memory/input hashes differ');
      assert.deepEqual(second.audit,first.audit,'Repeated audit differs');
      assert.deepEqual(second.checkpoints,first.checkpoints,'Repeated physical states differ');
      writeNew(path.join(matchDir,'determinism.json'),{status:'passed',turns:first.summary.turns});
      progress({match:matches.length+1,total:6,turn:first.summary.turns,phase:'Independent verification'});
      await compareIndependent(matchDir);
      matches.push({...first.summary,directory:name,independentVerification:'passed',determinism:'passed'});
    }
    verify();const result={format:'carbon-arena-competition-result-v1',status:'passed',entries:c.entries,
      freezeSHA256:c.freezeSHA256,seeds:c.seeds,rated:c.rated,matches,score:score(matches,c.seeds,c.entries)};
    writeNew(path.join(dir,'result.json'),result);
    ledger.append('completed',{id:cid,result});return result;
  }catch(e){const status=ledger.read().challenges.find(x=>x.id===cid).status;
    if(['prepared','running'].includes(status))ledger.append('failed',{id:cid,error:e.message});throw e;
  }finally{await box.close();}
}
module.exports={checkSource,prepare,physical,play,compareIndependent,runPrepared};
