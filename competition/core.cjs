'use strict';
const assert = require('node:assert/strict');
const POLICY = Object.freeze({id:'carbon-arena-v05-championship-v1',rulesVersion:'0.5',initialRating:1500,k:32,
  provisionalChallenges:5,maps:3,matches:6,scoring:'two-map-wins-then-total-cash',ratingUnit:'six-match-challenge'});
function score(matches,seeds,ids) {
  assert.equal(ids.length,2); assert.notEqual(ids[0],ids[1]);
  assert.equal(seeds.length,3); assert.equal(new Set(seeds).size,3); assert.equal(matches.length,6);
  const totalCash=Object.fromEntries(ids.map(id=>[id,0])),seedWins={...totalCash};
  const pairs=seeds.map(seed=>{
    const pair=matches.filter(m=>m.seed===seed); assert.equal(pair.length,2,'Each map needs two matches');
    assert.notEqual(pair[0].colors.Red,pair[1].colors.Red,'Colors must swap');
    const cash=Object.fromEntries(ids.map(id=>[id,0]));
    for(const m of pair){assert.deepEqual(Object.values(m.colors).sort(),ids.slice().sort());
      for(const t of ['Red','Blue']){assert.ok(Number.isSafeInteger(m.cash[t])&&m.cash[t]>=0);cash[m.colors[t]]+=m.cash[t];}}
    for(const id of ids)totalCash[id]+=cash[id];
    const winner=cash[ids[0]]===cash[ids[1]]?null:cash[ids[0]]>cash[ids[1]]?ids[0]:ids[1];
    if(winner)seedWins[winner]++;
    return {seed,cash,winner};
  });
  const winner=ids.find(id=>seedWins[id]>=2) || (totalCash[ids[0]]===totalCash[ids[1]]?null:
    totalCash[ids[0]]>totalCash[ids[1]]?ids[0]:ids[1]);
  return {winner,seedWins,pairs,totalCash};
}
function elo(a,b,outcome){
  assert.ok([a,b].every(Number.isFinite));assert.ok([0,0.5,1].includes(outcome));
  const expected=1/(1+10**((b-a)/400)),change=POLICY.k*(outcome-expected);
  return {before:[a,b],after:[a+change,b-change],change,expected};
}
module.exports={POLICY,score,elo};
