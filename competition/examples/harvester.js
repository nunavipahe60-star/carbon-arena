'use strict';
// Public practice example. This is not a submitted contestant.
function decide(snapshot,team,memory){
  const homes=team==='Red'?[[4,4],[9,9]]:[[9,4],[4,9]];
  const distance=(x,y,a,b)=>Math.min((x-a+15)%15,(a-x+15)%15)+Math.min((y-b+15)%15,(b-y+15)%15);
  function move(v,target){let best='WAIT',value=distance(v.x,v.y,...target);
    for(const [action,dx,dy]of [['MOVE_UP',0,-1],['MOVE_RIGHT',1,0],['MOVE_DOWN',0,1],['MOVE_LEFT',-1,0]]){
      const d=distance((v.x+dx+15)%15,(v.y+dy+15)%15,...target);if(d<value){value=d;best=action;}}
    return best;
  }
  return {decision:{vehicles:snapshot.vehicles.filter(v=>v.team===team).map(v=>{
    const home=homes.slice().sort((a,b)=>distance(v.x,v.y,...a)-distance(v.x,v.y,...b))[0];let action='WAIT';
    if(v.type==='collector'){
      if(v.cargo>=60)action=move(v,home);
      else if(snapshot.ground[v.y*15+v.x]>0&&!homes.some(h=>h[0]===v.x&&h[1]===v.y))action='HARVEST';
      else action=move(v,[(home[0]+(v.id%2?1:14))%15,(home[1]+(v.id===3?1:0))%15]);
    }
    return {vehicle:v.id,action,priority:v.id};
  }),purchases:[]},memory:{calls:(memory?memory.calls:0)+1}};
}
