# Competition harness and analytics v1

This companion extends the existing `Carbon-Arena-Harness-v0.5.md` and `Carbon-Arena-Analytics-v0.5.md` for the local competition app. Engine rules, counters, normalized decisions and audit formats are unchanged.

## Strategy and execution

Protocol: `carbon-arena-competition-v1`. A global `decide(snapshot, team, memory)` returns `{decision, memory}` synchronously. Red and Blue each receive the same independent public turn-start JSON, with separate memory initially null. A fresh QuickJS guest is created per call, so only returned JSON memory survives. Source hashes, settings and names are registration metadata; source bytes remain in the local archive and are not served over HTTP; opponent private memory and this turn's decision are never exposed.

The reused runtime is `quickjs-emscripten@0.32.0 (release-sync)`. Each call has 1,000 ms, 128 MiB heap and 1 MiB stack; source is at most 1 MiB, returned memory 256 KiB and the full JSON envelope 1 MiB. The host watchdog has 250 ms grace, and worker startup timeout is 15 seconds. There is no filesystem, network, import/require, clock, timers, locale-sensitive comparison or Math.random. Global intrinsics are frozen. These match the frozen sandbox limits rather than the browser's exploratory beam-search budget.

Failure supplies `{failure: code, vehicles: [], purchases: []}` to the engine; the engine normalizes to WAIT for every living friendly vehicle, no purchases, and a `strategy_failure` event. Memory is unchanged. A subsequent call may succeed. Calls are made serially, Red then Blue, against the same pre-action snapshot. Strategies cannot observe host order.

## Replay additions

Engine replay format remains `carbon-arena-replay-v1` and rulesVersion `0.5`. The new strategies metadata is:

```json
{
  "protocol": "carbon-arena-competition-v1",
  "freezeSHA256": "<sha256 of exact freeze.json bytes>",
  "entrants": {
    "Red": {"id": "<entry UUID>", "name": "<display name>", "sha256": "<source hash>"},
    "Blue": {"id": "<entry UUID>", "name": "<display name>", "sha256": "<source hash>"}
  }
}
```

`seed`, generator, coordinate system and all actual settings are saved alongside the 300 normalized decisions. Viewing does not run entrant code. Saved replays always contain the full match; a viewer audit export contains only the selected timeline prefix. The organizer's archived `audit.json` always covers the full match.

## Calls and checkpoints

`strategy-calls.json` has one record per team per turn: 1-based action `turn`, `team`, `entrant`, `snapshotSHA256`, `inputMemorySHA256`, `outputMemorySHA256`, `ok`, and `failure` (null on success). Hashes use SHA-256 over UTF-8 `JSON.stringify` of the snapshot or memory. Private memory contents are not included. Elapsed wall time is deliberately omitted from repeat comparisons. Memory hashes still allow verification of unchanged memory on failure.

`checkpoint-hashes.json` includes turn zero plus all 300 completed turns. It hashes the full ground grid, vehicles, living trees, teams, nextTreeId, turn, initialCarbon, generatedCarbon (ground only), treeGeneratedCarbon, soldCarbon, ended and winner. Full repeated audits also verify event and summary history, while live-state replay reproduction checks the full state.

`summary.json` includes `seed`, color-to-entry `colors`, `cash` by color, `turns`, number of failed team calls, and cumulative `treeGenerated`. Match summaries are linked to entrants through `colors`, never by assuming a model is always Red. No extra sources are combined into the ground regeneration counter.

Independent verification scope follows the supplied comparator, documented in the README and `docs/VALIDATION.md`. `independent.json` must report total=1 and passed=1 and the process must exit zero. Only then can a match count toward a completed challenge.

## Ledger and results

Ledger events have `sequence`, `previous`, UTC `at`, `type`, `data`, and `hash`. The hash covers `JSON.stringify` of the preceding body fields in that order. Event types are registered, prepared, started, failed, completed, entries-banned, challenge-sealed and entries-relabeled. Invalid state transitions are rejected. Elo/title are derived only once from a completed rated event; replaying the log never appends another update.

`entries-relabeled` data is `{entries: [{id, name, model, version, notes}, ...]}`. Each update must contain exactly those fields; the batch must be nonempty with unique, existing IDs. Names, model and version are trimmed strings of 1–100 characters; notes are a string of at most 2,000 characters. Reconstructed entries receive the new display fields and `relabeled: true`. IDs, hashes, registration timestamps, restrictions and all competition results remain unchanged. Original registration events and archived evidence are never rewritten.

Public evidence projects relabeled participants at the defined metadata locations: freeze `entries` and replay `strategies.entrants`. A changed document adds `metadataProjection: "current-entry-labels-v1"`. Game settings, decisions, events, source hashes and result data are unchanged. The referenced freeze hash identifies the archived original, not the projected download. Owner-authenticated downloads preserve original archive bytes. Sealed-evidence access checks run before any projection or file read.

`entries-banned` data is `{ids: [<registered entry UUID>, ...]}` and sets `entry.banned = true`. Both rated and practice preparation reject these entries before source access or seed reservation. `challenge-sealed` data is `{id: <completed or failed challenge UUID>}` and sets `challenge.sealed = true`. These events preserve historical scores, counts, Elo and title; they do not determine advancement.

`result.json` has format `carbon-arena-competition-result-v1`, status passed, entry IDs, freeze hash, seeds, rated flag, six match summaries and a `score` object. Score contains winner (entry ID or null), seedWins, three pairs with cash by entry ID and map winner, and totalCash by entry ID. Ledger-derived challenge state adds the rating before/after arrays and expected result, plus title before/after where rated. These derived changes are available in `/api/state`; the standalone result records match evidence and score.

The public state format is `carbon-arena-competition-state-v1`. Entry counts are rated challenges, not matches. Its `revision` and `head` are useful backup receipts. The HTTP response also includes live progress, an `owner` access flag and a per-process request token; these are not permanent result evidence. The process token is not an owner credential.

For a sealed challenge without a valid owner session, state exposes only `id`, `entries`, `rated`, `status`, available creation/completion timestamps, `sealed: true`, and (when passed) `result: {score: {winner: <entry UUID or null>}}`. All other evidence is omitted, including seeds, map totals, cash, freeze hashes and rating deltas. Associated job details are also withheld. Direct result/freeze/seeds and replay/audit/summary/determinism/independent routes return 403 until owner-authenticated. Owner mode restores the original full state and evidence routes without changing archive files. Sessions expire after two hours and on server restart, and can be explicitly revoked. Original private launchers are excluded. See the root README for the local-filesystem trust boundary.

All model/version/preparation fields are organizer assertions. This platform measures a specific strategy artifact under fixed rules. Do not aggregate different strategy hashes as one entrant, treat practice as rating evidence, count deterministic repeat runs as extra matches, or compare Elo values from independent rule seasons as if they shared a pool.
