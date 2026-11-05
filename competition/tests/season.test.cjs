'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events');
const {schedule,mapScore,pairScore,standings}=require('../season-core.cjs');
const {SeasonStore}=require('../season-store.cjs');
const {freezeSeason,verifySeason,drawSix}=require('../season-runner.cjs');
const {Ledger,seedExclusions,id}=require('../ledger.cjs');
const {sha,writeNew}=require('../integrity.cjs');
const {serve}=require('../server.cjs');
const ids=['a','b','c'],seeds=[301,302,303,304,305,306];
function games(amount=(g,id)=>id===g.pair[0]?101:100){return schedule(ids,seeds).map(g=>({...g,cash:Object.fromEntries(['Red','Blue'].map(c=>[c,amount(g,g.colors[c])]))}));}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-season-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ledger=new Ledger(dir),store=new SeasonStore(dir);
  const entries=['Alpha','Beta','Gamma'].map(name=>ledger.register({name,model:'Public fixture',version:'test'},`function decide(){return {decision:{},memory:null};} // ${name}`));
  return {dir,ledger,store,input:{entries:entries.map(e=>e.id),confirmedFinalVersions:true}};
}
test('36 games share six distinct maps across all pairs with two colors and balanced rounds',()=>{
  const plan=schedule(ids,seeds);assert.equal(plan.length,36);assert.equal(new Set(plan.map(g=>g.directory)).size,36);
  for(const pair of [['a','b'],['a','c'],['b','c']]){
    const group=plan.filter(g=>g.pair.join()===pair.join());assert.equal(group.length,12);
    for(const seed of seeds){const both=group.filter(g=>g.seed===seed);assert.equal(both.length,2);assert.notEqual(both[0].colors.Red,both[1].colors.Red);}
    assert.equal(group.filter(g=>g.round===1).length,6);assert.equal(group.filter(g=>g.round===2).length,6);
    assert.equal(group[0].colors.Red,pair[0]);assert.equal(group[6].colors.Red,pair[1]);
  }
  for(const id of ids)assert.equal(plan.filter(g=>g.pair.includes(id)).length,24);
  assert.throws(()=>schedule(ids,[1,1,2,3,4,5]));assert.throws(()=>schedule(['a','a','b'],seeds));
});
test('six-map points outrank huge cash loss; no early stopping or round-win shortcut',()=>{
  const group=games((g,id)=>id===g.pair[0]?(g.map<=4?101:0):(g.map<=4?100:100000)).filter(g=>g.pair.join()==='a,b');
  const result=pairScore(group,seeds,['a','b']);assert.equal(result.winner,'a');assert.equal(result.points.a,4);assert.ok(result.totalCash.b>result.totalCash.a);
  assert.equal(result.maps.length,6);assert.throws(()=>pairScore(group.slice(0,6),seeds,['a','b']));
});
test('draws award half a point, equal pairing points use all-game cash, exact ties share rank',()=>{
  const tied=games(()=>100),result=standings(tied,seeds,ids,true);
  assert.deepEqual(result.table.map(r=>[r.points,r.cash,r.rank,r.draws,r.mapsPlayed]),[[6,2400,1,12,12],[6,2400,1,12,12],[6,2400,1,12,12]]);
  const first=tied.slice(0,2);assert.deepEqual(mapScore(first,seeds[0],['a','b']).points,{a:0.5,b:0.5});
  const mixed=games((g,id)=>id===g.pair[0]?(g.map<=3?110:100):(g.map<=3?100:101)).filter(g=>g.pair.join()==='a,b');
  const pair=pairScore(mixed,seeds,['a','b']);assert.deepEqual(pair.points,{a:3,b:3});assert.equal(pair.winner,'a');
});
test('season ranks by twelve-map points, then cash; cash from a half-finished map waits',()=>{
  const completed=standings(games(),seeds,ids,true);assert.deepEqual(completed.table.map(r=>[r.id,r.points,r.rank]),[['a',12,1],['b',6,2],['c',0,3]]);
  const half=standings(games().slice(0,1),seeds,ids);assert.ok(half.table.every(r=>r.cash===0&&r.points===0));
  const after=standings(games().slice(0,2),seeds,ids);assert.equal(after.table.find(r=>r.id==='a').cash,202);
  const cashTiebreak=games((g,id)=>g.map<=3?(id===g.pair[0]?200:100):(id===g.pair[1]?101:100));
  assert.deepEqual(standings(cashTiebreak,seeds,ids,true).table.map(r=>[r.id,r.points]),[['a',6],['b',6],['c',6]]);
});
test('duplicate games, substitutions, bad colors, unsafe cash and incomplete final results fail closed',()=>{
  for(const modify of [g=>g.splice(1,1,g[0]),g=>g[0].cash.Red=-1,g=>g[0].cash.Red=1.5,g=>g[0].cash.Red=Number.MAX_SAFE_INTEGER,g=>g[1].colors={...g[0].colors},g=>g[0].seed=1]){
    const g=games();modify(g);assert.throws(()=>standings(g,seeds,ids,true));
  }
  assert.throws(()=>standings(games().slice(0,35),seeds,ids,true));
});
test('freeze is permanent, draws after freeze, reserves shared seeds against later challenges, leaves legacy state intact',t=>{
  const {ledger,store,input}=fixture(t),before=ledger.read();
  assert.throws(()=>freezeSeason(ledger,store,{...input,confirmedFinalVersions:false}),/final versions/);
  const view=freezeSeason(ledger,store,input),dir=store.seasonDir(view.id);
  assert.equal(view.status,'ready');assert.equal(view.seeds.length,6);assert.deepEqual(ledger.read(),before);
  assert.ok(view.seeds.every(n=>seedExclusions(ledger).has(n)));
  const freeze=JSON.parse(fs.readFileSync(path.join(dir,'freeze.json'))),reserved=JSON.parse(fs.readFileSync(path.join(dir,'seeds.json')));
  assert.ok(freeze.createdAt<=reserved.selectedAt);assert.equal(reserved.freezeSHA256,view.freezeSHA256);
  assert.throws(()=>freezeSeason(ledger,store,input),/frozen roster/);verifySeason(ledger,store);
  assert.deepEqual(new SeasonStore(ledger.dir).view(),view);
});
test('frozen source, seed reservation and freeze integrity are checked before continuation',t=>{
  const {ledger,store,input}=fixture(t);freezeSeason(ledger,store,input);const state=store.read(),dir=store.seasonDir(state.id);
  for(const file of [path.join(dir,'freeze.json'),path.join(dir,'seeds.json'),path.join(dir,'sources',state.entries[0].sha256+'.js')]){
    const bytes=fs.readFileSync(file);fs.appendFileSync(file,' ');assert.throws(()=>verifySeason(ledger,store));fs.writeFileSync(file,bytes);verifySeason(ledger,store);
  }
});
test('interrupted running seasons pause with verified prefix retained and reject duplicate completion',t=>{
  const {ledger,store,input}=fixture(t);freezeSeason(ledger,store,input);let state=store.append('started',{});
  const plan=schedule(input.entries,state.seeds);
  const match={...plan[0],cash:{Red:100,Blue:100},determinism:'passed',independentVerification:'passed',evidenceSHA256:sha('fixture'),evidenceDirectory:plan[0].directory+'/attempt-1'};
  store.append('match-verified',{match});store.recover();state=store.read();assert.equal(state.status,'paused');assert.equal(state.matches.length,1);
  store.append('started',{});assert.throws(()=>store.append('match-verified',{match}));assert.throws(()=>store.append('completed',{result:{}}));
  store.append('paused',{error:'Public fixture pause'});assert.equal(store.read().matches.length,1);
});
test('all 36 verified games complete once; journal tampering and truncation fail closed',t=>{
  const {ledger,store,input}=fixture(t);freezeSeason(ledger,store,input);const started=store.append('started',{});
  for(const game of schedule(input.entries,started.seeds))store.append('match-verified',{match:{...game,cash:{Red:100,Blue:100},determinism:'passed',independentVerification:'passed',evidenceSHA256:sha('fixture'),evidenceDirectory:game.directory+'/attempt-1'}});
  const result=store.view().scores;result.final=true;store.append('completed',{result,completedAt:new Date().toISOString()});assert.equal(store.view().scores.final,true);
  assert.throws(()=>store.append('completed',{result}));const raw=fs.readFileSync(store.file,'utf8');
  fs.writeFileSync(store.file,raw.replace('Alpha','Tampered'));assert.throws(()=>store.read(),/hash mismatch/);
  fs.writeFileSync(store.file,raw.trimEnd());assert.throws(()=>store.read(),/Incomplete/);
});
test('crash after saved draw recovers the same six seeds without rerolling; orphan season seeds stay excluded',t=>{
  const {ledger,store,input}=fixture(t);freezeSeason(ledger,store,input);const ready=store.read();
  const lines=fs.readFileSync(store.file,'utf8').split('\n');fs.writeFileSync(store.file,lines[0]+'\n');store.recover();assert.deepEqual(store.read().seeds,ready.seeds);
  writeNew(path.join(store.seasonDir(id()),'seeds.json'),{seeds:[901,902,903,904,905,906]});assert.ok(seedExclusions(ledger).has(906));
  const values=[0,1,1,2,3,4,5,6,7];assert.deepEqual(drawSix(new Set([1]),()=>values.shift()),[2,3,4,5,6,7]);assert.throws(()=>drawSix(new Set([1]),()=>1),/fresh maps/);
});
test('season HTTP requires request token and local origin, exposes metadata and verified evidence only',async t=>{
  const {dir,input}=fixture(t),app=serve({dataDir:dir,port:0});await once(app.server,'listening');
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=async route=>fetch(base+route),state=await (await get('/api/season-two')).json();assert.equal(state.status,'awaiting-roster');
  const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Arena-Token':state.token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await post('/api/season-two/freeze',input,{'X-Arena-Token':'wrong'})).status,403);
  assert.equal((await post('/api/season-two/freeze',input,{Origin:'https://example.invalid'})).status,403);
  assert.equal((await post('/api/season-two/freeze',{...input,confirmedFinalVersions:false})).status,400);
  assert.equal((await post('/api/season-two/freeze',input)).status,201);assert.equal((await post('/api/season-two/freeze',input)).status,400);
  for(const route of ['/season-two','/season-two.js','/season-two.css','/api/season-two/freeze.json','/api/season-two/seeds.json'])assert.equal((await get(route)).status,200,route);
  for(const route of ['/api/season-two/result.json','/api/season-two/matches/0/replay.json','/api/season-two/sources/source.js','/api/season-two/matches/0/strategy-calls.json','/api/season-two/events.jsonl'])assert.equal((await get(route)).status,404,route);
  assert.equal(app.ledger.read().challenges.length,0);
});
