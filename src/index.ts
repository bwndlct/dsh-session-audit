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
import { adaptSession, type RawSessionEvent, type RawSessionLog, type SessionHeaderLike } from './dsh/session-adapter.ts'
import { listSessionLogs, readSessionLog, resolveSessionsRoot } from './dsh/session-reader.ts'
import { analyzeSession } from './audit/analyzer.ts'
import type { SessionAuditReport } from './audit/types.ts'
import { formatTextReport } from './formatters/text.ts'
import { formatMarkdownReport } from './formatters/markdown.ts'
import { formatJsonReport } from './formatters/json.ts'
import { DEFAULT_THRESHOLDS, type AuditThresholds } from './rules/thresholds.ts'

/** Stable Cordis plugin name (must match the loader entry in cordis.patch.yml). */
export const name = 'dsh-session-audit'

/** Requires the tool registry; sessions service is optional (headless profiles). */
export const inject = ['tools']

/** Structural view of the services this plugin reads (no runtime imports). */
interface SessionsService {
	get(id: string): { id: string; events: unknown[]; header: SessionHeaderLike } | undefined
}

interface ExecLike {
	signal?: AbortSignal
	agent?: { session?: { id: string } }
}

interface ContextLike {
	tools: { register(definition: unknown): () => void }
	get(name: 'sessions'): SessionsService | undefined
	get(name: 'commands'): { register(definition: unknown): () => void } | undefined
	get(name: string): unknown
	effect(cleanup: () => unknown, reason?: string): unknown
}

export interface AuditToolResult {
	found: boolean
	message?: string
	sessions?: Array<{ id: string; cwd?: string; createdAt?: string; sizeBytes: number }>
	report?: SessionAuditReport
	rendered: string
}

