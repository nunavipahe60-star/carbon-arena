'use strict';
// Exercise the actual file:// build with all HTTP(S) requests blocked.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carbon-demo-')),errors=[],external=[];
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,r=>{external.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../playable-v0.5/index.html')).href);
  assert.equal(await page.locator('#turn').textContent(),'0');
  for(let i=0;i<8;i++)await page.locator('#step').click();
  assert.equal(await page.locator('#turn').textContent(),'8');
  const download=page.waitForEvent('download');await page.locator('#export').click();
  const file=await download;const replay=JSON.parse(fs.readFileSync(await file.path()));
  assert.equal(replay.rulesVersion,'0.5');assert.equal(replay.decisions.length,8);
  const fixture=path.join(dir,'demo-replay.json');fs.writeFileSync(fixture,JSON.stringify(replay));
  await page.locator('#restart').click();assert.equal(await page.locator('#turn').textContent(),'0');
  await page.locator('#replay-file').setInputFiles(fixture);
  await page.waitForFunction(()=>document.querySelector('#turn').textContent==='8');
  const out=path.resolve(__dirname,'../docs/images');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'arena.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Offline file build passed: step, export, restart, replay import, desktop/mobile layout, no external requests or browser errors.');
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
