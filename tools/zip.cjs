'use strict';
// Small deterministic ZIP writer for source kits and local result downloads.
// Stored entries use no native dependencies. Existing archives are never overwritten.
const fs = require('node:fs'), path = require('node:path');
const crcTable = Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function writeZip(output, entries) {
  const parts=[], central=[];let offset=0;
  if(entries.length>65535)throw Error('Too many ZIP entries');
  for(const [name, value] of entries){
    if(!/^[\x20-\x7e]+$/.test(name)||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\'))throw Error('Invalid ZIP path');
    const filename=Buffer.from(name),bytes=Buffer.from(value),crc=crc32(bytes);
    if(bytes.length>0xffffffff)throw Error('ZIP entry too large');
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(33,12);
    h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    parts.push(h,filename,bytes);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(33,14);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(bytes.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    central.push(c,filename);offset+=h.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  fs.writeFileSync(output,Buffer.concat([...parts,directory,end]),{flag:'wx'});
}
function zipDirectory(dir,output,prefix){
  const entries=[];
  function walk(base){for(const e of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    const file=path.join(base,e.name);
    if(e.isDirectory())walk(file);
    else if(e.isFile())entries.push([prefix+'/'+path.relative(dir,file).replace(/\\/g,'/'),fs.readFileSync(file)]);
    else throw Error('Refusing a linked archive member');
  }}
  walk(dir);writeZip(output,entries);
}
module.exports={writeZip,zipDirectory};
