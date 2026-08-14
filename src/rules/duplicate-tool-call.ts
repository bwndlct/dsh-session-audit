/**
 * Rule: identical tool calls (same name + same arguments) repeated. Argument
 * identity uses stable serialization, so JSON key order never distinguishes
 * two otherwise-identical calls.
 *
 * @module dsh-session-audit/rules/duplicate-tool-call
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts'
import type { AuditThresholds } from './thresholds.ts'
import { toolCallKey } from '../utils/stable-json.ts'

export function evaluateDuplicateToolCalls(facts: AuditFacts, t: AuditThresholds): AuditSignal[] {
	const counts = new Map<string, { name: string; argsKey: string; count: number; firstSeq: number }>()
	for (const call of facts.toolSequence) {
		const key = toolCallKey(call.name, call.args, call.argsRaw)
		const entry = counts.get(key)
		if (entry === undefined) counts.set(key, { name: call.name, argsKey: key, count: 1, firstSeq: call.seq })
		else entry.count += 1
	}
	const signals: AuditSignal[] = []
	for (const entry of counts.values()) {
		if (entry.count < t.duplicateToolCallMin) continue
		const detail = describeArguments(entry.argsKey)
		signals.push({
			id: `duplicate-tool-call:${entry.name}:${entry.firstSeq}`,
			severity: 'warning',
			title: `identical \`${entry.name}\` call repeated ${entry.count} times`,
			detail,
		})
	}
	return signals
}

/** Human-readable, bounded argument summary for a stable call key. */
function describeArguments(argsKey: string): string | undefined {
	const separator = argsKey.indexOf('\u0000')
	if (separator === -1) return undefined
	const raw = argsKey.slice(separator + 1)
	const text = raw.startsWith('raw:') ? raw.slice(4) : raw
	return text.length > 120 ? `${text.slice(0, 120)}…` : text.length > 0 ? text : undefined
}
