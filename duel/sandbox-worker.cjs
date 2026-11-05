'use strict';
const {parentPort} = require('node:worker_threads');
const {performance} = require('node:perf_hooks');
const {getQuickJS} = require('quickjs-emscripten');
const guest = require('./guest.cjs');

getQuickJS().then(QuickJS => {
  parentPort.on('message', request => {
    const {id, source, snapshotText, team, memoryText, limits} = request;
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(limits.heapBytes);
    runtime.setMaxStackSize(limits.stackBytes);
    const context = runtime.newContext();
    const handles = [];
    let start, interrupted = false, response;
    function take(result) {
      if (result.error) { result.error.dispose(); throw new Error('Guest rejected'); }
      handles.push(result.value); return result.value;
    }
    try {
      const invoke = take(context.evalCode(guest, 'runner-bootstrap.js'));
      start = performance.now();
      parentPort.postMessage({id, started:true});
      runtime.setInterruptHandler(() => {
        if (performance.now()-start >= limits.timeMs) interrupted = true;
        return interrupted;
      });
      take(context.evalCode(source, 'strategy.js', {type:'global'}));
      const fn = context.getProp(context.global, 'decide'); handles.push(fn);
      if (context.typeof(fn) !== 'function') throw new Error('Missing decide');
      const args = [snapshotText, team, memoryText].map(value => {
        const h = context.newString(value); handles.push(h); return h;
      });
      for (const n of [limits.memoryBytes, limits.returnBytes]) {
        const h = context.newNumber(n); handles.push(h); args.push(h);
      }
      const value = take(context.callFunction(invoke, context.undefined, fn, ...args));
      const outputText = context.getString(value);
      const elapsedMs = performance.now()-start;
      response = elapsedMs >= limits.timeMs || interrupted
        ? {ok:false, code:'TIMEOUT', elapsedMs}
        : {ok:true, outputText, elapsedMs};
    } catch (_) {
      response = {ok:false, code:interrupted ? 'TIMEOUT' : 'GUEST_ERROR',
        elapsedMs:start === undefined ? 0 : performance.now()-start};
    } finally {
      runtime.removeInterruptHandler();
      for (let i=handles.length-1; i>=0; i--) handles[i].dispose();
      context.dispose(); runtime.dispose();
    }
    parentPort.postMessage({id, ...response});
  });
  parentPort.postMessage({ready:true});
}).catch(() => process.exit(1));
