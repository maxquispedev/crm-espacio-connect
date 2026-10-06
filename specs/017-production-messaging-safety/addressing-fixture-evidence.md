# 017 addressing fixture follow-up — 2026-10-05

Merged safety runtime e545a9c by fast-forward from a0c07f7 before edits, preserving ancestry. Read safety-evidence, mandatory SDD/domain context, actual sender/status/turn-safety/ledger and existing tests.

Only the four assigned unit suites and this evidence changed. Runtime, shared fixture, other tests, tasks and global checkpoint remain owned by safety/integrator/coordinator.

Replaced queued/column-proxy DB stubs with the existing createMemDb and real schema: transactions, rollback and for(update) are supported without mocking freshness or delivery guards. Fixtures contain tenant-bound contacts/conversations, textual inbound pointer and enabled agent profile; real captureTurnToken/isTurnCurrent execute. Real bindOutboundWamid persists wamid and reconciles durable receipts. Attention status mock is partial so binding remains real.

All original payload/addressing, sandbox, media MIME/kind/caption/limits, origin, cancellation and attention assertions retained. The historical AI-during-handoff test now expects StaleTurnError and zero Graph while retaining its pending-attention assertion; additional authorized AI-send coverage preserves pending attention without manual cancellation. Assertions locate outbound rows separately from the newly seeded inbound.

Strengthened every identity/type payload case with durable pending-before-Graph, bound wamid still pending, unconfirmed ledger and zero jobs. Added sent/delivered/read confirmation with duplicate/reversed receipts and durable early-read replay at binding; exactly one ledger and Graph call. Provider failure tests inspect persisted failed rows, retain AI origin/caption and assert no retry/manual cancellation.

## Verification

- Focus command: `pnpm_config_verify_deps_before_run=false pnpm --pm-on-fail=ignore exec vitest run tests/unit/messaging-addressing.test.ts tests/unit/send-media-kind-override.test.ts tests/unit/send-follow-up-cancel.test.ts tests/unit/attention-hooks.test.ts`: exit 0, **74/74**, four suites (37 + 9 + 2 + 26).
- Same launcher `typecheck`: exit 0 after final test additions.
- Same launcher `exec eslint` on the four assigned files: exit 0.
- `git diff --check`: exit 0.

Full lint/build/test and real HTTP/PostgreSQL E2E are PENDING integrator, already authorized; no claim of spec017 READY or physical database/provider verification. No push, deploy, main modification, real provider calls or cleanup performed. Next: merge this atomic fixture commit preserving ancestry and run integrator gates/live E2E; final tasks/CURRENT_STATE/domain updates belong to integrator/coordinator.
