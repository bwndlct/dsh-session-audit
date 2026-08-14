/**
 * Analyzer — one pass over the normalized events building the audit facts,
 * then the deterministic rules evaluate those facts into signals. Total work
 * is O(n) per pass with a small constant number of passes (no event×event
 * scanning anywhere).
 *
 * Counting semantics deliberately mirror the official `dsh-session-stats`
 * fold so audit numbers agree with the Web UI stats strip:
 *   - steps  = `step/end` count (every entered step closes with one);
 *   - turns  = distinct turns carrying at least one closed step;
 *   - tokens = latest usage sample per (turn, step) — an early `usage` chunk
 *              is replaced by the step's final `assistant/message` usage.
 *
 * @module dsh-session-audit/audit/analyzer
 */
import type {
	AuditEvent,
	AuditFacts,
	AuditSignal,
	AuditUsageSample,
	SessionAuditReport,
	ToolCallRecord,
} from './types.ts'
import type { SessionHeaderLike } from '../dsh/session-adapter.ts'
import type { AdaptedSession } from '../dsh/session-adapter.ts'
import { DEFAULT_THRESHOLDS, type AuditThresholds } from '../rules/thresholds.ts'
import { evaluateFailureRate } from '../rules/failure-rate.ts'
import { evaluateConsecutiveFailures } from '../rules/consecutive-failures.ts'
import { evaluateHighFrequencyTools } from '../rules/high-frequency-tool.ts'
import { evaluateDuplicateToolCalls } from '../rules/duplicate-tool-call.ts'
import { evaluateRepeatedFileReads } from '../rules/repeated-file-read.ts'
import { detectVerification, evaluateVerification, exitCodeMarkerOf } from '../rules/verification.ts'

export interface AnalyzeInput {
	header: SessionHeaderLike
	adapted: AdaptedSession
	/** zstd frames skipped at decode time (crash tail), surfaced as data quality. */
	truncatedFrames?: number
}

export function analyzeSession(input: AnalyzeInput, thresholds?: AuditThresholds): SessionAuditReport {
	const merged = thresholds !== undefined ? { ...DEFAULT_THRESHOLDS, ...thresholds } : DEFAULT_THRESHOLDS
	const facts = buildFacts(input.header, input.adapted, merged)
	const verification = detectVerification(facts, merged)
	const signals: AuditSignal[] = [
		...evaluateFailureRate(facts, merged),
		...evaluateConsecutiveFailures(facts, merged),
		...evaluateHighFrequencyTools(facts, merged),
		...evaluateDuplicateToolCalls(facts, merged),
		...evaluateRepeatedFileReads(facts, merged),
		...evaluateVerification(verification, merged),
		...evaluateTurnEndings(facts),
	]
	sortSignals(signals)
	return toReport(input, facts, verification, signals)
}

