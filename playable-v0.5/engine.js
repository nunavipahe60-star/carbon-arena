(function (root) {
  'use strict';
  const VERSION = '0.5', GENERATOR = 'symmetric-uniform-xorshift32-v1';
  const SIZE = 15, TEAMS = ['Red', 'Blue'];
  const HQ = {Red: [[4,4],[9,9]], Blue: [[9,4],[4,9]]};
  const ACTIONS = ['WAIT','MOVE_UP','MOVE_RIGHT','MOVE_DOWN','MOVE_LEFT','HARVEST','PICKUP','PLANT'];
  const DELTA = {MOVE_UP:[0,-1], MOVE_RIGHT:[1,0], MOVE_DOWN:[0,1], MOVE_LEFT:[-1,0]};
  const DEFAULTS = Object.freeze({turns:300, fleetLimit:10, treeLimit:10, treeGeneration:4, collectorCost:40, planterCost:60,
    plantingCost:20, harvest:15, pickup:30, absorption:3, treeLife:50, regenerationEvery:5, regeneration:1, ceiling:100});
  const clone = x => JSON.parse(JSON.stringify(x));
  const mod = q => (q % SIZE + SIZE) % SIZE;
  const index = (x,y) => y*SIZE+x;
  const same = (a,b) => a.x === b.x && a.y === b.y;
  const enemy = t => t === 'Red' ? 'Blue' : 'Red';
  const isHQ = (x,y,team) => (team ? [team] : TEAMS).some(t => HQ[t].some(p=>p[0]===x&&p[1]===y));
  const distance = (a,b) => Math.min(mod(a.x-b.x),mod(b.x-a.x))+Math.min(mod(a.y-b.y),mod(b.y-a.y));
  const nextPosition = (v,action) => {
    const d=DELTA[action];
    if (!d) return {x:v.x,y:v.y};
    const p={x:mod(v.x+d[0]),y:mod(v.y+d[1])};
    return isHQ(p.x,p.y,enemy(v.team)) ? {x:v.x,y:v.y} : p;
  };
  function xorshift(state) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    return (state ^ (state << 5)) >>> 0;
  }
  function generate(seed) {
    let state = (seed>>>0) || 0x6D2B79F5, samples=0, groups=0, rejections=0;
    const ground=Array(225).fill(0), seen=new Set();
    for (let x=1;x<=15;x++) for (let y=1;y<=15;y++) {
      const key=(x-1)+','+(y-1);
      if (seen.has(key)) continue;
      const rx=15-x||15, ry=15-y||15;
      const cells=[...new Map([[x,y],[rx,y],[x,ry],[rx,ry]].map(p=>[p.join(','),p])).values()];
      for (const [a,b] of cells) seen.add((a-1)+','+(b-1));
      groups++;
      let value=0;
      if (!cells.some(([a,b])=>isHQ(a-1,b-1))) {
        do {state=xorshift(state); if(state>=4294967228) rejections++;} while(state>=4294967228);
        value=state%101; samples++;
      }
      for(const [a,b] of cells) ground[index(a-1,b-1)]=value;
    }
    return {ground,groups,samples,rejections};
  }
  function allocate(ids,carbon,limit,turn) {
    if (!ids.length) return new Map();
    const sorted=ids.slice().sort((a,b)=>a-b), n=sorted.length;
    const base=Math.min(limit,Math.floor(carbon/n));
    const result=new Map(sorted.map(id=>[id,base]));
    if (base<limit) {
      const r=carbon-n*base, start=(turn-1)%n;
      for(let i=0;i<r;i++) {const id=sorted[(start+i)%n];result.set(id,result.get(id)+1);}
    }
    return result;
  }
  function create(seed=1,settings={}) {
    const config={...DEFAULTS,...settings};
    for(const [k,v] of Object.entries(config)) if(!Object.hasOwn(DEFAULTS,k)||!Number.isSafeInteger(v)||v<(k==='treeGeneration'?0:1)||(k==='treeLife'&&v!==50)) throw Error('Invalid setting: '+k);
    const {ground}=generate(seed), vehicles=[];
    for(const team of TEAMS) {
      for(const [id,type,h] of [[1,'collector',0],[2,'collector',0],[3,'collector',1],[4,'planter',1]]) {
        vehicles.push({team,id,type,x:HQ[team][h][0],y:HQ[team][h][1],cargo:0,born:0});
      }
    }
    const s={rulesVersion:VERSION,generator:GENERATOR,seed:seed>>>0,settings:config,turn:0,ground,vehicles,trees:[],
      teams:{Red:{cash:100,nextId:5,sold:0,spent:0,losses:0,treeGenerated:0},Blue:{cash:100,nextId:5,sold:0,spent:0,losses:0,treeGenerated:0}},
      nextTreeId:1,initialCarbon:ground.reduce((a,b)=>a+b,0),generatedCarbon:0,treeGeneratedCarbon:0,soldCarbon:0,events:[],ended:false,winner:null};
    s.history=[summarize(s)];return s;
  }
  function snapshot(s) {
    return clone({rulesVersion:s.rulesVersion,seed:s.seed,settings:s.settings,turn:s.turn,
      ground:s.ground,vehicles:s.vehicles,trees:s.trees,
      teams:Object.fromEntries(TEAMS.map(t=>[t,{cash:s.teams[t].cash,plantingBudget:s.teams[t].cash}])),eventHistory:s.events});
  }
  const key = v => v.team+':'+v.id;
  function normalize(s,decisions) {
    const out={};
    for(const team of TEAMS) {
      const d=decisions && decisions[team], requests=Array.isArray(d?.vehicles)?d.vehicles:[];
      const purchases=Array.isArray(d?.purchases)?d.purchases:[];
      out[team]={vehicles:[],purchases:[]};
      if(typeof d?.failure==='string') {
        out[team].failure=d.failure.slice(0,500);
        out[team].vehicles=s.vehicles.filter(v=>v.team===team).sort((a,b)=>a.id-b.id).map(v=>({vehicle:v.id,action:'WAIT',priority:0}));
        continue;
      }
      for(const v of s.vehicles.filter(v=>v.team===team).sort((a,b)=>a.id-b.id)) {
        const matches=requests.filter(r=>r && r.vehicle===v.id), r=matches.length===1?matches[0]:null;
        const priority=r?.priority ?? 0;
        const valid=r && ACTIONS.includes(r.action) && Number.isSafeInteger(priority) &&
          !(v.type==='planter'&&['HARVEST','PICKUP'].includes(r.action)) && !(v.type==='collector'&&r.action==='PLANT');
        out[team].vehicles.push({vehicle:v.id,action:valid?r.action:'WAIT',priority:valid?priority:0});
      }
      for(const h of ['HQ1','HQ2']) {
        const matches=purchases.filter(r=>r && r.headquarters===h), r=matches.length===1?matches[0]:null;
        if(r && ['collector','planter'].includes(r.vehicleType) && Number.isSafeInteger(r.priority??0)) {
          out[team].purchases.push({headquarters:h,vehicleType:r.vehicleType,priority:r.priority??0});
        }
      }
    }
    return out;
  }
  function resolve(s,input) {
    if(s.ended) return {decisions:normalize(s,{}),events:[]};
    const decisions=normalize(s,input), turn=s.turn+1, events=[], oldTrees=s.trees.slice(), cfg=s.settings;
    const emit=(type,data={})=>events.push({turn,seq:s.events.length+events.length,type,...data});
    for(const team of TEAMS)if(decisions[team].failure!==undefined)emit('strategy_failure',{team,message:decisions[team].failure});
    const actions=new Map();
    for(const team of TEAMS) for(const r of decisions[team].vehicles) actions.set(team+':'+r.vehicle,r);
    // Move every surviving starting vehicle before resolving any cell.
    for(const v of s.vehicles) {
      const action=actions.get(key(v)).action, p=nextPosition(v,action);
      if(p.x!==v.x||p.y!==v.y) emit('move',{team:v.team,vehicle:v.id,from:[v.x,v.y],to:[p.x,p.y]});
      v.x=p.x; v.y=p.y;
    }
    const occupied=new Map();
    for(const v of s.vehicles) {const i=index(v.x,v.y); if(!occupied.has(i)) occupied.set(i,[]);occupied.get(i).push(v);}
    const dead=new Map();
    for(const [i,vs] of [...occupied].sort((a,b)=>a[0]-b[0])) {
      const red=vs.filter(v=>v.team==='Red'),blue=vs.filter(v=>v.team==='Blue');
      if(!red.length||!blue.length) continue;
      const totals=[red,blue].map(group=>group.reduce((a,v)=>a+v.cargo,0));
      const teamCargo={Red:totals[0],Blue:totals[1]},collisionEvent=s.events.length+events.length;
      if(totals[0]===totals[1]) {
        const amount=totals[0]+totals[1]; s.ground[i]+=amount;
        emit('drop',{cell:[i%15,Math.floor(i/15)],amount,teamCargo,sources:vs.map(v=>({team:v.team,vehicle:v.id,amount:v.cargo})),reason:'collision_tie'});
        for(const v of vs) dead.set(key(v),{cause:amount===0?'empty_tie':'cargo_tie',collisionEvent});
      } else {
        const winners=totals[0]<totals[1]?red:blue,losers=totals[0]<totals[1]?blue:red;
        const amount=losers.reduce((a,v)=>a+v.cargo,0),split=allocate(winners.map(v=>v.id),amount,Infinity,turn);
        emit('theft',{cell:[i%15,Math.floor(i/15)],team:winners[0].team,amount,teamCargo,
          sources:losers.map(v=>({team:v.team,vehicle:v.id,amount:v.cargo})),
          recipients:winners.map(v=>({team:v.team,vehicle:v.id,amount:split.get(v.id)}))});
        for(const v of winners) v.cargo+=split.get(v.id);
        for(const v of losers) dead.set(key(v),{cause:'theft',collisionEvent});
      }
    }
    for(const v of s.vehicles) if(dead.has(key(v))) {
      s.teams[v.team].losses++;
      emit('destroy',{team:v.team,vehicle:v.id,cargo:v.cargo,cell:[v.x,v.y],requestedAction:actions.get(key(v)).action,...dead.get(key(v))});
    }
    s.vehicles=s.vehicles.filter(v=>!dead.has(key(v)));
    for(const [i] of [...occupied].sort((a,b)=>a[0]-b[0])) {
      const on=s.vehicles.filter(v=>index(v.x,v.y)===i);
      for(const mode of ['HARVEST','PICKUP']) {
        const requesters=on.filter(v=>actions.get(key(v)).action===mode);
        if(!requesters.length) continue;
        const tree=s.trees.find(t=>index(t.x,t.y)===i && t.team===requesters[0].team);
        if(mode==='PICKUP'&&!tree) continue;
        const available=mode==='HARVEST'?s.ground[i]:tree.storage;
        const split=allocate(requesters.map(v=>v.id),available,mode==='HARVEST'?cfg.harvest:cfg.pickup,turn);
        for(const v of requesters.sort((a,b)=>a.id-b.id)) {
          const amount=split.get(v.id);v.cargo+=amount;
          if(mode==='HARVEST') s.ground[i]-=amount;else tree.storage-=amount;
          if(amount) emit(mode==='HARVEST'?'harvest':'pickup',{team:v.team,vehicle:v.id,cell:[v.x,v.y],tree:tree?.id??null,amount});
        }
      }
    }
    for(const team of TEAMS) {
      const planters=s.vehicles.filter(v=>v.team===team && actions.get(key(v)).action==='PLANT')
        .sort((a,b)=>actions.get(key(a)).priority-actions.get(key(b)).priority||a.id-b.id);
      for(const v of planters) if(!isHQ(v.x,v.y) && !s.trees.some(t=>same(t,v)) && s.trees.filter(t=>t.team===team).length<cfg.treeLimit && s.teams[team].cash>=cfg.plantingCost) {
        s.teams[team].cash-=cfg.plantingCost;s.teams[team].spent+=cfg.plantingCost;
        const tree={id:s.nextTreeId++,team,x:v.x,y:v.y,storage:0,remaining:cfg.treeLife,planted:turn};s.trees.push(tree);
        emit('plant',{team,vehicle:v.id,tree:tree.id,cell:[v.x,v.y],cost:cfg.plantingCost});
      }
    }
    const requests=new Map();
    for(const t of oldTrees) for(const [dx,dy] of Object.values(DELTA)) {
      const i=index(mod(t.x+dx),mod(t.y+dy));if(!requests.has(i))requests.set(i,[]);requests.get(i).push(t);
    }
    for(const [i,trees] of [...requests].sort((a,b)=>a[0]-b[0])) {
      const amount=Math.min(cfg.absorption,Math.floor(s.ground[i]/trees.length));
      for(const t of trees) {t.storage+=amount;s.ground[i]-=amount;if(amount)emit('absorption',{team:t.team,tree:t.id,cell:[i%15,Math.floor(i/15)],amount});}
    }
    // Complete generation for all old trees before any expiry. Pickup has already
    // happened, and newly planted trees are excluded. Ground regeneration keeps
    // its original counter; tree production has its own cumulative source.
    const orderedTrees=oldTrees.slice().sort((a,b)=>a.id-b.id);
    for(const t of orderedTrees) if(cfg.treeGeneration>0) {
      t.storage+=cfg.treeGeneration;s.treeGeneratedCarbon+=cfg.treeGeneration;
      s.teams[t.team].treeGenerated+=cfg.treeGeneration;
      emit('tree_generation',{team:t.team,tree:t.id,amount:cfg.treeGeneration});
    }
    // Last-turn production is released on expiry, available for absorption next turn.
    for(const t of orderedTrees) if(--t.remaining===0) {
      s.ground[index(t.x,t.y)]+=t.storage;
      emit('expiry',{team:t.team,tree:t.id,cell:[t.x,t.y],amount:t.storage});
    }
    s.trees=s.trees.filter(t=>t.remaining>0);
    for(const v of s.vehicles) if(v.cargo && isHQ(v.x,v.y,v.team)) {
      emit('sale',{team:v.team,vehicle:v.id,amount:v.cargo,cell:[v.x,v.y]});
      s.teams[v.team].cash+=v.cargo;s.teams[v.team].sold+=v.cargo;s.soldCarbon+=v.cargo;v.cargo=0;
    }
    for(const team of TEAMS) {
      const purchases=decisions[team].purchases.slice().sort((a,b)=>a.priority-b.priority||a.headquarters.localeCompare(b.headquarters));
      for(const r of purchases) {
        const cost=r.vehicleType==='collector'?cfg.collectorCost:cfg.planterCost;
        const reason=s.vehicles.filter(v=>v.team===team).length>=cfg.fleetLimit?'fleet_limit':s.teams[team].cash<cost?'cash':null;
        if(reason) {emit('purchase_rejected',{team,...r,reason});continue;}
        const [x,y]=HQ[team][r.headquarters==='HQ1'?0:1],id=s.teams[team].nextId++;
        s.teams[team].cash-=cost;s.teams[team].spent+=cost;
        s.vehicles.push({team,id,type:r.vehicleType,x,y,cargo:0,born:turn});
        emit('purchase',{team,vehicle:id,vehicleType:r.vehicleType,headquarters:r.headquarters,cell:[x,y],cost});
      }
    }
    if(turn%cfg.regenerationEvery===0) for(let i=0;i<225;i++) if(!isHQ(i%15,Math.floor(i/15)) && s.ground[i]<cfg.ceiling) {
      const amount=Math.min(cfg.regeneration,cfg.ceiling-s.ground[i]);s.ground[i]+=amount;s.generatedCarbon+=amount;
      if(amount)emit('regeneration',{cell:[i%15,Math.floor(i/15)],amount});
    }
    s.turn=turn;s.events.push(...events);
    if(turn>=cfg.turns || (!s.vehicles.length && TEAMS.every(t=>s.teams[t].cash<Math.min(cfg.collectorCost,cfg.planterCost)))) {
      s.ended=true;s.winner=s.teams.Red.cash===s.teams.Blue.cash?'Draw':s.teams.Red.cash>s.teams.Blue.cash?'Red':'Blue';
    }
    s.history.push(summarize(s));
    return {decisions,events};
  }
  function carbonTotal(s) {return s.ground.reduce((a,b)=>a+b,0)+s.vehicles.reduce((a,v)=>a+v.cargo,0)+s.trees.reduce((a,t)=>a+t.storage,0)+s.soldCarbon;}
  function summarize(s) {
    const losses={empty_tie:0,cargo_tie:0,theft:0},collisions={empty_tie:0,cargo_tie:0,theft:0};
    const lossesByTeam={Red:{...losses},Blue:{...losses}};
    let expiryReleased=0;
    for(const e of s.events) {
      if(e.type==='destroy'){losses[e.cause]++;lossesByTeam[e.team][e.cause]++;}
      if(e.type==='theft')collisions.theft++;
      if(e.type==='drop'&&e.reason==='collision_tie')collisions[e.amount===0?'empty_tie':'cargo_tie']++;
      if(e.type==='expiry')expiryReleased+=e.amount;
    }
    const totalAccounted=carbonTotal(s),expectedTotal=s.initialCarbon+s.generatedCarbon+s.treeGeneratedCarbon;
    return {turn:s.turn,ground:s.ground.reduce((a,b)=>a+b,0),stored:s.trees.reduce((a,t)=>a+t.storage,0),
      inTransit:s.vehicles.reduce((a,v)=>a+v.cargo,0),sold:s.soldCarbon,initial:s.initialCarbon,regenerated:s.generatedCarbon,
      treeGenerated:s.treeGeneratedCarbon,treeGeneratedByTeam:Object.fromEntries(TEAMS.map(t=>[t,s.teams[t].treeGenerated])),
      totalAccounted,expectedTotal,carbonError:totalAccounted-expectedTotal,
      cash:{Red:s.teams.Red.cash,Blue:s.teams.Blue.cash},expiryReleased,losses,lossesByTeam,collisions};
  }
  function audit(s) {
    return clone({format:'carbon-arena-audit-v1',rulesVersion:s.rulesVersion,generator:s.generator,
      coordinateSystem:'zero-based-xy',seed:s.seed,settings:s.settings,initialCarbon:s.initialCarbon,throughTurn:s.turn,
      notes:['Losses count vehicles; collisions count encounters. All counters are cumulative.',
        'Expiry transfers storage to ground. Destroy records do not transfer carbon a second time.',
        'Ground + stored + inTransit + sold = initial + regenerated + treeGenerated. Regenerated is ground only.',
        'Tree generation is emitted in increasing tree ID order, after all absorption and before all expiry. No lineage attribution is included.'],
      turnSummaries:s.history,events:s.events});
  }
  function replay(record,toTurn=Infinity) {
    if(record?.rulesVersion==='0.4') throw Error('Rules 0.4 replay is not supported. This viewer supports rules 0.5 only.');
    if(record?.format!=='carbon-arena-replay-v1'||record.rulesVersion!==VERSION||record.generator!==GENERATOR||record.coordinateSystem!=='zero-based-xy') throw Error('Unsupported replay format or rules version.');
    if(!Number.isInteger(record.seed)||record.seed<0||record.seed>4294967295||!Array.isArray(record.decisions)||record.decisions.length>300) throw Error('Invalid replay.');
    if(!record.settings||typeof record.settings!=='object'||Array.isArray(record.settings)||
      Object.keys(DEFAULTS).some(k=>!Object.hasOwn(record.settings,k))) throw Error('Replay must include every actual v0.5 setting, including treeGeneration.');
    const s=create(record.seed,record.settings);
    for(const d of record.decisions.slice(0,toTurn)) resolve(s,d);
    return s;
  }
  const api={VERSION,GENERATOR,SIZE,TEAMS,HQ,ACTIONS,DELTA,DEFAULTS,clone,mod,index,same,enemy,isHQ,distance,nextPosition,xorshift,generate,allocate,create,snapshot,normalize,resolve,carbonTotal,summarize,audit,replay,key};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CarbonArena=api;
})(typeof globalThis!=='undefined'?globalThis:this);
