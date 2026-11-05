# Carbon Arena — Automated Strategy Competition, Rules v0.5

## Project brief

Carbon Arena is a personal, AI-assisted strategy-game experiment in which Red and Blue teams compete automatically on a carbon-resource grid. This rulebook consolidates the original design requirements and choices developed with Codex.

This publication implements rules v0.5 in `playable-v0.5/` and the local competition app. The [match harness](Carbon-Arena-Harness-v0.5.md) describes execution and replay contracts; the [analytics appendix](Carbon-Arena-Analytics-v0.5.md) describes public events and counters. Balance remains experimental. The tree lifespan is fixed at 50 working turns.

## 1. Core design requirements

| Feature | Requirement |
| --- | --- |
| Board | A 15 × 15 grid |
| Red headquarters | (5, 5) and (10, 10) |
| Blue headquarters | (5, 10) and (10, 5) |
| Control | Both teams are controlled by automated strategies |
| Turns | Both teams submit their actions independently and act simultaneously |
| Vehicles | Carbon collectors and tree planters |
| Transportation | Collected carbon must be carried back to a friendly headquarters and sold for cash |
| Trees | Planted trees absorb nearby carbon for their owner; each tree lasts 50 working turns |
| Collision | Between opposing vehicles, the vehicle carrying less carbon survives and takes the other vehicle's cargo |
| Fleet limit | Each team may have at most 10 vehicles total, including collectors and planters across both headquarters |

Strategic goals include comparing harvesting with pursuit, planning several turns ahead, coordinating fleet roles, estimating tree investment value, and using lightly loaded vehicles to intercept heavily loaded opponents.

## 2. Supplementary design choices

The following complete the playable ruleset: wrapping boundaries, symmetric starting resources, initial fleet and cash, harvest and purchase rates, tree storage, generation, and pickup, equal-cargo and group collisions, headquarters protection, resource regeneration, and the match scoring system. These are choices for this version, rather than additional claims about the original inspiration. Tree capture is disabled for this first playable version.

## 3. Board and fair starting conditions

- Display coordinates use 1–15. The x-axis runs left to right; the y-axis runs top to bottom. Internal coordinates use 0–14, with internal = displayed − 1 on each axis. All coordinates in this document and the viewer are displayed coordinates. Replays use internal coordinates and declare `coordinateSystem: zero-based-xy`. The displayed wrapping reflection corresponds internally to q → (13 − q) mod 15; negative remainders must be normalized into 0–14.
- The board wraps in both directions. Moving right from column 15 enters column 1; moving up from row 1 enters row 15.
- Wrapping lets us retain the requested headquarters coordinates while using a board symmetry that exchanges Red and Blue.
- Generate initial carbon approximately uniformly over integer amounts from 0 to 100 for each independent symmetry group, using the specified pseudorandom generator with negligible residual bias. Brighter green means more carbon. All ordinary cells are passable; there are no terrain obstacles or fog of war.
- Initial resources are invariant under both horizontal and vertical wrapping reflections. In displayed coordinates, the reflection is x → 15 − x or y → 15 − y, with a result of 0 represented as 15. Each reflection exchanges the teams' headquarters.
- All four headquarters contain zero ground carbon and do not regenerate it.
- The two reflections partition the board into 64 symmetry groups. The four headquarters form one group fixed at zero, leaving 63 independently sampled groups. The ideal uniform model gives expected total starting ground carbon of 11,050; individual seeds vary, and cells within a group are correlated.
- Record map generator ID `symmetric-uniform-xorshift32-v1` and its unsigned 32-bit seed in each replay. Enumerate groups by their smallest displayed (x, y) coordinate, sorting by x then y. Skip the headquarters group without consuming an output. Replace seed zero with `0x6D2B79F5`. Each output first advances xorshift32 state with shifts 13 left, 17 right, and 5 left, keeping unsigned 32-bit state after each operation, then emits that new state. The seed itself is never emitted as the first output. Reject outputs at or above `floor(2^32 / 101) * 101 = 4,294,967,228`; advance again after every rejection. Use the accepted output modulo 101 for every cell in the sampled group. Rejection removes the usual modulo reduction bias, but xorshift32 excludes zero, leaving negligible residual bias; this is a pseudorandom testing generator.

