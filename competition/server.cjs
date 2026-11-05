'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Ledger}=require('./ledger.cjs');
const {checkSource,prepare,runPrepared}=require('./runner.cjs');
const {root}=require('./integrity.cjs');
const {ownerAccess,visibleState,publicEvidence}=require('./access.cjs');
const {SeasonStore}=require('./season-store.cjs');
const {freezeSeason,runSeason}=require('./season-runner.cjs');
const {CurtainStore}=require('./curtain-call-store.cjs');
const {freezeCurtain,runCurtain}=require('./curtain-call-runner.cjs');
const {PracticeStore,preparePractice,runPractice}=require('./practice.cjs');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.zip':'application/zip'};
function serve({dataDir=path.join(__dirname,'data'),port=4317}={}){
  fs.mkdirSync(dataDir,{recursive:true});const lock=path.join(dataDir,'server.lock');
  try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});}
  catch(e){if(e.code!=='EEXIST')throw e;const pid=JSON.parse(fs.readFileSync(lock)).pid;
    let alive=true;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
    if(alive)throw Error('This competition archive is already open in another process');
    fs.unlinkSync(lock);fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});}
  const ledger=new Ledger(dataDir),season=new SeasonStore(dataDir),curtain=new CurtainStore(dataDir),practice=new PracticeStore(dataDir),access=ownerAccess(dataDir);let job=null,mutating=false;const token=crypto.randomBytes(24).toString('hex');
  try{ledger.recover();season.recover();curtain.recover();practice.recover();}catch(e){fs.unlinkSync(lock);throw e;}
  const publicState=req=>{
    const state=ledger.read(),owner=access.authorized(req);
    const visibleJob=job&&!owner&&state.challenges.find(c=>c.id===job.id)?.sealed?{id:job.id,status:job.status}:job;
    return {...visibleState(state,owner),job:visibleJob,busy:mutating};
  };
  const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const file=(res,f)=>{if(!fs.existsSync(f)){send(res,404,{error:'File is not available'});return;}
    const stream=fs.createReadStream(f);stream.on('error',()=>res.destroy());
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});stream.pipe(res);};
  const evidence=(req,res,f,state)=>{
    if(!access.authorized(req)&&state.entries.some(e=>e.relabeled))send(res,200,publicEvidence(JSON.parse(fs.readFileSync(f)),state));
    else file(res,f);
  };
  async function body(req){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>7*1024*1024)throw Error('Request is too large');chunks.push(b);}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))||'{}');}
  function launch(cid){job={kind:'challenge',id:cid,status:'running',phase:'Starting',match:1,total:6,turn:0};
    runPrepared(ledger,cid,p=>Object.assign(job,p)).then(()=>Object.assign(job,{status:'passed',phase:'Complete'}),
      e=>Object.assign(job,{status:'failed',phase:'Stopped',error:e.message}));
  }
  function launchSeason(){job={kind:'season-two',id:season.read().id,status:'running',phase:'Starting',match:season.read().matches.length+1,total:36,turn:0};
    runSeason(ledger,season,p=>Object.assign(job,p)).then(()=>Object.assign(job,{status:'passed',phase:'Complete'}),
      e=>Object.assign(job,{status:'failed',phase:'Paused',error:e.message}));
  }
  function launchCurtain(){job={kind:'curtain-call',id:curtain.read().id,status:'running',phase:'Starting',match:curtain.read().matches.length+1,total:60,turn:0};
    runCurtain(ledger,curtain,p=>Object.assign(job,p)).then(()=>Object.assign(job,{status:'passed',phase:'Complete'}),
      e=>Object.assign(job,{status:'failed',phase:'Paused',error:e.message}));
  }
  function launchPractice(id){job={kind:'quick-practice',id,status:'running',phase:'Starting',match:1,total:2,turn:0};
    runPractice(ledger,practice,id,p=>Object.assign(job,p)).then(()=>Object.assign(job,{status:'passed',phase:'Complete'}),
      e=>Object.assign(job,{status:'failed',phase:'Stopped',error:e.message}));
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const expected='127.0.0.1:'+server.address().port;
      if(req.headers.host!==expected){send(res,403,{error:'Open this app using its local address'});return;}
      const url=new URL(req.url,'http://'+expected),p=url.pathname;
      if(req.method==='GET'&&p==='/api/state'){send(res,200,{...publicState(req),token});return;}
      if(req.method==='GET'&&p==='/api/practice'){
        send(res,200,{catalog:visibleState(ledger.read(),false).entries.filter(e=>!e.banned),sessions:practice.list(),job:publicState(req).job,busy:mutating,token});return;
      }
      if(req.method==='GET'&&p==='/api/season-two'){
        const catalog=visibleState(ledger.read(),access.authorized(req)).entries;
        const view=access.authorized(req)?season.view():publicEvidence(season.view(),ledger.read());
        send(res,200,{...view,catalog:catalog.filter(e=>!e.practiceOnly&&!e.banned),job:publicState(req).job,busy:mutating,token});return;
      }
      if(req.method==='GET'&&p==='/api/curtain-call'){
        const catalog=visibleState(ledger.read(),access.authorized(req)).entries;
        send(res,200,{...curtain.view(),catalog:catalog.filter(e=>!e.practiceOnly&&!e.banned),job:publicState(req).job,busy:mutating,token});return;
      }
      if(req.method==='POST'&&p.startsWith('/api/')){
        if(req.headers['x-arena-token']!==token||req.headers.origin!=='http://'+expected){send(res,403,{error:'Refresh the competition page before making changes'});return;}
        if(mutating||job?.status==='running')throw Error('Wait for the current operation to finish');
        mutating=true;
        try{const input=await body(req);
          if(p==='/api/practice/run'){const session=preparePractice(ledger,practice,input);launchPractice(session.id);send(res,202,{id:session.id});return;}
          if(p==='/api/curtain-call/freeze'){send(res,201,freezeCurtain(ledger,curtain,input));return;}
          if(p==='/api/curtain-call/run'){
            if(!['ready','paused'].includes(curtain.read().status))throw Error('Curtain Call is not ready to start or resume');
            launchCurtain();send(res,202,{id:curtain.read().id});return;
          }
          if(p==='/api/season-two/freeze'){send(res,201,freezeSeason(ledger,season,input));return;}
          if(p==='/api/season-two/run'){
            if(!['ready','paused'].includes(season.read().status))throw Error('Season is not ready to start or resume');
            launchSeason();send(res,202,{id:season.read().id});return;
          }
          if(p==='/api/owner/unlock'){
            const cookie=access.unlock(input.key);if(!cookie){send(res,403,{error:'Owner access is required'});return;}
            res.setHeader('Set-Cookie',cookie);send(res,200,{owner:true});return;
          }
          if(p==='/api/owner/lock'){
            res.setHeader('Set-Cookie',access.lock(req));send(res,200,{owner:false});return;
          }
          if(p==='/api/admin/ban'||p==='/api/admin/seal'){
            if(!access.authorized(req)){send(res,403,{error:'Owner access is required'});return;}
            if(p==='/api/admin/ban')ledger.banEntries(input.ids);else ledger.sealChallenge(input.id);
            send(res,200,{status:'saved'});return;
          }
          if(p==='/api/register'){
            await checkSource(input.source);const entry=ledger.register(input,input.source);send(res,201,{entry});return;
          }
          if(p==='/api/challenge'){
            const cid=prepare(ledger,input.entries,input.rated!==false);launch(cid);send(res,202,{id:cid});return;
          }
          if(p==='/api/demo'){
            const ids=[];
            for(const [fileName,name]of [['harvester.js','Practice harvester'],['wait.js','Practice WAIT']]){
              const source=fs.readFileSync(path.join(__dirname,'examples',fileName),'utf8');
              const old=ledger.read().entries.find(e=>e.practiceOnly&&e.sha256===crypto.createHash('sha256').update(source).digest('hex'));
              const e=old||ledger.register({name,model:'Public example',version:'1'},source,{practiceOnly:true});ids.push(e.id);
            }
            const cid=prepare(ledger,ids,false);launch(cid);send(res,202,{id:cid});return;
          }
          throw Error('Unknown action');
        }finally{mutating=false;}
      }
      if(req.method!=='GET'){send(res,405,{error:'Unsupported method'});return;}
      const practiceFile=p.match(/^\/api\/practice\/sessions\/([a-f0-9-]{36})\/(freeze|seeds|result)\.json$/);
      if(practiceFile){file(res,path.join(practice.sessionDir(practiceFile[1]),practiceFile[2]+'.json'));return;}
      const practiceMatch=p.match(/^\/api\/practice\/sessions\/([a-f0-9-]{36})\/matches\/([01])\/(replay|audit|summary|verification|independent|strategy-calls)\.json$/);
      if(practiceMatch){const state=practice.read(practiceMatch[1]),match=state.matches[Number(practiceMatch[2])];
        if(!match){send(res,404,{error:'This practice game is not verified yet'});return;}
        file(res,path.join(practice.sessionDir(state.id),match.directory,practiceMatch[3]+'.json'));return;
      }
      const curtainFile=p.match(/^\/api\/curtain-call\/(freeze|seeds|result)\.json$/);
      if(curtainFile){const s=curtain.read();
        if(!s.id||(curtainFile[1]==='result'&&s.status!=='completed')){send(res,404,{error:'Event evidence is not available yet'});return;}
        file(res,path.join(curtain.seasonDir(s.id),curtainFile[1]+'.json'));return;
      }
      if(p==='/api/curtain-call/package.zip'){
        const s=curtain.read();if(s.status!=='completed'){send(res,404,{error:'The final package is not ready'});return;}
        file(res,path.join(curtain.seasonDir(s.id),'Curtain-Call-Results.zip'));return;
      }
      const curtainMatch=p.match(/^\/api\/curtain-call\/matches\/(0|[1-9]\d?)\/(replay|audit|summary|determinism|independent)\.json$/);
      if(curtainMatch){const s=curtain.read(),m=s.matches[Number(curtainMatch[1])];
        if(!m){send(res,404,{error:'This match is not verified yet'});return;}
        file(res,path.join(curtain.seasonDir(s.id),m.evidenceDirectory,curtainMatch[2]+'.json'));return;
      }
      const seasonFile=p.match(/^\/api\/season-two\/(freeze|seeds|result)\.json$/);
      if(seasonFile){const s=season.read();
        if(!s.id||(seasonFile[1]==='result'&&s.status!=='completed')){send(res,404,{error:'Season evidence is not available yet'});return;}
        evidence(req,res,path.join(season.seasonDir(s.id),seasonFile[1]+'.json'),ledger.read());return;
      }
      const seasonMatch=p.match(/^\/api\/season-two\/matches\/(0|[1-9]\d?)\/(replay|audit|summary|determinism|independent)\.json$/);
      if(seasonMatch){const s=season.read(),m=s.matches[Number(seasonMatch[1])];
        if(!m){send(res,404,{error:'This match is not verified yet'});return;}
        evidence(req,res,path.join(season.seasonDir(s.id),m.evidenceDirectory,seasonMatch[2]+'.json'),ledger.read());return;
      }
      const match=p.match(/^\/api\/matches\/([a-f0-9-]{36})\/(map-[123]-(?:first|swapped))\/(replay|audit|summary|determinism|independent)\.json$/);
      if(match){const state=ledger.read(),challenge=state.challenges.find(c=>c.id===match[1]);
        if(!challenge){send(res,404,{error:'Challenge not found'});return;}
        if(challenge.sealed&&!access.authorized(req)){send(res,403,{error:'This record is locked. Owner access is required.'});return;}
        const f=path.join(ledger.challengeDir(match[1]),match[2],match[3]+'.json');
        if(!fs.existsSync(f))throw Error('Match evidence is not ready');evidence(req,res,f,state);return;}
      const result=p.match(/^\/api\/challenges\/([a-f0-9-]{36})\/(result|freeze|seeds)\.json$/);
      if(result){const state=ledger.read(),challenge=state.challenges.find(c=>c.id===result[1]);
        if(!challenge){send(res,404,{error:'Challenge not found'});return;}
        if(challenge.sealed&&!access.authorized(req)){send(res,403,{error:'This record is locked. Owner access is required.'});return;}
        const f=path.join(ledger.challengeDir(result[1]),result[2]+'.json');
        if(!fs.existsSync(f))throw Error('Evidence is not ready');
        evidence(req,res,f,state);return;}
      if(p==='/viewer/index.html'){
        const html=fs.readFileSync(path.join(root,'playable-v0.5/index.html'),'utf8').replace('</body>','<script src="/bridge.js"></script></body>');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
      }
      const viewer=p.match(/^\/viewer\/(engine\.js|app\.js|strategies\.js|style\.css)$/);
      if(viewer){file(res,path.join(root,'playable-v0.5',viewer[1]));return;}
      const assets={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/bridge.js':'bridge.js',
        '/practice':'practice.html','/practice.html':'practice.html','/practice.js':'practice.js','/practice.css':'practice.css',
        '/curtain-call':'curtain-call.html','/curtain-call.html':'curtain-call.html','/curtain-call.js':'curtain-call.js',
        '/season-two':'season-two.html','/season-two.html':'season-two.html','/season-two.js':'season-two.js','/season-two.css':'season-two.css'};
      if(assets[p]){file(res,path.join(__dirname,'public',assets[p]));return;}
      const downloads={'/entry-kit.zip':'Carbon-Arena-Competition-Entry-Kit-v1.zip','/rules.md':'Carbon-Arena-Rules-v0.5.md'};
      if(downloads[p]){file(res,path.join(root,downloads[p]));return;}
      send(res,404,{error:'Page not found'});
    }catch(e){if(!res.headersSent)send(res,400,{error:e.message});else res.destroy();}
  });
  server.on('close',()=>{try{if(JSON.parse(fs.readFileSync(lock)).pid===process.pid)fs.unlinkSync(lock);}catch(_){}});
  server.on('error',()=>{try{fs.unlinkSync(lock);}catch(_){}});
  server.listen(port,'127.0.0.1');return {server,ledger,season,curtain,practice,getJob:()=>job};
}
if(require.main===module){
  const args=process.argv.slice(2),arg=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
  const port=arg('--port')===undefined?4317:Number(arg('--port'));
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  const {server}=serve({dataDir:arg('--data')?path.resolve(arg('--data')):undefined,port});
  server.on('listening',()=>console.log('Carbon Arena competition: http://127.0.0.1:'+server.address().port));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={serve};
