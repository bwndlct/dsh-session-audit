/**
 * Rule: overall tool failure rate.
 *
 * @module dsh-session-audit/rules/failure-rate
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts'
import type { AuditThresholds } from './thresholds.ts'

export function evaluateFailureRate(facts: AuditFacts, t: AuditThresholds): AuditSignal[] {
	const { resolved, failed, failureRate } = facts.toolTotals
	if (resolved < t.failureRateMinSamples) return []
	if (failureRate < t.failureRateWarning) return []
	return [
		{
			id: 'tool-failure-rate',
			severity: 'warning',
			title: `tool failure rate reached ${Math.round(failureRate * 100)}%`,
			detail: `${failed} of ${resolved} resolved tool calls failed`,
		},
	]
}
