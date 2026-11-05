"use strict";
// Carbon Arena independent resolver (Claude). Written from the rules text, not Codex's engine. Testing only.
// Tool revision 2026-10-15b: supports rules v0.4 and v0.5 explicitly; there is no default version.
const M = 0xFFFFFFFF >>> 0;
function xs(s){ s=(s^(s<<13))>>>0; s=(s^(s>>>17))>>>0; s=(s^(s<<5))>>>0; return s>>>0; }
function genMap(seed){
  let s = seed===0 ? 0x6D2B79F5 : seed>>>0;
  const refl=q=>(13-q+15)%15, groups=new Map();
  for(let x=0;x<15;x++)for(let y=0;y<15;y++){
    const orb=[[x,y],[refl(x),y],[x,refl(y)],[refl(x),refl(y)]];
    let key=null; for(const [a,b] of orb){const k=[a+1,b+1]; if(!key||k[0]<key[0]||(k[0]===key[0]&&k[1]<key[1]))key=k;}
    const ks=key[0]*100+key[1]; if(!groups.has(ks))groups.set(ks,new Set()); for(const [a,b] of orb)groups.get(ks).add(b*15+a);
  }
  const hq=new Set([4*15+4,9*15+9,4*15+9,9*15+4]); const g=new Array(225).fill(0);
  for(const k of [...groups.keys()].sort((a,b)=>a-b)){
    const cells=[...groups.get(k)]; if(cells.some(c=>hq.has(c)))continue;
    do{ s=xs(s);}while(s>=4294967228); const v=s%101; for(const c of cells)g[c]=v;
  }
  return g;
}
const HQS={Red:[[4,4],[9,9]],Blue:[[9,4],[4,9]]};
const HQL={Red:{HQ1:[4,4],HQ2:[9,9]},Blue:{HQ1:[9,4],HQ2:[4,9]}};
const OPP={Red:"Blue",Blue:"Red"};
const HQSET=new Set([64,144,69,139]);
const isHQ=(t,x,y)=>HQS[t].some(h=>h[0]===x&&h[1]===y);
const DIR={MOVE_UP:[0,-1],MOVE_DOWN:[0,1],MOVE_LEFT:[-1,0],MOVE_RIGHT:[1,0]};
const SETTINGS={turns:300,fleetLimit:10,collectorCost:40,planterCost:60,harvest:15,pickup:30,absorption:3,treeLife:50,regenerationEvery:5,regeneration:1,ceiling:100};
// Version-dependent settings. Every state carries exactly one of these in st.cfg.
const RULES=Object.freeze({
  "0.4":Object.freeze({treeLimit:8,plantingCost:20,treeGeneration:0}),
  "0.5":Object.freeze({treeLimit:10,plantingCost:20,treeGeneration:4})});
function rulesFor(v){
  if(!Object.prototype.hasOwnProperty.call(RULES,v))throw new Error(`rules version required: one of ${Object.keys(RULES).join(", ")} (got ${JSON.stringify(v)})`);
  return {rulesVersion:v,...RULES[v]};}
