'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine.js'),old=require('../../tests/fixtures/engine-v04.js'),V=require('./tree-vectors.cjs');
test('rulebook vector 1: zero-ground generation timing and final production',()=>V.timing(true));
test('rulebook vector 2: seed-1 real-map storage and expiry pile',()=>V.timing(false));
test('rulebook vector 3: cap ten rejects the eleventh planting without charge',()=>V.cap(false));
test('rulebook vector 4: a slot opens only after expiry, permitting next-turn replacement',()=>V.cap(true));
test('working trees generate in ascending ID order before every expiry, after pickup and absorption',()=>{
  const s=E.create(1);s.ground.fill(0);
  s.vehicles=[{team:'Red',id:1,type:'collector',x:1,y:1,cargo:0,born:0}];
  s.trees=[{id:9,team:'Blue',x:3,y:1,storage:0,remaining:1,planted:0},
    {id:2,team:'Red',x:1,y:1,storage:0,remaining:1,planted:0}];
  s.ground[E.index(2,1)]=10;s.initialCarbon=10;s.history=[E.summarize(s)];
  E.resolve(s,{Red:{vehicles:[{vehicle:1,action:'PICKUP'}]}});
  assert.equal(s.vehicles[0].cargo,0);
  const gen=s.events.filter(e=>e.type==='tree_generation'),abs=s.events.filter(e=>e.type==='absorption'),exp=s.events.filter(e=>e.type==='expiry');
  assert.deepEqual(gen.map(e=>e.tree),[2,9]);assert.deepEqual(exp.map(e=>e.tree),[2,9]);
  assert.ok(Math.max(...abs.map(e=>e.seq))<gen[0].seq);
  assert.ok(gen.at(-1).seq<exp[0].seq);assert.deepEqual(exp.map(e=>e.amount),[7,7]);
  assert.equal(s.treeGeneratedCarbon,8);assert.deepEqual(E.summarize(s).treeGeneratedByTeam,{Red:4,Blue:4});
  assert.equal(E.summarize(s).carbonError,0);
});
test('generation is available to later pickups and does not depend on ground or storage',()=>{
  const f=V.setup(true);V.step(f,'MOVE_RIGHT');V.step(f,'MOVE_RIGHT');V.step(f,'PLANT');
  const s=f.state;const c=s.vehicles.find(v=>v.team==='Red'&&v.id===3);c.x=11;c.y=9;
  E.resolve(s,{Red:{vehicles:[{vehicle:3,action:'PICKUP'}]}});
  assert.equal(c.cargo,0);assert.equal(s.trees[0].storage,4);
  E.resolve(s,{Red:{vehicles:[{vehicle:3,action:'PICKUP'}]}});
  assert.equal(c.cargo,4);assert.equal(s.trees[0].storage,4);
  const m=E.summarize(s);assert.equal(m.regenerated,221);assert.equal(m.treeGenerated,8);assert.equal(m.carbonError,0);
});
test('snapshots, summaries and audits expose version, actual settings and separate sources without aliasing',()=>{
  const f=V.timing(true),s=f.state,snap=E.snapshot(s),audit=E.audit(s),m=E.summarize(s);
  assert.equal(snap.rulesVersion,'0.5');assert.equal(snap.settings.treeLimit,10);assert.equal(snap.settings.treeGeneration,4);
  assert.equal(snap.settings.plantingCost,20);assert.equal(snap.settings.treeLife,50);
  assert.equal(m.treeGenerated,200);assert.equal(m.regenerated,s.events.filter(e=>e.type==='regeneration').reduce((n,e)=>n+e.amount,0));
  assert.equal(audit.rulesVersion,'0.5');assert.equal(audit.turnSummaries.at(-1).treeGenerated,200);
  assert.equal(snap.eventHistory.filter(e=>e.type==='tree_generation').length,50);
  assert.equal(snap.treeGeneratedCarbon,undefined);snap.settings.treeGeneration=999;snap.eventHistory.length=0;
  assert.equal(s.settings.treeGeneration,4);assert.ok(s.events.length>0);
});
test('v0.5 replays require recorded settings and reject v0.4 without changing the old resolver',()=>{
  const f=V.timing(false),s=f.state;
  const r={format:'carbon-arena-replay-v1',rulesVersion:'0.5',generator:E.GENERATOR,coordinateSystem:'zero-based-xy',seed:1,settings:s.settings,decisions:f.decisions};
  assert.deepEqual(E.replay(r),s);assert.equal(E.replay(r,3).treeGeneratedCarbon,0);
  assert.equal(E.replay(r,4).treeGeneratedCarbon,4);
  const missing=E.clone(r);delete missing.settings.treeGeneration;assert.throws(()=>E.replay(missing),/every actual/);
  assert.throws(()=>E.replay({...r,rulesVersion:'0.4'}),/Rules 0.4 replay is not supported/);
  assert.throws(()=>old.replay(r),/Unsupported/);
  assert.equal(old.VERSION,'0.4');assert.equal(old.DEFAULTS.treeLimit,8);
});
test('tree lifetime is fixed and generation settings reject invalid values',()=>{
  for(const value of [-1,1.5,NaN,Infinity,'4'])assert.throws(()=>E.create(1,{treeGeneration:value}),/Invalid setting/);
  assert.throws(()=>E.create(1,{treeLife:49}),/Invalid setting/);
  assert.equal(E.create(1,{treeGeneration:0}).settings.treeGeneration,0);
});
test('same-phase planting counts the first success immediately and caps each team independently',()=>{
  const s=E.create(1);s.ground.fill(0);s.initialCarbon=0;
  s.vehicles=[{team:'Red',id:4,type:'planter',x:1,y:2,cargo:0,born:0},
    {team:'Red',id:5,type:'planter',x:2,y:2,cargo:0,born:0},
    {team:'Blue',id:4,type:'planter',x:3,y:2,cargo:0,born:0}];
  s.trees=E.TEAMS.flatMap((team,row)=>Array.from({length:9},(_,i)=>({id:row*9+i+1,team,x:i,y:row,storage:0,remaining:50,planted:0})));
  s.nextTreeId=19;s.history=[E.summarize(s)];
  E.resolve(s,{Red:{vehicles:[{vehicle:4,action:'PLANT',priority:2},{vehicle:5,action:'PLANT',priority:1}]},Blue:{vehicles:[{vehicle:4,action:'PLANT'}]}});
  assert.equal(s.trees.filter(t=>t.team==='Red').length,10);assert.equal(s.trees.filter(t=>t.team==='Blue').length,10);
  assert.equal(s.teams.Red.cash,80);assert.equal(s.teams.Blue.cash,80);
  assert.deepEqual(s.events.filter(e=>e.type==='plant').map(e=>[e.team,e.vehicle]),[['Red',5],['Blue',4]]);
  assert.equal(s.treeGeneratedCarbon,18*4);assert.equal(E.summarize(s).carbonError,0);
});
test('rate-zero/cap-eight replay retains v0.4 physical outcomes and event stream',()=>{
  // Build a disposable public fixture, independent of any historical match.
  const fixture=old.create(1),decisions=[];
  while(!fixture.ended){
    const d=Object.fromEntries(old.TEAMS.map(team=>[team,{vehicles:fixture.vehicles.filter(v=>v.team===team).map(v=>({vehicle:v.id,action:['MOVE_RIGHT','MOVE_DOWN','HARVEST','PLANT','PICKUP','WAIT'][((fixture.turn>>1)+v.id)%6]})),purchases:fixture.turn%11===0?[{headquarters:'HQ1',vehicleType:'collector'}]:[]}]));
    decisions.push(old.resolve(fixture,d).decisions);
  }
  const baseline={seed:1,settings:fixture.settings,decisions};
  const a=old.create(baseline.seed,baseline.settings),b=E.create(baseline.seed,{...baseline.settings,treeGeneration:0});
  for(const d of baseline.decisions){old.resolve(a,d);E.resolve(b,d);
    for(const key of ['ground','vehicles','trees','events','generatedCarbon','soldCarbon','ended','winner'])assert.deepEqual(b[key],a[key]);
    for(const team of E.TEAMS)for(const key of Object.keys(a.teams[team]))assert.equal(b.teams[team][key],a.teams[team][key]);
    assert.equal(E.summarize(b).carbonError,0);
  }
  assert.equal(b.turn,300);assert.equal(b.treeGeneratedCarbon,0);
});
