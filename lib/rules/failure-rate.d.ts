/**
 * Rule: overall tool failure rate.
 *
 * @module dsh-session-audit/rules/failure-rate
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
export declare function evaluateFailureRate(facts: AuditFacts, t: AuditThresholds): AuditSignal[];
