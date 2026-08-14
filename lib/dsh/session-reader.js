import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
/** zstd frame magic (little-endian 0xFD2FB528). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/** Resolve the durable sessions root (`$DSH_HOME/sessions`, default `~/.dsh/sessions`). */
export function resolveSessionsRoot() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(home, 'sessions');
}
/** Decode one log buffer (zstd multi-frame or plain JSONL) into logical lines. */
export function decodeLogBuffer(buffer) {
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
        const chunks = [];
        let truncatedFrames = 0;
        let search = 0;
        for (;;) {
            const at = buffer.indexOf(ZSTD_MAGIC, search);
            if (at === -1)
                break;
            const next = buffer.indexOf(ZSTD_MAGIC, at + 4);
            const end = next === -1 ? buffer.length : next;
            try {
                chunks.push(zstdDecompressSync(buffer.subarray(at, end)).toString('utf8'));
            }
            catch {
                // A torn final frame is a crash tail: keep everything decoded
                // before it, exactly like the backend's own recovery scan.
                truncatedFrames += 1;
            }
            search = end;
        }
        const text = chunks.join('');
        return { lines: text.split('\n'), truncatedFrames };
    }
    return { lines: buffer.toString('utf8').split('\n'), truncatedFrames: 0 };
}
/** Parse logical lines into header + events. Malformed lines are counted, never thrown. */
export function parseLogLines(lines) {
    let header;
    const events = [];
    let badLines = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            badLines += 1;
            continue;
        }
        if (typeof parsed !== 'object' || parsed === null) {
            badLines += 1;
            continue;
        }
        const record = parsed;
        if (record.type === 'session') {
            if (typeof record.id === 'string') {
                header = {
                    type: 'session',
                    id: record.id,
                    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
                    createdAt: typeof record.createdAt === 'number' ? record.createdAt : undefined,
                    parentSession: typeof record.parentSession === 'string' ? record.parentSession : undefined,
                    delegationDepth: typeof record.delegationDepth === 'number' ? record.delegationDepth : undefined,
                    agentPreset: typeof record.agentPreset === 'string' ? record.agentPreset : undefined,
                };
            }
            continue;
        }
        if (typeof record.type === 'string')
            events.push(record);
    }
    return { header, events, badLines, truncatedFrames: 0 };
}
async function listLogFiles(root) {
    const files = [];
    let workspaceDirs;
    try {
        workspaceDirs = await readdir(root, { withFileTypes: true });
    }
    catch {
        return files;
    }
    for (const workspace of workspaceDirs) {
        if (!workspace.isDirectory())
            continue;
        let sessionDirs;
        try {
            sessionDirs = await readdir(join(root, workspace.name), { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const session of sessionDirs) {
            if (!session.isDirectory())
                continue;
            for (const suffix of ['session.jsonl.zstd', 'session.jsonl']) {
                const path = join(root, workspace.name, session.name, suffix);
                try {
                    const info = await stat(path);
                    if (info.isFile()) {
                        files.push(path);
                        break;
                    }
                }
                catch {
                    /* try next suffix */
                }
            }
        }
    }
    return files;
}
/** Discover every durable session log under `root`, newest mtime first. */
export async function listSessionLogs(root, signal) {
    const infos = [];
    for (const path of await listLogFiles(root)) {
        try {
            const [fileStat, buffer] = await Promise.all([stat(path), readFile(path, { signal })]);
            const { lines } = decodeLogBuffer(buffer);
            const { header } = parseLogLines(lines);
            if (header === undefined)
                continue;
            infos.push({
                id: header.id,
                cwd: header.cwd,
                createdAt: header.createdAt,
                path,
                sizeBytes: fileStat.size,
                mtimeMs: fileStat.mtimeMs,
            });
        }
        catch {
            /* unreadable log: exclude from listing */
        }
    }
    infos.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return infos;
}
/** Read and decode one session log by id. Returns `undefined` when not found. */
export async function readSessionLog(root, sessionId, signal) {
    for (const path of await listLogFiles(root)) {
        let buffer;
        try {
            buffer = await readFile(path, { signal });
        }
        catch {
            continue;
        }
        const { lines, truncatedFrames } = decodeLogBuffer(buffer);
        const decoded = parseLogLines(lines);
        if (decoded.header?.id !== sessionId)
            continue;
        return {
            header: decoded.header,
            events: decoded.events,
            badLines: decoded.badLines,
            truncatedFrames,
        };
    }
    return undefined;
}