// Lab configs are labelled by the official version whose settings they match exactly, else "lab".
function labelFor(c){for(const [v,r] of Object.entries(RULES))if(r.treeLimit===c.treeLimit&&r.plantingCost===c.plantingCost&&r.treeGeneration===c.treeGeneration)return v;return "lab";}
function nb(c){const x=c%15,y=(c/15)|0;return [y*15+(x+1)%15,y*15+(x+14)%15,((y+1)%15)*15+x,((y+14)%15)*15+x];}
function create(seed,rulesVersion){
  const st={seed,turn:0,cfg:rulesFor(rulesVersion),treeGen:{Red:0,Blue:0},treeGenTotal:0,seq:0,ground:genMap(seed),vehicles:[],trees:[],nextTree:1,cash:{Red:100,Blue:100},nextId:{Red:5,Blue:5},sold:0,regen:0,expr:0,losses:{Red:{empty_tie:0,cargo_tie:0,theft:0},Blue:{empty_tie:0,cargo_tie:0,theft:0}},events:[]};
  for(const t of ["Red","Blue"]){const L=HQL[t];[[1,"collector","HQ1"],[2,"collector","HQ1"],[3,"collector","HQ2"],[4,"planter","HQ2"]].forEach(([id,type,h])=>st.vehicles.push({team:t,id,type,x:L[h][0],y:L[h][1],cargo:0,born:0,alive:true}));}
  return st;
}
function createLab(cfg,initialGround){
  const st=create(cfg.seed,"0.4");st.ground=initialGround.slice();st.initial=initialGround.reduce((a,b)=>a+b,0);
  const c={treeLimit:cfg.treeLimit,plantingCost:cfg.plantingCost,treeGeneration:cfg.treeGeneration||0};
  st.cfg={rulesVersion:labelFor(c),...c};
  if(cfg.start==="equal-capital"){st.vehicles=[];for(const t of ["Red","Blue"]){const p=cfg.planters[t];st.cash[t]=500-((10-p)*40+p*60);st.nextId[t]=11;
    for(let id=1;id<=10;id++){const h=id<=5?"HQ1":"HQ2";st.vehicles.push({team:t,id,type:id>10-p?"planter":"collector",x:HQL[t][h][0],y:HQL[t][h][1],cargo:0,born:0,alive:true});}}}
  return st;}
function snapshot(st){
  const settings={...SETTINGS,treeLimit:st.cfg.treeLimit,plantingCost:st.cfg.plantingCost};if(st.cfg.treeGeneration)settings.treeGeneration=st.cfg.treeGeneration;
  return {rulesVersion:st.cfg.rulesVersion,seed:st.seed,settings,turn:st.turn,ground:st.ground.slice(),
    vehicles:st.vehicles.filter(v=>v.alive).map(v=>({team:v.team,id:v.id,type:v.type,x:v.x,y:v.y,cargo:v.cargo,born:v.born})),
    trees:st.trees.map(t=>({id:t.id,team:t.team,x:t.x,y:t.y,storage:t.storage,remaining:t.remaining,planted:t.planted})),
    teams:{Red:{cash:st.cash.Red,plantingBudget:st.cash.Red},Blue:{cash:st.cash.Blue,plantingBudget:st.cash.Blue}},eventHistory:process.env.FULLEV?st.events:[]};
}
function rot(ids,turn){ids=[...ids].sort((a,b)=>a-b);const k=(turn-1)%ids.length;return ids.slice(k).concat(ids.slice(0,k));}
function alloc(ids,C,L,turn){const n=ids.length,b=L==null?Math.floor(C/n):Math.min(L,Math.floor(C/n));const out=new Map(ids.map(i=>[i,b]));
  if(L==null||b<L){const rem=C-n*Math.floor(C/n);for(const i of rot(ids,turn).slice(0,rem))out.set(i,out.get(i)+1);}return out;}
