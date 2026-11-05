'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Sandbox} = require('../sandbox.cjs');
const E = require('../../tests/fixtures/engine-v04.js');
const snapshot = E.snapshot(E.create(1));
const example = fs.readFileSync(path.join(__dirname,'../example-strategy.js'),'utf8');

test('explicit memory persists, globals reset, both colors normalize identically', async () => {
  const box = new Sandbox();
  try {
    for (const team of E.TEAMS) {
      const first = await box.call(example,snapshot,team,null);
      assert.equal(first.ok,true);
      const second = await box.call(example,snapshot,team,first.memory);
      assert.equal(second.ok,true); assert.equal(second.memory.calls,2);
      assert.deepEqual(E.normalize(E.create(1),{[team]:first.decision})[team],first.decision);
    }
    const source = 'var counter=0; function decide(){return {decision:{},memory:++counter}}';
    assert.equal((await box.call(source,snapshot,'Red',null)).memory,1);
    assert.equal((await box.call(source,snapshot,'Red',null)).memory,1);
  } finally { await box.close(); }
});

test('host, clocks, dynamic compilation and constructor escape routes are unavailable', async () => {
  const box = new Sandbox();
  try {
    const result = await box.call(`function decide(){
      return {decision:{},memory:{
        globals: [typeof require,typeof process,typeof module,typeof fetch,
          typeof Date,typeof performance,typeof Intl,typeof eval,typeof Function,
          typeof WebAssembly,typeof Math.random,typeof console,typeof std,typeof os],
        routes: [typeof (()=>{}).constructor,typeof (async()=>{}).constructor,
          typeof (function*(){}).constructor,typeof (async function*(){}).constructor,
          typeof Object.constructor,typeof ''.localeCompare]
      }};
    }`,snapshot,'Red',null);
    assert.equal(result.ok,true);
    assert.ok(result.memory.globals.concat(result.memory.routes).every(v=>v==='undefined'));
    for (const source of [
      'function decide(){return require("node:fs").readFileSync("../playable/engine.js")}',
      'function decide(){return ({}).constructor.constructor("return process")()}',
      'function decide(){return import("node:fs")}',
      'function decide(){return {decision:{},memory:Date.now()}}'
    ]) assert.equal((await box.call(source,snapshot,'Red',null)).ok,false);
  } finally { await box.close(); }
});

test('mutating public inputs cannot change engine state or another call', async () => {
  const box = new Sandbox(), before = JSON.stringify(snapshot);
  try {
    const source = 'function decide(s,t,m){s.ground[0]=999;s.vehicles.length=0;return {decision:{},memory:s.ground[0]}}';
    assert.equal((await box.call(source,snapshot,'Red',null)).memory,999);
    assert.equal(JSON.stringify(snapshot),before);
    const clean = await box.call('function decide(s){return {decision:{},memory:s.ground[0]}}',snapshot,'Blue',null);
    assert.equal(clean.memory,snapshot.ground[0]);
  } finally { await box.close(); }
});

test('invalid, asynchronous, accessor, cyclic and oversized output is rejected', async () => {
  const box = new Sandbox({memoryBytes:128,returnBytes:512});
  try {
    const bodies = [
      'return {decision:{}}', 'return {decision:null,memory:null}',
      'return {decision:{failure:"forged"},memory:null}',
      'return {decision:{},memory:NaN}', 'return {decision:{},memory:Infinity}',
      'return {decision:{},memory:undefined}', 'return {decision:{},memory:1n}',
      'return Promise.resolve({decision:{},memory:null})',
      'let m={};m.m=m;return {decision:{},memory:m}',
      'return {decision:{},memory:new Map()}',
      'return {decision:{},get memory(){return null}}',
      'return {decision:{},memory:"a".repeat(129)}',
      'return {decision:{extra:"a".repeat(513)},memory:null}',
      'return {decision:{},memory:"é".repeat(100)}'
    ];
    for (const body of bodies) {
      const r = await box.call('function decide(){'+body+'}',snapshot,'Red',null);
      assert.equal(r.ok,false,body);
    }
    assert.equal((await box.call(example,snapshot,'Blue',null)).ok,true);
  } finally { await box.close(); }
});

test('infinite initialization and decisions time out, then the sandbox recovers', async () => {
  const box = new Sandbox({timeMs:50,watchdogGraceMs:100});
  try {
    for (const source of ['while(true){}; function decide(){}','function decide(){while(true){}}']) {
      const result = await box.call(source,snapshot,'Red',null);
      assert.equal(result.ok,false); assert.equal(result.code,'TIMEOUT');
    }
    assert.equal((await box.call(example,snapshot,'Blue',null)).ok,true);
  } finally { await box.close(); }
});

test('guest heap exhaustion is contained and subsequent calls work', async () => {
  const box = new Sandbox({heapBytes:8*1024*1024,timeMs:500});
  try {
    const result = await box.call('function decide(){const a=[];for(let i=0;i<1000000;i++)a.push({i,data:"value"});return {decision:{},memory:null}}',snapshot,'Red',null);
    assert.equal(result.ok,false);
    assert.equal((await box.call(example,snapshot,'Blue',null)).ok,true);
  } finally { await box.close(); }
});

test('native stalls are bounded by the watchdog and recovery starts a fresh worker', async () => {
  const box = new Sandbox({timeMs:25,watchdogGraceMs:50});
  try {
    const result = await box.call('function decide(){ /(a+)+$/.test("a".repeat(30000)+"!"); return {decision:{},memory:null}}',snapshot,'Red',null);
    assert.equal(result.ok,false); assert.equal(result.code,'TIMEOUT');
    assert.equal((await box.call(example,snapshot,'Blue',null)).ok,true);
  } finally { await box.close(); }
});

test('prototype or JSON tampering cannot bypass finite-output validation', async () => {
  const box = new Sandbox();
  try {
    for (const prefix of [
      'JSON.stringify=()=>"{}";',
      'Number.isFinite=()=>true;',
      'Object.prototype.toJSON=function(){return null};',
      'Array.prototype.toJSON=function(){return null};'
    ]) {
      const result = await box.call(prefix+'function decide(){return {decision:{},memory:NaN}}',snapshot,'Red',null);
      assert.equal(result.ok,false);
    }
    assert.equal((await box.call(example,snapshot,'Blue',null)).ok,true);
  } finally { await box.close(); }
});
