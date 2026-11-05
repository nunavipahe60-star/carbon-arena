'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {sha,fingerprint,writeNew}=require('./integrity.cjs');
const {seedExclusions}=require('./ledger.cjs');
const {play,compareIndependent}=require('./runner.cjs');
const {Sandbox}=require('../duel/sandbox.cjs');
const limits=require('../duel/config.cjs');
const POLICY=Object.freeze({id:'carbon-arena-quick-practice-v1',rulesVersion:'0.5',maps:1,games:2,turnsPerGame:300,colorSwap:true,rated:false,fullStrategyRerun:false,verification:['carbon-conservation','replay-reconstruction','independent-resolver']});
const loaded=fingerprint();
function score(matches,ids){
 assert.equal(matches.length,2);assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
 assert.equal(matches[0].seed,matches[1].seed);assert.notEqual(matches[0].colors.Red,matches[1].colors.Red);
 const rows=ids.map(id=>{const cash=matches.map(m=>{assert.deepEqual(Object.values(m.colors).sort(),ids.slice().sort());const value=m.cash[m.colors.Red===id?'Red':'Blue'];assert(Number.isSafeInteger(value)&&value>=0);return value;});const total=cash[0]+cash[1];assert(Number.isSafeInteger(total));return{id,first:cash[0],swapped:cash[1],total};});
 return{rows,winner:rows[0].total===rows[1].total?null:rows[0].total>rows[1].total?ids[0]:ids[1],difference:Math.abs(rows[0].total-rows[1].total)};
}
class PracticeStore{
 constructor(dataDir){this.dir=path.join(path.resolve(dataDir),'practice','sessions');}
 sessionDir(id){assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);return path.join(this.dir,id);}
 read(id){return JSON.parse(fs.readFileSync(path.join(this.sessionDir(id),'state.json'),'utf8'));}
 save(state){const file=path.join(this.sessionDir(state.id),'state.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n');fs.renameSync(temp,file);return state;}
 list(){if(!fs.existsSync(this.dir))return[];return fs.readdirSync(this.dir).filter(id=>/^[a-f0-9-]{36}$/.test(id)&&fs.existsSync(path.join(this.dir,id,'state.json'))).map(id=>this.read(id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 recover(){for(const state of this.list())if(['prepared','running'].includes(state.status))this.save({...state,status:'interrupted',error:'Service interrupted. Retained games and seed are saved; this session will not restart automatically.'});}
}
function preparePractice(ledger,store,input){
 assert(Array.isArray(input.entries)&&input.entries.length===2&&new Set(input.entries).size===2,'Choose two different strategies.');
 const catalog=ledger.read();assert(!catalog.challenges.some(c=>['prepared','running'].includes(c.status)),'Wait until the current challenge finishes.');
 const entries=input.entries.map(id=>{const e=catalog.entries.find(e=>e.id===id);assert(e&&!e.banned,'Choose an available registered strategy.');assert.equal(sha(fs.readFileSync(path.join(ledger.dir,'sources',e.sha256+'.js'))),e.sha256,'Registered strategy bytes changed.');return{...e};});
 const manual=input.seed!==undefined&&input.seed!==null&&input.seed!=='';
 if(manual)assert(Number.isInteger(input.seed)&&input.seed>0&&input.seed<=4294967295,'Seed must be an integer from 1 to 4294967295.');
 assert.deepEqual(fingerprint(),loaded,'Arena updated; manually restart the normal service before training.');
 const id=crypto.randomUUID(),dir=store.sessionDir(id),createdAt=new Date().toISOString();
 const freeze={format:'carbon-arena-quick-practice-freeze-v1',id,createdAt,entries,policy:POLICY,limits,integrity:loaded,requestedSeed:manual?input.seed:null};
 writeNew(path.join(dir,'freeze.json'),freeze);const freezeSHA256=sha(fs.readFileSync(path.join(dir,'freeze.json')));
 const excluded=seedExclusions(ledger);let seed=input.seed;
 if(!manual){seed=0;for(let i=0;i<10000;i++){const n=crypto.randomBytes(4).readUInt32BE(0);if(n>0&&!excluded.has(n)){seed=n;break;}}assert(seed,'Could not draw a fresh practice seed.');}
 writeNew(path.join(dir,'seeds.json'),{format:'carbon-arena-quick-practice-seeds-v1',seeds:[seed],freezeSHA256,selectedAt:new Date().toISOString(),method:manual?'User-selected training map':'OS cryptographic randomness after practice freeze',previouslyKnown:excluded.has(seed),excludedSeeds:[...excluded].sort((a,b)=>a-b)});
 const seedsSHA256=sha(fs.readFileSync(path.join(dir,'seeds.json')));
 return store.save({id,createdAt,status:'prepared',entries,seed,freezeSHA256,seedsSHA256,policy:POLICY,matches:[],result:null});
}
async function runPractice(ledger,store,id,progress=()=>{}){
 const state=store.read(id);assert.equal(state.status,'prepared');let box;
 const dir=store.sessionDir(id),frozen=JSON.parse(fs.readFileSync(path.join(dir,'freeze.json')));
 function verify(){assert.equal(sha(fs.readFileSync(path.join(dir,'freeze.json'))),state.freezeSHA256,'Practice freeze changed.');assert.equal(sha(fs.readFileSync(path.join(dir,'seeds.json'))),state.seedsSHA256,'Practice seed reservation changed.');const reservation=JSON.parse(fs.readFileSync(path.join(dir,'seeds.json')));assert.deepEqual(reservation.seeds,[state.seed]);assert.equal(reservation.freezeSHA256,state.freezeSHA256);assert.deepEqual(state.entries,frozen.entries);assert.deepEqual(fingerprint(),frozen.integrity,'Arena changed during training.');for(const e of state.entries)assert.equal(sha(fs.readFileSync(path.join(ledger.dir,'sources',e.sha256+'.js'))),e.sha256,'Registered strategy changed.');}
 try{
  verify();state.status='running';store.save(state);box=new Sandbox();
  const ids=state.entries.map(e=>e.id),entries=Object.fromEntries(state.entries.map(e=>[e.id,{...e,source:ledger.source(e)}]));
  for(let swap=0;swap<2;swap++){
   verify();const directory=swap?'swapped':'first',matchDir=path.join(dir,directory),colors={Red:ids[swap],Blue:ids[1-swap]};fs.mkdirSync(matchDir);
   const update=(turn,phase='Playing')=>progress({match:swap+1,total:2,turn,phase});update(0);
   const first=await play({seed:state.seed,colors,entries,box,freezeSHA256:state.freezeSHA256,progress:turn=>update(turn)});
   for(const [name,value]of Object.entries({replay:first.replay,audit:first.audit,summary:first.summary,'strategy-calls':first.calls,'checkpoint-hashes':first.checkpoints}))writeNew(path.join(matchDir,name+'.json'),value);
   update(300,'Independent verification');await compareIndependent(matchDir);
   writeNew(path.join(matchDir,'verification.json'),{status:'passed',replayReconstruction:'passed',carbonConservation:'passed',independentVerification:'passed',strategyReproducibility:'not-run-quick-practice'});
   state.matches.push({...first.summary,index:swap,directory,independentVerification:'passed',strategyReproducibility:'not-run-quick-practice'});store.save(state);
  }
  verify();state.result=score(state.matches,ids);state.status='completed';state.completedAt=new Date().toISOString();
  writeNew(path.join(dir,'result.json'),{format:'carbon-arena-quick-practice-result-v1',policy:POLICY,id,entries:state.entries,seed:state.seed,matches:state.matches,score:state.result,completedAt:state.completedAt});store.save(state);return state;
 }catch(error){state.status='failed';state.error=error.message;store.save(state);throw error;}
 finally{if(box)await box.close();}
}
module.exports={POLICY,PracticeStore,preparePractice,runPractice,score};
