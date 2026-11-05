'use strict';
// Public synthetic fixtures only. No production entrants or sealed evidence.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {Ledger,id}=require('../ledger.cjs'),{sha,writeNew}=require('../integrity.cjs');
const {score}=require('../core.cjs'),{publicEvidence}=require('../access.cjs'),{serve}=require('../server.cjs');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-metadata-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ledger=new Ledger(dir),entries=['Alpha','Beta'].map(name=>ledger.register({name:'Synthetic '+name,model:'Synthetic model',version:'Synthetic private tactic',notes:'Synthetic preparation detail'},`function decide(){return {decision:{},memory:null};} // ${name}`));
  const ids=entries.map(e=>e.id),cid=id(),seeds=[6101,6102,6103],freezeSHA256=sha(cid);
  const matches=seeds.flatMap(seed=>[
    {seed,colors:{Red:ids[0],Blue:ids[1]},cash:{Red:20,Blue:10}},
    {seed,colors:{Red:ids[1],Blue:ids[0]},cash:{Red:10,Blue:20}}
  ]);
  ledger.append('prepared',{id:cid,entries:ids,seeds,freezeSHA256,rated:true});ledger.append('started',{id:cid});
  const result={status:'passed',entries:ids,seeds,freezeSHA256,matches,score:score(matches,seeds,ids)};
  ledger.append('completed',{id:cid,result});
  const decisions=[{Red:{id:ids[0],name:'Synthetic command payload',vehicles:[]},Blue:{}}];
  const replay={strategies:{entrants:{Red:entries[0],Blue:entries[1]}},decisions};
  const freeze={entries,id:cid};
  for(const [file,value]of Object.entries({freeze,result,seeds:{seeds}}))writeNew(path.join(ledger.challengeDir(cid),file+'.json'),value);
  for(const file of ['replay','audit','summary','determinism','independent'])writeNew(path.join(ledger.challengeDir(cid),'map-1-first',file+'.json'),file==='replay'?replay:{status:'fixture'});
  const updates=entries.map((e,i)=>({id:e.id,name:'Fixture V'+(i+1),model:'Fixture',version:'v'+(i+1),notes:''}));
  return {dir,ledger,entries,cid,ids,replay,freeze,updates};
}
function identity(state){return {...state,head:undefined,revision:undefined,entries:state.entries.map(({name,model,version,notes,relabeled,...e})=>e)};}

test('relabel changes display metadata only, appends history, persists, and rejects identity edits',t=>{
  const {dir,ledger,cid,ids,updates}=fixture(t);ledger.banEntries(ids);ledger.sealChallenge(cid);
  const before=ledger.read(),raw=fs.readFileSync(ledger.file,'utf8');ledger.relabelEntries(updates);
  const after=new Ledger(dir).read();assert.deepEqual(identity(after),identity(before));
  assert.ok(fs.readFileSync(ledger.file,'utf8').startsWith(raw));
  for(const update of updates){const e=after.entries.find(e=>e.id===update.id);for(const key of ['name','model','version','notes'])assert.equal(e[key],update[key]);assert.equal(e.relabeled,true);}
  const revision=after.revision;
  for(const invalid of [[],[updates[0],updates[0]],[{...updates[0],id:id()}],[{...updates[0],sha256:'altered'}],[{...updates[0],name:' '}],[{...updates[0],notes:null}]])assert.throws(()=>ledger.relabelEntries(invalid));
  assert.equal(ledger.read().revision,revision);
});

test('projection replaces only entry metadata and leaves archived input and decisions intact',t=>{
  const {ledger,replay,freeze,updates}=fixture(t),raw=JSON.stringify({replay,freeze});ledger.relabelEntries(updates);
  for(const original of [replay,freeze]){
    const projected=publicEvidence(original,ledger.read());assert.equal(projected.metadataProjection,'current-entry-labels-v1');
    const entries=projected.entries||Object.values(projected.strategies.entrants);
    assert.deepEqual(entries.map(e=>e.name),updates.map(e=>e.name));assert.ok(entries.every(e=>e.notes===''&&e.version.startsWith('v')));
    assert.deepEqual(entries.map(e=>e.sha256),ledger.read().entries.map(e=>e.sha256));
  }
  assert.deepEqual(publicEvidence(replay,ledger.read()).decisions,replay.decisions);
  assert.equal(JSON.stringify({replay,freeze}),raw);
});

test('public HTTP state and evidence use aliases, original evidence stays intact, sealed routes stay locked',async t=>{
  const {dir,ledger,cid,updates}=fixture(t),archiveFile=path.join(ledger.challengeDir(cid),'freeze.json'),archiveHash=sha(fs.readFileSync(archiveFile));
  ledger.relabelEntries(updates);const arena=serve({dataDir:dir,port:0});await once(arena.server,'listening');
  t.after(()=>new Promise(resolve=>arena.server.close(resolve)));
  const base='http://127.0.0.1:'+arena.server.address().port;
  const state=await (await fetch(base+'/api/state')).json();assert.equal(state.owner,false);
  assert.deepEqual(state.entries.map(e=>e.name),updates.map(e=>e.name));assert.ok(state.entries.every(e=>e.notes===''));
  const routes=[...['result','freeze','seeds'].map(file=>`/api/challenges/${cid}/${file}.json`),...['replay','audit','summary','determinism','independent'].map(file=>`/api/matches/${cid}/map-1-first/${file}.json`)];
  for(const route of routes){const response=await fetch(base+route);assert.equal(response.status,200);const value=await response.json();
    assert.ok(!JSON.stringify(value).includes('Synthetic private tactic'));assert.ok(!JSON.stringify(value).includes('Synthetic preparation detail'));
  }
  assert.equal(sha(fs.readFileSync(archiveFile)),archiveHash);
  ledger.sealChallenge(cid);
  for(const route of routes)assert.equal((await fetch(base+route)).status,403);
});
