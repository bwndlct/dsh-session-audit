/**
 * Rule: one tool invoked an unusually high number of times. High counts are
 * context-dependent (a big refactor legitimately edits a lot), so the default
 * severity is `info`; it escalates to `warning` only at the higher bar.
 *
 * @module dsh-session-audit/rules/high-frequency-tool
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
export declare function evaluateHighFrequencyTools(facts: AuditFacts, t: AuditThresholds): AuditSignal[];
