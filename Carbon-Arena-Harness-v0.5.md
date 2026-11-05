# Carbon Arena - Match Harness v0.5

This document accompanies rules v0.5 and the offline `playable-v0.5/` build. The complete arena reuses the QuickJS sandbox in `duel/`. Validation of this publication is recorded in `docs/VALIDATION.md`.

## Running and viewing matches

Open `playable-v0.5/index.html` in a desktop browser. All assets are local; no server or network is required. Start/pause, step, speed, restart, seed entry, new map, cargo labels, cell inspection, replay save/load and timeline operate as before. Display coordinates are 1-15; state and replay coordinates are 0-14.

Each team shows its actual vehicle and tree limits. Tree inspection shows storage, remaining working turns and the actual generation rate. Resource flow separates ground regeneration, tree generation, each team's tree generation, and conservation error. Generation events are shown in recent events. The rules dialog explains cap ten, the four-carbon production rule, lifetime, and pickup timing. These views reflect the selected replay turn, not always the live match's final totals.

The viewer rejects v0.4 replays explicitly. Earlier viewers and real match history remain in the separate original local project. No old replay is silently upgraded.

## Strategies and budgets

The bundled `bundled-beam-v1` strategies are copied unchanged. Balanced, Tree economy and Interception remain exploratory presets with tree targets 5, 8 and 3 respectively; a strategic target is not the engine's cap of 10. No planner retuning or frozen contestant changes are part of this rules implementation.

Movement uses width-10 beams at depth 4 or 5 and a total budget of 10,000 candidate expansions per team per turn. For n living vehicles, each receives floor(10,000/n), with remaining expansions assigned to increasing team-local IDs. Unused quota is not transferred. Count before evaluating each candidate, including rejected candidates. On exhaustion use the best evaluated candidate or WAIT. These are position/risk estimates, not exact future joint-action simulation.

Strategy exceptions discard the failed team's entire submission, record `strategy_failure`, submit WAIT/no purchases, and pause the browser for inspection. Replay decisions retain the failure. There is no arbitrary-script sandbox in this viewer. User-submitted strategies run in the complete arena through its separate QuickJS sandbox.

## Public snapshot

`snapshot(state)` returns an independent JSON copy. Both strategies see the same public turn-start information, never opponent private memory or current decisions. `turn` counts completed turns; turn 0 chooses the first actions. The decision format and private-memory contract remain as documented in Rules v0.5.

| Field | Meaning |
| --- | --- |
| `rulesVersion` | `"0.5"` |
| `seed` | Unsigned map seed |
| `settings` | Actual match configuration, including `treeLimit`, `treeGeneration`, `treeLife` and `plantingCost` |
| `ground` | 225 nonnegative integers, indexed by `y * 15 + x` |
| `vehicles` | All living vehicles: `team`, `id`, `type`, `x`, `y`, `cargo`, `born` |
| `trees` | All living trees: global `id`, `team`, `x`, `y`, `storage`, `remaining`, `planted` |
| `teams` | Each team's public `cash` and `plantingBudget`; no private accounting fields |
| `eventHistory` | All completed public events in sequence order, including `tree_generation` |

Default settings:

```json
{"turns":300,"fleetLimit":10,"treeLimit":10,"treeGeneration":4,"collectorCost":40,"planterCost":60,"plantingCost":20,"harvest":15,"pickup":30,"absorption":3,"treeLife":50,"regenerationEvery":5,"regeneration":1,"ceiling":100}
```

The engine accepts positive safe-integer settings; `treeGeneration` also permits zero for explicit diagnostic configurations. `treeLife` is fixed at 50. The viewer starts official defaults. Diagnostic overrides are recorded in full and are not official default matches. Every setting is exposed as actually enforced, not substituted with a hard-coded snapshot default.

Generation occurs after all absorption, in increasing global tree ID, and completes for every working tree before any expiry. Expiry is also emitted in increasing tree ID. Planting-turn trees do not work. Pickup occurs before absorption/generation. Cap checks occur before expiry. Current-turn sales cannot fund planting.

## Replay and audit formats

Replay format remains `carbon-arena-replay-v1`; the `rulesVersion` discriminator is now `"0.5"`. Records include generator `symmetric-uniform-xorshift32-v1`, `coordinateSystem: "zero-based-xy"`, seed, every actual setting, strategy metadata, and normalized decisions under Red/Blue. A missing v0.5 setting, including `treeGeneration`, is rejected rather than defaulted. Unsupported rules versions are rejected. Replay executes saved decisions without running strategies.

`Save replay` exports the complete decision record even while viewing an earlier turn. `Save event log` exports `carbon-arena-audit-v1` only through the currently viewed turn, including rulesVersion, actual settings, strategy metadata, events and summaries from turn zero. An audit is not an importable decision replay. Strategy selection and depth lock after turn one and unlock on restart. The timeline is read-only; Return to live match returns to the latest state.

The original local project retains v0.4 and its audits separately. Version 0.5 does not rewrite historical `regenerated` fields that combined sources in experimental adapters.

## Counters and verification

`regenerated` is cumulative ground regeneration only. `treeGenerated` is cumulative production by all trees. `treeGeneratedByTeam` records `{Red, Blue}`, whose sum equals the global tree total. Ground regeneration is not assigned to a team. Internal state uses `generatedCarbon` for ground regeneration, `treeGeneratedCarbon` for tree production, and `teams[team].treeGenerated` for team production.

Every summary uses `ground + stored + inTransit + sold = initial + regenerated + treeGenerated`. The analytics document defines the other fields, event payload and storage ledger.

Run `npm test` from the repository root. Permanent tests include all four rulebook vectors, generation-before-expiry ordering, pickup timing, separate counters, snapshot isolation, replay/version checks, deterministic full matches, and a generation-zero/cap-eight regression using a newly generated legacy-engine fixture. No historical replay is distributed. The Practice and championship browser rehearsals use portable Playwright with external requests blocked. See `docs/VALIDATION.md` for actual coverage and limitations.
