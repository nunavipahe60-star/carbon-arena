'use strict';
// Public interface example. This is not a submitted contestant.
function decide(snapshot,team,memory){return {decision:{vehicles:snapshot.vehicles.filter(v=>v.team===team)
  .map(v=>({vehicle:v.id,action:'WAIT',priority:0})),purchases:[]},memory:{calls:(memory?memory.calls:0)+1}};}
