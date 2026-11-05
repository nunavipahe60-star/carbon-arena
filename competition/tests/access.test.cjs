'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {Ledger,id}=require('../ledger.cjs');
const {score}=require('../core.cjs');
const {sha,writeNew}=require('../integrity.cjs');
const {prepare}=require('../runner.cjs');
const {ownerAccess,visibleState}=require('../access.cjs');
const {serve}=require('../server.cjs');

function fixture(dir){
  const ledger=new Ledger(dir);
  const entries=['Alpha','Beta','Gamma'].map(name=>ledger.register({name,model:'Public fixture',version:'test'},`function decide(){return {decision:{},memory:null};} // ${name}`));
  const ids=entries.slice(0,2).map(e=>e.id),cid=id(),seeds=[3101,3102,3103],freezeSHA256=sha(cid);
  const matches=seeds.flatMap(seed=>[
    {seed,colors:{Red:ids[0],Blue:ids[1]},cash:{Red:20,Blue:10}},
    {seed,colors:{Red:ids[1],Blue:ids[0]},cash:{Red:10,Blue:20}}
  ]);
  ledger.append('prepared',{id:cid,entries:ids,seeds,freezeSHA256,rated:true});
  ledger.append('started',{id:cid});
  ledger.append('completed',{id:cid,result:{status:'passed',entries:ids,seeds,freezeSHA256,matches,score:score(matches,seeds,ids),privateMarker:'private-result-marker'}});
  const dirName=ledger.challengeDir(cid);
  for(const file of ['result','freeze','seeds'])writeNew(path.join(dirName,file+'.json'),{privateMarker:'private-'+file});
  for(const file of ['replay','audit','summary','determinism','independent'])writeNew(path.join(dirName,'map-1-first',file+'.json'),{privateMarker:'private-'+file});
  return {ledger,entries,cid,ids};
}

test('bans persist, preserve history, and reject rated/practice before source reads or seed draws',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-access-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {ledger,entries,cid}=fixture(dir),before=ledger.read(),raw=fs.readFileSync(ledger.file,'utf8');
  ledger.banEntries(entries.slice(0,2).map(e=>e.id));ledger.sealChallenge(cid);
  const after=new Ledger(dir).read();
  assert.ok(fs.readFileSync(ledger.file,'utf8').startsWith(raw));
  assert.deepEqual(after.entries.map(({banned,...e})=>e),before.entries);
  assert.deepEqual(after.challenges.map(({sealed,...c})=>c),before.challenges);
  assert.equal(after.champion,before.champion);
  assert.ok(after.entries.slice(0,2).every(e=>e.banned));
  assert.equal(after.challenges[0].sealed,true);
  ledger.source=()=>{throw Error('A banned entrant source must never be read');};
  const revision=after.revision;
  for(const banned of entries.slice(0,2))for(const rated of [true,false]){
    assert.throws(()=>prepare(ledger,[banned.id,entries[2].id],rated),/banned/);
    assert.throws(()=>ledger.append('prepared',{id:id(),entries:[banned.id,entries[2].id],seeds:[4101,4102,4103],freezeSHA256:sha('fixture'),rated}),/banned/);
  }
  assert.equal(ledger.read().revision,revision);
  assert.deepEqual(fs.readdirSync(path.join(dir,'challenges')),[cid]);
  assert.throws(()=>ledger.banEntries([id()]),/Unknown entry/);
  assert.equal(ledger.read().revision,revision);
});

test('sealed public state contains the winner, with no match scores, seeds, or evidence',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-access-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {ledger,cid,ids}=fixture(dir);ledger.sealChallenge(cid);
  const state=ledger.read(),publicView=visibleState(state,false),privateView=visibleState(state,true);
  assert.deepEqual(publicView.challenges[0].result,{score:{winner:ids[0]}});
  for(const field of ['seeds','freezeSHA256','rating','title','error'])assert.equal(publicView.challenges[0][field],undefined);
  assert.ok(!JSON.stringify(publicView).includes('private-result-marker'));
  assert.deepEqual(privateView.challenges,state.challenges);
  assert.equal(state.challenges[0].result.privateMarker,'private-result-marker');
});