Generator reference checks, independently reproduced in a standalone calculator and now verified against the playable generator:

| Input seed | Total starting carbon | (1, 1) | (2, 1) | (1, 2) | (8, 8) | (15, 15) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 10,783 | 93 | 30 | 39 | 45 | 45 |
| 12345 | 10,913 | 56 | 67 | 14 | 16 | 87 |
| 0, using replacement | 12,112 | 48 | 12 | 1 | 46 | 76 |

The rejection interval contains 68 unsigned 32-bit values. These checks cover group ordering, zero-seed replacement, advance-before-output, and reflection symmetry. They do not establish match balance.

- Use a map seed. Identical seeds, settings, deterministic strategy versions, and decisions must produce identical results.
- Every fifth turn, each ordinary cell gains 1 carbon, up to a regeneration ceiling of 100.
- Cargo drops and expired-tree storage may raise ground carbon above 100. Regeneration never removes excess carbon and adds nothing while a cell is at or above 100.

## 4. Starting fleet and economy

| Setting | Version 0.5 default |
| --- | --- |
| Match length | 300 turns |
| Starting cash per team | 100 |
| Starting fleet per team | 3 collectors and 1 planter |
| Initial deployment | As specified in the deployment table below |
| Starting vehicle cargo | 0 |
| Fleet limit | 10 living vehicles per team, across both headquarters and both types |
| Collector purchase price | 40 |
| Planter purchase price | 60 |
| Tree planting cost | 20 |
| Tree limit | 10 owned trees per team |
| Tree generation | 4 new carbon per working tree per working turn, into that tree's storage |
| Sale price | 1 cash per unit of delivered carbon |

Initial deployment is explicit; headquarters labels and vehicle identifiers are team-local:

| Team | Headquarters label | Displayed position | Initial vehicles |
| --- | --- | --- | --- |
| Red | HQ1 | (5, 5) | Collectors 1 and 2 |
| Red | HQ2 | (10, 10) | Collector 3 and planter 4 |
| Blue | HQ1 | (10, 5) | Collectors 1 and 2 |
| Blue | HQ2 | (5, 10) | Collector 3 and planter 4 |

This deployment maps Red to Blue under the horizontal wrapping reflection. New vehicles receive monotonically increasing team-local identifiers, starting at 5; destroyed identifiers are never reused.

Each team has one shared cash balance. Vehicles may sell cargo at either friendly headquarters. Purchases and planting use that balance. There is no movement fuel charge or maintenance fee.

Fleet composition is chosen by the strategy: for example, 9 collectors and 1 planter, or 8 collectors and 2 planters. Trees do not consume vehicle slots. Vehicles destroyed during the collision phase immediately free slots, which may be used for purchases later that same turn. Red and Blue each have their own limit of 10, allowing at most 20 vehicles on the board.

Each headquarters may purchase at most one vehicle per turn. A purchased vehicle spawns on that purchasing headquarters cell with zero cargo, even if friendly vehicles already occupy it. It is created after collisions and sales and becomes eligible for actions on the next turn. Failed purchases do not deduct cash. Fleet slots reserved by successful purchases count immediately, so two simultaneous requests cannot exceed the limit.

Within a team, lower numeric request priority is processed first; missing priority is zero. Planting ties use increasing team-local vehicle identifiers; purchase ties use HQ1 before HQ2. Assign purchased identifiers in successful purchase order. Planting is processed before sales and purchases. If a later request lacks funds or capacity, cancel it without charge.

The turn-start snapshot exposes `plantingBudget`, equal to current team cash. Planting cannot spend the same turn's future sales. The purchase phase uses the actual cash remaining after successful planting plus actual sales from surviving vehicles. A strategy may calculate `purchaseBudgetForecast` from its planned deliveries, but this is only an estimate, never guaranteed funds or extra cash. Purchase requests are revalidated against the actual post-sale balance.

## 5. Strategy information and actions

At the start of every turn, both strategies receive the same public game-state snapshot: ground carbon; both teams' vehicle types, positions, and cargo; tree ownership, storage, and remaining lifespan; team cash; turn number; and public event history.

Each strategy may retain its own private memory across turns. Opponent source code, internal memory, and unsubmitted or unrevealed current-turn decisions are unavailable.

