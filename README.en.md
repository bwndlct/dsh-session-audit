# dsh-session-audit

Understand how your DeepSeek Harness agent actually worked.

Inspect steps, tool calls, failures, repeated actions, token usage and
verification signals for one DSH session — rendered as a readable audit
report by a single `session_audit` tool call.

中文主文档：[README.md](./README.md)

```text
DSH Session Audit
──────────────────────────────────────────────

Session
ID              session-d2309fa2-47d3-484a-8357-236e0acdd9aa
Model           glm-5.3
Provider        zai-coding-cn
Duration        51m 42s
Started         2026-08-14T09:08:08.384Z

Execution
Turns           4
Steps           121
Assistant msgs  120
Turn endings    completed×1, interrupted×1, error×1

Tools
Total calls     150
Succeeded       143
Failed          6
Unresolved      1
Failure rate    4.0%

Top tools
  bash                  83  (1 failed)
  write                 26
  edit                  21  (4 failed)
  read                  12

Tokens
Input           349,428
Output          80,415
Cache read      9,243,520
Total           9,673,363

Execution signals
  ⚠ 3 consecutive failed tool calls detected
  ⚠ `bash` called 83 times
  ℹ session has a turn that never closed

Verification
  ✓ pnpm run typecheck  [typecheck]
  ✓ npm test  [test]  (2 attempts, 2 ok)
```

*(real report from a live machine session)*

## Why

DSH sessions already record *what happened* — the session log is the
append-only source of truth. But reading a 1000-event log does not answer
the questions you actually have after an agent run:

> How long did this take? How many turns and steps? Which tools dominated?
> Where did it fail? Did it repeat the same calls? Was anything verified?

