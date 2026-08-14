/**
 * Rule: the same file read many times through a file-reading tool. Reader
 * tools and their path argument names are configured in thresholds — nothing
 * assumes a single hard-coded tool name.
 *
 * @module dsh-session-audit/rules/repeated-file-read
 */
import type { AuditFacts, AuditSignal } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
export declare function evaluateRepeatedFileReads(facts: AuditFacts, t: AuditThresholds): AuditSignal[];
