'use strict';
const assert = require('node:assert/strict');
const CURTAIN_POLICY = Object.freeze({
  id: 'carbon-arena-curtain-call-v1', event: 'Curtain Call', rulesVersion: '0.5',
  players: 3, sharedMaps: 10, rounds: 2, mapsPerRound: 5,
  mapsPerPair: 10, mapsPerPlayer: 20, matches: 60, colorsPerMap: 2,
  mapWinPoints: 1, mapDrawPoints: 0.5,
  ranking: 'map-points-then-total-cash', exactTie: 'shared-rank',
  exhibitionGames: 0, benchmark: 'disabled', earlyTermination: false, eloUpdates: false
});
function roster(ids) {
  assert(Array.isArray(ids) && ids.length === 3 && new Set(ids).size === 3, 'Choose three different final entries.');
  assert(ids.every(id => typeof id === 'string' && id.length > 0));
}
function validSeeds(seeds) {
  assert(Array.isArray(seeds) && seeds.length === 10 && new Set(seeds).size === 10, 'Ten distinct shared maps are required.');
  assert(seeds.every(n => Number.isInteger(n) && n > 0 && n <= 4294967295));
}
function schedule(ids, seeds) {
  roster(ids); validSeeds(seeds);
  const games = [];
  for (let round = 0; round < 2; round++) {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      for (let localMap = 0; localMap < 5; localMap++) for (let swap = 0; swap < 2; swap++) {
        const map = round * 5 + localMap;
        const pair = [ids[a], ids[b]];
        const red = (swap + round) % 2;
        games.push({index: games.length, round: round + 1, pair,
          map: map + 1, seed: seeds[map], colors: {Red: pair[red], Blue: pair[1 - red]},
          directory: `round-${round + 1}-pair-${a + 1}-${b + 1}-map-${map + 1}-${swap ? 'swapped' : 'first'}`});
      }
    }
  }
  return games;
}
function cashCheck(game, ids) {
  assert.deepEqual(Object.keys(game.colors).sort(), ['Blue', 'Red']);
  assert.deepEqual(Object.values(game.colors).sort(), ids.slice().sort());
  assert.deepEqual(Object.keys(game.cash).sort(), ['Blue', 'Red']);
  for (const color of ['Red', 'Blue']) assert(Number.isSafeInteger(game.cash[color]) && game.cash[color] >= 0, 'Invalid final cash.');
}
function sumCash(values) {
  const sum = values.reduce((a, b) => a + b, 0);
  assert(Number.isSafeInteger(sum), 'Cash total exceeds safe integer range.');
  return sum;
}
function mapScore(games, seed, ids) {
  assert.equal(games.length, 2, 'A map needs both color matches.');
  games.forEach(g => {assert.equal(g.seed, seed); cashCheck(g, ids);});
  assert.notEqual(games[0].colors.Red, games[1].colors.Red, 'Colors must swap.');
  const cash = Object.fromEntries(ids.map(id => [id, sumCash(games.map(g => g.cash[g.colors.Red === id ? 'Red' : 'Blue']))]));
  const winner = cash[ids[0]] === cash[ids[1]] ? null : cash[ids[0]] > cash[ids[1]] ? ids[0] : ids[1];
  return {seed, cash, winner, points: Object.fromEntries(ids.map(id => [id, winner === null ? 0.5 : winner === id ? 1 : 0]))};
}
function pairScore(games, seeds, ids) {
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]); validSeeds(seeds);
  assert.equal(games.length, 20, 'Every pairing must play all twenty color matches.');
  const maps = seeds.map(seed => mapScore(games.filter(g => g.seed === seed), seed, ids));
  const points = Object.fromEntries(ids.map(id => [id, sumCash(maps.map(m => m.points[id] * 2)) / 2]));
  const totalCash = Object.fromEntries(ids.map(id => [id, sumCash(maps.map(m => m.cash[id]))]));
  const winner = points[ids[0]] !== points[ids[1]] ? (points[ids[0]] > points[ids[1]] ? ids[0] : ids[1]) :
    totalCash[ids[0]] === totalCash[ids[1]] ? null : totalCash[ids[0]] > totalCash[ids[1]] ? ids[0] : ids[1];
  return {entries: ids, points, totalCash, winner, maps};
}
function standings(games, seeds, ids, complete = false) {
  const plan = schedule(ids, seeds);
  assert(games.length <= plan.length);
  // Only a verified prefix can be credited. Duplicate or substituted games fail closed.
  games.forEach((g, i) => {
    for (const key of ['index', 'round', 'pair', 'map', 'seed', 'colors', 'directory']) assert.deepEqual(g[key], plan[i][key], 'Unexpected game in season results.');
    cashCheck(g, plan[i].pair);
  });
  if (complete) assert.equal(games.length, 60, 'The final table requires all 60 verified games.');
  const table = Object.fromEntries(ids.map(id => [id, {id, points: 0, cash: 0, mapsPlayed: 0, mapsScheduled: 20, wins: 0, draws: 0, losses: 0}]));
  const pairings = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const pair = [ids[a], ids[b]], selected = games.filter(g => g.pair[0] === pair[0] && g.pair[1] === pair[1]);
    const maps = [];
    for (const seed of seeds) {
      const both = selected.filter(g => g.seed === seed);
      if (both.length !== 2) continue;
      const score = mapScore(both, seed, pair); maps.push(score);
      for (const id of pair) {
        const row = table[id]; row.points += score.points[id]; row.cash = sumCash([row.cash, score.cash[id]]); row.mapsPlayed++;
        if (score.winner === null) row.draws++; else if (score.winner === id) row.wins++; else row.losses++;
      }
    }
    pairings.push(selected.length === 20 ? {...pairScore(selected, seeds, pair), complete: true, matchesVerified: 20} :
      {entries: pair, complete: false, matchesVerified: selected.length, maps,
        points: Object.fromEntries(pair.map(id => [id, maps.reduce((s, m) => s + m.points[id], 0)])),
        totalCash: Object.fromEntries(pair.map(id => [id, sumCash(maps.map(m => m.cash[id]))])), winner: null});
  }
  const rows = Object.values(table).sort((a, b) => b.points - a.points || b.cash - a.cash || ids.indexOf(a.id) - ids.indexOf(b.id));
  rows.forEach((row, i) => row.rank = i && row.points === rows[i - 1].points && row.cash === rows[i - 1].cash ? rows[i - 1].rank : i + 1);
  return {final: complete, matchesVerified: games.length, matchesScheduled: 60, table: rows, pairings};
}
module.exports = {CURTAIN_POLICY, roster, validSeeds, schedule, mapScore, pairScore, standings};
