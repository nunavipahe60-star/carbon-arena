# Local championship

From the repository root, run `npm ci`, then `npm start`, and open http://127.0.0.1:4327. See the root README for the offline demo and all available workflows.

Register a self-contained JavaScript strategy, or try the six-match demonstration with the two public examples. Registration repeats the first decision in both colors and preserves the exact UTF-8 bytes. A new source revision starts a separate record. Examples registered by the demonstration are practice-only.

Each challenge uses three maps, each played in both colors, for six 300-turn games. Combined cash across the color pair decides each map. Two map wins decide the challenge; otherwise total cash breaks the tie. All six games finish. Equal totals draw. One entire rated challenge produces one Elo update, with initial rating 1500 and K=32. The title moves only when the current champion loses, or when a first decisive rated challenge establishes a champion.

Only one rated attempt per pair of exact strategy versions is allowed, including failed attempts. Practice can repeat and changes no rating or title. An interrupted challenge fails, retaining its reservations and evidence. No silent retry erases an official attempt.

Formal games check conservation, exact replay reconstruction, repeated execution and the independent resolver. Saved evidence includes replay, audit, summaries, call and memory hashes, physical checkpoint hashes and verification logs. Sources and raw private strategy memory are not served by evidence routes.

`data/events.jsonl` is a hash-chained local ledger. This detects changes relative to retained receipts; it is not an organizer-independent signature. The local machine and organizer remain trusted. Preserve your entire data directory when moving your own installation, and back it up while idle.

The public release starts with a new archive. Historical evidence and seeds from the original private installation are not distributed. Local owner access can seal completed records; original owner launchers and secrets are excluded. This is application access control on a trusted local machine, not an operating-system boundary.

See [Practice](PRACTICE.md), [seasons](SEASONS.md), [strategy entry guide](ENTRY-KIT.md), and [harness schemas](HARNESS-AND-ANALYTICS.md).