function step(st,dec){
  const turn=st.turn+1; const E=st.events; const ev=(e)=>{e.turn=turn;e.seq=++st.seq;E.push(e);};
  const act=new Map(),pr=new Map();
  const V=(t,i)=>st.vehicles.find(v=>v.team===t&&v.id===i&&v.alive);
  for(const t of ["Red","Blue"]){
    const d=dec[t]||{}; const arr=Array.isArray(d.vehicles)?d.vehicles:[]; const cnt=new Map();
    for(const x of arr)cnt.set(x.vehicle,(cnt.get(x.vehicle)||0)+1);
    for(const x of arr){const v=V(t,x.vehicle); if(!v||v.born>=turn)continue; let a=cnt.get(x.vehicle)===1?x.action:"WAIT";
      if(!["WAIT","MOVE_UP","MOVE_DOWN","MOVE_LEFT","MOVE_RIGHT","HARVEST","PICKUP","PLANT"].includes(a))a="WAIT";
      if((a==="HARVEST"||a==="PICKUP")&&v.type!=="collector")a="WAIT"; if(a==="PLANT"&&v.type!=="planter")a="WAIT";
      act.set(t+v.id,a);pr.set(t+v.id,Number.isSafeInteger(x.priority)?x.priority:0);}
  }
  const alive=st.vehicles.filter(v=>v.alive&&v.born<turn).concat(st.vehicles.filter(v=>v.alive&&v.born>=turn));
  for(const v of st.vehicles.filter(v=>v.alive)){const a=act.get(v.team+v.id)||"WAIT"; if(DIR[a]){const [dx,dy]=DIR[a];const nx=(v.x+dx+15)%15,ny=(v.y+dy+15)%15;
      if(isHQ(OPP[v.team],nx,ny)){act.set(v.team+v.id,"WAIT");continue;} ev({type:"move",team:v.team,vehicle:v.id,from:[v.x,v.y],to:[nx,ny]}); v.x=nx;v.y=ny;}}
  const occ=new Map(); for(const v of st.vehicles.filter(v=>v.alive)){const c=v.y*15+v.x; if(!occ.has(c))occ.set(c,{Red:[],Blue:[]}); occ.get(c)[v.team].push(v);}
  for(const [c,d] of [...occ.entries()].sort((a,b)=>a[0]-b[0])){ if(!d.Red.length||!d.Blue.length)continue;
    const tc={Red:d.Red.reduce((s,v)=>s+v.cargo,0),Blue:d.Blue.reduce((s,v)=>s+v.cargo,0)};
    if(tc.Red===tc.Blue){ st.ground[c]+=tc.Red+tc.Blue; const cause=tc.Red===0?"empty_tie":"cargo_tie";
      ev({type:"drop",cell:[c%15,(c/15)|0],amount:tc.Red+tc.Blue,teamCargo:tc});
      for(const t of ["Red","Blue"])for(const v of d[t]){v.alive=false;v.cargo=0;st.losses[t][cause]++;ev({type:"destroy",team:t,vehicle:v.id,cause,cell:[c%15,(c/15)|0]});}
    } else { const w=tc.Red<tc.Blue?"Red":"Blue",l=OPP[w],amt=tc[l];
      for(const v of d[l]){v.alive=false;v.cargo=0;st.losses[l].theft++;ev({type:"destroy",team:l,vehicle:v.id,cause:"theft",cell:[c%15,(c/15)|0]});}
      const sh=alloc(d[w].map(v=>v.id),amt,null,turn); for(const v of d[w])v.cargo+=sh.get(v.id);
      ev({type:"theft",team:w,amount:amt,cell:[c%15,(c/15)|0],teamCargo:tc});}
  }
  const hg=new Map(),pg=new Map();
  for(const v of st.vehicles.filter(v=>v.alive)){const a=act.get(v.team+v.id),c=v.y*15+v.x;
    if(a==="HARVEST"){const k=v.team+":"+c;if(!hg.has(k))hg.set(k,[]);hg.get(k).push(v);}
    if(a==="PICKUP"){const tr=st.trees.find(t=>t.x===v.x&&t.y===v.y&&t.team===v.team);if(tr){if(!pg.has(tr.id))pg.set(tr.id,[]);pg.get(tr.id).push(v);}}}
  for(const [k,vs] of hg){const c=+k.split(":")[1];const m=alloc(vs.map(v=>v.id),st.ground[c],15,turn);for(const v of vs){const s=m.get(v.id);if(s>0){st.ground[c]-=s;v.cargo+=s;ev({type:"harvest",team:v.team,vehicle:v.id,amount:s,cell:[v.x,v.y]});}}}
  for(const [tid,vs] of pg){const tr=st.trees.find(t=>t.id===tid);const m=alloc(vs.map(v=>v.id),tr.storage,30,turn);for(const v of vs){const s=m.get(v.id);if(s>0){tr.storage-=s;v.cargo+=s;ev({type:"pickup",team:v.team,vehicle:v.id,amount:s,tree:tid});}}}
  const working=st.trees.filter(t=>t.planted<turn);
  for(const t of ["Red","Blue"]){
    const reqs=st.vehicles.filter(v=>v.alive&&v.team===t&&act.get(t+v.id)==="PLANT").sort((a,b)=>(pr.get(t+a.id)-pr.get(t+b.id))||(a.id-b.id));
    for(const v of reqs){const c=v.y*15+v.x; if(HQSET.has(c)||st.trees.some(tr=>tr.x===v.x&&tr.y===v.y)||st.trees.filter(tr=>tr.team===t).length>=st.cfg.treeLimit||st.cash[t]<st.cfg.plantingCost)continue;
      st.cash[t]-=st.cfg.plantingCost; st.trees.push({id:st.nextTree++,team:t,x:v.x,y:v.y,storage:0,remaining:50,planted:turn}); ev({type:"plant",team:t,vehicle:v.id,cell:[v.x,v.y]});}
  }
  const pre=st.ground.slice(); const ab=[];
  for(const tr of working){for(const n of nb(tr.y*15+tr.x)){const cnt=working.filter(t2=>nb(t2.y*15+t2.x).includes(n)).length;const s=Math.min(3,Math.floor(pre[n]/cnt));if(s>0)ab.push([tr,n,s]);}}
  for(const [tr,n,s] of ab){st.ground[n]-=s;tr.storage+=s;}
  const GEN=st.cfg.treeGeneration||0; if(GEN){for(const tr of [...working].sort((a,b)=>a.id-b.id)){tr.storage+=GEN;st.treeGenTotal+=GEN;st.treeGen[tr.team]+=GEN;ev({type:"tree_generation",team:tr.team,tree:tr.id,amount:GEN});}}
  for(const tr of [...working].sort((a,b)=>a.id-b.id)){tr.remaining--; if(tr.planted+50===turn){st.ground[tr.y*15+tr.x]+=tr.storage;st.expr+=tr.storage;ev({type:"expiry",team:tr.team,amount:tr.storage});}}
  st.trees=st.trees.filter(tr=>tr.planted+50!==turn);
  for(const v of st.vehicles.filter(v=>v.alive)){if(v.cargo>0&&isHQ(v.team,v.x,v.y)){st.cash[v.team]+=v.cargo;st.sold+=v.cargo;ev({type:"sale",team:v.team,vehicle:v.id,amount:v.cargo});v.cargo=0;}}
  for(const t of ["Red","Blue"]){
    let ps=(dec[t]&&Array.isArray(dec[t].purchases))?dec[t].purchases:[]; const hc=new Map(); for(const p of ps)hc.set(p.headquarters,(hc.get(p.headquarters)||0)+1);
    ps=ps.filter(p=>hc.get(p.headquarters)===1&&(p.headquarters==="HQ1"||p.headquarters==="HQ2")&&(p.vehicleType==="collector"||p.vehicleType==="planter"));
    ps.sort((a,b)=>((a.priority||0)-(b.priority||0))||(a.headquarters<b.headquarters?-1:1));
    for(const p of ps){const cost=p.vehicleType==="collector"?40:60;const n=st.vehicles.filter(v=>v.alive&&v.team===t).length;
      if(st.cash[t]<cost||n>=10){ev({type:"purchase_rejected",team:t});continue;}
      st.cash[t]-=cost;const id=st.nextId[t]++;const [x,y]=HQL[t][p.headquarters];st.vehicles.push({team:t,id,type:p.vehicleType,x,y,cargo:0,born:turn,alive:true});ev({type:"purchase",team:t,vehicle:id,vehicleType:p.vehicleType});}
  }
  if(turn%5===0){for(let c=0;c<225;c++){if(!HQSET.has(c)&&st.ground[c]<100){st.ground[c]++;st.regen++;}}}
  st.turn=turn;
}
function totals(st){const g=st.ground.reduce((a,b)=>a+b,0),s=st.trees.reduce((a,t)=>a+t.storage,0),c=st.vehicles.filter(v=>v.alive).reduce((a,v)=>a+v.cargo,0);return {ground:g,stored:s,inTransit:c,sold:st.sold,regenerated:st.regen,treeGenerated:st.treeGenTotal,expiryReleased:st.expr};}
const vm=require("node:vm");
function loadStrategy(path,prefix){const src=(prefix||"")+require("node:fs").readFileSync(path,"utf8");
  if(!process.env.ISOLATE){const f=new Function(src+"\n;return decide;")();return (snap,team,mem)=>{const a=JSON.parse(JSON.stringify([snap,team,mem]));const t0=process.hrtime.bigint();const r=f(a[0],a[1],a[2]);return [JSON.parse(JSON.stringify(r)),Number(process.hrtime.bigint()-t0)/1e6];};}
  return (snap,team,mem)=>{const ctx=vm.createContext({});vm.runInContext(src,ctx,{timeout:5000});ctx.__a=JSON.parse(JSON.stringify([snap,team,mem]));
    const t0=process.hrtime.bigint();const r=vm.runInContext("decide(__a[0],__a[1],__a[2])",ctx,{timeout:5000});const ms=Number(process.hrtime.bigint()-t0)/1e6;
    return [JSON.parse(JSON.stringify(r)),ms];};}
