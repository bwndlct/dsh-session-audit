/**
 * Centralized rule thresholds — every default lives here; nothing is
 * hard-coded inside a rule. Overridable programmatically (a future config
 * surface can pass a partial object).
 *
 * @module dsh-session-audit/rules/thresholds
 */

export interface AuditThresholds {
	/** per-tool call count at which the high-frequency rule emits `info`. */
	toolCallsInfo: number
	/** per-tool call count at which the high-frequency rule emits `warning`. */
	toolCallsWarning: number
	/** occurrences (inclusive) at which an identical tool call counts as repeated. */
	duplicateToolCallMin: number
	/** reads (inclusive) of the same file path at which the repeated-read rule fires. */
	repeatedFileReadMin: number
	/** tool failure rate over resolved results at which the rule fires (warning). */
	failureRateWarning: number
	/** minimum resolved results before a failure-rate signal may fire. */
	failureRateMinSamples: number
	/** consecutive failed tool results (inclusive) at which the rule fires (warning). */
	consecutiveFailuresWarning: number
	/** consecutive failed attempts of one verification command (warning). */
	consecutiveVerificationFailuresWarning: number
	/** tools whose arguments name a file to read: arg holding the path. */
	fileReaderTools: Record<string, string[]>
	/** tools whose `command` argument is a shell command line. */
	shellTools: string[]
}

export const DEFAULT_THRESHOLDS: AuditThresholds = {
	toolCallsInfo: 15,
	toolCallsWarning: 30,
	duplicateToolCallMin: 3,
	repeatedFileReadMin: 4,
	failureRateWarning: 0.15,
	failureRateMinSamples: 3,
	consecutiveFailuresWarning: 3,
	consecutiveVerificationFailuresWarning: 2,
	// DSH built-in reader is `read` (file_path); common aliases covered for
	// custom setups. Extensible by configuration without code changes.
	fileReaderTools: {
		read: ['file_path', 'path'],
		read_file: ['file_path', 'path'],
		Read: ['file_path', 'path'],
	},
	// DSH built-in shell tools (`bash`, `pwsh`) carry `command`.
	shellTools: ['bash', 'pwsh', 'shell'],
}