Each team submits one action per vehicle and up to one purchase request per headquarters. A missing or invalid vehicle action becomes WAIT. The engine does not infer an intended action.

### Decision format

Each team submits a JSON object using team-local vehicle identifiers and headquarters labels:

```json
{
  "vehicles": [
    {"vehicle": 1, "action": "HARVEST", "priority": 0},
    {"vehicle": 4, "action": "PLANT", "priority": 1}
  ],
  "purchases": [
    {"headquarters": "HQ1", "vehicleType": "collector", "priority": 0}
  ]
}
```

`vehicle` is a positive integer identifying a living vehicle owned by the submitting team. `action` must match an action name in the table below. `headquarters` is `HQ1` or `HQ2`; `vehicleType` is `collector` or `planter`. Priorities must be safe integers; missing priority defaults to zero, and lower numbers are processed first. Vehicle priority affects PLANT spending order only; it does not change movement, collision, or collection order. Missing arrays are empty. Unknown vehicle requests are ignored; duplicate requests for one living vehicle invalidate that vehicle's action to WAIT. Invalid vehicle action or priority becomes WAIT. Duplicate requests for one headquarters, unknown headquarters, or invalid purchase type or priority are discarded without charge. Replays store the normalized decisions for both teams under `Red` and `Blue`. Harness-recorded strategy exceptions may attach a `failure` string to a team decision; this forces all that team's actions to WAIT and discards its purchases, as described in the harness.

| Action | Collector | Planter | Effect |
| --- | --- | --- | --- |
| MOVE_UP / DOWN / LEFT / RIGHT | Yes | Yes | Move one cell; no active harvest or planting that turn |
| HARVEST | Yes | No | Take up to 15 ground carbon from the current cell |
| PICKUP | Yes | No | Take up to 30 stored carbon from a friendly tree on the current cell |
| PLANT | No | Yes | Plant on an eligible empty cell |
| WAIT | Yes | Yes | No movement or active resource collection |

- Vehicles do not expire; only trees have the 50-turn lifespan.
- There is no vehicle cargo limit in this version. Large cargo thefts remain possible, and heavy loads remain vulnerable.
- Both vehicle types participate in collisions. Planters are usually empty, but stolen cargo must still be delivered to a friendly headquarters.
- Friendly vehicles may share a cell, including a headquarters. The viewer must support inspecting multiple vehicles on one cell.
- Surviving vehicles at a friendly headquarters automatically sell all cargo during the sale phase, including vehicles that waited there.
- Vehicles cannot enter enemy headquarters. An attempted move into an enemy headquarters becomes WAIT at the starting cell. Interception remains possible on surrounding cells.
- Moving onto a resource cell or tree does not automatically harvest or pick up carbon. Those require a separate action on a subsequent turn.
- Friendly collectors sharing a ground resource or tree storage divide the available amount evenly among requesting vehicles, respecting each action's limit. For n eligible requesters with limit L and available integer carbon C, give each b = min(L, floor(C/n)). If b < L, compute r = C − n·floor(C/n) and give one additional unit to the first r requesters in the rotated list below. If b = L, no remainder units are allocated. Any carbon beyond the combined action limits stays at its source.
- For same-team harvest, pickup, and stolen-cargo remainder allocation, sort eligible vehicle identifiers increasingly and rotate that list left by (turn − 1) mod n. Turn numbering starts at 1. This avoids reliance on global identifiers or board-position tie-breaks. Mirrored decisions with matching team-local identities yield matching allocations; arbitrary strategies need not produce mirrored decisions.

## 6. Trees, storage, and transport

In this version, absorbed and generated carbon is stored in the tree. Collectors pick it up and transport it home; trees do not directly generate cash or transfer carbon remotely.

