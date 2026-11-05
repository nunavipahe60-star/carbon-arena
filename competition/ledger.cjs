'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {POLICY,elo,score}=require('./core.cjs');
const {sha,writeNew}=require('./integrity.cjs');
const id=()=>crypto.randomUUID();
function label(value,name){if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw Error(name+' must contain 1–100 characters');return value.trim();}
class Ledger{
  constructor(dir){this.dir=path.resolve(dir);fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'events.jsonl');}
  read(){
    const state={format:'carbon-arena-competition-state-v1',policy:POLICY,entries:[],challenges:[],champion:null,revision:0,head:'0'.repeat(64)};
    const raw=fs.existsSync(this.file)?fs.readFileSync(this.file,'utf8'):'';
    if(raw&&!raw.endsWith('\n'))throw Error('Incomplete ledger write; preserve the file for recovery');
    for(const line of raw.split('\n').filter(Boolean)){
      const event=JSON.parse(line),{hash,...body}=event;
      assert.equal(body.sequence,state.revision+1,'Ledger sequence mismatch');assert.equal(body.previous,state.head,'Ledger chain mismatch');
      assert.equal(hash,sha(JSON.stringify(body)),'Ledger hash mismatch');
      const d=body.data;
      if(body.type==='registered'){
        assert.ok(!state.entries.some(e=>e.id===d.id||e.sha256===d.sha256));
        state.entries.push({...d,rating:POLICY.initialRating,played:0,wins:0,draws:0,losses:0});
      }else if(body.type==='entries-relabeled'){
        assert.ok(Array.isArray(d.entries)&&d.entries.length>0,'Choose entries to relabel');
        assert.equal(new Set(d.entries.map(e=>e.id)).size,d.entries.length,'Duplicate entry');
        for(const update of d.entries){
          assert.deepEqual(Object.keys(update).sort(),['id','model','name','notes','version'],'Only display metadata can change');
          const entry=state.entries.find(e=>e.id===update.id);assert.ok(entry,'Unknown entry');
          for(const field of ['name','model','version'])assert.equal(update[field],label(update[field],field));
          assert.ok(typeof update.notes==='string'&&update.notes.length<=2000,'Invalid notes');
          Object.assign(entry,update,{relabeled:true});
        }
      }else if(body.type==='entries-banned'){
        assert.ok(Array.isArray(d.ids)&&d.ids.length>0&&new Set(d.ids).size===d.ids.length);
        for(const eid of d.ids){const entry=state.entries.find(e=>e.id===eid);assert.ok(entry,'Unknown entry');entry.banned=true;}
      }else if(body.type==='challenge-sealed'){
        const challenge=state.challenges.find(c=>c.id===d.id);assert.ok(challenge,'Unknown challenge');
        assert.ok(['passed','failed'].includes(challenge.status),'Wait until the challenge finishes');challenge.sealed=true;
      }else if(body.type==='prepared'){
        assert.ok(!state.challenges.some(c=>c.id===d.id));
        assert.match(d.id,/^[a-f0-9-]{36}$/);assert.match(d.freezeSHA256,/^[a-f0-9]{64}$/);
        assert.equal(typeof d.rated,'boolean');
        assert.ok(Array.isArray(d.seeds)&&d.seeds.length===3&&new Set(d.seeds).size===3);
        assert.ok(d.seeds.every(n=>Number.isInteger(n)&&n>=0&&n<=4294967295));
        assert.ok(!state.challenges.some(c=>c.seeds.some(n=>d.seeds.includes(n))),'Maps were already reserved');
        assert.ok(d.entries.length===2&&d.entries[0]!==d.entries[1]);
        for(const eid of d.entries){const entry=state.entries.find(e=>e.id===eid);assert.ok(entry);assert.ok(!entry.banned,'This entry is banned from new challenges');}
        if(d.rated){
          assert.ok(d.entries.every(eid=>!state.entries.find(e=>e.id===eid).practiceOnly));
          assert.ok(!state.challenges.some(c=>c.rated&&c.entries.every(eid=>d.entries.includes(eid))),'Official pair already attempted');
        }
        state.challenges.push({...d,status:'prepared'});
      }else{
        const c=state.challenges.find(c=>c.id===d.id);assert.ok(c,'Unknown challenge');
        if(body.type==='started'){assert.equal(c.status,'prepared');Object.assign(c,{status:'running'});}
        else if(body.type==='failed'){assert.ok(['prepared','running'].includes(c.status));Object.assign(c,{status:'failed',error:d.error});}
        else if(body.type==='completed'){
          assert.equal(c.status,'running');const result=d.result;
          assert.equal(result.status,'passed');assert.equal(result.freezeSHA256,c.freezeSHA256);
          assert.deepEqual(result.seeds,c.seeds);assert.deepEqual(result.entries,c.entries);
          const scoring=score(result.matches,c.seeds,c.entries);
          assert.deepEqual(result.score,scoring);
          Object.assign(c,{status:'passed',result,completedAt:body.at});
          if(c.rated){
            const [a,b]=c.entries.map(eid=>state.entries.find(e=>e.id===eid));
            assert.ok(!a.practiceOnly&&!b.practiceOnly);
            c.rating=elo(a.rating,b.rating,scoring.winner===null?0.5:scoring.winner===a.id?1:0);
            [a.rating,b.rating]=c.rating.after;
            for(const e of [a,b]){e.played++;if(scoring.winner===null)e.draws++;else if(scoring.winner===e.id)e.wins++;else e.losses++;}
            const before=state.champion;
            if(scoring.winner&&(!before||c.entries.includes(before)))state.champion=scoring.winner;
            c.title={before,after:state.champion};
          }
        }else throw Error('Unknown ledger event');
      }
      state.head=hash;state.revision=body.sequence;
    }
    return state;
  }
  append(type,data){const s=this.read(),body={sequence:s.revision+1,previous:s.head,at:new Date().toISOString(),type,data};
    const line=JSON.stringify({...body,hash:sha(JSON.stringify(body))})+'\n';
    // Validate the prospective transition before appending to durable evidence.
    const temp=path.join(this.dir,`.validate-${id()}`);fs.mkdirSync(temp);
    try{fs.writeFileSync(path.join(temp,'events.jsonl'),(fs.existsSync(this.file)?fs.readFileSync(this.file,'utf8'):'')+line);new Ledger(temp).read();}
    finally{fs.rmSync(temp,{recursive:true,force:true});}
    const fd=fs.openSync(this.file,'a');try{fs.writeSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return this.read();
  }
  register(metadata,source,{practiceOnly=false}={}){
    if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>1024*1024)throw Error('Choose a JavaScript file up to 1 MiB');
    if(Buffer.from(source,'utf8').toString('utf8')!==source)throw Error('Strategy must be valid UTF-8 text');
    const hash=sha(Buffer.from(source,'utf8')),s=this.read();
    if(s.entries.some(e=>e.sha256===hash))throw Error('These exact strategy bytes are already registered');
    const entry={id:id(),name:label(metadata.name,'Name'),model:label(metadata.model,'Model'),version:label(metadata.version,'Version'),
      notes:typeof metadata.notes==='string'?metadata.notes.trim().slice(0,2000):'',sha256:hash,practiceOnly,registeredAt:new Date().toISOString()};
    const file=path.join(this.dir,'sources',hash+'.js');fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file))assert.equal(sha(fs.readFileSync(file)),hash);else{const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,source);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    this.append('registered',entry);return entry;
  }
  banEntries(ids){return this.append('entries-banned',{ids});}
  relabelEntries(entries){return this.append('entries-relabeled',{entries});}
  sealChallenge(id){return this.append('challenge-sealed',{id});}
  source(entry){const bytes=fs.readFileSync(path.join(this.dir,'sources',entry.sha256+'.js'));assert.equal(sha(bytes),entry.sha256,'Archived strategy changed');return bytes.toString('utf8');}
  challengeDir(cid){if(!/^[a-f0-9-]{36}$/.test(cid))throw Error('Invalid challenge ID');return path.join(this.dir,'challenges',cid);}
  recover(){for(const c of this.read().challenges)if(['prepared','running'].includes(c.status))this.append('failed',{id:c.id,error:'Interrupted before completion. Seeds stay consumed; no ratings were applied.'});}
}
function seedExclusions(ledger){
  const reserved=[],dirs=[{dir:path.join(ledger.dir,'challenges'),count:3},
    {dir:path.join(ledger.dir,'season-two','seasons'),count:6},
    {dir:path.join(ledger.dir,'curtain-call','seasons'),count:10},
    {dir:path.join(ledger.dir,'practice','sessions'),count:1}],verification=path.join(__dirname,'verification');
  // Public rehearsal maps also stay unavailable to the production ladder.
  if(fs.existsSync(verification))for(const name of fs.readdirSync(verification))
    if(/^rehearsal-[a-zA-Z0-9-]+$/.test(name)){
      dirs.push({dir:path.join(verification,name,'archive','challenges'),count:3});
      dirs.push({dir:path.join(verification,name,'archive','season-two','seasons'),count:6});
      dirs.push({dir:path.join(verification,name,'archive','curtain-call','seasons'),count:10});
      dirs.push({dir:path.join(verification,name,'archive','practice','sessions'),count:1});
    }
  // Include reservations interrupted before their prepared event was appended.
  for(const {dir,count} of dirs)if(fs.existsSync(dir))for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name,'seeds.json');if(fs.existsSync(file)){
      const record=JSON.parse(fs.readFileSync(file));
      assert.ok(Array.isArray(record.seeds)&&record.seeds.length===count&&new Set(record.seeds).size===count&&
        record.seeds.every(n=>Number.isInteger(n)&&n>0&&n<=4294967295),'Invalid retained seed reservation');
      reserved.push(...record.seeds);
    }
  }
  const publicSeeds=JSON.parse(fs.readFileSync(path.join(__dirname,'seed-history.json'))).seeds;
  return new Set([0,1599512364,956325211,6278101,2099498940,2025122752,1941950568,1722479056,1152197638,1001617435,679249739,...publicSeeds,...reserved,...ledger.read().challenges.flatMap(c=>c.seeds)]);
}
function chooseSeeds(excluded,random=()=>crypto.randomBytes(4).readUInt32BE(0)){
  const seeds=[];for(let attempts=0;seeds.length<3&&attempts<10000;attempts++){const n=random();
    if(Number.isInteger(n)&&n>=0&&n<=4294967295&&!excluded.has(n)&&!seeds.includes(n))seeds.push(n);}
  if(seeds.length!==3)throw Error('Could not select three fresh maps');return seeds;
}
module.exports={Ledger,id,label,seedExclusions,chooseSeeds};
