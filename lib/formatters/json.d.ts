/**
 * JSON formatter — the stable `SessionAuditReport` structure verbatim.
 *
 * @module dsh-session-audit/formatters/json
 */
import type { SessionAuditReport } from '../audit/types.ts';
export declare function formatJsonReport(report: SessionAuditReport): string;
