'use strict';
const assert=require('node:assert/strict');
const E=require('../engine.js');
function setup(zero=false,cash=100){
  const s=E.create(1);
  if(zero){s.ground.fill(0);s.initialCarbon=0;}
  s.teams.Red.cash=cash;s.history=[E.summarize(s)];
  return {state:s,decisions:[],states:[E.clone(s)],initialGround:s.ground.slice(),initialCash:cash};
}
function step(f,action='WAIT'){
  const r=E.resolve(f.state,{Red:{vehicles:[{vehicle:4,action}]}});
  f.decisions.push(r.decisions);
  const m=E.summarize(f.state);
  assert.equal(m.carbonError,0);
  assert.equal(m.totalAccounted,m.initial+m.regenerated+m.treeGenerated);
  assert.equal(m.treeGenerated,m.treeGeneratedByTeam.Red+m.treeGeneratedByTeam.Blue);
  // Compact snapshots are sufficient for cross-resolver verification; no strategy is rerun.
  f.states.push({snapshot:E.snapshot(f.state),summary:m});
}
function timing(zero){
  const f=setup(zero),s=f.state,storage={};
  for(let turn=1;turn<=53;turn++){
    step(f,turn<=2?'MOVE_RIGHT':turn===3?'PLANT':'WAIT');
    if([3,4,5,6,52].includes(turn))storage[turn]=s.trees[0].storage;
    if(turn===3)assert.equal(s.teams.Red.cash,80);
  }
  const e=s.events.find(e=>e.type==='expiry');
  assert.equal(e.turn,53);assert.equal(s.treeGeneratedCarbon,200);
  if(zero){assert.deepEqual(storage,{3:0,4:4,5:8,6:16,52:236});assert.equal(e.amount,240);}
  else {assert.equal(storage[4],16);assert.equal(storage[52],502);assert.equal(e.amount,506);assert.equal(s.ground[E.index(11,9)],539);}
  f.expected={storage,expiryTurn:e.turn,expiryAmount:e.amount,treeGenerated:200,finalGroundAtPlant:s.ground[E.index(11,9)]};
  return f;
}
function cap(continueToExpiry=false){
  const f=setup(true,1000),s=f.state;
  for(let turn=1;turn<=24;turn++)step(f,turn<=2?'MOVE_DOWN':turn%2?'MOVE_RIGHT':'PLANT');
  assert.deepEqual(s.events.filter(e=>e.type==='plant').map(e=>e.turn),[4,6,8,10,12,14,16,18,20,22]);
  assert.equal(s.trees.length,10);assert.equal(s.teams.Red.spent,200);assert.equal(s.teams.Red.cash,800);
  if(continueToExpiry){
    while(s.turn<52)step(f);
    step(f,'MOVE_RIGHT');step(f,'PLANT');
    assert.equal(s.trees.length,9);assert.equal(s.teams.Red.cash,800);assert.equal(s.events.find(e=>e.type==='expiry').turn,54);
    step(f,'PLANT');assert.equal(s.trees.length,10);assert.equal(s.teams.Red.cash,780);
  }
  f.expected={plantingsThroughTurn24:10,spendingThroughTurn24:200,turn24Rejected:true,
    ...(continueToExpiry?{turn54Rejected:true,turn55Accepted:true}:{})};
  return f;
}
module.exports={setup,step,timing,cap};
