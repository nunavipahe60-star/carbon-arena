'use strict';

// Runs inside QuickJS before contestant source. No host functions are bound.
// The returned closure is held only by the host as a guest handle; contestant
// code cannot replace its captured parser, validator or serializer.
module.exports = `(() => {
  const parse = JSON.parse, stringify = JSON.stringify;
  const keys = Object.keys, descriptors = Object.getOwnPropertyDescriptors;
  const getPrototypeOf = Object.getPrototypeOf, ownKeys = Reflect.ownKeys;
  const isArray = Array.isArray, finite = Number.isFinite;
  const apply = Reflect.apply, charCodeAt = String.prototype.charCodeAt;
  const objectPrototype = Object.prototype, arrayPrototype = Array.prototype;
  const setAdd = Set.prototype.add, setHas = Set.prototype.has, setDelete = Set.prototype.delete;
  const NativeSet = Set, NativeError = Error;
  const hasOwn = Object.prototype.hasOwnProperty;
  function fail(message) { throw new NativeError(message); }
  function bytes(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = apply(charCodeAt, s, [i]);
      if (c < 128) n++;
      else if (c < 2048) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
        apply(charCodeAt, s, [i+1]) >= 0xDC00 && apply(charCodeAt, s, [i+1]) <= 0xDFFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function validate(root) {
    const ancestors = new NativeSet();
    const stack = [{value: root, exit: false}];
    // Use index assignment/pop by length, independent of modified prototypes.
    while (stack.length) {
      const item = stack[stack.length-1]; stack.length--;
      const v = item.value;
      if (item.exit) { apply(setDelete, ancestors, [v]); continue; }
      if (v === null || typeof v === 'boolean' || typeof v === 'string') continue;
      if (typeof v === 'number') { if (!finite(v)) fail('Non-finite number'); continue; }
      if (typeof v !== 'object') fail('Non-JSON value');
      const array = isArray(v), proto = getPrototypeOf(v);
      if (array ? proto !== arrayPrototype : proto !== objectPrototype && proto !== null) fail('Non-JSON object');
      if (apply(setHas, ancestors, [v])) fail('Cyclic output');
      apply(setAdd, ancestors, [v]);
      stack[stack.length] = {value:v, exit:true};
      const ds = descriptors(v), names = ownKeys(ds);
      for (let i=0; i<names.length; i++) {
        const k = names[i], d = ds[k];
        if (typeof k !== 'string' || !apply(hasOwn,d,['value'])) fail('Accessor or symbol output');
        if (array && k === 'length') continue;
        if (!d.enumerable) fail('Non-enumerable output');
        if (array && (String(Number(k)) !== k || Number(k) < 0 || Number(k) >= v.length || !Number.isInteger(Number(k)))) fail('Non-index array property');
        stack[stack.length] = {value:d.value, exit:false};
      }
      if (array && names.length !== v.length + 1) fail('Sparse array');
    }
  }
  // Constructor routes are closed before contestant initialization.
  const functionPrototypes = [Function.prototype,
    getPrototypeOf(async function(){}), getPrototypeOf(function*(){}),
    getPrototypeOf(async function*(){})];
  for (const p of functionPrototypes) Object.defineProperty(p,'constructor',
    {value:undefined, writable:false, configurable:false});
  for (const name of ['Date','performance','Intl','eval','Function','WebAssembly',
    'WeakRef','FinalizationRegistry','SharedArrayBuffer','Atomics','console',
    'fetch','XMLHttpRequest','require','process','module','Buffer','setTimeout',
    'setInterval','queueMicrotask','std','os']) {
    Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});
  }
  Object.defineProperty(Math,'random',{value:undefined,writable:false,configurable:false});
  Object.defineProperty(String.prototype,'localeCompare',{value:undefined,writable:false,configurable:false});
  // Freeze the intrinsic object graph so output validation/serialization cannot
  // be redirected through modified built-in methods or inherited toJSON hooks.
  const seen = new NativeSet(), pending = [];
  for (const k of ownKeys(globalThis)) {
    const d = Object.getOwnPropertyDescriptor(globalThis,k);
    if (d && 'value' in d && d.value !== globalThis) pending[pending.length] = d.value;
  }
  pending[pending.length] = objectPrototype;
  pending[pending.length] = arrayPrototype;
  for (const p of functionPrototypes) pending[pending.length] = p;
  while (pending.length) {
    const value=pending[pending.length-1]; pending.length--;
    if (value===null || (typeof value!=='object' && typeof value!=='function') || seen.has(value)) continue;
    seen.add(value);
    const prototype=getPrototypeOf(value);
    if(prototype)pending[pending.length]=prototype;
    const ds=descriptors(value);
    for(const name of ownKeys(ds)) {
      const d=ds[name];
      if('value' in d)pending[pending.length]=d.value;
      if(d.get)pending[pending.length]=d.get;
      if(d.set)pending[pending.length]=d.set;
    }
    Object.freeze(value);
  }
  return function invoke(fn, snapshotText, team, memoryText, memoryLimit, returnLimit) {
    const result = fn(parse(snapshotText), team, parse(memoryText));
    validate(result);
    if (result === null || isArray(result) || typeof result !== 'object' ||
      !apply(hasOwn,result,['decision']) || !apply(hasOwn,result,['memory']) ||
      result.decision === null || isArray(result.decision) || typeof result.decision !== 'object' ||
      apply(hasOwn,result.decision,['failure'])) fail('Invalid result envelope');
    const memory = stringify(result.memory), output = stringify(result);
    if (memory.length > memoryLimit || bytes(memory) > memoryLimit) fail('Private memory too large');
    if (output.length > returnLimit || bytes(output) > returnLimit) fail('Return value too large');
    return output;
  };
})()`;
