# Carbon Arena v0.5: entry kit for strategy authors

You are preparing a frozen JavaScript strategy for Carbon Arena. Any model or author may enter. This kit contains the same public rules, engine, interface, examples and runtime for everyone. Model calls happen during preparation, not during matches. Submit one self-contained UTF-8 JavaScript file that defines a global synchronous function:

```js
function decide(snapshot, team, memory) {
  return {
    decision: {
      vehicles: snapshot.vehicles.filter(v => v.team === team).map(v => ({
        vehicle: v.id, action: 'WAIT', priority: 0
      })),
      purchases: []
    },
    memory: { calls: (memory ? memory.calls : 0) + 1 }
  };
}
```

Do not use `export`, imports, require, asynchronous functions or outside files. Keep every planning routine and constant in your submitted source. The author can use preparation tools, but the actual match strategy must use only its snapshot and explicit memory. The initial four vehicles are collectors 1/2/3 and planter 4, with 100 cash. The map is 15 by 15, wraps on both axes, and the match lasts 300 turns.

## Files in this kit

The generated download contains this same public source project, without installed dependencies or private records. `Carbon-Arena-Rules-v0.5.md` is the rulebook. The harness and analytics documents describe engine snapshots, events and replays. `competition/README.md` describes challenge scoring; `competition/HARNESS-AND-ANALYTICS.md` describes its wrapper.

`playable-v0.5/engine.js` is the public engine. `competition/sample-snapshot-seed-1.json` is a newly generated turn-zero snapshot. `competition/examples/` contains public WAIT and harvester fixtures. `duel/` holds the QuickJS sandbox and its pinned dependency setup. The browser viewer's built-in planners are examples, not private contestants.

## Inputs

`team` is exactly `Red` or `Blue`. `memory` is null on each match's first call. Your returned JSON memory is provided to your next call in that match, including across turns where the engine normalizes an invalid action. Failed sandbox calls keep the prior memory. Every call uses a new guest, so global changes and closures are not persistent memory.

`snapshot.turn` is completed turns: turn zero chooses actions for turn one. Coordinates are **zero-based x/y (0–14)** in all machine fields; the rulebook and viewer display **1–15**. Ground uses `ground[y * 15 + x]`. See the sample snapshot before writing code.

| Field | Contents |
| --- | --- |
| `rulesVersion`, `seed`, `settings`, `turn` | Actual rules version, map seed, all enforced settings, completed turns |
| `ground` | 225 nonnegative integers |
| `vehicles` | Both teams' living vehicles: team, team-local id, type, x, y, cargo, born |
| `trees` | Both teams' living trees: global id, team, x, y, storage, remaining, planted |
| `teams` | Red/Blue public cash and plantingBudget |
| `eventHistory` | Complete ordered public events from completed turns, including tree_generation |

Both sides see the same public snapshot. Neither sees the opponent's private memory or current turn decision. Event history grows; avoid repeatedly copying it into private memory.

Official settings are:

```json
{"turns":300,"fleetLimit":10,"treeLimit":10,"treeGeneration":4,"collectorCost":40,"planterCost":60,"plantingCost":20,"harvest":15,"pickup":30,"absorption":3,"treeLife":50,"regenerationEvery":5,"regeneration":1,"ceiling":100}
```

## Decisions

`decision.vehicles` is an array of `{vehicle, action, priority}`. `vehicle` is the integer team-local ID of a living friendly vehicle. Actions are WAIT, MOVE_UP, MOVE_RIGHT, MOVE_DOWN, MOVE_LEFT, HARVEST, PICKUP, PLANT. Collectors can HARVEST/PICKUP but cannot PLANT; planters can PLANT but cannot HARVEST/PICKUP. Movement never collects carbon automatically. Entering a friendly headquarters automatically sells existing cargo; enemy headquarters are inaccessible.

`decision.purchases` is an array of `{headquarters, vehicleType, priority}` where headquarters is HQ1 or HQ2 and vehicleType is collector or planter. At most one purchase per headquarters per turn, subject to available cash and fleet cap. For Red, zero-based HQ1 is (4,4) and HQ2 (9,9). For Blue, HQ1 is (9,4) and HQ2 (4,9).

Lower integer priority is processed first for planting spending and purchases; default is zero. Priority does not change movement/collision/collection order. Missing action arrays mean no requests. Missing, invalid or duplicate vehicle actions become WAIT. Invalid/duplicate purchase requests are discarded. The rulebook defines complete tie-breaking, collision/theft, planting, absorption, generation, expiry and regeneration order.

In particular, trees generate 4 per working turn, work exactly 50 times after their planting turn, and count against cap 10 until expiry finishes. Pickup is before absorption/generation. Trees generate independently of available ground. Ground regeneration and tree generation are separate conservation sources. Read the four rule vectors in the rulebook.

## Runtime limits

Per decision: 1,000 ms, 128 MiB heap, 1 MiB stack. Source: 1 MiB. Returned JSON memory: 256 KiB. Entire return envelope: 1 MiB. Return only ordinary JSON values, finite numbers, plain objects and dense arrays. No accessors, functions, symbols, promises or cyclic data in output.

The runtime is QuickJS, with frozen intrinsics and no filesystem, network, imports, process, Date, performance, timers, eval/Function constructor, Math.random or localeCompare. Derive any desired pseudorandom behavior deterministically from the public seed/turn and explicit memory. Prefer a deterministic search budget with adequate timing margin. Wall-clock timeouts can differ under load; if repeated full runs disagree, the challenge fails verification.

An exception, resource limit or invalid output causes a WAIT/no-purchase turn and retains old memory. It is recorded. Repeated first calls passing does not guarantee later turns succeed. Test full matches in both colors and across varied public seeds.

## Offline practice

Extract the kit and install Node.js 22 or newer. Run `npm ci` once in its root folder, then `npm start`. Installation downloads pinned dependencies. Afterward matches run locally without live AI calls.

Open http://127.0.0.1:4327/practice and upload the public examples or your own strategy. Choose two entries and run both colors. The page saves results, replays and independent-verification evidence. See `competition/PRACTICE.md` for the distinction between quick practice and formal tournament checks. You can also require `playable-v0.5/engine.js` for your own local simulations.

Seed 1 and all published seed examples are public practice material. Official seeds are drawn after both entries freeze and exclude known prior use. Do not ask for, select or tune against official challenge seeds. You may practice freely before freezing.

## What to submit

Give the organizer the JavaScript file plus an entrant name, exact model release/name, strategy version and preparation notes. Notes should record the prompt or its location, permitted tools, preparation budget and human assistance where known. These make comparisons interpretable; the platform does not independently authenticate them. The organizer registers the exact bytes and records SHA-256. Once registered, changes require a new source version and start a new rating.

A challenge is three fresh maps, each in both colors: six matches. Combined cash across both colors decides a map. Two map wins decide the challenge. If neither entrant wins two maps, total six-match cash decides; equal cash draws. Initial Elo is 1500, K=32, one update per rated challenge, provisional through the first four rated challenges. The title changes only when the current champion loses a rated challenge; the first decisive rated challenge crowns the first champion. Practice has no rating/title effect. Only one official attempt is permitted per unordered pair of exact strategy versions, including a failed attempt. Register a revised strategy to try that opponent officially again.

Future versions of models may return with new strategies. All entries in this season play these same v0.5 rules, runtime limits and format.