function play(seed,redPath,bluePath,opts={}){
  const st=create(seed,opts.rulesVersion); const S={Red:loadStrategy(redPath,opts.redPrefix),Blue:loadStrategy(bluePath,opts.bluePrefix)}; const mem={Red:null,Blue:null}; let maxms={Red:0,Blue:0},fails={Red:0,Blue:0};
  while(st.turn<300){const snap=snapshot(st);const dec={};
    for(const t of ["Red","Blue"]){try{const [r,ms]=S[t](snap,t,mem[t]);maxms[t]=Math.max(maxms[t],ms);dec[t]=r.decision;mem[t]=r.memory;}catch(e){fails[t]++;dec[t]={vehicles:[],purchases:[]};if(opts.verbose)console.error(t,e.message);}}
    step(st,dec);
    const tt=totals(st); if(tt.ground+tt.stored+tt.inTransit+tt.sold!==genMap(seed).reduce((a,b)=>a+b,0)+tt.regenerated+tt.treeGenerated)throw new Error("conservation "+st.turn);}
  return {seed,cash:{...st.cash},losses:st.losses,maxms,fails,st};
}
module.exports={createLab,create,step,snapshot,totals,genMap,play,loadStrategy,RULES,rulesFor};
function stats(st){const o={};for(const t of ["Red","Blue"]){const E=st.events.filter(e=>e.team===t);const sum=(ty)=>E.filter(e=>e.type===ty).reduce((a,e)=>a+(e.amount||0),0);
 o[t]={cash:st.cash[t],harvest:sum("harvest"),pickup:sum("pickup"),sold:sum("sale"),stolen:sum("theft"),plants:E.filter(e=>e.type==="plant").length,buys:E.filter(e=>e.type==="purchase").map(e=>e.vehicleType[0]).join("").length,
 planters:E.filter(e=>e.type==="purchase"&&e.vehicleType==="planter").length,losses:st.losses[t],
 harvestActs:E.filter(e=>e.type==="harvest").length,pickupActs:E.filter(e=>e.type==="pickup").length,moves:E.filter(e=>e.type==="move").length};}
 const ab={Red:0,Blue:0};return o;}
module.exports.stats=stats;
