'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {sha}=require('./integrity.cjs');
function inventory(dataDir){
 const result={};
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,e.name),rel=path.relative(dataDir,file).replace(/\\/g,'/');
  if(['owner-key.json','server.lock','curtain-call'].includes(rel)||rel.startsWith('.validate-'))continue;
  if(e.isDirectory())walk(file);else if(e.isFile())result[rel]={bytes:fs.statSync(file).size,sha256:sha(fs.readFileSync(file))};
 }}walk(dataDir);return result;
}
function verify(dataDir,baseline){
 for(const [rel,record]of Object.entries(baseline)){
  const bytes=fs.readFileSync(path.join(dataDir,rel));assert.equal(bytes.length,record.bytes,'Historical file length changed: '+rel);assert.equal(sha(bytes),record.sha256,'Historical file changed: '+rel);
 }
 return {status:'passed',filesVerified:Object.keys(baseline).length,ownerSecretRead:false,at:new Date().toISOString()};
}
module.exports={inventory,verify};
