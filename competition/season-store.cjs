'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {sha} = require('./integrity.cjs');
const {SEASON_POLICY, roster, validSeeds, schedule, standings} = require('./season-core.cjs');
function initial() {
  return {format: 'carbon-arena-season-two-state-v1', policy: SEASON_POLICY,
    status: 'awaiting-roster', revision: 0, head: '0'.repeat(64), matches: [], attempts: 0};
}
function transition(s, type, d) {
  if (type === 'frozen') {
    assert.equal(s.status, 'awaiting-roster', 'Season Two already has a frozen roster.');
    assert.match(d.id, /^[a-f0-9-]{36}$/); assert.match(d.freezeSHA256, /^[a-f0-9]{64}$/);
    roster(d.entries.map(e => e.id)); assert.equal(new Set(d.entries.map(e => e.sha256)).size, 3);
    assert(d.entries.every(e => /^[a-f0-9]{64}$/.test(e.sha256) && !e.practiceOnly && !e.banned));
    Object.assign(s, d, {status: 'frozen'});
  } else if (type === 'reserved') {
    assert.equal(s.status, 'frozen'); validSeeds(d.seeds);
    assert.equal(d.freezeSHA256, s.freezeSHA256);
    Object.assign(s, {seeds: d.seeds, reservedAt: d.reservedAt, reservationSHA256: d.reservationSHA256, status: 'ready'});
    assert.match(s.reservationSHA256, /^[a-f0-9]{64}$/);
  } else if (type === 'started') {
    assert(['ready', 'paused'].includes(s.status), 'Season is not ready to run.');
    assert(s.seeds); s.status = 'running'; s.attempts++; s.error = null;
  } else if (type === 'match-verified') {
    assert.equal(s.status, 'running');
    assert.equal(d.match.index, s.matches.length, 'A verified match cannot be counted twice.');
    assert.equal(d.match.determinism, 'passed'); assert.equal(d.match.independentVerification, 'passed');
    assert.match(d.match.evidenceSHA256, /^[a-f0-9]{64}$/);
    assert.equal(d.match.evidenceDirectory, `${d.match.directory}/attempt-${s.attempts}`, 'Unexpected evidence directory.');
    standings([...s.matches, d.match], s.seeds, s.entries.map(e => e.id));
    s.matches.push(d.match);
  } else if (type === 'paused') {
    assert.equal(s.status, 'running'); assert.equal(typeof d.error, 'string');
    s.status = 'paused'; s.error = d.error;
  } else if (type === 'blocked') {
    assert.equal(s.status, 'frozen'); s.status = 'blocked'; s.error = d.error;
  } else if (type === 'completed') {
    assert.equal(s.status, 'running');
    const result = standings(s.matches, s.seeds, s.entries.map(e => e.id), true);
    assert.deepEqual(d.result, result);
    s.status = 'completed'; s.result = result; s.completedAt = d.completedAt;
  } else throw Error('Unknown season event.');
  return s;
}
class SeasonStore {
  constructor(dataDir) {this.dir = path.join(path.resolve(dataDir), 'season-two'); this.file = path.join(this.dir, 'events.jsonl');}
  seasonDir(id) {assert.match(id, /^[a-f0-9-]{36}$/); return path.join(this.dir, 'seasons', id);}
  read() {
    const state = initial(), raw = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8') : '';
    assert(!raw || raw.endsWith('\n'), 'Incomplete season ledger write; retain evidence for recovery.');
    for (const line of raw.split('\n').filter(Boolean)) {
      const {hash, ...body} = JSON.parse(line);
      assert.equal(body.sequence, state.revision + 1, 'Season sequence mismatch.');
      assert.equal(body.previous, state.head, 'Season chain mismatch.');
      assert.equal(sha(JSON.stringify(body)), hash, 'Season ledger hash mismatch.');
      transition(state, body.type, body.data); state.head = hash; state.revision = body.sequence;
    }
    return state;
  }
  append(type, data) {
    const current = this.read(); transition(structuredClone(current), type, data);
    const body = {sequence: current.revision + 1, previous: current.head, at: new Date().toISOString(), type, data};
    fs.mkdirSync(this.dir, {recursive: true});
    const fd = fs.openSync(this.file, 'a');
    try {fs.writeFileSync(fd, JSON.stringify({...body, hash: sha(JSON.stringify(body))}) + '\n'); fs.fsyncSync(fd);}
    finally {fs.closeSync(fd);}
    return this.read();
  }
  recover() {
    const s = this.read();
    if (s.status === 'running') this.append('paused', {error: 'Service interrupted. Resume uses the same frozen entries and six maps; verified matches are retained.'});
    if (s.status === 'frozen') {
      const file = path.join(this.seasonDir(s.id), 'seeds.json');
      if (fs.existsSync(file)) {
        const bytes = fs.readFileSync(file), reservation = JSON.parse(bytes);
        assert.equal(reservation.freezeSHA256, s.freezeSHA256);
        this.append('reserved', {seeds: reservation.seeds, freezeSHA256: s.freezeSHA256,
          reservationSHA256: sha(bytes), reservedAt: reservation.selectedAt});
      } else this.append('blocked', {error: 'Freeze was interrupted before a map reservation was committed. Preserve the archive for organizer recovery.'});
    }
  }
  view() {
    const s = this.read();
    return {...s, scores: s.seeds ? standings(s.matches, s.seeds, s.entries.map(e => e.id), s.status === 'completed') : null,
      schedule: s.seeds ? schedule(s.entries.map(e => e.id), s.seeds) : []};
  }
}
module.exports = {SeasonStore, transition};
