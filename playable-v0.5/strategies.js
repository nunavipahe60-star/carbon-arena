(function(root){
  'use strict';
  const E=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.CarbonArena;
  const PRESETS={balanced:{name:'Balanced',load:75,trees:5,hunters:0},grove:{name:'Tree economy',load:90,trees:8,hunters:0},hunter:{name:'Interception',load:60,trees:3,hunters:3}};
  const VERSION='bundled-beam-v1', BUDGET=10000;
  const MOVES=['MOVE_UP','MOVE_RIGHT','MOVE_DOWN','MOVE_LEFT'];
  function nearestHome(v){return E.HQ[v.team].map(([x,y])=>({x,y})).sort((a,b)=>E.distance(v,a)-E.distance(v,b))[0];}
  function danger(s,v){
    if(E.isHQ(v.x,v.y,v.team)||v.cargo===0)return 0;
    let risk=0;
    for(const e of s.vehicles)if(e.team!==v.team&&e.cargo<v.cargo){const d=E.distance(v,e);if(d<=1)risk+=v.cargo*.7+15;else if(d===2)risk+=v.cargo*.12;}
    return risk;
  }
  function decide(s,team,preset='balanced',depth=4,options={}) {
    const config=PRESETS[preset]||PRESETS.balanced, own=s.vehicles.filter(v=>v.team===team).sort((a,b)=>a.id-b.id);
    const actions=[],purchases=[],reasons={},claimed=new Map(), metrics={expanded:0,perVehicle:{}};
    const treeCount=s.trees.filter(t=>t.team===team).length, budget=options.budget??BUDGET;
    let plannedTrees=0,plantCash=s.teams[team].cash;
    const hunters=own.filter(v=>v.type==='collector'&&v.cargo===0).slice(0,config.hunters).map(v=>v.id);
    const opponents=s.vehicles.filter(v=>v.team!==team && v.cargo>0).sort((a,b)=>b.cargo-a.cargo||a.id-b.id);
    function resourceScore(v,p,kind,amount){
      const home=nearestHome({...v,...p}),dist=E.distance(v,p),route=E.distance(p,home);
      const reserved=claimed.get(p.x+','+p.y)||0;
      return Math.min(amount,kind==='tree'?90:60)/(dist+route*.4+2)-reserved*7;
    }
    for(let vi=0;vi<own.length;vi++) {
      const v=own[vi], limit=Math.floor(budget/Math.max(1,own.length))+(vi<budget%Math.max(1,own.length)?1:0);
      let expanded=0,role='collect',target=null;
      const home=nearestHome(v),homeDist=E.distance(v,home),turn=s.turn+1,remaining=s.settings.turns-s.turn;
      if(v.cargo>=config.load||v.cargo>0&&(remaining<=homeDist+3||v.type==='planter')) {role='deliver';target=home;}
      else if(hunters.includes(v.id)&&opponents.length) {
        const prey=opponents.slice().sort((a,b)=>E.distance(v,a)-E.distance(v,b)||b.cargo-a.cargo)[0];
        const h=nearestHome(prey),progress=MOVES.map(a=>E.nextPosition(prey,a)).filter(p=>!E.isHQ(p.x,p.y,prey.team)&&E.distance(p,h)<E.distance(prey,h));
        const cells=[...progress,{x:prey.x,y:prey.y}];
        target=cells[hunters.indexOf(v.id)%cells.length];role='intercept';
      } else if(v.type==='planter') {
        role='plant';let best=-Infinity;
        if(treeCount+plannedTrees<config.trees&&plantCash>=s.settings.plantingCost&&remaining>25) for(let y=0;y<15;y++)for(let x=0;x<15;x++) {
          const p={x,y};if(E.isHQ(x,y)||s.trees.some(t=>E.same(t,p))||claimed.has(x+','+y))continue;
          const nearby=Object.values(E.DELTA).reduce((sum,[dx,dy])=>sum+s.ground[E.index(E.mod(x+dx),E.mod(y+dy))],0);
          const nearTrees=s.trees.filter(t=>E.distance(t,p)<=2).length;
          const score=nearby/(E.distance(v,p)+4)-nearTrees*9-E.distance(p,home)*.3;
          if(score>best){best=score;target=p;}
        }
        if(!target){role='idle';target=home;}
      } else {
        let best=-Infinity;
        for(let y=0;y<15;y++)for(let x=0;x<15;x++) {
          if(E.isHQ(x,y))continue;const p={x,y},tree=s.trees.find(t=>t.team===team&&E.same(t,p));
          const amount=tree?.storage||s.ground[E.index(x,y)];if(!amount)continue;
          const score=resourceScore(v,p,tree?.storage?'tree':'ground',amount)-danger(s,{...v,...p,cargo:v.cargo+15})*.08;
          if(score>best){best=score;target=p;}
        }
        if(!target){role=v.cargo?'deliver':'idle';target=home;}
      }
      if(target)claimed.set(target.x+','+target.y,(claimed.get(target.x+','+target.y)||0)+1);
      const treeHere=s.trees.find(t=>t.team===team&&E.same(t,v));
      let chosen='WAIT',selectionPath='default_wait',beamScore=null,chosenPath=null;
      const rootCandidates=[],beamLayers=[];
      if(role==='plant'&&E.same(v,target)&&plantCash>=s.settings.plantingCost){chosen='PLANT';selectionPath='plant';plantCash-=s.settings.plantingCost;plannedTrees++;}
      else if(role==='collect'&&treeHere?.storage>0&&danger(s,{...v,cargo:v.cargo+Math.min(30,treeHere.storage)})<v.cargo+15){chosen='PICKUP';selectionPath='pickup_gate';}
      else if(role==='collect'&&target&&E.same(v,target)&&s.ground[E.index(v.x,v.y)]>0&&danger(s,{...v,cargo:v.cargo+15})<v.cargo+15){chosen='HARVEST';selectionPath='harvest_gate';}
      else if(target&&!E.same(v,target)) {
        // A small receding-horizon position model; enemy reach is a risk estimate, never a revealed decision.
        let beam=[{x:v.x,y:v.y,first:'WAIT',score:0,path:new Set([v.x+','+v.y]),trace:[]}],best=null;
        for(let d=0;d<depth&&expanded<limit;d++) {
          const candidates=[];
          for(const node of beam)for(const action of ['WAIT',...MOVES]) {
            if(expanded>=limit)break;expanded++;
            const p=E.nextPosition({...v,x:node.x,y:node.y},action),cell=p.x+','+p.y;
            const first=d===0?action:node.first;
            const risk=danger(s,{...v,...p});
            const immediate=-E.distance(p,target)*14-risk-.2-(node.path.has(cell)?2:0)+(E.same(p,target)?20:0);
            if(options.diagnostics&&d===0)rootCandidates.push({action,cell:[p.x,p.y],danger:risk,score:immediate});
            const score=node.score+immediate*Math.pow(.85,d);
            const path=new Set(node.path);path.add(cell);
            candidates.push({...p,first,score,path,trace:options.diagnostics?
              node.trace.concat({action,cell:[p.x,p.y],danger:risk,immediate,discountedScore:score}):[]});
          }
          candidates.sort((a,b)=>b.score-a.score||E.ACTIONS.indexOf(a.first)-E.ACTIONS.indexOf(b.first)||a.x-b.x||a.y-b.y);
          beam=candidates.slice(0,10);
          if(options.diagnostics)beamLayers.push({depth:d+1,firstActions:[...new Set(candidates.map(c=>c.first))].map(action=>({
            action,bestScore:candidates.find(c=>c.first===action).score,retained:beam.some(c=>c.first===action)}))});
          if(beam.length)best=beam[0];
        }
        chosen=best?.first||'WAIT';selectionPath='movement_beam';beamScore=best?.score??null;chosenPath=best?.trace??null;
      }
      // Close to the final turn, never collect cargo that cannot reach home in time.
      if(['HARVEST','PICKUP'].includes(chosen)&&remaining<=homeDist){chosen='WAIT';selectionPath='endgame_wait';}
      actions.push({vehicle:v.id,action:chosen,priority:v.id});
      metrics.expanded+=expanded;metrics.perVehicle[v.id]={expanded,limit};
      reasons[v.id]={role,action:chosen,target:target?[target.x,target.y]:null,expanded,limit};
      if(options.diagnostics){
        const p=E.nextPosition(v,chosen);
        reasons[v.id].diagnostics={selectionPath,currentCellDanger:danger(s,v),chosenCellDanger:danger(s,{...v,...p}),
          pickupGateDanger:role==='collect'&&treeHere?.storage>0?danger(s,{...v,cargo:v.cargo+Math.min(30,treeHere.storage)}):null,
          harvestGateDanger:role==='collect'&&target&&E.same(v,target)&&s.ground[E.index(v.x,v.y)]>0?danger(s,{...v,cargo:v.cargo+15}):null,
          collectionGateThreshold:v.cargo+15,rootCandidates,beamScore,beamLayers,chosenPath};
      }
    }
    if(s.settings.turns-s.turn>20) {
      let count=own.length,cash=plantCash;
      for(const h of ['HQ1','HQ2'])if(count<s.settings.fleetLimit){
        const planters=own.filter(v=>v.type==='planter').length;
        const vehicleType=planters===0&&treeCount<config.trees?'planter':'collector';
        const cost=vehicleType==='planter'?s.settings.planterCost:s.settings.collectorCost;
        if(cash>=cost){purchases.push({headquarters:h,vehicleType,priority:h==='HQ1'?0:1});cash-=cost;count++;}
      }
    }
    return {decision:{vehicles:actions,purchases},reasons,metrics};
  }
  const api={VERSION,BUDGET,PRESETS,decide,danger};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CarbonStrategies=api;
})(typeof globalThis!=='undefined'?globalThis:this);
