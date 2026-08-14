/**
 * Rule: identical tool calls (same name + same arguments) repeated. Argument
 * identity uses stable serialization, so JSON key order never distinguishes
 * two otherwise-identical calls.
 *
 * @module dsh-session-audit/rules/duplicate-tool-call
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
export declare function evaluateDuplicateToolCalls(facts: AuditFacts, t: AuditThresholds): AuditSignal[];