test('owner capabilities are separate from public request tokens, expire, and can be revoked',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-access-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const access=ownerAccess(dir),key=JSON.parse(fs.readFileSync(path.join(dir,'owner-key.json'))).key;
  assert.equal(access.unlock('0'.repeat(64)),null);
  assert.equal(access.unlock({}),null);
  const setCookie=access.unlock(key);assert.match(setCookie,/HttpOnly; SameSite=Strict/);
  const req={headers:{cookie:setCookie.split(';')[0]}};
  assert.equal(access.authorized({headers:{}}),false);assert.equal(access.authorized(req),true);
  access.lock(req);assert.equal(access.authorized(req),false);
  req.headers.cookie=access.unlock(key).split(';')[0];
  const realNow=Date.now();t.mock.method(Date,'now',()=>realNow+2*60*60*1000+1000);
  assert.equal(access.authorized(req),false);
});

test('HTTP enforces locks on state and every evidence route, including direct URLs, and survives restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-access-http-test-'));
  const {ledger,cid,ids,entries}=fixture(dir);ledger.banEntries(ids);ledger.sealChallenge(cid);
  let arena=serve({dataDir:dir,port:0});await once(arena.server,'listening');
  t.after(async()=>{await new Promise(resolve=>arena.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  let base='http://127.0.0.1:'+arena.server.address().port;
  const initial=await (await fetch(base+'/api/state')).json();
  assert.equal(initial.owner,false);assert.deepEqual(initial.challenges[0].result,{score:{winner:ids[0]}});
  assert.ok(!JSON.stringify(initial).includes('private-result-marker'));
  const routes=[...['result','freeze','seeds'].map(file=>`/api/challenges/${cid}/${file}.json`),
    ...['replay','audit','summary','determinism','independent'].map(file=>`/api/matches/${cid}/map-1-first/${file}.json`)];
  for(const route of routes){const r=await fetch(base+route);assert.equal(r.status,403,route);assert.ok(!(await r.text()).includes('privateMarker'));}
  for(const route of ['/owner-key.json','/data/owner-key.json','/access.cjs',`/api/matches/${cid}/map-1-first/strategy-calls.json`])assert.equal((await fetch(base+route)).status,404);
  const post=async(route,body,cookie)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Arena-Token':(await (await fetch(base+'/api/state')).json()).token,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await post('/api/admin/ban',{ids:[entries[2].id]})).status,403);
  assert.equal((await post('/api/admin/seal',{id:cid})).status,403);
  assert.equal((await post('/api/owner/unlock',{key:initial.token})).status,403);
  for(const banned of ids)for(const rated of [true,false]){
    const r=await post('/api/challenge',{entries:[banned,entries[2].id],rated});assert.equal(r.status,400);assert.match((await r.json()).error,/banned/);
  }
  const key=JSON.parse(fs.readFileSync(path.join(dir,'owner-key.json'))).key;
  const login=await post('/api/owner/unlock',{key});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  for(const route of routes){const r=await fetch(base+route,{headers:{Cookie:cookie}});assert.equal(r.status,200,route);assert.match(await r.text(),/privateMarker/);}
  const privateState=await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();
  assert.equal(privateState.owner,true);assert.equal(privateState.challenges[0].result.privateMarker,'private-result-marker');
  assert.equal((await post('/api/owner/lock',{},cookie)).status,200);
  assert.equal((await fetch(base+routes[0],{headers:{Cookie:cookie}})).status,403);
  const secondLogin=await post('/api/owner/unlock',{key}),oldCookie=secondLogin.headers.get('set-cookie').split(';')[0];
  await new Promise(resolve=>arena.server.close(resolve));
  arena=serve({dataDir:dir,port:0});await once(arena.server,'listening');base='http://127.0.0.1:'+arena.server.address().port;
  assert.equal((await fetch(base+routes[0],{headers:{Cookie:oldCookie}})).status,403);
  const restarted=await (await fetch(base+'/api/state')).json();assert.equal(restarted.challenges[0].sealed,true);assert.ok(restarted.entries.slice(0,2).every(e=>e.banned));
  assert.equal((await post('/api/owner/unlock',{key})).status,200);
});
