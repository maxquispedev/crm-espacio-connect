# T002 — Addressing evidence (2026-10-05)

Ownership: addressing module, addressing lines in existing sender/templates,
and new addressing tests only. Base spec: b8051b0. No safety/schema/shared-doc
changes, deployment, push, main update or cleanup.

## Official Meta contract verified

Primary source consulted on 2026-10-05:
https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
Sections: Messages → Message send requests; Considerations; requesting contact
information using templates. Web browsing initially returned HTTP 429; a direct
HTTPS GET with a browser user agent succeeded, yielding the actual official
Spanish documentation, including rendered content and JSON examples. Temporary
source HTML/text: /tmp/meta-bsuid.html and /tmp/meta-bsuid.txt (not repo artifacts).

Meta defines `recipient` as the complete BSUID string, including country prefix
and period, or parent BSUID; it is not an object and it is not `to`. The same
addressing changes apply to every message type. If both request fields are
supplied, Meta gives the phone `to` precedence. Consequently this implementation
prefers stored BSUID by emitting ONLY `recipient`; phone-only emits ONLY `to`.
BSUID is preserved verbatim. Phone formatting is removed before the existing
Mexico 521→52 normalizer; letters/BSUIDs in the phone column fail closed rather
than being converted to digits.

Official exception: one-tap, zero-tap and copy-code authentication templates
require the user's phone. Local templates persist category but not those header/
button subtypes, so AUTHENTICATION conservatively selects phone even when both
identities exist; BSUID-only authentication fails before Graph. Other supported
message/template categories prefer BSUID. No speculative phone retry on failure.

## Coverage and callsites

`resolveMessageAddress` is the single server abstraction used by prepareSend
(text, all file media, location/contacts) and sendTemplate. Follow-up worker
already delegates to sendText/sendTemplate; legacy and sales delivery also
already delegate to these senders. No second sender or follow-up edit needed.
The remaining `/messages` Graph caller is bot/typing, a read/typing operation
addressed by `message_id`; it has no `to`/`recipient` and retains its sandbox
check. It must not receive a fabricated contact destination.

New tests exercise real sendText/sendMediaMessage/sendStructured/sendTemplate
functions and inspect Graph request bodies; only providers, filesystem and DB
are mocked. Phone-only/BSUID-only/both for text, native video, template and
location: exactly one destination; video caption/id and template variables/URL
button survive. Each kind/identity sandbox case checks zero Graph, media upload,
filesystem and credentials access. Missing identity, opaque parent BSUID,
invalid phone and authentication exception are covered.

## Verification checkpoint

- New addressing suite: **33/33 pass**.
- Initial plain pnpm invocations aborted before scripts: pnpm 11 tried reinstalling
  the shared symlinked dependencies and refused removal without a TTY. No modules
  were purged. Subsequent commands use `pnpm_config_verify_deps_before_run=false
  pnpm --pm-on-fail=ignore …` to execute existing scripts with original dependencies
  without an installation/mutation; package/lock/config unchanged.
- Full tests/typecheck/lint/build: running or pending at initial atomic commit;
  final results appended below.
- HTTP app/PostgreSQL self-test E2E: **pending integration T005**, not executed
  by this addressing worker. Unit payload coverage is not live E2E readiness.

Constitution Check I–IX: no new data/queries/services/secrets; original tenant,
window, sandbox and idempotency guards preserved. Spec017/task T002 implemented;
coordinator/integrator owns shared tasks/checkpoint updates and remaining E2E.
No new business policy requiring Obsidian sync in this addressing task.

Next step: merge the addressing implementation commit into the safety worktree
before safety modifies sender; integrate T003 and run T004–T007 gates/E2E.

## Final T002 gate results

Implementation commit: **fb8eda5** (`fix(whatsapp): address BSUID recipients
through Meta recipient field`). Sender/templates ownership released at that
commit; subsequent commit only appends this verification evidence.

All scripts run with the environment override described above:

| Gate | Result |
|---|---|
| `pnpm --pm-on-fail=ignore typecheck` | exit 0 |
| `pnpm --pm-on-fail=ignore lint` | exit 0; 3 pre-existing warnings (img + unused eslint-disable) |
| `pnpm --pm-on-fail=ignore build` | exit 0; existing ambiguous duration CSS warning |
| `pnpm --pm-on-fail=ignore test -- tests/unit/messaging-addressing.test.ts` | exit 0; pnpm forwards `--`, so Vitest actually ran the complete suite: **1407 pass, 9 skipped**, 118 passing files + 1 skipped; new suite **33/33** |
| `git diff --check` | exit 0 |
| Live self-test HTTP/PG | not run here; remains explicitly pending T005 integration |

Original dependencies are symlinked at `node_modules` as authorized. The
symlink is untracked and retained (no cleanup requested); all owned source and
evidence changes are committed. Full build log: /tmp/addressing-build.log.
No live Meta request or real WhatsApp message was sent. Technical scope T002
is delivered; spec017 overall is not declared READY until integration/E2E.
