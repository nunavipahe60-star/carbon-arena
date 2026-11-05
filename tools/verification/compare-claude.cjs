"use strict";
// Claude's independent comparator for Carbon Arena v0.5 (authored without reading Codex's comparison script).
// For each folder holding replay.json + audit.json:
//   A. Rebuilds Codex's full board every turn from Codex's own public events alone (every ground cell,
//      every vehicle, every tree, cash), starting from the official map and fleet.
//   B. Replays the same decisions through Claude's independent resolver.
//   C. Compares A, B and Codex's turn summaries every turn, plus event streams by content.
// Usage: node compare-claude.cjs <resolver.js> <out.json> <folder> [<folder> ...]
// Exit 0 only if every folder passes every check.
const fs = require("fs"), path = require("path");
const [resolverPath, outPath, ...folders] = process.argv.slice(2);
if (!resolverPath || !outPath || !folders.length) { console.error("usage: node compare-claude.cjs <resolver.js> <out.json> <folder>..."); process.exit(2); }
const R = require(path.resolve(resolverPath));
const OFFICIAL = { turns:300, fleetLimit:10, treeLimit:10, treeGeneration:4, collectorCost:40, planterCost:60, plantingCost:20,
  harvest:15, pickup:30, absorption:3, treeLife:50, regenerationEvery:5, regeneration:1, ceiling:100 };
const HQ = { Red:[[4,4],[9,9]], Blue:[[9,4],[4,9]] };
const TEAMS = ["Red","Blue"];
const idx = (c) => c[1]*15 + c[0];
const vkey = (t,i) => t+":"+i;