/** Single pass: counters, tool sequence with attached results, usage fold. */
function buildFacts(header: SessionHeaderLike, adapted: AdaptedSession, thresholds: AuditThresholds): AuditFacts {
	const turnsWithClosedStep = new Set<number>()
	const openTurns = new Set<number>()
	const turnEndReasons: Record<string, number> = {}
	let steps = 0
	let assistantMessages = 0

	const callsById = new Map<string, ToolCallRecord>()
	const toolSequence: ToolCallRecord[] = []
	const byTool = new Map<string, { calls: number; failed: number }>()

	// latest usage per `turn:step` (chunk sample replaced by final message usage)
	const usageByStep = new Map<string, { seq: number; usage: AuditUsageSample }>()

	let lastEventAt: number | undefined

	for (const event of adapted.events) {
		if (event.time !== undefined && (lastEventAt === undefined || event.time > lastEventAt)) lastEventAt = event.time
		switch (event.kind) {
			case 'turn-start':
				openTurns.add(event.turn)
				break
			case 'turn-end':
				openTurns.delete(event.turn)
				turnEndReasons[event.reason] = (turnEndReasons[event.reason] ?? 0) + 1
				break
			case 'step-end':
				steps += 1
				turnsWithClosedStep.add(event.turn)
				break
			case 'assistant-message':
				assistantMessages += 1
				if (event.usage !== undefined) noteUsage(usageByStep, event.turn, event.step, event.seq, event.usage)
				break
			case 'usage-sample':
				noteUsage(usageByStep, event.turn, event.step, event.seq, event.usage)
				break
			case 'tool-call': {
				const record: ToolCallRecord = {
					seq: event.seq,
					time: event.time,
					turn: event.turn,
					step: event.step,
					callId: event.callId,
					name: event.name,
					args: event.args,
					argsRaw: event.argsRaw,
				}
				callsById.set(event.callId, record)
				toolSequence.push(record)
				const entry = byTool.get(event.name) ?? { calls: 0, failed: 0 }
				entry.calls += 1
				byTool.set(event.name, entry)
				break
			}
			case 'tool-result': {
				const call = callsById.get(event.callId)
				if (call === undefined) continue // orphan result (replacement/repaired log): no call to attach
				call.result = {
					seq: event.seq,
					time: event.time,
					isError: event.isError,
					errorName: event.errorName,
					errorCode: event.errorCode,
					textPreview: event.textPreview,
				}
				if (event.isError) {
					const entry = byTool.get(call.name)
					if (entry !== undefined) entry.failed += 1
				}
				break
			}
		}
	}

	toolSequence.sort((a, b) => a.seq - b.seq)

	// Shell tools report non-zero command exits as successful tool executions
	// carrying a trailing `[exit code: N]` marker (the documented dsh-tool-bash
	// contract). For audit purposes those are failed calls: fold the marker
	// into the failure accounting so `npm test` exit 1 counts as a failure.
	for (const call of toolSequence) {
		const result = call.result
		if (result === undefined || result.isError) continue
		if (!thresholds.shellTools.includes(call.name)) continue
		const exitCode = exitCodeMarkerOf(result.textPreview ?? '')
		if (exitCode === undefined || exitCode === 0) continue
		result.isError = true
		result.errorName = result.errorName ?? 'shell'
		result.errorCode = result.errorCode ?? `EXIT_${exitCode}`
		const entry = byTool.get(call.name)
		if (entry !== undefined) entry.failed += 1
	}

	let succeeded = 0
	let failed = 0
	let unresolved = 0
	for (const call of toolSequence) {
		if (call.result === undefined) unresolved += 1
		else if (call.result.isError) failed += 1
		else succeeded += 1
	}
	const resolved = succeeded + failed

	const tokens = sumUsage(usageByStep)

	return {
		session: {
			id: header.id,
			startedAt: header.createdAt,
			lastEventAt,
			model: adapted.context.models.length > 0 ? adapted.context.models.join(', ') : undefined,
			provider: adapted.context.providers.length > 0 ? adapted.context.providers.join(', ') : undefined,
			cwd: header.cwd,
		},
		execution: {
			turns: turnsWithClosedStep.size,
			steps,
			assistantMessages,
			openTurn: openTurns.size > 0,
			turnEndReasons,
		},
		toolSequence,
		toolTotals: {
			totalCalls: toolSequence.length,
			resolved,
			succeeded,
			failed,
			unresolved,
			failureRate: resolved > 0 ? failed / resolved : 0,
		},
		byTool,
		tokens,
	}
}

function noteUsage(
	usageByStep: Map<string, { seq: number; usage: AuditUsageSample }>,
	turn: number,
	step: number,
	seq: number,
	usage: AuditUsageSample,
): void {
	const key = `${turn}:${step}`
	const existing = usageByStep.get(key)
	if (existing === undefined || seq >= existing.seq) usageByStep.set(key, { seq, usage })
}

