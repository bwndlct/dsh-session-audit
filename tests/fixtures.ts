/**
 * Shared fixture factory — builds raw DSH session events in the exact
 * durable shapes verified against dsh 0.1.0-rc.6 real session logs.
 *
 * @module tests/fixtures
 */

let seqCounter = 0
let timeCounter = 1_000

export function resetFixtures(): void {
	seqCounter = 0
	timeCounter = 1_000
}

function nextSeq(): number {
	seqCounter += 1
	return seqCounter
}

function nextTime(): number {
	timeCounter += 50
	return timeCounter
}

export function sessionHeader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: 'session',
		version: 0,
		id: 'session-test-0001',
		createdAt: 1_000,
		cwd: '/tmp/project',
		delegationDepth: 0,
		...overrides,
	}
}

export function turnStart(turn: number): Record<string, unknown> {
	return { type: 'turn/start', seq: nextSeq(), time: nextTime(), data: { turn } }
}

export function turnEnd(turn: number, reason = 'completed'): Record<string, unknown> {
	return { type: 'turn/end', seq: nextSeq(), time: nextTime(), data: { turn, reason: { kind: reason } } }
}

export function stepStart(turn: number, step: number): Record<string, unknown> {
	return { type: 'step/start', seq: nextSeq(), time: nextTime(), data: { turn, step } }
}

export function stepEnd(turn: number, step: number): Record<string, unknown> {
	return { type: 'step/end', seq: nextSeq(), time: nextTime(), data: { turn, step } }
}

export function toolCall(
	turn: number,
	step: number,
	callId: string,
	name: string,
	args: Record<string, unknown> | string,
): Record<string, unknown> {
	const arguments_ = typeof args === 'string' ? args : JSON.stringify(args)
	return { type: 'tool/call', seq: nextSeq(), time: nextTime(), data: { turn, step, callId, name, arguments: arguments_ } }
}

export function toolResult(
	turn: number,
	step: number,
	callId: string,
	options: {
		isError?: boolean
		error?: { name: string; code: string }
		text?: string
	} = {},
): Record<string, unknown> {
	const block: Record<string, unknown> = {
		type: 'tool-result',
		toolCallId: callId,
		content: [{ type: 'text', text: options.text ?? 'ok' }],
	}
	if (options.isError === true) block.isError = true
	return {
		type: 'tool/result',
		seq: nextSeq(),
		time: nextTime(),
		data: {
			turn,
			step,
			message: {
				source: { kind: 'tool', callId },
				content: [block],
			},
			...(options.error !== undefined ? { error: options.error } : {}),
		},
	}
}

export function bashResult(
	turn: number,
	step: number,
	callId: string,
	exitCode: number | undefined,
	text = '',
): Record<string, unknown> {
	const suffix = exitCode !== undefined && exitCode !== 0 ? `\n[exit code: ${exitCode}]` : exitCode === 0 ? '\n[exit code: 0]' : ''
	return toolResult(turn, step, callId, { text: `${text}${suffix}` })
}

export function assistantMessage(
	turn: number,
	step: number,
	options: { usage?: Record<string, number> } = {},
): Record<string, unknown> {
	return {
		type: 'assistant/message',
		seq: nextSeq(),
		time: nextTime(),
		data: {
			turn,
			step,
			message: {
				role: 'assistant',
				id: `msg-${turn}-${step}`,
				content: [{ type: 'text', text: 'message' }],
				source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
			},
			...(options.usage !== undefined ? { usage: options.usage } : {}),
		},
	}
}

export function usageChunk(turn: number, step: number, usage: Record<string, number>): Record<string, unknown> {
	return {
		type: 'assistant/chunk',
		seq: nextSeq(),
		time: nextTime(),
		data: { turn, step, chunk: { type: 'usage', usage } },
	}
}

export function requestHeader(provider: string, model: string): Record<string, unknown> {
	return {
		type: 'request/header',
		seq: nextSeq(),
		time: nextTime(),
		data: { header: { config: { provider, model, reasoningEffort: 'medium', maxTokens: 8192 }, system: [], tools: [] }, reason: 'initial' },
	}
}

export function logOf(header: Record<string, unknown>, events: Array<Record<string, unknown>>): string {
	return [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))].join('\n')
}