export function apply(ctx: ContextLike): void {
	const dispose = ctx.tools.register({
		name: 'session_audit',
		description:
			'Audit one DeepSeek Harness session: duration, turns, steps, tool call distribution, ' +
			'failures, repeated actions, token usage and verification signals (test/build/lint). ' +
			'Reads the session log locally; pass no arguments to audit the current session. ' +
			'Use when the user asks how a session actually ran, what failed, or what was verified.',
		parameters: {
			type: 'object',
			properties: {
				session_id: {
					type: 'string',
					description:
						'Target session id (defaults to the current session). Discover ids with list_sessions=true.',
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
				thresholds: {
					type: 'object',
					description:
						'Optional overrides for audit rule thresholds. Keys are a subset of AuditThresholds ' +
						'(e.g. toolCallsWarning, failureRateWarning, duplicateToolCallMin). ' +
						'Provided values are shallow-merged with the defaults.',
					additionalProperties: true,
				},
			},
		},
		output: {
			schema: { type: 'object', additionalProperties: true },
			render: (_args: unknown, value: { rendered?: string }) => [{ type: 'text', text: String(value?.rendered ?? '') }],
		},
		isConcurrencySafe: () => true,
		execute: async (
			args: { session_id?: string; format?: 'text' | 'markdown' | 'json'; list_sessions?: boolean; thresholds?: Partial<AuditThresholds> },
			exec: ExecLike,
		): Promise<AuditToolResult> => {
			try {
				if (args.list_sessions === true) {
					return await listSessions(exec?.signal)
				}
				const targetId = args.session_id ?? exec?.agent?.session?.id
				if (targetId === undefined || targetId === '') {
					return {
						found: false,
						message:
							'no target session: invoked outside a session with no session_id. ' +
							'Call again with list_sessions=true to discover session ids.',
						rendered: 'session_audit: no target session (pass session_id or list_sessions=true).',
					}
				}
				const mergedThresholds = args.thresholds !== undefined
					? { ...DEFAULT_THRESHOLDS, ...args.thresholds }
					: DEFAULT_THRESHOLDS
				return await auditSession(ctx, targetId, args.format ?? 'text', mergedThresholds, exec?.signal)
			} catch (error) {
				const message = `session_audit failed: ${String((error as Error)?.message ?? error)}`
				return { found: false, message, rendered: message }
			}
		},
	})
	ctx.effect(() => dispose, 'dsh-session-audit: tool registration')

	// Optional slash commands: mounted only when the commands service is present
	// (e.g. web profiles). Headless profiles load the plugin without them.
	const commands = ctx.get('commands')
	if (commands !== undefined) {
		ctx.effect(() => commands.register({
			name: 'session-audit',
			description: 'Audit the current session (format: text, markdown, or json — empty for text)',
			input: { hint: 'text | markdown | json — empty for text' },
			handler: async (invocation: {
				agent: { session: { id: string } }
				rawInput: string
				signal: AbortSignal
			}): Promise<{ kind: 'success' | 'error'; text: string }> => {
				const raw = invocation.rawInput.trim().toLowerCase()
				const format = raw === '' || raw === 'text' ? 'text' as const
					: raw === 'markdown' ? 'markdown' as const
					: raw === 'json' ? 'json' as const
					: undefined
				if (format === undefined) {
					return {
						kind: 'error',
						text: `/session-audit: unknown format "${invocation.rawInput.trim()}" (expected text, markdown, or json)`,
					}
				}
				try {
					const result = await auditSession(ctx, invocation.agent.session.id, format, DEFAULT_THRESHOLDS, invocation.signal)
					return { kind: 'success', text: result.rendered }
				} catch (error) {
					return {
						kind: 'error',
						text: `/session-audit: ${error instanceof Error ? error.message : String(error)}`,
					}
				}
			},
		}), 'dsh-session-audit: /session-audit command')

		ctx.effect(() => commands.register({
			name: 'audit-list',
			description: 'List recent durable DSH sessions',
			handler: async (invocation: { signal: AbortSignal }): Promise<{ kind: 'success' | 'error'; text: string }> => {
				try {
					const result = await listSessions(invocation.signal)
					return { kind: 'success', text: result.rendered }
				} catch (error) {
					return {
						kind: 'error',
						text: `/audit-list: ${error instanceof Error ? error.message : String(error)}`,
					}
				}
			},
		}), 'dsh-session-audit: /audit-list command')
	}
}

async function listSessions(signal: AbortSignal | undefined): Promise<AuditToolResult> {
	const logs = await listSessionLogs(resolveSessionsRoot(), signal)
	const sessions = logs.slice(0, 20).map((log) => ({
		id: log.id,
		cwd: log.cwd,
		createdAt: log.createdAt !== undefined ? new Date(log.createdAt).toISOString() : undefined,
		sizeBytes: log.sizeBytes,
	}))
	const header = `Recent DSH sessions (${logs.length} durable logs, newest first)`
	const body = sessions
		.map((session, index) => {
			const created = session.createdAt ?? 'unknown time'
			const cwd = session.cwd ?? 'unknown cwd'
			return `${String(index + 1).padStart(2)}. ${session.id}\n     ${created}  ${cwd}`
		})
		.join('\n')
	return {
		found: true,
		sessions,
		rendered: sessions.length > 0 ? `${header}\n${body}` : `${header}\n(none found under ${resolveSessionsRoot()})`,
	}
}

async function auditSession(
	ctx: ContextLike,
	sessionId: string,
	format: 'text' | 'markdown' | 'json',
	thresholds: AuditThresholds,
	signal: AbortSignal | undefined,
): Promise<AuditToolResult> {
	const log = await loadSessionLog(ctx, sessionId, signal)
	if (log === undefined) {
		const message =
			`session ${sessionId} was not found (not live, and no durable log under ${resolveSessionsRoot()}). ` +
			'Call again with list_sessions=true to discover ids.'
		return { found: false, message, rendered: `session_audit: ${message}` }
	}
	const adapted = adaptSession(log.raw)
	const report = analyzeSession({ header: log.raw.header, adapted, truncatedFrames: log.raw.truncatedFrames }, thresholds)
	const rendered =
		format === 'json' ? formatJsonReport(report) : format === 'markdown' ? formatMarkdownReport(report) : formatTextReport(report)
	return { found: true, report, rendered }
}

/** Live registry first (complete, includes the unflushed tail), durable log second. */
async function loadSessionLog(
	ctx: ContextLike,
	sessionId: string,
	signal: AbortSignal | undefined,
): Promise<{ raw: RawSessionLog; source: 'live' | 'disk' } | undefined> {
	const sessions = ctx.get('sessions')
	const live = sessions?.get(sessionId)
	if (live !== undefined) {
		return {
			source: 'live',
			raw: {
				header: live.header,
				events: live.events as RawSessionEvent[],
			},
		}
	}
	const fromDisk = await readSessionLog(resolveSessionsRoot(), sessionId, signal)
	if (fromDisk === undefined) return undefined
	return {
		source: 'disk',
		raw: { header: fromDisk.header, events: fromDisk.events, truncatedFrames: fromDisk.truncatedFrames },
	}
}
