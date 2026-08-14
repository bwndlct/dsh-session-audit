/**
 * Rule: consecutive failed tool results.
 *
 * @module dsh-session-audit/rules/consecutive-failures
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
export declare function evaluateConsecutiveFailures(facts: AuditFacts, t: AuditThresholds): AuditSignal[];
