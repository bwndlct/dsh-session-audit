/**
 * Verification detection — recognize common test/build/lint/typecheck
 * commands inside shell tool calls and record their observed outcomes.
 *
 * Outcome sources, in order:
 *   1. harness-level failure: result `isError` / `data.error` → failed;
 *   2. shell exit convention: dsh-tool-bash appends a final
 *      `[exit code: N]` marker line for non-zero exits (canonical, part of
 *      the tool's documented output contract) → failed when N ≠ 0;
 *   3. otherwise the command was observed to complete → succeeded.
 *
 * The rule reports what was OBSERVED. It never claims "the project was
 * verified" — absence of a matched command only yields a carefully-worded
 * info signal, because verification may have run through mechanisms this
 * fold cannot see.
 *
 * @module dsh-session-audit/rules/verification
 */
import type { AuditFacts, AuditSignal, ToolCallRecord, VerificationResult, VerificationType } from '../audit/types.ts';
import type { AuditThresholds } from './thresholds.ts';
/** Match one command line against the verification vocabulary. */
export declare function matchVerificationCommand(command: string): {
    type: VerificationType;
    command: string;
} | undefined;
/** Extract the shell command line of one tool call, when it is a shell tool. */
export declare function shellCommandOf(call: ToolCallRecord, t: AuditThresholds): string | undefined;
/** Trailing `[exit code: N]` marker of a shell-tool result, when present. */
export declare function exitCodeMarkerOf(text: string): number | undefined;
/**
 * Observed outcome of one shell-tool call:
 * `false` = failed (harness error or non-zero exit marker), `true` = completed.
 */
export declare function shellCallSucceeded(call: ToolCallRecord): boolean;
/** Fold all verification attempts out of the tool sequence. */
export declare function detectVerification(facts: AuditFacts, t: AuditThresholds): VerificationResult[];
export declare function evaluateVerification(results: VerificationResult[], t: AuditThresholds): AuditSignal[];
