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
import type { SessionAuditReport } from './types.ts';
import type { SessionHeaderLike } from '../dsh/session-adapter.ts';
import type { AdaptedSession } from '../dsh/session-adapter.ts';
import { type AuditThresholds } from '../rules/thresholds.ts';
export interface AnalyzeInput {
    header: SessionHeaderLike;
    adapted: AdaptedSession;
    /** zstd frames skipped at decode time (crash tail), surfaced as data quality. */
    truncatedFrames?: number;
}
export declare function analyzeSession(input: AnalyzeInput, thresholds?: AuditThresholds): SessionAuditReport;
