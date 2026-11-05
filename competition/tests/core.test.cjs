'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {POLICY,score,elo}=require('../core.cjs');
const {Ledger,id,chooseSeeds,seedExclusions}=require('../ledger.cjs');
const {sha,writeNew}=require('../integrity.cjs');
const {prepare,checkSource,runPrepared,play}=require('../runner.cjs');
const E=require('../../playable-v0.5/engine.js');
const {Sandbox}=require('../../duel/sandbox.cjs');
function store(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-competition-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Ledger(dir);}
function register(l,name,options){return l.register({name,model:'Public test fixture',version:'test'},`function decide(){return {decision:{},memory:null};} // ${name}`,options).id;}
function matches(seeds,ids,amounts){return seeds.flatMap((seed,i)=>[
  {seed,colors:{Red:ids[0],Blue:ids[1]},cash:{Red:amounts[i][0],Blue:amounts[i][1]}},
  {seed,colors:{Red:ids[1],Blue:ids[0]},cash:{Red:amounts[i][1],Blue:amounts[i][0]}}
]);}
function finish(l,ids,amounts,rated=true){const cid=id(),seeds=[1,2,3].map(n=>n+10*l.read().challenges.length),freezeSHA256=sha(cid);
  l.append('prepared',{id:cid,entries:ids,seeds,freezeSHA256,rated});l.append('started',{id:cid});
  const games=matches(seeds,ids,amounts),result={status:'passed',freezeSHA256,entries:ids,seeds,matches:games,score:score(games,seeds,ids)};
  l.append('completed',{id:cid,result});return cid;
}
test('two map wins beat an arbitrarily large cash loss on the remaining map',()=>{
  const s=score(matches([1,2,3],['a','b'],[[101,100],[101,100],[0,100000]]),[1,2,3],['a','b']);assert.equal(s.winner,'a');assert.ok(s.totalCash.b>s.totalCash.a);
});
test('drawn maps use total cash only when nobody has two map wins',()=>{
  for(const [amounts,winner]of [[[[120,100],[100,110],[100,100]],'a'],[[[100,100],[100,100],[100,100]],null]])
    assert.equal(score(matches([1,2,3],['a','b'],amounts),[1,2,3],['a','b']).winner,winner);
});
test('incomplete, negative-cash and unswapped score inputs are rejected',()=>{
  const m=matches([1,2,3],['a','b'],[[100,100],[100,100],[100,100]]);
  assert.throws(()=>score(m.slice(1),[1,2,3],['a','b']));m[1].colors=m[0].colors;assert.throws(()=>score(m,[1,2,3],['a','b']));
  const bad=matches([1,2,3],['a','b'],[[-1,0],[1,1],[1,1]]);assert.throws(()=>score(bad,[1,2,3],['a','b']));
});
test('Elo uses one K=32 update with conserved points and expected underdog reward',()=>{
  assert.deepEqual(elo(1500,1500,1).after,[1516,1484]);assert.deepEqual(elo(1500,1500,0.5).after,[1500,1500]);
  assert.ok(elo(1300,1700,1).change>29);assert.equal(elo(1300,1700,1).after.reduce((a,b)=>a+b),3000);assert.equal(POLICY.ratingUnit,'six-match-challenge');
});
test('ledger replays ratings once and transfers title only in a title challenge',t=>{
  const l=store(t),a=register(l,'A'),b=register(l,'B'),c=register(l,'C'),d=register(l,'D');
  const cid=finish(l,[a,b],[[101,100],[101,100],[101,100]]);let s=l.read();assert.equal(s.champion,a);assert.equal(s.entries[0].rating,1516);assert.equal(s.entries[0].played,1);
  const before=fs.readFileSync(l.file,'utf8');assert.throws(()=>l.append('completed',{id:cid,result:s.challenges[0].result}));assert.equal(fs.readFileSync(l.file,'utf8'),before);
  finish(l,[c,d],[[102,100],[102,100],[102,100]]);assert.equal(l.read().champion,a);
  finish(l,[a,c],[[100,101],[100,101],[100,101]]);s=l.read();assert.equal(s.champion,c);assert.equal(s.entries[0].played,2);
  assert.deepEqual(new Ledger(l.dir).read(),s);assert.ok(Math.abs(s.entries.reduce((v,e)=>v+e.rating,0)-6000)<1e-9);
});
test('draws count once and practice never awards Elo or a title',t=>{
  const l=store(t),a=register(l,'A'),b=register(l,'B');finish(l,[a,b],[[100,100],[100,100],[100,100]]);
  assert.equal(l.read().champion,null);assert.equal(l.read().entries[0].draws,1);
  finish(l,[a,b],[[110,100],[110,100],[110,100]],false);assert.equal(l.read().champion,null);assert.equal(l.read().entries[0].played,1);assert.equal(l.read().entries[0].rating,1500);
});
test('content identity and archived bytes cannot be silently replaced',t=>{
  const l=store(t);register(l,'A');const e=l.read().entries[0];assert.throws(()=>l.register({name:'renamed',model:'M',version:'V'},l.source(e)));
  fs.appendFileSync(path.join(l.dir,'sources',e.sha256+'.js'),' ');assert.throws(()=>l.source(e),/Archived strategy changed/);
});
test('ledger hash tampering and incomplete writes fail closed',t=>{
  const l=store(t);register(l,'A');const raw=fs.readFileSync(l.file,'utf8');fs.writeFileSync(l.file,raw.replace('Public test fixture','altered fixture'));
  assert.throws(()=>l.read(),/Ledger hash mismatch/);fs.writeFileSync(l.file,raw.trimEnd());assert.throws(()=>l.read(),/Incomplete ledger write/);
});
test('interrupted attempts keep seeds, do not rate, and block an official retry',t=>{
  const l=store(t),ids=[register(l,'A'),register(l,'B')],cid=prepare(l,ids,true),c=l.read().challenges[0];
  const freeze=JSON.parse(fs.readFileSync(path.join(l.challengeDir(cid),'freeze.json'))),reservation=JSON.parse(fs.readFileSync(path.join(l.challengeDir(cid),'seeds.json')));
  assert.equal(reservation.freezeSHA256,sha(fs.readFileSync(path.join(l.challengeDir(cid),'freeze.json'))));assert.ok(freeze.createdAt<=reservation.selectedAt);
  l.append('started',{id:cid});l.recover();assert.equal(l.read().challenges[0].status,'failed');assert.equal(l.read().entries[0].played,0);
  assert.ok(c.seeds.every(n=>seedExclusions(l).has(n)));assert.throws(()=>prepare(l,ids.slice().reverse(),true),/official attempt/);
});
test('even an orphan map reservation is excluded; selection rejects duplicates and old maps',t=>{
  const l=store(t);writeNew(path.join(l.challengeDir(id()),'seeds.json'),{seeds:[10,11,12]});assert.ok(seedExclusions(l).has(11));
  assert.ok(seedExclusions(l).has(2049928135),'Public full-rehearsal maps stay consumed');
  const values=[10,10,11,12,13,13,14,15];assert.deepEqual(chooseSeeds(new Set([10,11,12]),()=>values.shift()),[13,14,15]);
  assert.throws(()=>chooseSeeds(new Set([1]),()=>1),/fresh maps/);
});
test('practice examples and malformed reservations cannot be rated',t=>{
  const l=store(t),ids=[register(l,'A',{practiceOnly:true}),register(l,'B')];assert.throws(()=>prepare(l,ids,true),/Practice examples/);
  assert.throws(()=>l.append('prepared',{id:id(),entries:ids,seeds:[1,1,2],rated:false,freezeSHA256:sha('x')}));
});
test('real sandbox check accepts examples and rejects crashes and forbidden clock access',async()=>{
  await checkSource(fs.readFileSync(path.join(__dirname,'../examples/wait.js'),'utf8'));
  await assert.rejects(checkSource('function decide(){throw Error("fixture")}'));
  await assert.rejects(checkSource('function decide(){return {decision:{},memory:Date.now()}}'));
});
test('sandbox failure is normalized as WAIT and recorded in the audit',async()=>{
  const box=new Sandbox(),entries={a:{name:'Throw fixture',sha256:sha('a'),source:'function decide(){throw Error("fixture");}'},b:{name:'WAIT fixture',sha256:sha('b'),source:'function decide(){return {decision:{},memory:null};}'}};
  try{
    // A single-turn fixture exercises failure handling; full official defaults are tested by the rehearsal.
    const snapshot=E.snapshot(E.create(1)),result=await box.call(entries.a.source,snapshot,'Red',null);assert.equal(result.ok,false);
    const s=E.create(1);E.resolve(s,{Red:{failure:result.code},Blue:{}});assert.equal(s.history.at(-1).carbonError,0);
    assert.ok(E.audit(s).events.some(e=>e.type==='strategy_failure'));
  }finally{await box.close();}
});
test('a changed freeze stops verification, retains evidence, and applies no Elo',async t=>{
  const l=store(t),ids=[register(l,'A'),register(l,'B')],cid=prepare(l,ids,true);
  fs.appendFileSync(path.join(l.challengeDir(cid),'freeze.json'),' ');
  await assert.rejects(runPrepared(l,cid),/Freeze changed/);
  assert.equal(l.read().challenges[0].status,'failed');assert.equal(l.read().entries[0].played,0);
  assert.ok(fs.existsSync(path.join(l.challengeDir(cid),'seeds.json')));
});
test('runner retains private memory on a failed turn and gives both teams the same snapshot',async()=>{
  const received=[],box={async call(source,snapshot,team,memory){
    received.push({turn:snapshot.turn,team,memory:JSON.parse(JSON.stringify(memory)),snapshot:sha(JSON.stringify(snapshot))});
    if(snapshot.turn===1&&team==='Red')return {ok:false,code:'GUEST_ERROR'};
    return {ok:true,decision:{},memory:{calls:(memory?.calls||0)+1}};
  }},entries={a:{name:'A',sha256:sha('a'),source:'A'},b:{name:'B',sha256:sha('b'),source:'B'}};
  const r=await play({seed:1,colors:{Red:'a',Blue:'b'},entries,box,freezeSHA256:sha('test')});
  assert.equal(r.summary.turns,300);assert.equal(r.summary.failures,1);assert.equal(r.calls.length,600);
  assert.equal(r.calls[2].inputMemorySHA256,r.calls[2].outputMemorySHA256);
  assert.deepEqual(received.find(c=>c.team==='Red'&&c.turn===2).memory,{calls:1});
  for(let i=0;i<received.length;i+=2)assert.equal(received[i].snapshot,received[i+1].snapshot);
  assert.equal(r.replay.decisions[1].Red.failure,'GUEST_ERROR');assert.ok(r.audit.turnSummaries.every(s=>s.carbonError===0));
});