`dsh-session-audit` folds one session's durable event log into those
answers. It is a **step / tool-call profiler and failure analyzer**, not a
token dashboard (see [Existing alternatives](#existing-alternatives)).

## Features

- **Session metrics** — duration, turns, steps, assistant messages, tool
  call totals, per-tool distribution, success/failure split.
- **Token usage** — input / output / cache buckets folded per model step
  exactly like the official `session-stats` projection; reported as
  *unavailable* (never estimated) when the provider logged no usage.
- **Deterministic audit signals** — consecutive failures, failure rate,
  high-frequency tools, identical repeated calls (key-order insensitive),
  repeated reads of the same file. Rule-based only; no LLM judgement.
- **Verification detection** — recognizes test/build/lint/typecheck
  commands (`npm test`, `pytest`, `cargo test`, `tsc`, `eslint`, …) inside
  shell tool calls and reports their observed outcomes.
- **Three formats** — text (default), Markdown, JSON with a stable
  `schemaVersion` you can build on.
- **Live or historical** — audits the current session in memory by default,
  or any durable session by id; lists recent sessions for discovery.
- **Robust** — empty sessions, malformed events, unknown future event
  types, orphan results, torn crash-tail log frames: all handled without
  crashing, and surfaced as data-quality notes.

## Installation

Requires dsh (`@deepseek-ai/dsh`) 0.1.0-rc.6+.

```sh
# from npm (once published)
dsh plugin --profile web add dsh-session-audit

# from GitHub
dsh plugin --profile web add github:bwndlct/dsh-plugins/plugins/dsh-session-audit

# local development (link)
dsh plugin --profile web add link:/path/to/dsh-plugins/plugins/dsh-session-audit
```

Then add the package to the profile's `dsh.profile.bundles` array in
`~/.dsh/profiles/web/package.json` (the install command above does not do
this step):

```jsonc
"dsh": {
  "profile": {
    "bundles": [
      // ...existing entries...
      "dsh-session-audit"
    ]
  }
}
```

Restart dsh (`dsh web`). Verify the mount:

```sh
dsh --profile web --dump-config | grep -A2 session-audit
```

## Usage

In a session, ask the agent (it will call the tool), or use the slash
commands in interactive profiles:

- `audit this session` — audits the current session.
- `audit session session-abc123` — audits a stored session by id.
- `list recent sessions` — lists durable sessions to pick from.
- `audit this session as markdown` / `as json` — picks the format.

Slash commands (available when the `commands` service is mounted, e.g. web
profiles):

- `/session-audit [text|markdown|json]` — audit the current session (empty
  for text).
- `/audit-list` — list recent durable sessions.

Tool parameters:

| parameter | type | meaning |
|---|---|---|
| `session_id` | string | target session (default: current session) |
| `format` | `text` \| `markdown` \| `json` | report format (default `text`) |
| `list_sessions` | boolean | list recent sessions instead of auditing |
| `thresholds` | object | optional overrides for audit rule thresholds (shallow-merged with defaults) |

The report stays local — it is returned as the tool result for you and the
model to read; nothing is written to disk.

## Audit Signals

All rules are deterministic and threshold-driven; every threshold lives in
one place (`src/rules/thresholds.ts`) and defaults are conservative so a
normal session does not drown in warnings.

| Signal | Severity | Default threshold |
|---|---|---|
| consecutive failed tool calls | warning | ≥ 3 |
| overall tool failure rate | warning | ≥ 15% over ≥ 3 resolved results |
| identical tool call repeated | warning | ≥ 3 occurrences (arguments compared with sorted keys — JSON key order never hides a duplicate) |
| same file read repeatedly | info / warning | ≥ 4 reads (warning ≥ 8); reader tool + argument name configurable (`read`/`read_file` → `file_path` by default) |
| high-frequency tool | info / warning | ≥ 15 calls (info), ≥ 30 (warning) |
| turn ended non-completed | info | any `aborted` / `error` / `interrupted` ending |
| open turn | info | live/interrupted session indicator |
| no verification command detected | info | careful wording — absence of evidence, not evidence of absence |
| verification command failed | warning | last observed attempt failed |
| repeated verification failures | warning | ≥ 2 failed attempts, none succeeding after |

There is deliberately **no efficiency score** — the report states facts and
deterministic findings; judging them stays with you.

## Verification Detection

The rules recognize common verifiers inside shell tool calls
(`bash` / `pwsh`, configurable):

- **test**: `npm|pnpm|yarn|bun (run) test*`, `pytest`, `cargo test`,
  `go test`, `dotnet test`, `jest`, `vitest`, `mocha`, `mvn|gradle test`,
  `make test`
- **lint**: `(npm|pnpm|yarn|bun) (run) lint*`, `eslint`, `biome`,
  `prettier`, `ruff`, `pylint`, `flake8`, `golangci-lint`
- **typecheck**: `(npm|…) typecheck*`, `tsc`, `mypy`, `pyright`,
  `cargo check`
- **build**: `(npm|pnpm|yarn|bun) (run) build*`, `cargo build`, `go build`,
  `dotnet build`, `make build|all`

Success is decided from what was actually observed in the tool result:
a harness-level error, or the documented `[exit code: N]` marker that
dsh-tool-bash appends for non-zero exits, marks the attempt failed. A
matched command with no durable result is treated as *not observed*, not as
a failure. When no verifier is seen at all, the report says exactly that —
it never claims the agent "did not verify", because verification may have
run through a mechanism the log cannot show.

## How it works

```text
DSH session (live registry or ~/.dsh/sessions durable log, zstd frames)
        │  session-reader — direct stat by session id (dir name IS id),
        │                    header-frame-only decode for listing, full decode
        │                    for audit; fallback scan when dir name ≠ header id
        ▼
session-adapter — raw events → normalized AuditEvent vocabulary
        ▼
analyzer — one O(n) pass: counts, tool pairing, usage fold (per turn:step,
           usage chunk superseded by final assistant/message usage)
        ▼
rules — deterministic signals from the folded facts
        ▼
SessionAuditReport (schemaVersion 1.0) — text / markdown / json
```

- Turn/step counting mirrors the official `dsh-session-stats` semantics
  (steps = `step/end` count; turns = distinct turns with a closed step), so
  audit numbers agree with the Web UI stats strip.
- Token buckets follow `TokenUsage` from `dsh-llm`: input excludes cached
  input; cache read/write are separate; reasoning (a subset of output) is
  reported but never added into totals.
- DSH event-shape knowledge is confined to the adapter; the analyzer and
  rules depend only on the normalized vocabulary.

## Privacy

**dsh-session-audit performs local analysis only.** It reads session logs
from this machine's DSH home and the live in-memory session registry. It
makes no network requests, calls no LLM APIs, sends no telemetry, and
collects nothing about you. Reports exist as tool-call results inside your
own session.

## Development

```sh
cd plugins/dsh-session-audit
npm install --no-save            # typescript + @types/node for tooling
npx tsc -p tsconfig.json         # typecheck + build to lib/
node --test tests/               # 32 unit tests
```

Layout:

```text
src/
  index.ts               tool registration + live/disk session loading
  dsh/
    session-adapter.ts   raw DSH events → normalized audit events
    session-reader.ts    durable-log discovery, zstd decode, JSONL parse
  audit/
    analyzer.ts          O(n) fold + rule orchestration
    types.ts             SessionAuditReport schema, AuditEvent vocabulary
  rules/                 one file per rule + centralized thresholds
  formatters/            text / markdown / json
  utils/                 stable-json (sorted-key identity), duration
tests/                   node:test suites: analyzer, rules, edge cases, reader
```

## Compatibility

- Verified against `@deepseek-ai/dsh` **0.1.0-rc.6** (session format
  version 0).
- Reads both compressed (`session.jsonl.zstd`, default) and plain
  (`session.jsonl`) durable logs.
- `SESSION_FORMAT_VERSION` is pre-release; a future format bump will need
  an adapter update — which is why all shape knowledge lives in one place.

## Limitations

- Verification matching is pattern-based; a verifier wrapped in an unusual
  script name is not recognized.
- Sub-agent sessions are audited individually (by id); there is no
  cross-session rollup yet.
- Reasoning tokens are reported when the provider supplies them, but the
  per-step values of some providers cannot be reconstructed.
- No time-series or context-growth analysis yet (roadmap).

## Roadmap

- v0.3 — session compare
- v0.4 — context growth analysis
- v0.5 — HTML report
- later — web dashboard views, cross-harness audit

## Existing alternatives

Token/cost dashboards already exist (`dsh-spend`, `dsh-balance-stats`,
`dsh-session-cost`, `dsh-token-monitor`) and are complementary: they
answer *how much did I spend*. This plugin answers *how did the agent
work* — execution shape, failure locations, repetition, verification. As of
v0.2.0 no other plugin in the `dshplugin` ecosystem covers single-session
execution audit.

## License

[MIT](./LICENSE)