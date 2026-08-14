/**
 * Session reader — locates and decodes durable DSH session logs from disk.
 *
 * On-disk layout (dsh-session-persistence-jsonl):
 *   `<root>/<workspace-dir>/<session-dir>/session.jsonl.zstd | session.jsonl`
 * The zstd artifact is a concatenation of independent checksummed frames:
 * one header frame (only the `session` line), then one frame per append
 * batch. Frames are split by scanning the magic in the RAW buffer — the same
 * approach the shipped scanners use; a mis-split cannot pass the per-frame
 * checksum and surfaces as a skipped (truncated) frame.
 *
 * `DSH_HOME` overrides the default `~/.dsh` home, mirroring dsh-home-paths.
 *
 * @module dsh-session-audit/dsh/session-reader
 */
import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { RawSessionEvent, SessionHeaderLike } from './session-adapter.ts'

/** zstd frame magic (little-endian 0xFD2FB528). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Resolve the durable sessions root (`$DSH_HOME/sessions`, default `~/.dsh/sessions`). */
export function resolveSessionsRoot(): string {
	const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
	return join(home, 'sessions')
}

export interface DecodedLog {
	header?: SessionHeaderLike
	events: RawSessionEvent[]
	badLines: number
	/** frames skipped because they failed decode (torn crash tail). */
	truncatedFrames: number
}

/** Decode one log buffer (zstd multi-frame or plain JSONL) into logical lines. */
export function decodeLogBuffer(buffer: Buffer): { lines: string[]; truncatedFrames: number } {
	if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
		const chunks: string[] = []
		let truncatedFrames = 0
		let search = 0
		for (;;) {
			const at = buffer.indexOf(ZSTD_MAGIC, search)
			if (at === -1) break
			const next = buffer.indexOf(ZSTD_MAGIC, at + 4)
			const end = next === -1 ? buffer.length : next
			try {
				chunks.push(zstdDecompressSync(buffer.subarray(at, end)).toString('utf8'))
			} catch {
				// A torn final frame is a crash tail: keep everything decoded
				// before it, exactly like the backend's own recovery scan.
				truncatedFrames += 1
			}
			search = end
		}
		const text = chunks.join('')
		return { lines: text.split('\n'), truncatedFrames }
	}
	return { lines: buffer.toString('utf8').split('\n'), truncatedFrames: 0 }
}

/** Parse logical lines into header + events. Malformed lines are counted, never thrown. */
export function parseLogLines(lines: string[]): DecodedLog {
	let header: SessionHeaderLike | undefined
	const events: RawSessionEvent[] = []
	let badLines = 0
	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed === '') continue
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			badLines += 1
			continue
		}
		if (typeof parsed !== 'object' || parsed === null) {
			badLines += 1
			continue
		}
		const record = parsed as Record<string, unknown>
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
				}
			}
			continue
		}
		if (typeof record.type === 'string') events.push(record as unknown as RawSessionEvent)
	}
	return { header, events, badLines, truncatedFrames: 0 }
}

/** Lightweight discovery record for one durable session log. */
export interface SessionLogInfo {
	id: string
	cwd?: string
	createdAt?: number
	path: string
	sizeBytes: number
	mtimeMs: number
}

async function listLogFiles(root: string): Promise<string[]> {
	const files: string[] = []
	let workspaceDirs: Dirent[]
	try {
		workspaceDirs = await readdir(root, { withFileTypes: true })
	} catch {
		return files
	}
	for (const workspace of workspaceDirs) {
		if (!workspace.isDirectory()) continue
		let sessionDirs: Dirent[]
		try {
			sessionDirs = await readdir(join(root, workspace.name), { withFileTypes: true })
		} catch {
			continue
		}
		for (const session of sessionDirs) {
			if (!session.isDirectory()) continue
			for (const suffix of ['session.jsonl.zstd', 'session.jsonl']) {
				const path = join(root, workspace.name, session.name, suffix)
				try {
					const info = await stat(path)
					if (info.isFile()) {
						files.push(path)
						break
					}
				} catch {
					/* try next suffix */
				}
			}
		}
	}
	return files
}

