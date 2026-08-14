/**
 * JSON formatter — the stable `SessionAuditReport` structure verbatim.
 *
 * @module dsh-session-audit/formatters/json
 */
import type { SessionAuditReport } from '../audit/types.ts'

export function formatJsonReport(report: SessionAuditReport): string {
	return `${JSON.stringify(report, null, 2)}\n`
}
