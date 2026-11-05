'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const E=require('../engine.js'), S=require('../strategies.js');
const v=(team,id,x,y,cargo=0,type='collector')=>({team,id,x:x-1,y:y-1,cargo,type,born:0});
function fixture(vehicles=[],trees=[],ground={}){
  const s=E.create(1);s.ground.fill(0);s.vehicles=vehicles;s.trees=trees;
  for(const [cell,amount] of Object.entries(ground)){const [x,y]=cell.split(',').map(Number);s.ground[E.index(x-1,y-1)]=amount;}
  s.initialCarbon=E.carbonTotal(s);
  for(const t of E.TEAMS)s.teams[t].nextId=Math.max(4,...vehicles.filter(v=>v.team===t).map(v=>v.id))+1;
  s.nextTreeId=Math.max(0,...trees.map(t=>t.id))+1;s.history=[E.summarize(s)];return s;
}
const tree=(id,team,x,y,storage=0,remaining=50)=>({id,team,x:x-1,y:y-1,storage,remaining,planted:0});
const decision=(entries=[],purchases=[])=>({vehicles:entries.map(([vehicle,action,priority=0])=>({vehicle,action,priority})),purchases});
function check(s){
  assert.equal(E.carbonTotal(s),s.initialCarbon+s.generatedCarbon+s.treeGeneratedCarbon);
  assert.equal(s.history.at(-1).carbonError,0);
  for(const t of E.TEAMS){assert.equal(s.teams[t].cash,100+s.teams[t].sold-s.teams[t].spent);assert.ok(s.vehicles.filter(v=>v.team===t).length<=s.settings.fleetLimit);}
  for(const n of [...s.ground,...s.vehicles.map(v=>v.cargo),...s.trees.map(t=>t.storage)])assert.ok(Number.isSafeInteger(n)&&n>=0);
}
test('generator reference seeds, groups, reflection and protected bases',()=>{
  for(const [seed,total,cells] of [[1,10783,[93,30,39,45,45]],[12345,10913,[56,67,14,16,87]],[0,12112,[48,12,1,46,76]]]){
    const g=E.generate(seed);assert.equal(g.groups,64);assert.equal(g.samples,63);assert.equal(g.ground.reduce((a,b)=>a+b,0),total);
    assert.deepEqual([[1,1],[2,1],[1,2],[8,8],[15,15]].map(([x,y])=>g.ground[E.index(x-1,y-1)]),cells);
    for(let x=0;x<15;x++)for(let y=0;y<15;y++)assert.equal(g.ground[E.index(x,y)],g.ground[E.index(E.mod(13-x),E.mod(13-y))]);
    for(const bases of Object.values(E.HQ))for(const [x,y] of bases)assert.equal(g.ground[E.index(x,y)],0);
  }
});
test('both rejection paths exclude the boundary and maximum and advance again',()=>{
  for(const [seed,first,second] of [[0xA4D939CC,4294967228,17270968],[0x5E6CFCE7,4294967295,253983]]){
    assert.equal(E.xorshift(seed),first);assert.equal(E.xorshift(first),second);
    const g=E.generate(seed);assert.equal(g.ground[0],69);assert.ok(g.rejections>=1);
  }
});
test('collection remainder rotation, cap and leftovers',()=>{
  assert.deepEqual([...E.allocate([2,5,7],40,15,1).values()],[14,13,13]);
  assert.deepEqual([...E.allocate([2,5,7],40,15,2).values()],[13,14,13]);
  assert.deepEqual([...E.allocate([2,5,7],40,15,3).values()],[13,13,14]);
  assert.deepEqual([...E.allocate([2,5,7],44,15,1).values()],[15,15,14]);
  for(const amount of [40,44,100]){
    const s=fixture([2,5,7].map(id=>v('Red',id,8,8)),[],{'8,8':amount});
    E.resolve(s,{Red:decision([[2,'HARVEST'],[5,'HARVEST'],[7,'HARVEST']])});
    assert.equal(s.vehicles.reduce((a,v)=>a+v.cargo,0),Math.min(45,amount));assert.equal(s.ground[E.index(7,7)],Math.max(0,amount-45));check(s);
  }
});
test('lighter vehicle takes cargo; equal cargo drops; stacked totals govern',()=>{
  for(const [cargo,expected] of [[5,433],[428,856]]){
    const s=fixture([v('Red',1,8,8,cargo),v('Blue',1,8,8,428)]);E.resolve(s,{});check(s);
    if(cargo===5){assert.equal(s.vehicles[0].team,'Red');assert.equal(s.vehicles[0].cargo,expected);}else{assert.equal(s.vehicles.length,0);assert.equal(s.ground[E.index(7,7)],expected);}
  }
  const s=fixture([v('Red',1,8,8,100),v('Blue',1,8,8,60),v('Blue',2,8,8,60)]);E.resolve(s,{});assert.equal(s.vehicles[0].cargo,220);assert.equal(s.vehicles.length,1);check(s);
});
test('winning stacked vehicles keep their own cargo and split stolen cargo by rotation',()=>{
  for(const [turn,expected] of [[1,[15,15,16]],[2,[14,16,16]],[3,[14,15,17]]]){
    const s=fixture([v('Red',2,8,8,1),v('Red',5,8,8,2),v('Red',7,8,8,3),v('Blue',1,8,8,40)]);
    s.turn=turn-1;s.history=[E.summarize(s)];
    E.resolve(s,{});assert.deepEqual(s.vehicles.map(v=>v.cargo),expected);check(s);
  }
});
test('five effective hunters cover five endpoints; swaps do not add collisions',()=>{
  const starts=[[8,6],[10,8],[8,10],[6,8],[8,7]], moves=['MOVE_DOWN','MOVE_LEFT','MOVE_UP','MOVE_RIGHT','MOVE_DOWN'];
  for(const action of ['MOVE_UP','MOVE_RIGHT','MOVE_DOWN','MOVE_LEFT','WAIT']){
    const s=fixture([v('Red',1,8,8,100),...starts.map(([x,y],i)=>v('Blue',i+1,x,y))]);
    E.resolve(s,{Red:decision([[1,action]]),Blue:decision(moves.map((a,i)=>[i+1,a]))});
    assert.equal(s.vehicles.filter(v=>v.team==='Red').length,0);assert.equal(s.events.filter(e=>e.type==='theft').length,1);
    assert.equal(s.vehicles.filter(v=>v.cargo===100).length,1);check(s);
  }
  for(const action of ['MOVE_DOWN','MOVE_LEFT']){
    const s=fixture([v('Red',1,8,8,100),v('Blue',1,8,6),v('Blue',2,10,8),v('Blue',5,8,7)]);
    E.resolve(s,{Red:decision([[1,action]]),Blue:decision([[1,'MOVE_DOWN'],[2,'MOVE_LEFT'],[5,'MOVE_DOWN']])});assert.equal(s.vehicles.length,4);check(s);
  }
});
test('headquarters protection, delivery once and wrapping',()=>{
  const s=fixture([v('Red',1,5,6,100),v('Blue',1,4,5)]);
  E.resolve(s,{Red:decision([[1,'MOVE_UP']]),Blue:decision([[1,'MOVE_RIGHT']])});
  assert.equal(s.teams.Red.cash,200);assert.equal(s.vehicles.find(v=>v.team==='Blue').x,3);
  E.resolve(s,{});assert.equal(s.teams.Red.cash,200);check(s);
  const w=fixture([v('Red',1,15,1)]);E.resolve(w,{Red:decision([[1,'MOVE_RIGHT']])});assert.equal(w.vehicles[0].x,0);
  E.resolve(w,{Red:decision([[1,'MOVE_UP']])});assert.equal(w.vehicles[0].y,14);check(w);
});
test('empty escort trades away from carrier; stacking cannot protect a load',()=>{
  const s=fixture([v('Red',1,8,8),v('Blue',1,8,8)]);E.resolve(s,{});assert.equal(s.vehicles.length,0);check(s);
  const stack=fixture([v('Red',1,8,8,100),v('Red',2,8,8),v('Blue',1,8,8)]);E.resolve(stack,{});assert.equal(stack.vehicles.length,1);assert.equal(stack.vehicles[0].team,'Blue');assert.equal(stack.vehicles[0].cargo,100);check(stack);
});
test('movement does not harvest; pickup occurs after collision and before absorption',()=>{
  const m=fixture([v('Red',1,7,8)],[],{'8,8':100});E.resolve(m,{Red:decision([[1,'MOVE_RIGHT']])});assert.equal(m.vehicles[0].cargo,0);check(m);
  const s=fixture([v('Red',1,8,8),v('Blue',1,8,7)],[tree(1,'Red',8,8,90)]);
  E.resolve(s,{Red:decision([[1,'PICKUP']]),Blue:decision([[1,'MOVE_DOWN']])});assert.equal(s.vehicles.length,0);assert.equal(s.trees[0].storage,94);assert.equal(s.events.filter(e=>e.type==='pickup').length,0);check(s);
  const p=fixture([v('Red',1,8,8),v('Red',2,8,8)],[tree(1,'Red',8,8,40)]);
  E.resolve(p,{Red:decision([[1,'PICKUP'],[2,'PICKUP']])});assert.deepEqual(p.vehicles.map(v=>v.cargo),[20,20]);assert.equal(p.trees[0].storage,4);check(p);
  const escape=fixture([v('Red',1,8,8,30),v('Blue',1,8,7)]);E.resolve(escape,{Red:decision([[1,'MOVE_DOWN']]),Blue:decision([[1,'MOVE_DOWN']])});assert.equal(escape.vehicles.length,2);check(escape);
});
test('working trees share sources equally with leftovers, including last-turn trees',()=>{
  for(const [count,carbon,absorbed,left] of [[2,5,2,1],[4,3,0,3]]){
    const positions=[[7,8],[9,8],[8,7],[8,9]],trees=positions.slice(0,count).map(([x,y],i)=>tree(i+1,i%2?'Blue':'Red',x,y,0,50));
    const s=fixture([],trees,{'8,8':carbon});E.resolve(s,{});assert.deepEqual(s.trees.map(t=>t.storage),Array(count).fill(absorbed+4));assert.equal(s.ground[E.index(7,7)],left);check(s);
  }
  const last=fixture([],[tree(1,'Red',7,8,0,1),tree(2,'Blue',9,8,0,50)],{'8,8':5});E.resolve(last,{});assert.equal(last.trees[0].storage,6);assert.equal(last.ground[E.index(6,7)],6);assert.equal(last.ground[E.index(7,7)],1);check(last);
});
test('new tree waits until next turn, works exactly 50 times, then releases storage',()=>{
  const s=fixture([v('Red',4,8,8,0,'planter')],[],{'7,8':100,'9,8':100,'8,7':100,'8,9':100});
  E.resolve(s,{Red:decision([[4,'PLANT']])});assert.equal(s.trees[0].storage,0);assert.equal(s.trees[0].remaining,50);assert.equal(s.teams.Red.cash,80);
  E.resolve(s,{Red:decision([[4,'PLANT']])});assert.equal(s.teams.Red.cash,80);assert.equal(s.trees[0].remaining,49);
  while(s.turn<50)E.resolve(s,{});assert.equal(s.trees.length,1);assert.equal(s.trees[0].remaining,1);
  E.resolve(s,{});assert.equal(s.trees.length,0);assert.equal(s.events.filter(e=>e.type==='expiry').length,1);assert.equal(s.events.filter(e=>e.type==='expiry')[0].turn,51);check(s);
});
test('expiry cannot be absorbed during release phase; an enemy tree siphons next turn',()=>{
  const s=fixture([],[tree(1,'Red',8,8,30,1),tree(2,'Blue',9,8,0,50)]);E.resolve(s,{});
  assert.equal(s.trees[0].storage,4);assert.equal(s.ground[E.index(7,7)],34);
  E.resolve(s,{});assert.equal(s.trees[0].storage,11);assert.equal(s.ground[E.index(7,7)],31);check(s);
});
test('pre-sale planting cannot borrow; post-sale purchases use actual cash and spawn at base',()=>{
  const s=fixture([v('Red',1,5,5,100),v('Red',4,8,8,0,'planter')]);s.teams.Red.cash=0;s.teams.Red.spent=100;
  E.resolve(s,{Red:decision([[4,'PLANT']], [{headquarters:'HQ2',vehicleType:'collector'}])});
  assert.equal(s.trees.length,0);assert.equal(s.teams.Red.cash,60);
  const fresh=s.vehicles.find(v=>v.id===5);assert.equal(fresh.x,9);assert.equal(fresh.y,9);assert.equal(fresh.cargo,0);assert.equal(fresh.born,1);check(s);
});
test('collision loss frees a same-turn fleet slot; only one of two purchases succeeds',()=>{
  const vs=Array.from({length:10},(_,i)=>v('Red',i+1,i===0?8:5,i===0?8:5,i===0?20:0));vs.push(v('Blue',1,8,8));
  const s=fixture(vs);E.resolve(s,{Red:decision([],[{headquarters:'HQ1',vehicleType:'collector'},{headquarters:'HQ2',vehicleType:'collector'}])});
  assert.equal(s.vehicles.filter(v=>v.team==='Red').length,10);assert.equal(s.events.filter(e=>e.type==='purchase').length,1);assert.equal(s.events.find(e=>e.type==='purchase_rejected').reason,'fleet_limit');check(s);
});
test('destroyed delivery cannot fund a purchase; cash rejection charges nothing',()=>{
  const s=fixture([v('Red',1,5,6,100),v('Blue',1,4,6)]);
  s.teams.Red.cash=0;s.teams.Red.spent=100;
  E.resolve(s,{Red:decision([[1,'WAIT']],[{headquarters:'HQ1',vehicleType:'collector'}]),Blue:decision([[1,'MOVE_RIGHT']])});
  assert.equal(s.teams.Red.cash,0);assert.equal(s.teams.Red.spent,100);
  assert.equal(s.events.filter(e=>e.type==='sale'&&e.team==='Red').length,0);
  assert.equal(s.events.filter(e=>e.type==='purchase'&&e.team==='Red').length,0);
  assert.equal(s.events.find(e=>e.type==='purchase_rejected').reason,'cash');check(s);
});
test('priorities are explicit; duplicate and invalid requests become waits or are discarded',()=>{
  const s=fixture([v('Red',1,8,8),v('Red',4,7,7,0,'planter')],[],{'8,8':100});
  E.resolve(s,{Red:{vehicles:[{vehicle:1,action:'HARVEST'},{vehicle:1,action:'HARVEST'},{vehicle:4,action:'HARVEST'}],purchases:[{headquarters:'HQ1',vehicleType:'collector'},{headquarters:'HQ1',vehicleType:'collector'}]}});assert.equal(s.vehicles[0].cargo,0);assert.equal(s.vehicles.length,2);check(s);
  const p=fixture([v('Red',4,8,8,0,'planter'),v('Red',5,9,9,0,'planter')]);p.teams.Red.cash=20;p.teams.Red.spent=80;
  E.resolve(p,{Red:decision([[4,'PLANT',10],[5,'PLANT',0]])});assert.equal(p.trees.length,1);assert.equal(p.trees[0].x,8);check(p);
});
test('regeneration respects ceiling, excess drops and headquarters',()=>{
  const s=fixture([],[],{'8,8':101,'7,7':99});s.turn=4;E.resolve(s,{});
  assert.equal(s.ground[E.index(7,7)],101);assert.equal(s.ground[E.index(6,6)],100);
  for(const bases of Object.values(E.HQ))for(const [x,y] of bases)assert.equal(s.ground[E.index(x,y)],0);check(s);
});
test('per-vehicle budget slices do not starve later vehicles',()=>{
  const s=E.snapshot(E.create(1)),r=S.decide(s,'Red','balanced',5,{budget:20});
  assert.ok(r.metrics.expanded<=20);for(const m of Object.values(r.metrics.perVehicle))assert.ok(m.expanded<=m.limit);
  assert.ok(r.metrics.perVehicle[4].limit>0);assert.equal(r.decision.vehicles.length,4);
  assert.deepEqual(S.decide(s,'Red','balanced',5,{budget:20}),r);
});
test('full matches conserve carbon and cash; identical runs and replays agree exactly',()=>{
  for(const seed of [1,12345,0,0xA4D939CC,0x5E6CFCE7]){
    const a=E.create(seed),b=E.create(seed),decisions=[];
    while(!a.ended){const snap=E.snapshot(a),d={Red:S.decide(snap,'Red','balanced',4).decision,Blue:S.decide(snap,'Blue','hunter',4).decision};
      const r=E.resolve(a,d);E.resolve(b,d);decisions.push(r.decisions);check(a);}
    assert.equal(a.turn,300);assert.deepEqual(a,b);
    const record={format:'carbon-arena-replay-v1',rulesVersion:E.VERSION,generator:E.GENERATOR,coordinateSystem:'zero-based-xy',seed,settings:a.settings,decisions};
    assert.deepEqual(E.replay(record),a);
    assert.ok(a.soldCarbon>0);assert.ok(a.events.some(e=>e.type==='plant'));assert.ok(a.events.some(e=>e.type==='expiry'));
  }
});
test('winner counts cash only; stopped matches do not advance',()=>{
  const s=fixture([v('Red',1,8,8,1000),v('Blue',1,9,9)]);s.turn=299;s.teams.Blue.cash=110;s.teams.Blue.sold=10;s.soldCarbon=10;s.initialCarbon+=10;
  E.resolve(s,{});assert.equal(s.winner,'Blue');assert.equal(s.ended,true);E.resolve(s,{});assert.equal(s.turn,300);check(s);
});
test('invalid replays are rejected',()=>{assert.throws(()=>E.replay({format:'other'}));});
test('loss causes link each death to one encounter, including stacked ties and theft',()=>{
  const s=fixture([v('Red',1,2,2),v('Red',2,2,2),v('Blue',1,2,2),
    v('Red',3,3,3,10),v('Blue',2,3,3,10),
    v('Red',4,8,8,100),v('Blue',3,8,8,60),v('Blue',4,8,8,60)]);
  E.resolve(s,{});check(s);
  const m=s.history.at(-1);
  assert.deepEqual(m.losses,{empty_tie:3,cargo_tie:2,theft:2});
  assert.deepEqual(m.collisions,{empty_tie:1,cargo_tie:1,theft:1});
  assert.deepEqual(m.lossesByTeam.Red,{empty_tie:2,cargo_tie:1,theft:0});
  assert.equal(m.ground,20);assert.equal(m.inTransit,220);
  for(const e of s.events.filter(e=>e.type==='destroy')){
    const encounter=s.events[e.collisionEvent];assert.equal(encounter.seq,e.collisionEvent);
    assert.deepEqual(encounter.cell,e.cell);assert.ok(encounter.sources.some(v=>v.team===e.team&&v.vehicle===e.vehicle));
    assert.equal(encounter.type,e.cause==='theft'?'theft':'drop');
  }
  assert.deepEqual(s.events.find(e=>e.type==='theft').teamCargo,{Red:100,Blue:120});
});
test('audit includes turn zero and reproduces every summary and event without aliasing',()=>{
  const s=E.create(1),decisions=[];
  for(let i=0;i<6;i++)decisions.push(E.resolve(s,{Red:decision([[1,'MOVE_UP'],[2,'HARVEST']])}).decisions);
  const record={format:'carbon-arena-replay-v1',rulesVersion:E.VERSION,generator:E.GENERATOR,coordinateSystem:'zero-based-xy',seed:1,settings:s.settings,decisions};
  const audit=E.audit(s);assert.equal(audit.turnSummaries.length,7);
  assert.deepEqual(E.audit(E.replay(record)),audit);
  for(const h of audit.turnSummaries){assert.equal(h.ground+h.stored+h.inTransit+h.sold,h.initial+h.regenerated+h.treeGenerated);assert.equal(h.carbonError,0);}
  const partial=E.audit(E.replay(record,3));assert.equal(partial.throughTurn,3);assert.equal(partial.turnSummaries.length,4);assert.ok(partial.events.every(e=>e.turn<=3));
  audit.turnSummaries[0].ground=0;audit.events.length=0;
  assert.equal(s.history[0].ground,10783);assert.ok(s.events.length>0);
});
test('strategy failure discards partial submissions and remains reproducible in replay',()=>{
  const s=E.create(1),r=E.resolve(s,{Red:{failure:'fixture exception',vehicles:[{vehicle:1,action:'MOVE_UP'}],purchases:[{headquarters:'HQ1',vehicleType:'collector'}]}});
  assert.equal(s.vehicles.find(v=>v.team==='Red'&&v.id===1).y,4);assert.equal(s.teams.Red.cash,100);
  assert.equal(s.events[0].type,'strategy_failure');assert.equal(s.events[0].message,'fixture exception');
  assert.deepEqual(E.replay({format:'carbon-arena-replay-v1',rulesVersion:E.VERSION,generator:E.GENERATOR,coordinateSystem:'zero-based-xy',seed:1,settings:s.settings,decisions:[r.decisions]}),s);check(s);
});