function checkFolder(dir) {
  const fail = [], note = (m) => { if (fail.length < 25) fail.push(m); };
  const replay = JSON.parse(fs.readFileSync(path.join(dir,"replay.json")));
  const audit = JSON.parse(fs.readFileSync(path.join(dir,"audit.json")));
  const counts = { turns:0, cellChecks:0, vehicleChecks:0, treeChecks:0, eventsCompared:{}, absorptionGroups:0, generationEvents:0 };
  const bump = (k,n=1) => { counts.eventsCompared[k] = (counts.eventsCompared[k]||0) + n; };

  // 0. Header: must be exactly official v0.5; never reinterpret anything else.
  const hdr = { format:"carbon-arena-replay-v1", rulesVersion:"0.5", generator:"symmetric-uniform-xorshift32-v1", coordinateSystem:"zero-based-xy" };
  for (const [k,v] of Object.entries(hdr)) if (replay[k] !== v) note(`replay ${k} = ${JSON.stringify(replay[k])}, expected ${v}`);
  if (audit.rulesVersion !== "0.5" || audit.seed !== replay.seed) note("audit header does not match replay");
  if (JSON.stringify(Object.entries(replay.settings).sort()) !== JSON.stringify(Object.entries(OFFICIAL).sort())) note("replay settings are not the official v0.5 settings");
  if (fail.length) return { dir, pass:false, failures:fail, counts };

  // A. Codex board, rebuilt from events.
  const ground = R.genMap(replay.seed).slice();
  if (ground.reduce((a,b)=>a+b,0) !== audit.initialCarbon) note(`initial carbon ${audit.initialCarbon} vs regenerated map ${ground.reduce((a,b)=>a+b,0)}`);
  const veh = new Map(), trees = new Map(), cash = { Red:100, Blue:100 };
  for (const t of TEAMS) [[1,"collector",0],[2,"collector",0],[3,"collector",1],[4,"planter",1]].forEach(([id,type,h]) =>
    veh.set(vkey(t,id), { team:t, id, type, x:HQ[t][h][0], y:HQ[t][h][1], cargo:0, born:0 }));
  const byTurn = new Map(); let lastSeq = -Infinity;
  for (const e of audit.events) {
    if (!(e.seq > lastSeq)) note(`Codex seq not increasing at ${e.seq}`); lastSeq = e.seq;
    if (!byTurn.has(e.turn)) byTurn.set(e.turn, []); byTurn.get(e.turn).push(e);
  }
  const apply = (e) => {
    const V = (t,i) => { const v = veh.get(vkey(t,i)); if (!v) note(`turn ${e.turn}: event for unknown vehicle ${t} ${i} (${e.type})`); return v || {cargo:0}; };
    switch (e.type) {
      case "move": { const v = V(e.team,e.vehicle); if (v.x!==e.from[0]||v.y!==e.from[1]) note(`turn ${e.turn}: move from mismatch`); v.x=e.to[0]; v.y=e.to[1]; break; }
      case "drop": ground[idx(e.cell)] += e.amount; for (const s of e.sources) V(s.team,s.vehicle).cargo -= s.amount; break;
      case "theft": for (const s of e.sources) V(s.team,s.vehicle).cargo -= s.amount; for (const r of e.recipients) V(r.team,r.vehicle).cargo += r.amount; break;
      case "destroy": { const v = V(e.team,e.vehicle); if (v.cargo !== 0) note(`turn ${e.turn}: destroyed vehicle still holds ${v.cargo}`); veh.delete(vkey(e.team,e.vehicle)); break; }
      case "harvest": ground[idx(e.cell)] -= e.amount; V(e.team,e.vehicle).cargo += e.amount; break;
      case "pickup": trees.get(e.tree).storage -= e.amount; V(e.team,e.vehicle).cargo += e.amount; break;
      case "plant": trees.set(e.tree, { id:e.tree, team:e.team, x:e.cell[0], y:e.cell[1], storage:0, planted:e.turn }); cash[e.team] -= e.cost; break;
      case "absorption": ground[idx(e.cell)] -= e.amount; trees.get(e.tree).storage += e.amount; break;
      case "tree_generation": trees.get(e.tree).storage += e.amount; break;
      case "expiry": { const tr = trees.get(e.tree); if (tr.storage !== e.amount) note(`turn ${e.turn}: expiry amount ${e.amount} vs storage ${tr.storage}`);
        ground[idx(e.cell)] += e.amount; trees.delete(e.tree); break; }
      case "sale": { const v = V(e.team,e.vehicle); if (v.cargo !== e.amount) note(`turn ${e.turn}: sale ${e.amount} vs cargo ${v.cargo}`); v.cargo = 0; cash[e.team] += e.amount; break; }
      case "purchase": veh.set(vkey(e.team,e.vehicle), { team:e.team, id:e.vehicle, type:e.vehicleType, x:e.cell[0], y:e.cell[1], cargo:0, born:e.turn }); cash[e.team] -= e.cost; break;
      case "regeneration": ground[idx(e.cell)] += e.amount; break;
      case "purchase_rejected": case "strategy_failure": break;
      default: note(`unknown event type ${e.type}`);
    }
  };

  // B. Claude resolver.
  const st = R.create(replay.seed, "0.5");
  const sums = audit.turnSummaries;
  if (sums.length !== replay.decisions.length + 1) note(`summaries ${sums.length} vs decisions ${replay.decisions.length}`);

  for (let k = 0; k < replay.decisions.length; k++) {
    const turn = k + 1;
    const before = new Map(st.trees.map(t => [t.id, t.storage]));
    const n0 = st.events.length;
    R.step(st, JSON.parse(JSON.stringify(replay.decisions[k])));
    const mine = st.events.slice(n0), theirs = byTurn.get(turn) || [];
    for (const e of theirs) apply(e);
    counts.turns++;

    // C1. Board: every cell, vehicle, tree; cash.
    for (let c = 0; c < 225; c++) { counts.cellChecks++; if (ground[c] !== st.ground[c]) { note(`turn ${turn}: cell ${c%15},${(c/15)|0} Codex ${ground[c]} vs Claude ${st.ground[c]}`); break; } }
    const mv = new Map(st.vehicles.filter(v=>v.alive).map(v => [vkey(v.team,v.id), v]));
    if (mv.size !== veh.size) note(`turn ${turn}: vehicle count Codex ${veh.size} vs Claude ${mv.size}`);
    for (const [kk,v] of veh) { counts.vehicleChecks++; const m = mv.get(kk);
      if (!m || m.type!==v.type || m.x!==v.x || m.y!==v.y || m.cargo!==v.cargo || m.born!==v.born) { note(`turn ${turn}: vehicle ${kk} differs`); break; } }
    const mt = new Map(st.trees.map(t => [t.id, t]));
    if (mt.size !== trees.size) note(`turn ${turn}: tree count Codex ${trees.size} vs Claude ${mt.size}`);
    for (const [id,t] of trees) { counts.treeChecks++; const m = mt.get(id);
      if (!m || m.team!==t.team || m.x!==t.x || m.y!==t.y || m.storage!==t.storage || m.planted!==t.planted || m.remaining!==t.planted+50-turn) { note(`turn ${turn}: tree ${id} differs`); break; } }
    for (const t of TEAMS) if (cash[t] !== st.cash[t]) note(`turn ${turn}: ${t} cash from Codex events ${cash[t]} vs Claude ${st.cash[t]}`);

    // C2. Codex summary vs both the rebuilt board and Claude's counters.
    const s = sums[turn], my = R.totals(st);
    if (s.turn !== turn) note(`summary index ${turn} has turn ${s.turn}`);
    const g = ground.reduce((a,b)=>a+b,0), stored = [...trees.values()].reduce((a,t)=>a+t.storage,0), transit = [...veh.values()].reduce((a,v)=>a+v.cargo,0);
    const want = { ground:[g,my.ground], stored:[stored,my.stored], inTransit:[transit,my.inTransit], sold:[s.sold,my.sold],
      regenerated:[s.regenerated,my.regenerated], treeGenerated:[s.treeGenerated,my.treeGenerated], expiryReleased:[s.expiryReleased,my.expiryReleased] };
    for (const [f,[a,b]] of Object.entries(want)) if (s[f]!==a || s[f]!==b) note(`turn ${turn}: summary ${f} ${s[f]}, rebuilt ${a}, Claude ${b}`);
    for (const t of TEAMS) { if (s.treeGeneratedByTeam[t] !== st.treeGen[t]) note(`turn ${turn}: ${t} treeGenerated ${s.treeGeneratedByTeam[t]} vs ${st.treeGen[t]}`);
      if (s.cash[t] !== st.cash[t]) note(`turn ${turn}: summary cash ${t}`);
      for (const c of ["empty_tie","cargo_tie","theft"]) if (s.lossesByTeam[t][c] !== st.losses[t][c]) note(`turn ${turn}: losses ${t} ${c}`); }
    if (s.treeGeneratedByTeam.Red + s.treeGeneratedByTeam.Blue !== s.treeGenerated) note(`turn ${turn}: per-team generation does not sum`);
    if (s.carbonError !== 0 || s.totalAccounted !== s.ground+s.stored+s.inTransit+s.sold || s.expectedTotal !== s.initial+s.regenerated+s.treeGenerated || s.totalAccounted !== s.expectedTotal) note(`turn ${turn}: Codex summary conservation`);
    if (my.ground+my.stored+my.inTransit+my.sold !== audit.initialCarbon+my.regenerated+my.treeGenerated) note(`turn ${turn}: Claude conservation`);

    // C3. Event content, compared per turn as multisets (Claude's resolver omits some fields; compare what both carry).
    const ms = (arr, f) => arr.map(f).sort().join("|");
    const pick = (arr,type) => arr.filter(e => e.type===type);
    const pairs = [
      ["harvest", e=>[e.team,e.vehicle,e.cell,e.amount]+""],
      ["pickup", e=>[e.team,e.vehicle,e.tree,e.amount]+""],
      ["plant", e=>[e.team,e.vehicle,e.cell]+""],
      ["sale", e=>[e.team,e.vehicle,e.amount]+""],
      ["purchase", e=>[e.team,e.vehicle,e.vehicleType]+""],
      ["purchase_rejected", e=>e.team],
      ["expiry", e=>[e.team,e.amount]+""],
      ["drop", e=>[e.cell,e.amount]+""],
      ["theft", e=>[e.team,e.cell,e.amount]+""],
      ["destroy", e=>[e.team,e.vehicle,e.cause]+""],
    ];
    for (const [type,f] of pairs) { const a = pick(theirs,type), b = pick(mine,type);
      if (ms(a,f) !== ms(b,f)) note(`turn ${turn}: ${type} events differ (Codex ${a.length}, Claude ${b.length})`); bump(type, a.length); }
    // Generation: exact ordered sequence, and the v0.5 contract inside each stream.
    const gc = pick(theirs,"tree_generation").map(e=>[e.team,e.tree,e.amount]+""), gm = pick(mine,"tree_generation").map(e=>[e.team,e.tree,e.amount]+"");
    if (gc.join("|") !== gm.join("|")) note(`turn ${turn}: generation sequence differs`);
    counts.generationEvents += gc.length;
    for (const [who,arr] of [["Codex",theirs],["Claude",mine]]) {
      const types = arr.map(e=>e.type), ids = arr.filter(e=>e.type==="tree_generation").map(e=>e.tree), exp = arr.filter(e=>e.type==="expiry");
      if (ids.some((x,i)=>i>0&&x<=ids[i-1])) note(`turn ${turn}: ${who} generation not in ascending tree id`);
      if (types.includes("expiry") && types.lastIndexOf("tree_generation") > types.indexOf("expiry")) note(`turn ${turn}: ${who} generation after expiry`);
      if (types.lastIndexOf("absorption") > types.indexOf("tree_generation") && types.includes("tree_generation")) note(`turn ${turn}: ${who} absorption after generation`);
      if (who==="Codex" && exp.some((e,i)=>i>0&&e.tree<=exp[i-1].tree)) note(`turn ${turn}: Codex expiry not in ascending tree id`);
    }
    // Absorption per (tree, turn): Codex absorption events vs Claude's storage ledger.
    const absC = new Map(); for (const e of pick(theirs,"absorption")) absC.set(e.tree, (absC.get(e.tree)||0) + e.amount);
    const pickMine = new Map(); for (const e of pick(mine,"pickup")) pickMine.set(e.tree, (pickMine.get(e.tree)||0) + e.amount);
    const genMine = new Map(); for (const e of pick(mine,"tree_generation")) genMine.set(e.tree, e.amount);
    const expiring = [...before.keys()].filter(id => !mt.has(id)).sort((a,b)=>a-b), expAmt = pick(mine,"expiry").map(e=>e.amount);
    const after = new Map(st.trees.map(t => [t.id, t.storage])); expiring.forEach((id,i) => after.set(id, expAmt[i]));
    for (const [id,s0] of before) { const absMine = after.get(id) - s0 - (genMine.get(id)||0) + (pickMine.get(id)||0);
      counts.absorptionGroups++; if (absMine !== (absC.get(id)||0)) note(`turn ${turn}: tree ${id} absorbed Codex ${absC.get(id)||0} vs Claude ${absMine}`); }
    for (const id of absC.keys()) if (!before.has(id)) note(`turn ${turn}: Codex absorption by tree ${id} that was not working`);
  }
  return { dir, seed:replay.seed, pass:fail.length===0, failures:fail, counts,
    final:{ cash:st.cash, collisions:audit.turnSummaries.at(-1).collisions, treeGenerated:R.totals(st).treeGenerated } };
}

const results = [];
for (const d of folders) { try { results.push(checkFolder(d)); } catch (e) { results.push({ dir:d, pass:false, failures:["exception: "+e.message] }); } }
const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report = { tool:"compare-claude.cjs", toolSHA256:sha(__filename), resolverSHA256:sha(path.resolve(resolverPath)), passed:results.filter(r=>r.pass).length, total:results.length, results };
fs.writeFileSync(outPath, JSON.stringify(report, null, 1));
for (const r of results) console.log(`${r.pass?"PASS":"FAIL"} ${path.basename(r.dir)}${r.pass?"":"  "+r.failures.slice(0,3).join("; ")}`);
console.log(`${report.passed}/${report.total} passed`);
process.exit(report.passed === report.total ? 0 : 1);