- A planter pays 20 to plant on its current cell, provided that cell is not a headquarters, contains no tree, and the team has room under its tree limit.
- Planting does not consume the planter. It remains a mobile vehicle.
- At most one tree may occupy a cell. Trees and vehicles may share a cell.
- Each working turn, a tree absorbs up to 3 ground carbon from each of its four orthogonal neighboring cells, at most 12 total. It does not absorb from its own cell.
- Tree storage is unlimited. Absorption transfers existing ground carbon; it does not create new carbon.
- After all absorption on each working turn, every working tree generates 4 new carbon into its own storage. Generation is the only way trees create carbon. It does not depend on neighboring cells, current storage, or pickups. Process generation in increasing tree identifier order; all generation completes before any expiry.
- All working trees absorb simultaneously, regardless of ownership. Here n counts the working trees of either team orthogonally adjacent to the cell, excluding trees planted this turn and including trees on their last working turn. For a ground cell containing C carbon and n > 0, each receives min(3, floor(C/n)) from that cell. Leave all undistributed carbon on the ground; do not allocate integer remainders. For example, two trees competing for 5 each receive 2 and leave 1; four trees competing for 3 each receive 0 and leave 3. This rule applies equally to same-team and cross-team competition and avoids position-based tie-breaks. With many trees and very little carbon, a remainder may persist until harvesting, regeneration, or a change in the competing trees.
- A tree planted on turn T works on turns T+1 through T+50, exactly 50 times. It neither absorbs nor generates on its planting turn. Over a full life it generates exactly 200 carbon.
- After each working turn, reduce remaining lifespan by one. At zero, remove the tree and drop its remaining storage onto its cell as ground carbon available to either team. All absorption, then all generation, is completed before any expiry release; a tree's last-turn generation is included in its release. Adjacent working trees of either team can absorb the released pile starting on the next turn, including newly planted trees that become active then.
- Trees cannot be captured or destroyed in this version. Their ownership stays fixed until expiry. Passing over a tree does not affect it.
- Collectors cannot pick up enemy-tree storage. After expiry releases storage as ground carbon, collectors of either team can harvest it normally; vehicles carrying collected carbon remain vulnerable to theft.
- PLANT on a cell with any existing tree has no effect and costs nothing.
- The tree limit counts every owned tree on the board when planting is processed, including trees planted earlier in the same planting step and trees that will expire later that turn. A team at its limit can replace an expiring tree on the following turn at the earliest.

## 7. Collision and cargo theft

Resolve collisions after all movement and before harvesting, pickup, tree actions, or sales. Compare cargo at that point in the turn.

### One opposing vehicle on each side

- If opposing vehicles finish on the same cell, the vehicle with less cargo survives; the heavier vehicle is removed.
- Transfer all defeated cargo to the survivor. For example, a Blue vehicle carrying 5 defeats a Red vehicle carrying 428 and ends with 433.
- Equal cargo destroys both vehicles; all cargo becomes ground carbon on that cell.
- Opposing vehicles exchanging positions do not collide in this version. Only final shared cells count.

### Multiple vehicles sharing a cell

Since friendly stacking is allowed, compare each team's combined cargo on that cell:

- The team with less combined cargo retains all its vehicles there. Remove all opposing vehicles on the cell.
- Split defeated cargo evenly among the winning vehicles; allocate integer leftovers with a deterministic rotation of team-local unit identifiers.
- Equal team cargo destroys all vehicles there and drops all their cargo as ground carbon.

This supplementary group rule avoids dependence on pairwise resolution order. A vehicle count advantage does not grant extra attack power. Coordinated interception should generally cover separate possible escape cells rather than stack vehicles on one cell.

Stolen cargo persists normally. There is no protection period: a successful thief becomes more vulnerable as its cargo rises.

## 8. Fixed turn resolution

1. Supply both strategies with the same turn-start snapshot and collect their decisions independently.
2. Validate actions; convert invalid actions to WAIT.
3. Execute all movement simultaneously, including wrapping and enemy-headquarters restrictions.
4. Resolve opposing final-cell collisions; remove defeated vehicles and distribute stolen or dropped cargo.
5. Surviving vehicles that selected HARVEST or PICKUP execute those actions.
6. Surviving planters execute planting, using each team's spending priorities and available pre-sale cash. Cancel unfunded or invalid requests without charge.
7. Trees that existed at turn start absorb simultaneously. Each then generates 4 carbon into its storage and loses one lifespan. Expired trees release storage, including this turn's generation, and disappear; newly planted trees wait until next turn.
8. Surviving vehicles at friendly headquarters sell all cargo.
9. Execute eligible headquarters purchases. New vehicles act starting next turn.
10. Apply ground-carbon regeneration on turns 5, 10, 15, and so on. Record results and advance the turn.

Destroyed vehicles never execute later actions. Team processing order must not affect outcomes; use the explicit priorities and deterministic allocation rules instead.

