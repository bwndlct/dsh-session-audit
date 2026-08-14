/**
 * Session adapter — maps raw DSH durable session events onto the normalized
 * audit vocabulary. All shape knowledge about DSH logs lives here.
 *
 * Raw event envelope: `{ type, seq, time, data }`. The durable vocabulary is
 * defined by `@deepseek-ai/dsh-session` (`SessionEventMap`); shapes below were
 * verified against dsh 0.1.0-rc.6 sources and real session logs.
 *
 * @module dsh-session-audit/dsh/session-adapter
 */
import type { AuditEvent, AuditSessionContext } from '../audit/types.ts';
/** Session header — first logical line of a durable log. */
export interface SessionHeaderLike {
    type?: 'session';
    id: string;
    cwd?: string;
    createdAt?: number;
    parentSession?: string;
    delegationDepth?: number;
    agentPreset?: string;
}
/** One raw durable event, already JSON-parsed. */
export interface RawSessionEvent {
    type: string;
    seq?: number;
    time?: number;
    data?: unknown;
}
/** Raw log + header as produced by the reader or a live session object. */
export interface RawSessionLog {
    header: SessionHeaderLike;
    events: RawSessionEvent[];
    /** zstd frames that failed checksum/decode and were skipped (crash tail). */
    truncatedFrames?: number;
}
export interface AdaptedSession {
    events: AuditEvent[];
    context: AuditSessionContext;
    /** count of events recognized as unknown types (future vocabulary). */
    skippedEvents: number;
    unknownEventTypes: string[];
}
/** Adapt one raw log into the normalized audit vocabulary. Never throws. */
export declare function adaptSession(raw: RawSessionLog): AdaptedSession;
