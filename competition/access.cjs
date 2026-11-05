'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const OWNER_COOKIE='carbon-arena-owner',SESSION_MS=2*60*60*1000;
function ownerAccess(dataDir){
  const file=path.join(dataDir,'owner-key.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({key:crypto.randomBytes(32).toString('hex')})+'\n',{flag:'wx',mode:0o600});
  const {key}=JSON.parse(fs.readFileSync(file,'utf8'));
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid owner access key');
  const sessions=new Map();
  const cookie=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(OWNER_COOKIE+'='))?.slice(OWNER_COOKIE.length+1);
  function authorized(req){const id=cookie(req),expires=sessions.get(id);if(!expires)return false;if(Date.now()>=expires){sessions.delete(id);return false;}return true;}
  function unlock(supplied){
    if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(key,'hex')))return null;
    for(const [id,expires]of sessions)if(Date.now()>=expires)sessions.delete(id);
    const session=crypto.randomBytes(32).toString('hex');sessions.set(session,Date.now()+SESSION_MS);
    return `${OWNER_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}`;
  }
  function lock(req){sessions.delete(cookie(req));return `${OWNER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
  return {authorized,unlock,lock};
}
function visibleChallenge(c,owner){
  if(!c.sealed||owner)return c;
  const value={id:c.id,entries:c.entries,rated:c.rated,status:c.status,createdAt:c.createdAt,completedAt:c.completedAt,sealed:true};
  if(c.status==='passed')value.result={score:{winner:c.result.score.winner}};
  return value;
}
function publicEvidence(value,state){
  const aliases=new Map(state.entries.filter(e=>e.relabeled).map(e=>[e.id,e]));let changed=false;
  function entry(item){
    if(!item||typeof item!=='object')return item;
    const result={...item};
    const alias=aliases.get(item.id);
    if(alias)for(const field of ['name','model','version','notes'])if(Object.hasOwn(item,field)){
      changed ||= item[field]!==alias[field];result[field]=alias[field];
    }
    return result;
  }
  // Only known participant metadata locations are projected. Decisions, events,
  // settings and private-memory-shaped data must retain their exact meaning.
  function project(item){
    if(!item||typeof item!=='object'||Array.isArray(item))return item;
    const result={...item};
    if(Array.isArray(item.entries))result.entries=item.entries.map(entry);
    if(item.strategies?.entrants)result.strategies={...item.strategies,
      entrants:Object.fromEntries(Object.entries(item.strategies.entrants).map(([team,e])=>[team,entry(e)]))};
    if(Array.isArray(item.challenges))result.challenges=item.challenges.map(project);
    if(item.result)result.result=project(item.result);
    return result;
  }
  const result=project(value);
  if(changed)result.metadataProjection='current-entry-labels-v1';
  return result;
}
function visibleState(state,owner){
  const value={...state,challenges:state.challenges.map(c=>visibleChallenge(c,owner)),owner};
  return owner?value:publicEvidence(value,state);
}
module.exports={ownerAccess,visibleChallenge,visibleState,publicEvidence};