## 9. Scoring and match end

- After completing turn 300, the team with more cash wins. Equal cash is a draw.
- Undelivered cargo, tree storage, vehicles, and trees have no final cash value.
- Losing all vehicles does not immediately lose the match; teams with enough cash may purchase replacements.
- If both teams have no vehicles and neither can afford any vehicle, the match ends early and compares cash.

## 10. Required correctness scenarios


- Cargo 5 versus 428: the lighter vehicle survives with 433.
- Equal cargo: both vehicles are removed and all cargo lands on the cell.
- Group collisions give identical results regardless of team iteration order.
- A move cannot also actively harvest; cargo sales occur only at friendly headquarters and exactly once.
- Multiple trees cannot absorb the same carbon twice; multiple pickup requests cannot duplicate stored carbon.
- A tree planted at T works exactly on T+1 through T+50. PLANT on an existing tree changes neither ownership nor lifespan and charges nothing.
- Tree expiry drops all remaining storage. Harvesting, pickup, absorption, theft, and drops conserve carbon; regeneration, tree generation, and sales are accounted for separately. After every turn: ground carbon + tree storage + cargo in transit + carbon sold = initial ground carbon + regenerated + tree generated.
- The four tree generation and tree limit checks below reproduce exactly.
- Initial resource symmetry exchanges the teams; wrapping movement handles every edge correctly.
- Identical seeds, settings, strategy decisions, and initial states yield identical match results and replays.
- Fleet purchases never exceed 10 vehicles per team, including requests from both headquarters in one turn. With a fixture team containing 10 vehicles and one collision loss, one eligible same-turn purchase succeeds and a second fails for capacity, assuming sufficient cash. Purchased vehicles appear at the requesting headquarters with zero cargo and cannot act until the next turn.
- Tree competition leaves indivisible remainders on the ground: two requests against 5 yield 2 each and 1 remaining; four against 3 yield 0 each and 3 remaining. Both same-team and cross-team cases follow this rule.
- Generator outputs match all seed reference values in section 3, with 64 groups, 63 samples, and zero carbon at every headquarters. Use both explicit rejection vectors below to verify advance-after-rejection.
- A collector destroyed before its PICKUP transfers or drops only pre-pickup cargo, leaving tree storage untouched.
- Planting cannot spend future sale proceeds. Purchases can use actual same-turn proceeds after planting costs, but must not use proceeds from a destroyed or undelivered vehicle.
- A scripted five-destination scenario verifies interception, escape, headquarters protection, stacking, and escort behavior as specified below.

### Scripted one-turn interception checks

Use a Red collector carrying 100 at (8, 8), away from headquarters. Use five empty Blue hunters at (8, 6), (10, 8), (8, 10), (6, 8), and (8, 7). Assign them respectively to (8, 7), (9, 8), (8, 9), (7, 8), and (8, 8).

Run five separate fixtures from this same starting position: the Red carrier moves up, right, down, left, or waits. In each fixture it meets exactly one empty hunter, is removed, and transfers 100 to that hunter. Position exchanges are allowed, so the hunter starting at (8, 7) does not create an extra collision when the carrier moves up.

For a three-hunter variant, retain only hunters assigned to up, right, and staying. The carrier escapes by moving down or left. This is a deterministic counterexample to guaranteed capture by those three hunters, not a win-rate simulation.

Additional independent fixtures:

- A Red carrier at (5, 6) moves up into its headquarters (5, 5). A Blue hunter attempting to enter (5, 5) stays outside; the carrier survives and sells.
- An empty Red escort and empty Blue hunter meet on a cell without the carrier: both disappear. If both meet on the loaded carrier's final cell, the empty Blue hunter defeats both Red vehicles under group totals.
- A carrier with 100 meets two Blue hunters carrying 60 each: Red's total 100 is lower than Blue's 120, so Red survives with 220. Being individually lighter does not guarantee stacked hunters win.


### Tree generation and tree limit checks

Each fixture uses seed 1 and keeps the official starting fleet and settings. Every vehicle except Red planter 4, which starts at (10, 10), waits; neither team purchases. Zero-ground fixtures clear all ground carbon and reset initial-carbon accounting. Tree-limit fixtures set Red's initial cash to 1,000. The conservation identity above must hold after every turn.

