'use strict';
const {Worker} = require('node:worker_threads');
const path = require('node:path');
const config = require('./config.cjs');

class Sandbox {
  constructor(limits = {}) {
    this.limits = {...config, ...limits};
    this.worker = null; this.sequence = 0; this.busy = false;
  }
  async start() {
    if (this.worker) return;
    const worker = new Worker(path.join(__dirname,'sandbox-worker.cjs'), {
      resourceLimits:{maxOldGenerationSizeMb:512, stackSizeMb:4}
    });
    this.worker = worker;
    try {
      await new Promise((resolve,reject) => {
        const timer = setTimeout(() => finish(new Error('Sandbox startup timed out')), this.limits.startupMs);
        const onMessage = m => { if (m.ready) finish(); };
        const onError = () => finish(new Error('Sandbox startup failed'));
        const onExit = () => finish(new Error('Sandbox exited during startup'));
        function finish(error) {
          clearTimeout(timer); worker.off('message',onMessage); worker.off('error',onError); worker.off('exit',onExit);
          error ? reject(error) : resolve();
        }
        worker.on('message',onMessage); worker.once('error',onError); worker.once('exit',onExit);
      });
    } catch (error) { await this.close(); throw error; }
  }
  async call(source, snapshot, team, memory) {
    if (this.busy) throw new Error('Sandbox calls must run serially');
    if (!['Red','Blue'].includes(team)) throw new Error('Unknown team');
    if (Buffer.byteLength(source,'utf8') > this.limits.sourceBytes) throw new Error('Source exceeds limit');
    const memoryText = JSON.stringify(memory), snapshotText = JSON.stringify(snapshot);
    if (Buffer.byteLength(memoryText,'utf8') > this.limits.memoryBytes) throw new Error('Input memory exceeds limit');
    this.busy = true;
    try {
      await this.start();
      const worker = this.worker, id = ++this.sequence;
      const response = await new Promise(resolve => {
        let done = false;
        let timer = setTimeout(() => finish({ok:false,code:'WORKER_FAILURE'},true),this.limits.startupMs);
        const onMessage = m => {
          if (m.id !== id) return;
          if (m.started) {
            clearTimeout(timer);
            timer = setTimeout(() => finish({ok:false,code:'TIMEOUT'},true),
              this.limits.timeMs + this.limits.watchdogGraceMs);
          } else finish(m);
        };
        const onError = () => finish({ok:false,code:'WORKER_FAILURE'},true);
        const onExit = () => finish({ok:false,code:'WORKER_FAILURE'},true);
        const finish = (value, terminate = false) => {
          if (done) return; done = true;
          clearTimeout(timer); worker.off('message',onMessage); worker.off('error',onError); worker.off('exit',onExit);
          if (terminate) {
            this.worker = null;
            worker.terminate().then(() => resolve(value), () => resolve(value));
          } else resolve(value);
        };
        worker.on('message',onMessage); worker.once('error',onError); worker.once('exit',onExit);
        worker.postMessage({id,source,snapshotText,team,memoryText,limits:this.limits});
      });
      if (!response.ok) return response;
      if (typeof response.outputText !== 'string' || Buffer.byteLength(response.outputText,'utf8') > this.limits.returnBytes)
        return {ok:false,code:'INVALID_OUTPUT'};
      let output;
      try { output = JSON.parse(response.outputText); } catch (_) { return {ok:false,code:'INVALID_OUTPUT'}; }
      if (!output || !output.decision || Array.isArray(output.decision) || typeof output.decision !== 'object' ||
        !Object.hasOwn(output,'memory') || Object.hasOwn(output.decision,'failure') ||
        Buffer.byteLength(JSON.stringify(output.memory),'utf8') > this.limits.memoryBytes)
        return {ok:false,code:'INVALID_OUTPUT'};
      return {ok:true, decision:output.decision, memory:output.memory, elapsedMs:response.elapsedMs};
    } finally { this.busy = false; }
  }
  async close() {
    const worker = this.worker; this.worker = null;
    if (worker) await worker.terminate();
  }
}
module.exports = {Sandbox};
