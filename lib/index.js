/**
 * dsh-session-audit — session execution analytics and audit reports for
 * DeepSeek Harness.
 *
 * Registers one model-facing tool, `session_audit`, which reads one DSH
 * session (the live in-memory one by default, or any durable log by id),
 * normalizes its events, runs deterministic rules, and renders an audit
 * report as text, Markdown, or JSON.
 *
 * The plugin has zero runtime dependencies: the tool is registered as a
 * plain `ToolDefinition` object (the same shape `defineTool` produces),
 * so the package links into any profile without installing peers.
 *
 * Local analysis only: session logs are read from this machine's DSH home
 * (`$DSH_HOME/sessions`, default `~/.dsh/sessions`) or from the live session
 * registry. The plugin performs no network access, no LLM calls, and writes
 * nothing except its own return value.
 *
 * @module dsh-session-audit
 */
import { adaptSession } from "./dsh/session-adapter.js";
import { listSessionLogs, readSessionLog, resolveSessionsRoot } from "./dsh/session-reader.js";
import { analyzeSession } from "./audit/analyzer.js";
import { formatTextReport } from "./formatters/text.js";
import { formatMarkdownReport } from "./formatters/markdown.js";
import { formatJsonReport } from "./formatters/json.js";
/** Stable Cordis plugin name (must match the loader entry in cordis.patch.yml). */
export const name = 'dsh-session-audit';
/** Requires the tool registry; uses the live session registry when present. */
export const inject = ['tools', 'sessions'];
export function apply(ctx) {
    const dispose = ctx.tools.register({
        name: 'session_audit',
        description: 'Audit one DeepSeek Harness session: duration, turns, steps, tool call distribution, ' +
            'failures, repeated actions, token usage and verification signals (test/build/lint). ' +
            'Reads the session log locally; pass no arguments to audit the current session. ' +
            'Use when the user asks how a session actually ran, what failed, or what was verified.',
        parameters: {
            type: 'object',
            properties: {
                session_id: {
                    type: 'string',
                    description: 'Target session id (defaults to the current session). Discover ids with list_sessions=true.',
                },
                format: {
                    type: 'string',
                    enum: ['text', 'markdown', 'json'],
                    description: 'Report format (default: text).',
                },
                list_sessions: {
                    type: 'boolean',
                    description: 'List recent durable sessions (id, cwd, created) instead of auditing one.',
                },
            },
        },
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: String(value?.rendered ?? '') }],
        },
        isConcurrencySafe: () => true,
        execute: async (args, exec) => {
            try {
                if (args.list_sessions === true) {
                    return await listSessions(exec?.signal);
                }
                const targetId = args.session_id ?? exec?.agent?.session?.id;
                if (targetId === undefined || targetId === '') {
                    return {
                        found: false,
                        message: 'no target session: invoked outside a session with no session_id. ' +
                            'Call again with list_sessions=true to discover session ids.',
                        rendered: 'session_audit: no target session (pass session_id or list_sessions=true).',
                    };
                }
                return await auditSession(ctx, targetId, args.format ?? 'text', exec?.signal);
            }
            catch (error) {
                const message = `session_audit failed: ${String(error?.message ?? error)}`;
                return { found: false, message, rendered: message };
            }
        },
    });
    ctx.effect(() => dispose, 'dsh-session-audit: tool registration');
}
async function listSessions(signal) {
    const logs = await listSessionLogs(resolveSessionsRoot(), signal);
    const sessions = logs.slice(0, 20).map((log) => ({
        id: log.id,
        cwd: log.cwd,
        createdAt: log.createdAt !== undefined ? new Date(log.createdAt).toISOString() : undefined,
        sizeBytes: log.sizeBytes,
    }));
    const header = `Recent DSH sessions (${logs.length} durable logs, newest first)`;
    const body = sessions
        .map((session, index) => {
        const created = session.createdAt ?? 'unknown time';
        const cwd = session.cwd ?? 'unknown cwd';
        return `${String(index + 1).padStart(2)}. ${session.id}\n     ${created}  ${cwd}`;
    })
        .join('\n');
    return {
        found: true,
        sessions,
        rendered: sessions.length > 0 ? `${header}\n${body}` : `${header}\n(none found under ${resolveSessionsRoot()})`,
    };
}
async function auditSession(ctx, sessionId, format, signal) {
    const log = await loadSessionLog(ctx, sessionId, signal);
    if (log === undefined) {
        const message = `session ${sessionId} was not found (not live, and no durable log under ${resolveSessionsRoot()}). ` +
            'Call again with list_sessions=true to discover ids.';
        return { found: false, message, rendered: `session_audit: ${message}` };
    }
    const adapted = adaptSession(log.raw);
    const report = analyzeSession({ header: log.raw.header, adapted, truncatedFrames: log.raw.truncatedFrames });
    const rendered = format === 'json' ? formatJsonReport(report) : format === 'markdown' ? formatMarkdownReport(report) : formatTextReport(report);
    return { found: true, report, rendered };
}
/** Live registry first (complete, includes the unflushed tail), durable log second. */
async function loadSessionLog(ctx, sessionId, signal) {
    const live = ctx.sessions?.get(sessionId);
    if (live !== undefined) {
        return {
            source: 'live',
            raw: {
                header: live.header,
                events: live.events,
            },
        };
    }
    const fromDisk = await readSessionLog(resolveSessionsRoot(), sessionId, signal);
    if (fromDisk === undefined)
        return undefined;
    return {
        source: 'disk',
        raw: { header: fromDisk.header, events: fromDisk.events, truncatedFrames: fromDisk.truncatedFrames },
    };
}
