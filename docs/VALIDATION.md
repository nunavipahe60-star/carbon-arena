# Release validation

Validation performed on Windows with Node.js 24.19.0 and pinned QuickJS 0.32.0. Tests use public fixtures and isolated archives, never the original competition installation.

| Check | Result and coverage |
| --- | --- |
| Unit and integration tests | 88 tests covering rule vectors, full deterministic matches, sandbox restrictions and recovery, scoring, Elo, title transfers, journal tampering, reservations, bans, metadata projections, sealed access, and season scheduling/recovery |
| Quick Practice browser rehearsal | Passed: 2 games, 600 turns, 1,200 strategy calls, 2 independent comparisons; no complete strategy rerun, as designed |
| Championship browser rehearsal | Passed: 6 games, 1,800 turns plus 1,800 repeat turns, 6 independent comparisons, zero failed strategy calls; no rated results or champion |
| Offline file build | Passed with HTTP(S) blocked: stepping, replay export, restart and replay import, desktop and 390px layouts, no browser errors or external requests |
| Browser controls and local protections | Registration including UTF-8 BOM preservation, invalid/duplicate entries, progress, results, downloads, replay play/pause/step/rewind/seek, request token/Origin/Host checks, source-path protection, mobile layout and restart persistence |

The Practice and championship pages were also inspected in rendered desktop/mobile screenshots. The repository image shows only the included offline demo using public bundled planners.

The initial test pass found one assertion still matching an older v0.4 rejection message. It was updated to the publication's actual message, and the complete affected test file passed. Release installation and final test results are checked from a fresh extraction before handoff.

Limits: the full 36-game and 60-game events were not replayed for this publication. Their policies, schedules, scoring, freeze permanence, recovery and evidence checks have automated coverage. The new result-ZIP writer is checked separately; this does not establish a new full-event verification result. Linux, macOS, Node.js 22 and other browser engines were not exercised. The browser tests used an existing compatible Chromium through the documented environment override; downloading Chromium through Playwright was not needed. A runtime change produces a different freeze identity and must not be used to reinterpret an older event.
