'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {sha, fingerprint, writeNew, root} = require('./integrity.cjs');
const {seedExclusions} = require('./ledger.cjs');
const {play, compareIndependent} = require('./runner.cjs');
const {Sandbox} = require('../duel/sandbox.cjs');
const limits = require('../duel/config.cjs');
const {SEASON_POLICY, roster, schedule, standings} = require('./season-core.cjs');
const loadedIntegrity = fingerprint();
function checkRuntime() {
  const now = fingerprint(); assert.deepEqual(now, loadedIntegrity, 'Arena changed during this process; restart before continuing'); return now;
}
function drawSix(excluded, random = () => crypto.randomBytes(4).readUInt32BE(0)) {
  const seeds = [];
  for (let i = 0; i < 10000 && seeds.length < 6; i++) {
    const n = random();
    if (Number.isInteger(n) && n > 0 && n <= 4294967295 && !excluded.has(n) && !seeds.includes(n)) seeds.push(n);
  }
  assert.equal(seeds.length, 6, 'Could not select six fresh maps.'); return seeds;
}
function freezeSeason(ledger, store, input) {
  assert.equal(input.confirmedFinalVersions, true, 'Confirm that all three authors have supplied their final versions.');
  roster(input.entries);
  assert.equal(store.read().status, 'awaiting-roster', 'Season Two already has its frozen roster.');
  const catalog = ledger.read();
  assert(!catalog.challenges.some(c => ['prepared', 'running'].includes(c.status)), 'Wait until the current challenge finishes.');
  const entries = input.entries.map(id => {
    const e = catalog.entries.find(e => e.id === id);
    assert(e && !e.practiceOnly && !e.banned, 'Choose registered, eligible final versions.');
    return structuredClone(e);
  });
  assert.equal(new Set(entries.map(e => e.sha256)).size, 3);
  const integrity = checkRuntime(), id = crypto.randomUUID(), dir = store.seasonDir(id);
  // Neutral administration copies bytes opaquely. No source is returned through a season endpoint.
  for (const e of entries) {
    const bytes = fs.readFileSync(path.join(ledger.dir, 'sources', e.sha256 + '.js'));
    assert.equal(sha(bytes), e.sha256, 'Registered source bytes changed.');
    fs.mkdirSync(path.join(dir, 'sources'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'sources', e.sha256 + '.js'), bytes, {flag: 'wx'});
  }
  const freeze = {format: 'carbon-arena-season-two-freeze-v1', id, policy: SEASON_POLICY,
    entries, createdAt: new Date().toISOString(), registrationRevision: catalog.revision,
    registrationHead: catalog.head, limits, integrity};
  writeNew(path.join(dir, 'freeze.json'), freeze);
  const freezeSHA256 = sha(fs.readFileSync(path.join(dir, 'freeze.json')));
  store.append('frozen', {id, entries, freezeSHA256, createdAt: freeze.createdAt});
  try {
    const excluded = seedExclusions(ledger), seeds = drawSix(excluded);
    writeNew(path.join(dir, 'seeds.json'), {format: 'carbon-arena-season-two-maps-v1',
      freezeSHA256, seeds, selectedAt: new Date().toISOString(),
      method: 'OS cryptographic randomness after all three final versions froze; shared by all pairings',
      excludedSeeds: [...excluded].sort((a, b) => a - b)});
    store.append('reserved', {seeds, freezeSHA256, reservedAt: new Date().toISOString(),
      reservationSHA256: sha(fs.readFileSync(path.join(dir, 'seeds.json')))});
    return store.view();
  } catch (error) {store.recover(); throw error;}
}
function matchEvidenceHash(dir) {
  const names = ['replay.json', 'audit.json', 'summary.json', 'strategy-calls.json',
    'checkpoint-hashes.json', 'determinism.json', 'independent.json', 'independent.stdout.txt', 'independent.stderr.txt'];
  return sha(JSON.stringify(names.map(name => [name, sha(fs.readFileSync(path.join(dir, name)))])));
}
function verifySeason(ledger, store) {
  const s = store.read(), dir = store.seasonDir(s.id);
  const bytes = fs.readFileSync(path.join(dir, 'freeze.json')), freeze = JSON.parse(bytes);
  assert.equal(sha(bytes), s.freezeSHA256, 'Season freeze changed.');
  assert.deepEqual(freeze.policy, SEASON_POLICY); assert.deepEqual(freeze.entries, s.entries);
  assert.deepEqual(freeze.limits, limits); assert.deepEqual(checkRuntime(), freeze.integrity, 'Arena/runtime changed after the season freeze.');
  const seedBytes = fs.readFileSync(path.join(dir, 'seeds.json')), reservation = JSON.parse(seedBytes);
  assert.equal(sha(seedBytes), s.reservationSHA256, 'Shared map reservation changed.');
  assert.deepEqual(reservation.seeds, s.seeds); assert.equal(reservation.freezeSHA256, s.freezeSHA256);
  const catalog = ledger.read();
  assert(!catalog.challenges.some(c => ['prepared', 'running'].includes(c.status)), 'Another challenge is active.');
  for (const entry of s.entries) {
    const registered = catalog.entries.find(e => e.id === entry.id);
    assert(registered && !registered.banned && registered.sha256 === entry.sha256, 'A frozen entrant is no longer eligible.');
    assert.equal(sha(fs.readFileSync(path.join(dir, 'sources', entry.sha256 + '.js'))), entry.sha256, 'Frozen season source changed.');
    assert.equal(sha(fs.readFileSync(path.join(ledger.dir, 'sources', entry.sha256 + '.js'))), entry.sha256, 'Registered source archive changed.');
  }
  for (const m of s.matches) assert.equal(matchEvidenceHash(path.join(dir, m.evidenceDirectory)), m.evidenceSHA256, 'Verified match evidence changed.');
  return {s, dir, freeze};
}
async function runSeason(ledger, store, progress = () => {}) {
  let box;
  try {
    const initial = store.read();
    assert(['ready', 'paused'].includes(initial.status), 'Season is not ready to start or resume.');
    verifySeason(ledger, store);
    const started = store.append('started', {}), dir = store.seasonDir(started.id);
    box = new Sandbox();
    const entries = Object.fromEntries(started.entries.map(e => [e.id, {...e,
      source: fs.readFileSync(path.join(dir, 'sources', e.sha256 + '.js'), 'utf8')}]));
    const plan = schedule(started.entries.map(e => e.id), started.seeds);
    for (const game of plan.slice(started.matches.length)) {
      verifySeason(ledger, store);
      const relative = path.join(game.directory, 'attempt-' + started.attempts).replace(/\\/g, '/');
      const matchDir = path.join(dir, relative); fs.mkdirSync(matchDir, {recursive: true});
      const options = {seed: game.seed, colors: game.colors, entries, box, freezeSHA256: started.freezeSHA256,
        progress: turn => progress({match: game.index + 1, total: 36, round: game.round, turn, phase: 'Playing'})};
      progress({match: game.index + 1, total: 36, round: game.round, turn: 0, phase: 'Playing'});
      const first = await play(options);
      for (const [name, value] of Object.entries({replay: first.replay, audit: first.audit,
        summary: first.summary, 'strategy-calls': first.calls, 'checkpoint-hashes': first.checkpoints})) writeNew(path.join(matchDir, name + '.json'), value);
      progress({match: game.index + 1, total: 36, round: game.round, turn: 300, phase: 'Checking reproducibility'});
      const second = await play({...options, progress: () => {}});
      for (const field of ['replay', 'audit', 'calls', 'checkpoints', 'summary']) assert.deepEqual(first[field], second[field], 'Season match did not reproduce: ' + field);
      writeNew(path.join(matchDir, 'determinism.json'), {status: 'passed', turns: first.summary.turns});
      progress({match: game.index + 1, total: 36, round: game.round, turn: 300, phase: 'Independent verification'});
      await compareIndependent(matchDir);
      verifySeason(ledger, store);
      store.append('match-verified', {match: {...first.summary, ...game, evidenceDirectory: relative,
        determinism: 'passed', independentVerification: 'passed', evidenceSHA256: matchEvidenceHash(matchDir)}});
    }
    const verified = verifySeason(ledger, store).s;
    const result = standings(verified.matches, verified.seeds, verified.entries.map(e => e.id), true);
    const record = {format: 'carbon-arena-season-two-result-v1', status: 'passed', freezeSHA256: verified.freezeSHA256,
      policy: SEASON_POLICY, entries: verified.entries, seeds: verified.seeds, matches: verified.matches, score: result};
    const resultFile = path.join(dir, 'result.json');
    // Recovery after the result write but before its ledger event preserves the exact result.
    if (fs.existsSync(resultFile)) assert.deepEqual(JSON.parse(fs.readFileSync(resultFile)), record);
    else writeNew(resultFile, record);
    store.append('completed', {result, completedAt: new Date().toISOString()}); return record;
  } catch (error) {
    if (store.read().status === 'running') store.append('paused', {error: error.message});
    throw error;
  } finally {if (box) await box.close();}
}
module.exports = {drawSix, freezeSeason, runSeason, verifySeason, matchEvidenceHash};
