/**
 * Rule: the same file read many times through a file-reading tool. Reader
 * tools and their path argument names are configured in thresholds — nothing
 * assumes a single hard-coded tool name.
 *
 * @module dsh-session-audit/rules/repeated-file-read
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts'
import type { AuditThresholds } from './thresholds.ts'

export function evaluateRepeatedFileReads(facts: AuditFacts, t: AuditThresholds): AuditSignal[] {
	const reads = new Map<string, number>()
	for (const call of facts.toolSequence) {
		const argNames = t.fileReaderTools[call.name]
		if (argNames === undefined || call.args === undefined) continue
		for (const argName of argNames) {
			const value = call.args[argName]
			if (typeof value === 'string' && value !== '') {
				reads.set(value, (reads.get(value) ?? 0) + 1)
				break
			}
		}
	}
	const signals: AuditSignal[] = []
	for (const [path, count] of reads) {
		if (count < t.repeatedFileReadMin) continue
		signals.push({
			id: `repeated-file-read:${path}`,
			severity: count >= t.repeatedFileReadMin * 2 ? 'warning' : 'info',
			title: `\`${path}\` was read ${count} times`,
		})
	}
	return signals
}
