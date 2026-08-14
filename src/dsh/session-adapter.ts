/**
 * Session adapter — maps raw DSH durable session events onto the normalized
 * audit vocabulary. All shape knowledge about DSH logs lives here.
 *
 * Raw event envelope: `{ type, seq, time, data }`. The durable vocabulary is
 * defined by `@deepseek-ai/dsh-session` (`SessionEventMap`); shapes below were
 * verified against dsh 0.1.0-rc.6 sources and real session logs.
 *
 * @module dsh-session-audit/dsh/session-adapter
 */
import type { AuditEvent, AuditSessionContext, AuditUsageSample } from '../audit/types.ts'

/** Session header — first logical line of a durable log. */
export interface SessionHeaderLike {
	type?: 'session'
	id: string
	cwd?: string
	createdAt?: number
	parentSession?: string
	delegationDepth?: number
	agentPreset?: string
}

/** One raw durable event, already JSON-parsed. */
export interface RawSessionEvent {
	type: string
	seq?: number
	time?: number
	data?: unknown
}

/** Raw log + header as produced by the reader or a live session object. */
export interface RawSessionLog {
	header: SessionHeaderLike
	events: RawSessionEvent[]
	/** zstd frames that failed checksum/decode and were skipped (crash tail). */
	truncatedFrames?: number
}

/**
 * Event types deliberately not projected into the audit vocabulary. They are
 * known, expected, and carry no v0.1 metric: stream deltas arrive as packed
 * chunk rows (`text-chunks` / `reasoning-chunks` / `tool-call-chunks`) or as
 * `assistant/chunk` (usage chunks ARE projected); the rest are log-only UI or
 * lifecycle records.
 */
const SKIPPED_KNOWN_TYPES = new Set([
	'assistant/chunk', // usage chunks handled specially; deltas not needed
	'user/message',
	'session/title',
	'session/title-llm-request',
	'request/context',
	'todo/write',
	'goal/change',
	'agent/inbox/spliced',
	'permission/preset',
	'sandbox/mode',
	'approval/policy',
	'session/title-llm-response',
	// known log-only vocabulary from companion plugins (dsh-session README):
	// seed boundary, bounded-recovery retries
	'session/end-seed',
	'llm/retry',
	'llm/retry-started',
	// packed chunk rows (storage codec tags — no slash)
	'text-chunks',
	'reasoning-chunks',
	'tool-call-chunks',
])

