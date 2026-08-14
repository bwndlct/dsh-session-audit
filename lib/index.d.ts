/**
 * dsh-session-audit — session execution analytics and audit reports for
 * DeepSeek Harness.
 *
 * Registers one model-facing tool, `session_audit`, which reads one DSH
 * session (the live in-memory one by default, or any durable log by id),
 * normalizes its events, runs deterministic rules, and renders an audit
 * report as text, Markdown, or JSON.
 *
 * The plugin has zero runtime dependencies: the tool is registered as a
 * plain `ToolDefinition` object (the same shape `defineTool` produces),
 * so the package links into any profile without installing peers.
 *
 * Local analysis only: session logs are read from this machine's DSH home
 * (`$DSH_HOME/sessions`, default `~/.dsh/sessions`) or from the live session
 * registry. The plugin performs no network access, no LLM calls, and writes
 * nothing except its own return value.
 *
 * @module dsh-session-audit
 */
import { type SessionHeaderLike } from './dsh/session-adapter.ts';
import type { SessionAuditReport } from './audit/types.ts';
/** Stable Cordis plugin name (must match the loader entry in cordis.patch.yml). */
export declare const name = "dsh-session-audit";
/** Requires the tool registry; sessions service is optional (headless profiles). */
export declare const inject: string[];
/** Structural view of the services this plugin reads (no runtime imports). */
interface SessionsService {
    get(id: string): {
        id: string;
        events: unknown[];
        header: SessionHeaderLike;
    } | undefined;
}
interface ContextLike {
    tools: {
        register(definition: unknown): () => void;
    };
    get(name: 'sessions'): SessionsService | undefined;
    get(name: 'commands'): {
        register(definition: unknown): () => void;
    } | undefined;
    get(name: string): unknown;
    effect(cleanup: () => unknown, reason?: string): unknown;
}
export interface AuditToolResult {
    found: boolean;
    message?: string;
    sessions?: Array<{
        id: string;
        cwd?: string;
        createdAt?: string;
        sizeBytes: number;
    }>;
    report?: SessionAuditReport;
    rendered: string;
}
export declare function apply(ctx: ContextLike): void;
export {};
