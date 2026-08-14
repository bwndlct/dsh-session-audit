/**
 * Reader tests: decoding (plain JSONL), listing, id lookup, torn frames.
 * Uses a temp directory; DSH_HOME is not touched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { decodeLogBuffer, listSessionLogs, parseLogLines, readSessionLog } from '../src/dsh/session-reader.ts'
import { logOf, requestHeader, resetFixtures, sessionHeader, toolCall, toolResult, turnEnd, turnStart } from './fixtures.ts'

// Re-export decodeHeaderFrame for testing (it's a private helper; we test through
// listSessionLogs which exercises it).
// The function is not exported — we test its behavior indirectly through
// listSessionLogs with zstd artifacts.

test('decodeLogBuffer splits multi-frame zstd logs', () => {
	const frameA = zstdCompressSync(Buffer.from('{"type":"session","id":"s1"}\n'))
	const frameB = zstdCompressSync(Buffer.from('{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}\n'))
	const buffer = Buffer.concat([frameA, frameB])
	const { lines, truncatedFrames } = decodeLogBuffer(buffer)
	assert.equal(truncatedFrames, 0)
	const parsed = parseLogLines(lines)
	assert.equal(parsed.header.id, 's1')
	assert.equal(parsed.events.length, 1)
})

test('decodeLogBuffer skips a torn final frame (crash tail)', () => {
	const frameA = zstdCompressSync(Buffer.from('{"type":"session","id":"s1"}\n'))
	const frameB = zstdCompressSync(Buffer.from('{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}\n'))
	const buffer = Buffer.concat([frameA, frameB, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03])])
	const { lines, truncatedFrames } = decodeLogBuffer(buffer)
	assert.equal(truncatedFrames, 1)
	const parsed = parseLogLines(lines)
	assert.equal(parsed.header.id, 's1')
	assert.equal(parsed.events.length, 1)
})

test('parseLogLines counts malformed lines without throwing', () => {
	const parsed = parseLogLines(['{"type":"session","id":"s1"}', 'garbage{', '', '{"type":"x"}', 'null'])
	assert.equal(parsed.header.id, 's1')
	assert.equal(parsed.badLines, 2) // garbage{ and null
	assert.equal(parsed.events.length, 1)
})

test('listSessionLogs and readSessionLog round-trip a workspace layout', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		const sessionDir = join(root, '--tmp-project--', 'session-abc')
		await mkdir(sessionDir, { recursive: true })
		const events = [turnStart(1), requestHeader('prov', 'model-x'), toolCall(1, 1, 'c1', 'read', { file_path: '/a' }), toolResult(1, 1, 'c1'), turnEnd(1)]
		await writeFile(join(sessionDir, 'session.jsonl'), logOf(sessionHeader({ id: 'session-abc', cwd: '/tmp/project' }), events))

		const logs = await listSessionLogs(root)
		assert.equal(logs.length, 1)
		assert.equal(logs[0].id, 'session-abc')
		assert.equal(logs[0].cwd, '/tmp/project')

		const read = await readSessionLog(root, 'session-abc')
		assert.notEqual(read, undefined)
		assert.equal(read.header.id, 'session-abc')
		assert.equal(read.events.length, 5)

		const missing = await readSessionLog(root, 'session-nope')
		assert.equal(missing, undefined)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('zstd round-trip through the reader path', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		const sessionDir = join(root, '--w--', 'session-z')
		await mkdir(sessionDir, { recursive: true })
		const headerLine = JSON.stringify(sessionHeader({ id: 'session-z' }))
		const eventsLines = [
			JSON.stringify(turnStart(1)),
			JSON.stringify(requestHeader('p', 'm')),
		].join('\n')
		// two frames, like the real backend (header frame + batch frame)
		const artifact = Buffer.concat([zstdCompressSync(Buffer.from(`${headerLine}\n`)), zstdCompressSync(Buffer.from(`${eventsLines}\n`))])
		await writeFile(join(sessionDir, 'session.jsonl.zstd'), artifact)

		const read = await readSessionLog(root, 'session-z')
		assert.notEqual(read, undefined)
		assert.equal(read.events.length, 2)
		assert.equal(read.truncatedFrames, 0)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('empty root lists nothing and lookup misses', async () => {
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		assert.deepEqual(await listSessionLogs(root), [])
		assert.equal(await readSessionLog(root, 'any'), undefined)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('readSessionLog hits direct path when session dir name matches id', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		const sessionDir = join(root, '--ws--', 'session-direct')
		await mkdir(sessionDir, { recursive: true })
		const events = [turnStart(1), requestHeader('p', 'm'), toolCall(1, 1, 'c1', 'read', {}), toolResult(1, 1, 'c1'), turnEnd(1)]
		await writeFile(join(sessionDir, 'session.jsonl'), logOf(sessionHeader({ id: 'session-direct' }), events))

		// Should find via direct stat — no full scan needed
		const read = await readSessionLog(root, 'session-direct')
		assert.notEqual(read, undefined)
		assert.equal(read.header.id, 'session-direct')
		assert.equal(read.events.length, 5)
		assert.equal(read.badLines, 0)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('readSessionLog falls back to full scan when direct path misses', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		// Session dir name differs from header id (edge case: renamed dir)
		const sessionDir = join(root, '--ws--', 'different-dir-name')
		await mkdir(sessionDir, { recursive: true })
		const events = [turnStart(1), turnEnd(1)]
		await writeFile(join(sessionDir, 'session.jsonl'), logOf(sessionHeader({ id: 'actual-session-id' }), events))

		// Direct stat fails (dir name ≠ id), but full scan finds it
		const read = await readSessionLog(root, 'actual-session-id')
		assert.notEqual(read, undefined)
		assert.equal(read.header.id, 'actual-session-id')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('listSessionLogs only decodes first zstd frame (header frame)', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		const sessionDir = join(root, '--ws--', 'session-hf')
		await mkdir(sessionDir, { recursive: true })
		// Three frames: header + two event batches. listSessionLogs should only
		// decode the first frame to get the header.
		const headerLine = JSON.stringify(sessionHeader({ id: 'session-hf', cwd: '/hf' }))
		const frameA = zstdCompressSync(Buffer.from(`${headerLine}\n`))
		const frameB = zstdCompressSync(Buffer.from(`${JSON.stringify(turnStart(1))}\n${JSON.stringify(turnEnd(1))}\n`))
		const frameC = zstdCompressSync(Buffer.from(`${JSON.stringify(requestHeader('p', 'm'))}\n`))
		const artifact = Buffer.concat([frameA, frameB, frameC])
		await writeFile(join(sessionDir, 'session.jsonl.zstd'), artifact)

		const logs = await listSessionLogs(root)
		assert.equal(logs.length, 1)
		assert.equal(logs[0].id, 'session-hf')
		assert.equal(logs[0].cwd, '/hf')
		// sizeBytes should match the file size (not just the header frame)
		assert.ok(logs[0].sizeBytes > 0)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('listSessionLogs tolerates corrupt first frame', async () => {
	resetFixtures()
	const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'))
	try {
		const sessionDir = join(root, '--ws--', 'session-corrupt')
		await mkdir(sessionDir, { recursive: true })
		// Corrupt zstd magic but valid file: decodeHeaderFrame skips it
		const corrupt = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff]) // valid magic, invalid frame
		await writeFile(join(sessionDir, 'session.jsonl.zstd'), corrupt)

		// Should not crash; corrupt frame is excluded from listing
		const logs = await listSessionLogs(root)
		// The corrupt frame fails decode → no header → excluded
		assert.equal(logs.length, 0)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