/**
 * Decode only the first zstd frame (the header frame) to extract session metadata.
 * The header frame contains only the `session` line; scanning stops after the first
 * valid frame is decoded. Returns the same shape as `parseLogLines` for the header
 * line — the rest of the log is not decoded.
 */
function decodeHeaderFrame(buffer: Buffer): { headerLine: string; truncatedFrames: number } {
	if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
		const at = 0
		const next = buffer.indexOf(ZSTD_MAGIC, 4)
		const end = next === -1 ? buffer.length : next
		try {
			const text = zstdDecompressSync(buffer.subarray(at, end)).toString('utf8')
			const newline = text.indexOf('\n')
			return { headerLine: newline === -1 ? text : text.slice(0, newline), truncatedFrames: 0 }
		} catch {
			return { headerLine: '', truncatedFrames: 1 }
		}
	}
	// Plain JSONL: first line is the header
	const newline = buffer.indexOf('\n'.charCodeAt(0))
	return { headerLine: newline === -1 ? buffer.toString('utf8') : buffer.subarray(0, newline).toString('utf8'), truncatedFrames: 0 }
}

/** Discover every durable session log under `root`, newest mtime first. */
export async function listSessionLogs(root: string, signal?: AbortSignal): Promise<SessionLogInfo[]> {
	const infos: SessionLogInfo[] = []
	for (const path of await listLogFiles(root)) {
		try {
			const [fileStat, buffer] = await Promise.all([stat(path), readFile(path, { signal })])
			const { headerLine } = decodeHeaderFrame(buffer)
			let header: SessionHeaderLike | undefined
			if (headerLine !== '') {
				try {
					const parsed = JSON.parse(headerLine) as Record<string, unknown>
					if (parsed.type === 'session' && typeof parsed.id === 'string') {
						header = {
							type: 'session',
							id: parsed.id,
							cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
							createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
						}
					}
				} catch {
					/* unparseable header line: exclude from listing */
				}
			}
			if (header === undefined) continue
			infos.push({
				id: header.id,
				cwd: header.cwd,
				createdAt: header.createdAt,
				path,
				sizeBytes: fileStat.size,
				mtimeMs: fileStat.mtimeMs,
			})
		} catch {
			/* unreadable log: exclude from listing */
		}
	}
	infos.sort((a, b) => b.mtimeMs - a.mtimeMs)
	return infos
}

/**
 * Read and decode one session log by id. Tries a direct stat first (the session
 * directory name IS the session id), then falls back to a full scan of all
 * workspace directories. Returns `undefined` when not found.
 */
export async function readSessionLog(
	root: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<{ header: SessionHeaderLike; events: RawSessionEvent[]; badLines: number; truncatedFrames: number } | undefined> {
	// Fast path: the on-disk layout is `<root>/<workspace>/<sessionId>/session.jsonl.zstd`
	// (or session.jsonl). The directory name is the session id — try a direct stat first.
	try {
		const workspaceDirs = await readdir(root, { withFileTypes: true })
		for (const ws of workspaceDirs) {
			if (!ws.isDirectory()) continue
			for (const suffix of ['session.jsonl.zstd', 'session.jsonl']) {
				const direct = join(root, ws.name, sessionId, suffix)
				let buffer: Buffer
				try {
					buffer = await readFile(direct, { signal })
				} catch {
					continue
				}
				const { lines, truncatedFrames } = decodeLogBuffer(buffer)
				const decoded = parseLogLines(lines)
				if (decoded.header?.id === sessionId) {
					return {
						header: decoded.header,
						events: decoded.events,
						badLines: decoded.badLines,
						truncatedFrames,
					}
				}
				// Header id mismatch (corrupt or moved log): fall through to full scan.
			}
		}
	} catch {
		/* root unreadable: fall through to full scan */
	}

	// Fallback: full scan (original path). Handles edge cases where the session
	// directory name differs from the header id.
	for (const path of await listLogFiles(root)) {
		let buffer: Buffer
		try {
			buffer = await readFile(path, { signal })
		} catch {
			continue
		}
		const { lines, truncatedFrames } = decodeLogBuffer(buffer)
		const decoded = parseLogLines(lines)
		if (decoded.header?.id !== sessionId) continue
		return {
			header: decoded.header,
			events: decoded.events,
			badLines: decoded.badLines,
			truncatedFrames,
		}
	}
	return undefined
}
