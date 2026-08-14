/**
 * Normalized audit model — the plugin's own stable vocabulary.
 *
 * The adapter (`dsh/session-adapter.ts`) maps raw DSH session events onto
 * these types; the analyzer and rules depend only on this module. When DSH
 * event shapes change, only the adapter needs updating.
 *
 * @module dsh-session-audit/audit/types
 */
/** Rule severity. v0.1 emits `critical` sparingly (never by default rules). */
export type AuditSeverity = 'info' | 'warning' | 'critical';
/**
 * Token usage sample (per model step). Buckets follow `TokenUsage` from
 * `@deepseek-ai/dsh-llm`: `inputTokens` is uncached input only; cached input
 * is reported separately; `reasoningTokens` (when present) is a subset of
 * output, so totals never add it twice.
 */
export interface AuditUsageSample {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
/** Normalized, ordered audit events produced by the adapter. */
export type AuditEvent = {
    kind: 'turn-start';
    seq: number;
    time?: number;
    turn: number;
} | {
    kind: 'turn-end';
    seq: number;
    time?: number;
    turn: number;
    reason: string;
} | {
    kind: 'step-start';
    seq: number;
    time?: number;
    turn: number;
    step: number;
} | {
    kind: 'step-end';
    seq: number;
    time?: number;
    turn: number;
    step: number;
} | {
    kind: 'tool-call';
    seq: number;
    time?: number;
    turn: number;
    step: number;
    callId: string;
    name: string;
    /** Parsed arguments object when the raw JSON string parses to a plain object. */
    args?: Record<string, unknown>;
    /** Raw argument JSON string exactly as the model produced it (`''` when absent). */
    argsRaw: string;
} | {
    kind: 'tool-result';
    seq: number;
    time?: number;
    turn: number;
    step: number;
    callId: string;
    isError: boolean;
    errorName?: string;
    errorCode?: string;
    /** First text block of the result, trimmed (bounded) — used by verification rules. */
    textPreview?: string;
} | {
    kind: 'assistant-message';
    seq: number;
    time?: number;
    turn: number;
    step: number;
    usage?: AuditUsageSample;
} | {
    kind: 'usage-sample';
    seq: number;
    time?: number;
    turn: number;
    step: number;
    usage: AuditUsageSample;
};
/** Session-level provenance extracted by the adapter. */
export interface AuditSessionContext {
    /** Distinct models seen in `request/header` events, first-appearance order. */
    models: string[];
    /** Distinct providers seen in `request/header` events, first-appearance order. */
    providers: string[];
}
/** One tool invocation with its paired result (when one landed). */
export interface ToolCallRecord {
    seq: number;
    time?: number;
    turn: number;
    step: number;
    callId: string;
    name: string;
    args?: Record<string, unknown>;
    argsRaw: string;
    result?: ToolResultRecord;
}
export interface ToolResultRecord {
    seq: number;
    time?: number;
    isError: boolean;
    errorName?: string;
    errorCode?: string;
    textPreview?: string;
}
/** Aggregates the analyzer computes in one pass; rules read these facts. */
export interface AuditFacts {
    session: {
        id: string;
        startedAt?: number;
        lastEventAt?: number;
        model?: string;
        provider?: string;
        cwd?: string;
    };
    execution: {
        /** Distinct turns carrying at least one closed step (official sessionStats semantics). */
        turns: number;
        /** `step/end` count — every entered step closes with one, including failed/cancelled. */
        steps: number;
        assistantMessages: number;
        /** True when a `turn/start` has no matching `turn/end` (live or interrupted session). */
        openTurn: boolean;
        turnEndReasons: Record<string, number>;
    };
    /** Tool calls in seq order with results attached. */
    toolSequence: ToolCallRecord[];
    toolTotals: {
        totalCalls: number;
        resolved: number;
        succeeded: number;
        failed: number;
        unresolved: number;
        /** failed / resolved; `0` when no resolved results. */
        failureRate: number;
    };
    byTool: Map<string, {
        calls: number;
        failed: number;
    }>;
    tokens: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        reasoningTokens: number;
        /** input + output + cacheRead + cacheWrite (disjoint buckets). */
        totalTokens: number;
        stepsWithUsage: number;
    } | undefined;
}
export type VerificationType = 'test' | 'build' | 'lint' | 'typecheck';
/** One recognized verification command and its observed attempts. */
export interface VerificationResult {
    /** Canonical matched command text, e.g. `npm test`. */
    command: string;
    type: VerificationType;
    attempts: number;
    okAttempts: number;
    failedAttempts: number;
    /** Whether the most recent attempt succeeded. */
    lastOk: boolean;
}
/** A deterministic audit finding. */
export interface AuditSignal {
    id: string;
    severity: AuditSeverity;
    title: string;
    detail?: string;
}
/** The stable report structure every formatter renders from. */
export interface SessionAuditReport {
    schemaVersion: '1.0';
    generatedAt: string;
    session: {
        id: string;
        startedAt?: string;
        lastEventAt?: string;
        durationMs?: number;
        model?: string;
        provider?: string;
        cwd?: string;
    };
    execution: {
        turns: number;
        steps: number;
        assistantMessages: number;
        openTurn: boolean;
        turnEndReasons: Record<string, number>;
        dataQuality: {
            skippedEvents: number;
            unknownEventTypes: string[];
            truncatedFrames: number;
        };
    };
    tools: {
        totalCalls: number;
        resolvedCalls: number;
        successfulCalls: number;
        failedCalls: number;
        unresolvedCalls: number;
        failureRate: number;
        byTool: Array<{
            name: string;
            calls: number;
            failed: number;
        }>;
    };
    tokens?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        stepsWithUsage: number;
    };
    signals: AuditSignal[];
    verification: VerificationResult[];
}
