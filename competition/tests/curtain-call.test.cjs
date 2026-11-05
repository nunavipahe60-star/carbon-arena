'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {schedule,standings,pairScore}=require('../curtain-call-core.cjs');
const {CurtainStore}=require('../curtain-call-store.cjs');
const {freezeCurtain,verifyCurtain,drawTen}=require('../curtain-call-runner.cjs');
const {Ledger,seedExclusions}=require('../ledger.cjs');
const {sha}=require('../integrity.cjs');
const ids=['a','b','c'],seeds=Array.from({length:10},(_,i)=>301+i);
const games=(amount=()=>100)=>schedule(ids,seeds).map(g=>({...g,cash:Object.fromEntries(['Red','Blue'].map(c=>[c,amount(g,g.colors[c])]))}));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-curtain-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const ledger=new Ledger(dir),store=new CurtainStore(dir);const entries=['A','B','C'].map(name=>ledger.register({name,model:'Public fixture',version:'test'},'function decide(){return {decision:{},memory:null};} // '+name));return{dir,ledger,store,input:{entries:entries.map(e=>e.id),confirmedFinalVersions:true}};}
test('60 games use exactly ten shared maps, swapped colors, forty games per author',()=>{
 const plan=schedule(ids,seeds);assert.equal(plan.length,60);assert.equal(new Set(plan.map(g=>g.directory)).size,60);
 for(const pair of [['a','b'],['a','c'],['b','c']]){const group=plan.filter(g=>g.pair.join()===pair.join());assert.equal(group.length,20);for(const seed of seeds){const both=group.filter(g=>g.seed===seed);assert.equal(both.length,2);assert.notEqual(both[0].colors.Red,both[1].colors.Red);}}
 for(const id of ids){assert.equal(plan.filter(g=>g.pair.includes(id)).length,40);assert.equal(plan.filter(g=>g.colors.Red===id).length,20);}
 assert.throws(()=>schedule(ids,[...seeds.slice(0,9),seeds[0]]));assert.throws(()=>schedule(['a','a','c'],seeds));
});
test('map points outrank cash; exact ties share rank; partial maps do not count',()=>{
 const group=games((g,id)=>id===g.pair[0]?(g.map<=6?101:0):(g.map<=6?100:100000)).filter(g=>g.pair.join()==='a,b');const p=pairScore(group,seeds,['a','b']);assert.equal(p.winner,'a');assert.equal(p.points.a,6);assert(p.totalCash.a<p.totalCash.b);
 const tied=standings(games(),seeds,ids,true);assert(tied.table.every(r=>r.rank===1&&r.points===10&&r.cash===4000&&r.mapsPlayed===20));
 const half=standings(games().slice(0,1),seeds,ids);assert(half.table.every(r=>r.points===0&&r.cash===0));
 const wins=standings(games((g,id)=>id===g.pair[0]?101:100),seeds,ids,true);assert.deepEqual(wins.table.map(r=>[r.id,r.points]),[['a',20],['b',10],['c',0]]);
});
test('duplicate, substituted, invalid-cash and incomplete final games are rejected',()=>{
 for(const mutate of [g=>g.splice(1,1,g[0]),g=>g[0].seed=1,g=>g[0].cash.Red=-1,g=>g[0].cash.Red=1.5,g=>g[0].cash.Red=Number.MAX_SAFE_INTEGER,g=>g[1].colors={...g[0].colors}]){const g=games();mutate(g);assert.throws(()=>standings(g,seeds,ids,true));}
 assert.throws(()=>standings(games().slice(0,59),seeds,ids,true));
});
test('freeze is permanent, preserves catalog, reserves all ten seeds and excludes disclosed practice maps',t=>{
 const {ledger,store,input}=fixture(t),before=ledger.read();
 input.labels=Object.fromEntries(input.entries.map((id,i)=>[id,{name:['Claude','Codex','Gemini-4-Argon'][i],model:'Exact release unknown',version:'unknown'}]));
 const view=freezeCurtain(ledger,store,input);assert.equal(view.seeds.length,10);assert.equal(view.policy.exhibitionGames,0);verifyCurtain(ledger,store);assert.deepEqual(ledger.read(),before);
 assert.deepEqual(view.entries.map(e=>e.name),['Claude','Codex','Gemini-4-Argon']);assert.deepEqual(view.entries.map(e=>[e.id,e.sha256]),before.entries.map(e=>[e.id,e.sha256]));
 const excluded=seedExclusions(ledger);assert(view.seeds.every(s=>excluded.has(s)));assert([1599512364,956325211,6278101,2099498940,2025122752,1941950568,1722479056,1152197638,1001617435,679249739].every(s=>excluded.has(s)));
 assert.throws(()=>freezeCurtain(ledger,store,input),/frozen roster/);
 for(const file of ['freeze.json','seeds.json','sources/'+view.entries[0].sha256+'.js']){const p=path.join(store.seasonDir(view.id),file),bytes=fs.readFileSync(p);fs.appendFileSync(p,' ');assert.throws(()=>verifyCurtain(ledger,store));fs.writeFileSync(p,bytes);}
});
test('interrupted journal preserves original draw and prefix; tampering fails closed',t=>{
 const {ledger,store,input}=fixture(t);freezeCurtain(ledger,store,input);const ready=store.read();const lines=fs.readFileSync(store.file,'utf8').split('\n');fs.writeFileSync(store.file,lines[0]+'\n');store.recover();assert.deepEqual(store.read().seeds,ready.seeds);
 store.append('started',{});const game=schedule(input.entries,ready.seeds)[0];const match={...game,cash:{Red:100,Blue:100},determinism:'passed',independentVerification:'passed',evidenceSHA256:sha('fixture'),evidenceDirectory:game.directory+'/attempt-1'};store.append('match-verified',{match});store.recover();assert.equal(store.read().status,'paused');assert.equal(store.read().matches.length,1);
 store.append('started',{});assert.throws(()=>store.append('match-verified',{match}));store.append('paused',{error:'Fixture pause'});
 const raw=fs.readFileSync(store.file,'utf8');fs.writeFileSync(store.file,raw.trimEnd());assert.throws(()=>store.read(),/Incomplete/);fs.writeFileSync(store.file,raw.replace('Public fixture','tamper'));assert.throws(()=>store.read(),/hash mismatch/);
});
test('crypto draw rejects zero, duplicates, historical exclusions and invalid candidates',()=>{
 const values=[0,5,5,-1,4294967296,...seeds];assert.deepEqual(drawTen(new Set([5]),()=>values.shift()),seeds);
});
