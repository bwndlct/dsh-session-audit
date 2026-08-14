# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-14

### Added

- **Slash commands**: `/session-audit [text|markdown|json]` and `/audit-list`
  are now registered when the `commands` service is available (e.g. web
  profiles). Headless profiles load the plugin without them — the
  `commands` service is optional.
- **Configurable thresholds**: the `session_audit` tool now accepts an optional
  `thresholds` parameter (object, subset of `AuditThresholds`). Provided
  values are shallow-merged with the defaults, allowing callers to tune
  rule sensitivity without code changes.
- **`engines` field**: `package.json` now declares `"engines": { "dsh":
  ">=0.1.0-rc.6" }`, matching the `dsh-session-export` reference plugin.

### Changed

- **`sessions` service is now optional**: `inject` only requires `'tools'`.
  The plugin reads the `sessions` service via `ctx.get('sessions')` when
  present, so headless profiles without a session registry can still load
  the plugin.
- **Performance: direct session ID lookup**: `readSessionLog` now stats
  `join(root, ws, sessionId, suffix)` directly before falling back to a
  full scan. The on-disk layout guarantees the directory name is the
  session id.
- **Performance: header-frame-only decode**: `listSessionLogs` now decodes
  only the first zstd frame (the header frame) instead of reading the
  entire log, reducing I/O for session listing.

### Fixed

- `analyzeSession` now properly merges partial `thresholds` objects with
  `DEFAULT_THRESHOLDS`, preventing crashes when callers pass a subset of
  threshold keys.

## [0.1.0] — 2026-08-14

### Added

- Initial release: `session_audit` tool for single-session execution audit.
- Text, Markdown, and JSON report formats.
- Deterministic audit rules: consecutive failures, failure rate,
  high-frequency tools, duplicate tool calls, repeated file reads,
  verification detection.
- Live session and durable log support.
- Zero runtime dependencies.