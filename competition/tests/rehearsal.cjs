'use strict';
// Isolated public-fixture rehearsal. Never opens the production competition archive.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {once}=require('node:events');
const http=require('node:http');
const {serve}=require('../server.cjs');
const {sha,writeNew}=require('../integrity.cjs');
const {chromium}=require('playwright');
(async()=>{
  const dir=path.resolve(__dirname,'../verification',process.argv[2]||('rehearsal-'+Date.now()));
  fs.mkdirSync(dir,{recursive:true});
  const dataDir=path.join(dir,'archive'),app=serve({dataDir,port:0});await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  const browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],external=[];let tick;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base+'/')||u==='about:blank')return r.continue();external.push(u);return r.abort();});
  try{
    await page.goto(base);await page.waitForFunction(()=>!!document.querySelector('#demo')&&!document.querySelector('#demo').disabled);
    await page.screenshot({path:path.join(dir,'desktop-empty.png'),fullPage:true});
    const initial=await(await fetch(base+'/api/state')).json(),token=initial.token;
    const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Arena-Token':token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    assert.equal((await post('/api/register',{}, {'X-Arena-Token':'wrong'})).status,403);
    assert.equal((await post('/api/register',{}, {Origin:'https://unrelated.invalid'})).status,403);
    const spoofStatus=await new Promise((resolve,reject)=>{http.get(base+'/api/state',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
    assert.equal(spoofStatus,403);
    assert.equal((await fetch(base+'/sources/source.js')).status,404);
    assert.equal((await fetch(base+'/api/matches/../../sources/source.js')).status,404);
    if(!initial.entries.length){
      const source=fs.readFileSync(path.resolve(__dirname,'../examples/wait.js'),'utf8')+'\n// Public UI registration fixture only.\n';
      async function form(name,bytes){await page.locator('#enter').click();await page.getByLabel('Entrant name').fill(name);
        await page.getByLabel('Model',{exact:true}).fill('Public browser-test fixture');await page.getByLabel('Strategy version').fill('test-1');
        await page.locator('#source').setInputFiles({name:'fixture.js',mimeType:'text/javascript',buffer:Buffer.from(bytes)});await page.locator('#register-submit').click();}
      await form('Public registration fixture',source);await page.waitForFunction(()=>!document.querySelector('#register-dialog').open);
      await form('Duplicate fixture',source);await page.waitForFunction(()=>document.querySelector('#register-status').textContent.includes('already registered'));
      await page.locator('#register-dialog [data-close]').click();
      assert.equal(app.ledger.read().entries.length,1);
      await form('Public second fixture',source+'// A distinct exact source version.\n');await page.waitForFunction(()=>!document.querySelector('#register-dialog').open);
      await page.locator('#challenge').click();const first=app.ledger.read().entries[0].id;
      await page.locator('#entrant-a').selectOption(first);await page.locator('#entrant-b').selectOption(first);
      await page.locator('#challenge-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#challenge-status').textContent.includes('different entries'));
      await page.locator('#challenge-dialog [data-close]').click();
      await page.locator('#demo').click();
    }else if(!initial.challenges.some(c=>c.status==='passed'))throw Error('Existing rehearsal is incomplete; choose a new evidence directory');
    let last='';tick=setInterval(()=>{const j=app.getJob();if(j){const s=`${j.status}: match ${j.match}/6 ${j.phase}, turn ${j.turn}`;if(s!==last){console.log(s);last=s;}}},5000);
    await page.waitForFunction(()=>document.querySelector('#history').textContent.includes('wins')||document.querySelector('#history').textContent.includes('Draw'),null,{timeout:1200000});
    clearInterval(tick);tick=null;
    const state=app.ledger.read(),c=state.challenges.find(c=>c.status==='passed');assert.ok(c);assert.equal(c.rated,false);
    assert.equal(state.champion,null);assert.ok(state.entries.every(e=>e.played===0&&e.rating===1500));assert.equal(c.result.matches.length,6);
    assert.ok(c.result.matches.every(m=>m.turns===300&&m.determinism==='passed'&&m.independentVerification==='passed'&&m.failures===0));
    const all=fs.readFileSync(app.ledger.file,'utf8');assert.equal(all.split('\n').filter(s=>s.includes('"type":"completed"')).length,1);
    await page.screenshot({path:path.join(dir,'desktop-results.png'),fullPage:true});
    await page.getByText('View challenge →',{exact:true}).first().click();assert.equal(await page.locator('.map-card').count(),3);
    await page.locator('.map-card button').first().click();const frame=page.frameLocator('#replay-frame');
    await frame.locator('#play').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#replay-frame').contentDocument?.querySelector('#play')?.textContent==='Play replay');
    assert.equal(await frame.locator('#turn').textContent(),'0');assert.equal(await frame.locator('#play').isDisabled(),false);
    await frame.locator('#step').click();assert.equal(await frame.locator('#turn').textContent(),'1');
    await frame.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#replay-frame').contentDocument.querySelector('#turn').textContent)>=3);
    await frame.locator('#play').click();assert.equal(await frame.locator('#play').textContent(),'Play replay');
    await frame.locator('#timeline').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input'));});assert.equal(await frame.locator('#turn').textContent(),'50');
    assert.equal(await frame.locator('#new-map').isDisabled(),true);assert.equal(await frame.locator('#return-live').isVisible(),false);
    const auditDownload=page.waitForEvent('download');await frame.locator('#export-audit').click();const audit=JSON.parse(fs.readFileSync(await(await auditDownload).path()));assert.equal(audit.throughTurn,50);
    const replayDownload=page.waitForEvent('download');await frame.locator('#export').click();const replay=JSON.parse(fs.readFileSync(await(await replayDownload).path()));assert.equal(replay.decisions.length,300);assert.equal(replay.strategies.freezeSHA256,c.freezeSHA256);
    await page.screenshot({path:path.join(dir,'desktop-replay.png'),fullPage:true});
    await frame.locator('body').screenshot({path:path.join(dir,'viewer-replay.png')});
    const standalone=await browser.newPage({viewport:{width:1440,height:1050}});standalone.on('pageerror',e=>errors.push(e.message));
    await standalone.goto(base+await page.locator('.map-card a[target="_blank"]').first().getAttribute('href'));
    await standalone.waitForFunction(()=>document.querySelector('#play').textContent==='Play replay');
    await standalone.screenshot({path:path.join(dir,'standalone-viewer.png'),fullPage:true});await standalone.close();
    await frame.locator('#restart').click();assert.equal(await frame.locator('#turn').textContent(),'0');
    await page.locator('#match-dialog [data-close]').click();await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(dir,'mobile-results.png'),fullPage:true});
    await page.locator('#enter').click();await page.screenshot({path:path.join(dir,'mobile-registration.png'),fullPage:true});await page.locator('#register-dialog [data-close]').click();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    await new Promise(resolve=>app.server.close(resolve));
    const reopened=serve({dataDir,port:0});await once(reopened.server,'listening');assert.deepEqual(reopened.ledger.read(),state);await new Promise(resolve=>reopened.server.close(resolve));
    const report={format:'carbon-arena-platform-rehearsal-v1',status:'passed',scope:'Public examples only; no official results',challenge:c.id,seeds:c.seeds,
      matches:6,turns:1800,repeatTurns:1800,independentMatches:6,strategyFailures:0,champion:null,ratedChallenges:0,
      browser:['registration','duplicate-source rejection','same-entry rejection','practice demonstration','result details','six replay links','play/pause/step/rewind','timeline seek','full replay and partial audit downloads','390px mobile','no external requests','no page errors'],
      api:['token','Origin','Host','source privacy','path allowlist','restart persistence'],ledgerHead:state.head,completedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({evidence:dir,...report},null,2));
  }finally{if(tick)clearInterval(tick);await browser.close();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
