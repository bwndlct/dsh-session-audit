/**
 * Plain-text report renderer (the default model-facing format).
 *
 * @module dsh-session-audit/formatters/text
 */
import type { SessionAuditReport } from '../audit/types.ts';
export declare function formatTextReport(report: SessionAuditReport): string;