export interface AdaptedSession {
	events: AuditEvent[]
	context: AuditSessionContext
	/** count of events recognized as unknown types (future vocabulary). */
	skippedEvents: number
	unknownEventTypes: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function usageFrom(value: unknown): AuditUsageSample | undefined {
	if (!isRecord(value)) return undefined
	const input = numOrUndefined(value.inputTokens)
	const output = numOrUndefined(value.outputTokens)
	if (input === undefined || output === undefined) return undefined
	return {
		inputTokens: input,
		outputTokens: output,
		cacheReadTokens: numOrUndefined(value.cacheReadTokens),
		cacheWriteTokens: numOrUndefined(value.cacheWriteTokens),
		reasoningTokens: numOrUndefined(value.reasoningTokens),
	}
}

/** Adapt one raw log into the normalized audit vocabulary. Never throws. */
export function adaptSession(raw: RawSessionLog): AdaptedSession {
	const events: AuditEvent[] = []
	const models: string[] = []
	const providers: string[] = []
	const unknownEventTypes: string[] = []
	let skippedEvents = 0

	for (const event of raw.events) {
		if (!isRecord(event)) {
			skippedEvents += 1
			continue
		}
		const type = typeof event.type === 'string' ? event.type : ''
		const seq = numOrUndefined(event.seq) ?? events.length
		const time = numOrUndefined(event.time)
		const data = isRecord(event.data) ? event.data : {}

		switch (type) {
			case 'turn/start': {
				const turn = numOrUndefined(data.turn)
				if (turn !== undefined) events.push({ kind: 'turn-start', seq, time, turn })
				else skippedEvents += 1
				break
			}
			case 'turn/end': {
				const turn = numOrUndefined(data.turn)
				const reason = isRecord(data.reason) && typeof data.reason.kind === 'string' ? data.reason.kind : 'unknown'
				if (turn !== undefined) events.push({ kind: 'turn-end', seq, time, turn, reason })
				else skippedEvents += 1
				break
			}
			case 'step/start':
			case 'step/end': {
				const turn = numOrUndefined(data.turn)
				const step = numOrUndefined(data.step)
				if (turn !== undefined && step !== undefined) {
					events.push({ kind: type === 'step/start' ? 'step-start' : 'step-end', seq, time, turn, step })
				} else skippedEvents += 1
				break
			}
			case 'tool/call': {
				const turn = numOrUndefined(data.turn)
				const step = numOrUndefined(data.step)
				const callId = typeof data.callId === 'string' ? data.callId : ''
				const name = typeof data.name === 'string' ? data.name : ''
				const argsRaw = typeof data.arguments === 'string' ? data.arguments : ''
				if (turn === undefined || step === undefined || callId === '' || name === '') {
					skippedEvents += 1
					break
				}
				let args: Record<string, unknown> | undefined
				if (argsRaw !== '') {
					try {
						const parsed: unknown = JSON.parse(argsRaw)
						if (isRecord(parsed)) args = parsed
					} catch {
						/* model-emitted non-JSON arguments: keep raw string only */
					}
				}
				events.push({ kind: 'tool-call', seq, time, turn, step, callId, name, args, argsRaw })
				break
			}
			case 'tool/result': {
				const turn = numOrUndefined(data.turn)
				const step = numOrUndefined(data.step)
				const message = isRecord(data.message) ? data.message : {}
				const source = isRecord(message.source) ? message.source : {}
				const callId = typeof source.callId === 'string' ? source.callId : ''
				if (turn === undefined || step === undefined || callId === '') {
					skippedEvents += 1
					break
				}
				const block = firstToolResultBlock(message.content)
				const error = isRecord(data.error) ? data.error : undefined
				events.push({
					kind: 'tool-result',
					seq,
					time,
					turn,
					step,
					callId,
					isError: block?.isError === true || error !== undefined,
					errorName: typeof error?.name === 'string' ? error.name : undefined,
					errorCode: typeof error?.code === 'string' ? error.code : undefined,
					textPreview: block?.text,
				})
				break
			}
			case 'assistant/message': {
				const turn = numOrUndefined(data.turn)
				const step = numOrUndefined(data.step)
				if (turn === undefined || step === undefined) {
					skippedEvents += 1
					break
				}
				events.push({ kind: 'assistant-message', seq, time, turn, step, usage: usageFrom(data.usage) })
				break
			}
			case 'assistant/chunk': {
				// usage chunks are the early per-step sample; the final
				// assistant/message usage (if any) replaces it in the fold.
				const chunk = isRecord(data.chunk) ? data.chunk : {}
				if (chunk.type !== 'usage') break
				const usage = usageFrom(chunk.usage)
				const turn = numOrUndefined(data.turn)
				const step = numOrUndefined(data.step)
				if (usage === undefined || turn === undefined || step === undefined) break
				events.push({ kind: 'usage-sample', seq, time, turn, step, usage })
				break
			}
			case 'request/header': {
				const header = isRecord(data.header) ? data.header : {}
				const config = isRecord(header.config) ? header.config : {}
				const provider = typeof config.provider === 'string' ? config.provider : undefined
				const model = typeof config.model === 'string' ? config.model : undefined
				if (provider !== undefined && !providers.includes(provider)) providers.push(provider)
				if (model !== undefined && !models.includes(model)) models.push(model)
				break
			}
			default: {
				// `hook/*` bridge events (declaration-merged by hook plugins) are
				// known log-only records; any other unrecognized type is counted.
				const known = type !== '' && (SKIPPED_KNOWN_TYPES.has(type) || type.startsWith('hook/'))
				if (type === '' || !known) {
					skippedEvents += 1
					if (type !== '' && !unknownEventTypes.includes(type)) unknownEventTypes.push(type)
				}
				break
			}
		}
	}

	return {
		events,
		context: { models, providers },
		skippedEvents,
		unknownEventTypes,
	}
}

interface ToolResultBlockView {
	isError?: boolean
	text?: string
}

function firstToolResultBlock(content: unknown): ToolResultBlockView | undefined {
	if (!Array.isArray(content)) return undefined
	for (const entry of content) {
		if (!isRecord(entry) || entry.type !== 'tool-result') continue
		let text: string | undefined
		if (Array.isArray(entry.content)) {
			for (const part of entry.content) {
				if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
					// Bounded head+tail preview: the tail matters because shell tools
					// append the `[exit code: N]` marker as the final line.
					text = part.text.length > 400
						? `${part.text.slice(0, 280)}
…
${part.text.slice(-120)}`
						: part.text
					break
				}
			}
		}
		return { isError: entry.isError === true, text }
	}
	return undefined
}