function sumUsage(
	usageByStep: Map<string, { seq: number; usage: AuditUsageSample }>,
): AuditFacts['tokens'] {
	if (usageByStep.size === 0) return undefined
	let inputTokens = 0
	let outputTokens = 0
	let cacheReadTokens = 0
	let cacheWriteTokens = 0
	let reasoningTokens = 0
	for (const { usage } of usageByStep.values()) {
		inputTokens += usage.inputTokens
		outputTokens += usage.outputTokens
		cacheReadTokens += usage.cacheReadTokens ?? 0
		cacheWriteTokens += usage.cacheWriteTokens ?? 0
		reasoningTokens += usage.reasoningTokens ?? 0
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		reasoningTokens,
		// buckets are disjoint: input excludes cached input; reasoning is a
		// subset of output and is therefore reported, never added.
		totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
		stepsWithUsage: usageByStep.size,
	}
}

/** Non-completed turn endings are worth a signal (aborted/error/interrupted). */
function evaluateTurnEndings(facts: AuditFacts): AuditSignal[] {
	const signals: AuditSignal[] = []
	for (const [reason, count] of Object.entries(facts.execution.turnEndReasons)) {
		if (reason === 'completed') continue
		signals.push({
			id: `turn-ending:${reason}`,
			severity: 'info',
			title: `${count} turn${count === 1 ? '' : 's'} ended with reason \`${reason}\``,
		})
	}
	if (facts.execution.openTurn) {
		signals.push({
			id: 'open-turn',
			severity: 'info',
			title: 'session has a turn that never closed (live or interrupted session)',
		})
	}
	return signals
}

const SEVERITY_ORDER = { warning: 0, info: 1, critical: 2 } as const

/** warnings first, critical last (v0.1 emits none), then stable by id. */
function sortSignals(signals: AuditSignal[]): void {
	signals.sort((a, b) => {
		const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
		return bySeverity !== 0 ? bySeverity : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
	})
}

function toReport(
	input: AnalyzeInput,
	facts: AuditFacts,
	verification: SessionAuditReport['verification'],
	signals: AuditSignal[],
): SessionAuditReport {
	const durationMs =
		facts.session.startedAt !== undefined && facts.session.lastEventAt !== undefined
			? Math.max(0, facts.session.lastEventAt - facts.session.startedAt)
			: undefined
	const byTool = [...facts.byTool.entries()]
		.map(([name, { calls, failed }]) => ({ name, calls, failed }))
		.sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1))
	return {
		schemaVersion: '1.0',
		generatedAt: new Date().toISOString(),
		session: {
			id: facts.session.id,
			startedAt: facts.session.startedAt !== undefined ? new Date(facts.session.startedAt).toISOString() : undefined,
			lastEventAt:
				facts.session.lastEventAt !== undefined ? new Date(facts.session.lastEventAt).toISOString() : undefined,
			durationMs,
			model: facts.session.model,
			provider: facts.session.provider,
			cwd: facts.session.cwd,
		},
		execution: {
			turns: facts.execution.turns,
			steps: facts.execution.steps,
			assistantMessages: facts.execution.assistantMessages,
			openTurn: facts.execution.openTurn,
			turnEndReasons: facts.execution.turnEndReasons,
			dataQuality: {
				skippedEvents: input.adapted.skippedEvents,
				unknownEventTypes: input.adapted.unknownEventTypes,
				truncatedFrames: input.truncatedFrames ?? 0,
			},
		},
		tools: {
			totalCalls: facts.toolTotals.totalCalls,
			resolvedCalls: facts.toolTotals.resolved,
			successfulCalls: facts.toolTotals.succeeded,
			failedCalls: facts.toolTotals.failed,
			unresolvedCalls: facts.toolTotals.unresolved,
			failureRate: facts.toolTotals.failureRate,
			byTool,
		},
		tokens: facts.tokens,
		signals,
		verification,
	}
}