| Check | Setup | Expected |
| --- | --- | --- |
| Generation timing | Zero-ground fixture. The planter moves right on turns 1 and 2, then plants at (12, 10) on turn 3. | Storage after turn 3: 0. Turn 4: 4. Turn 5: 8. Turn 6: 16 (turn 5 regeneration is absorbed on turn 6). Turn 52: 236. The tree expires on turn 53, releasing 240: 200 generated plus 40 absorbed. Tree generated: 200. |
| Real map | Official seed-1 uniform map. The planter moves right on turns 1 and 2, then plants at (12, 10) on turn 3. That cell holds 23; its neighbors up, right, down and left hold 63, 70, 72 and 61. | Red cash 80 after planting. Storage after turn 4: 16. Turn 52: 502. Expires on turn 53, releasing 506. (12, 10) holds 539 after turn 53. Tree generated: 200. |
| Tree limit | Zero-ground tree-limit fixture. The planter moves down on turns 1 and 2 to (10, 12), then alternates moving right and PLANT, planting on turns 4, 6, ..., 24 at (11, 12), (12, 12), ..., (15, 12), (1, 12), ..., (6, 12). | Plantings on turns 4 through 22 succeed. The 11th, on turn 24 at (6, 12), is rejected without charge. Cash spent: 200. |
| Limit at expiry | Continue the previous check. The first tree, planted on turn 4, expires on turn 54. The planter waits, moves right to (7, 12) on turn 53, then requests PLANT on turns 54 and 55. | Turn 54 is rejected: the expiring tree still counts. Turn 55 succeeds, restoring 10 trees. |

### Allocation examples

For sorted vehicle identifiers [2, 5, 7], C = 40 and L = 15:

| Turn | ID 2 | ID 5 | ID 7 | Carbon left |
| --- | --- | --- | --- | --- |
| 1 | 14 | 13 | 13 | 0 |
| 2 | 13 | 14 | 13 | 0 |
| 3 | 13 | 13 | 14 | 0 |

At turn 1 with C = 44, the result is [15, 15, 14]. With C = 100, all receive 15 and 55 stays at the source. Theft uses the same rotation with no per-vehicle action limit, while each winning vehicle also retains its original cargo.

### Rejection vectors

| Initial seed/state | First output, rejected | Next output, accepted | Group (1, 1) |
| --- | --- | --- | --- |
| 2,765,699,532 / 0xA4D939CC | 4,294,967,228 | 17,270,968 | 69 |
| 1,584,200,935 / 0x5E6CFCE7 | 4,294,967,295 | 253,983 | 69 |

Both are independently reproduced and pass in the playable generator. Accepting the boundary incorrectly would produce 0 in the first case.

## 11. Revision status

v0.5 adds tree generation: each working tree generates 4 new carbon into its own storage after absorption and before expiry, 200 over its 50-turn life. It also raises the tree limit from 8 to 10, and adds tree generation to the conservation accounting and correctness checks. Tree lifespan (50, fixed), planting cost (20) and all other rules are unchanged from v0.4. Under v0.4, trees only redistribute existing carbon; the matched cap-10 study supports this change under its tested shared policy and tuning budget.

The original local project retains earlier versions and their records separately. This repository publishes v0.5; a legacy engine is included only as a compatibility-test fixture. Balance remains provisional.

### Harness, replay and audit contracts for v0.5

The accompanying harness and analytics documents implement the following contracts:

- The snapshot reports `rulesVersion` "0.5" and the settings actually in force, including `treeLimit` 10 and `treeGeneration` 4.
- Public event history gains a `tree_generation` event with `turn`, `seq`, `team`, `tree` and `amount`, emitted in the written order: all generation, by increasing tree identifier, before any expiry.
- Turn and final summaries carry two separate cumulative counters for both teams: `regenerated` (ground regeneration only, as in v0.4) and `treeGenerated`. Historical lab audits stay as recorded.
- v0.5 replays record the rules version and settings. A v0.4 replay is played back only by the preserved v0.4 resolver, or rejected clearly by a v0.5-only reader; it is never reinterpreted under v0.5 settings.
- The decision format and private memory are unchanged. A v0.4 strategy remains decision-format compatible, but may need updating if it checks `rulesVersion`, assumes a closed list of event types, or plans around the old tree limit.
