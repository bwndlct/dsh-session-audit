import type { RawSessionEvent, SessionHeaderLike } from './session-adapter.ts';
/** Resolve the durable sessions root (`$DSH_HOME/sessions`, default `~/.dsh/sessions`). */
export declare function resolveSessionsRoot(): string;
export interface DecodedLog {
    header?: SessionHeaderLike;
    events: RawSessionEvent[];
    badLines: number;
    /** frames skipped because they failed decode (torn crash tail). */
    truncatedFrames: number;
}
/** Decode one log buffer (zstd multi-frame or plain JSONL) into logical lines. */
export declare function decodeLogBuffer(buffer: Buffer): {
    lines: string[];
    truncatedFrames: number;
};
/** Parse logical lines into header + events. Malformed lines are counted, never thrown. */
export declare function parseLogLines(lines: string[]): DecodedLog;
/** Lightweight discovery record for one durable session log. */
export interface SessionLogInfo {
    id: string;
    cwd?: string;
    createdAt?: number;
    path: string;
    sizeBytes: number;
    mtimeMs: number;
}
/** Discover every durable session log under `root`, newest mtime first. */
export declare function listSessionLogs(root: string, signal?: AbortSignal): Promise<SessionLogInfo[]>;
/** Read and decode one session log by id. Returns `undefined` when not found. */
export declare function readSessionLog(root: string, sessionId: string, signal?: AbortSignal): Promise<{
    header: SessionHeaderLike;
    events: RawSessionEvent[];
    badLines: number;
    truncatedFrames: number;
} | undefined>;
