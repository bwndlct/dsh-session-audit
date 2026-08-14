/**
 * Rule: one tool invoked an unusually high number of times. High counts are
 * context-dependent (a big refactor legitimately edits a lot), so the default
 * severity is `info`; it escalates to `warning` only at the higher bar.
 *
 * @module dsh-session-audit/rules/high-frequency-tool
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts'
import type { AuditThresholds } from './thresholds.ts'

export function evaluateHighFrequencyTools(facts: AuditFacts, t: AuditThresholds): AuditSignal[] {
	const signals: AuditSignal[] = []
	for (const [name, { calls }] of facts.byTool) {
		if (calls >= t.toolCallsWarning) {
			signals.push({ id: `high-frequency-tool:${name}`, severity: 'warning', title: `\`${name}\` called ${calls} times` })
		} else if (calls >= t.toolCallsInfo) {
			signals.push({ id: `high-frequency-tool:${name}`, severity: 'info', title: `\`${name}\` called ${calls} times` })
		}
	}
	return signals
}
