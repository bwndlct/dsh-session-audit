/**
 * Rule tests: duplicates, repeated reads, failures, verification.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptSession } from '../src/dsh/session-adapter.ts'
import { analyzeSession } from '../src/audit/analyzer.ts'
import {
	assistantMessage,
	bashResult,
	resetFixtures,
	sessionHeader,
	stepEnd,
	stepStart,
	toolCall,
	toolResult,
	turnEnd,
	turnStart,
} from './fixtures.ts'

function analyze(events) {
	const raw = { header: sessionHeader(), events }
	return analyzeSession({ header: raw.header, adapted: adaptSession(raw) })
}

test('duplicate tool call: key order does not distinguish arguments', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'grep', { pattern: 'foo', path: 'src' }),
		toolResult(1, 1, 'c1'),
		toolCall(1, 1, 'c2', 'grep', { path: 'src', pattern: 'foo' }), // key order differs
		toolResult(1, 1, 'c2'),
		toolCall(1, 1, 'c3', 'grep', { pattern: 'foo', path: 'src' }),
		toolResult(1, 1, 'c3'),
		toolCall(1, 1, 'c4', 'grep', { pattern: 'bar', path: 'src' }), // different args: not a duplicate
		toolResult(1, 1, 'c4'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	const duplicates = report.signals.filter((signal) => signal.id.startsWith('duplicate-tool-call:'))
	assert.equal(duplicates.length, 1)
	assert.match(duplicates[0].title, /repeated 3 times/)
})

test('duplicate detection tolerates unparsable raw arguments', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', 'not json {{{'),
		toolResult(1, 1, 'c1'),
		toolCall(1, 1, 'c2', 'bash', 'not json {{{'),
		toolResult(1, 1, 'c2'),
		toolCall(1, 1, 'c3', 'bash', 'not json {{{'),
		toolResult(1, 1, 'c3'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	assert.ok(report.signals.some((signal) => signal.id.startsWith('duplicate-tool-call:')))
})

test('repeated file reads counted per path via configurable reader tools', () => {
	resetFixtures()
	const events = [turnStart(1), stepStart(1, 1)]
	for (let index = 0; index < 4; index += 1) {
		const callId = `r${index}`
		events.push(toolCall(1, 1, callId, 'read', { file_path: '/src/app.ts', offset: 1 + index }))
		events.push(toolResult(1, 1, callId))
	}
	events.push(toolCall(1, 1, 'other', 'read', { file_path: '/src/other.ts' }))
	events.push(toolResult(1, 1, 'other'))
	events.push(stepEnd(1, 1), turnEnd(1))
	const report = analyze(events)
	const signal = report.signals.find((signal) => signal.id === 'repeated-file-read:/src/app.ts')
	assert.ok(signal !== undefined)
	assert.match(signal.title, /read 4 times/)
	// different offsets made these distinct calls, so no duplicate-tool-call signal
	assert.ok(!report.signals.some((signal) => signal.id.startsWith('duplicate-tool-call:')))
})

test('single failure and consecutive failures', () => {
	resetFixtures()
	const single = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'npm test' }),
		bashResult(1, 1, 'c1', 1, 'failing'),
		toolCall(1, 1, 'c2', 'bash', { command: 'npm test' }),
		bashResult(1, 1, 'c2', 0, 'passing'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	assert.equal(single.tools.failedCalls, 1)
	assert.ok(!single.signals.some((signal) => signal.id === 'consecutive-tool-failures'))

	resetFixtures()
	const consecutive = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'x' }),
		bashResult(1, 1, 'c1', 1, 'boom'),
		toolCall(1, 1, 'c2', 'bash', { command: 'y' }),
		bashResult(1, 1, 'c2', 2, 'boom'),
		toolCall(1, 1, 'c3', 'bash', { command: 'z' }),
		bashResult(1, 1, 'c3', 3, 'boom'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	assert.equal(consecutive.tools.failedCalls, 3)
	assert.ok(consecutive.signals.some((signal) => signal.id === 'consecutive-tool-failures'))
})

test('high failure rate signal only above threshold and sample minimum', () => {
	resetFixtures()
	const belowSamples = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'a' }),
		bashResult(1, 1, 'c1', 1, 'fail'),
		toolCall(1, 1, 'c2', 'bash', { command: 'b' }),
		bashResult(1, 1, 'c2', 0),
		stepEnd(1, 1),
		turnEnd(1),
	])
	// 50% rate but only 2 resolved (< failureRateMinSamples 3): no signal
	assert.ok(!belowSamples.signals.some((signal) => signal.id === 'tool-failure-rate'))

	resetFixtures()
	const above = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'a' }),
		bashResult(1, 1, 'c1', 1, 'fail'),
		toolCall(1, 1, 'c2', 'bash', { command: 'b' }),
		bashResult(1, 1, 'c2', 1, 'fail'),
		toolCall(1, 1, 'c3', 'bash', { command: 'c' }),
		bashResult(1, 1, 'c3', 0),
		toolCall(1, 1, 'c4', 'bash', { command: 'd' }),
		bashResult(1, 1, 'c4', 0),
		toolCall(1, 1, 'c5', 'bash', { command: 'e' }),
		bashResult(1, 1, 'c5', 0),
		toolCall(1, 1, 'c6', 'bash', { command: 'f' }),
		bashResult(1, 1, 'c6', 0),
		stepEnd(1, 1),
		turnEnd(1),
	])
	// 33% over 6 resolved: fires
	assert.ok(above.signals.some((signal) => signal.id === 'tool-failure-rate'))
})

test('high-frequency tool signal thresholds', () => {
	resetFixtures()
	const events = [turnStart(1), stepStart(1, 1)]
	for (let index = 0; index < 15; index += 1) {
		const callId = `h${index}`
		events.push(toolCall(1, 1, callId, 'read', { file_path: `/f${index}.ts` }))
		events.push(toolResult(1, 1, callId))
	}
	events.push(stepEnd(1, 1), turnEnd(1))
	const report = analyze(events)
	const signal = report.signals.find((signal) => signal.id === 'high-frequency-tool:read')
	assert.ok(signal !== undefined)
	assert.equal(signal.severity, 'info')
})

test('verification: npm test success and failure via exit-code marker', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'npm run nonexistent-test' }),
		bashResult(1, 1, 'c1', 1, 'npm ERR! missing script'),
		toolCall(1, 1, 'c2', 'bash', { command: 'npm test' }),
		bashResult(1, 1, 'c2', 0, 'all passing'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	const results = report.verification
	assert.equal(results.length, 2)
	const missing = results.find((result) => result.command.includes('nonexistent-test'))
	assert.ok(missing !== undefined && missing.lastOk === false && missing.failedAttempts === 1)
	const test = results.find((result) => result.command === 'npm test')
	assert.ok(test !== undefined && test.lastOk === true && test.type === 'test')
	assert.ok(!report.signals.some((signal) => signal.id === 'no-verification-detected'))
})

test('verification: pytest, cargo test, pnpm build, tsc, eslint recognized', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'pytest -q' }),
		bashResult(1, 1, 'c1', 0),
		toolCall(1, 1, 'c2', 'bash', { command: 'cargo test --all' }),
		bashResult(1, 1, 'c2', 0),
		toolCall(1, 1, 'c3', 'bash', { command: 'pnpm build' }),
		bashResult(1, 1, 'c3', 0),
		toolCall(1, 1, 'c4', 'bash', { command: 'tsc --noEmit' }),
		bashResult(1, 1, 'c4', 0),
		toolCall(1, 1, 'c5', 'bash', { command: 'eslint src/' }),
		bashResult(1, 1, 'c5', 0),
		stepEnd(1, 1),
		turnEnd(1),
	])
	const types = report.verification.map((result) => `${result.command}:${result.type}`)
	assert.ok(types.includes('pytest:test'))
	assert.ok(types.includes('cargo test:test'))
	assert.ok(types.includes('pnpm build:build'))
	assert.ok(types.includes('tsc:typecheck'))
	assert.ok(types.includes('eslint:lint'))
})

test('verification: repeated failing attempts produce warning signal', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'npm run build' }),
		bashResult(1, 1, 'c1', 1, 'error TS2304'),
		toolCall(1, 1, 'c2', 'bash', { command: 'npm run build' }),
		bashResult(1, 1, 'c2', 1, 'error TS2304'),
		stepEnd(1, 1),
		turnEnd(1),
	])
	const build = report.verification.find((result) => result.command === 'npm run build')
	assert.ok(build !== undefined)
	assert.equal(build.attempts, 2)
	assert.equal(build.failedAttempts, 2)
	assert.ok(report.signals.some((signal) => signal.id === 'verification-repeated-failure:npm run build'))
})

test('verification: absent commands yield cautious info signal', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'ls -la' }),
		bashResult(1, 1, 'c1', 0),
		assistantMessage(1, 1),
		stepEnd(1, 1),
		turnEnd(1),
	])
	const signal = report.signals.find((signal) => signal.id === 'no-verification-detected')
	assert.ok(signal !== undefined)
	assert.equal(signal.severity, 'info')
	assert.match(signal.title, /no test\/build\/lint verification command was detected/)
})

test('verification: unresolved shell call is not counted as an attempt', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'npm test' }),
		// no tool/result (interrupted session)
		stepEnd(1, 1),
		turnEnd(1, 'aborted'),
	])
	assert.equal(report.verification.length, 0)
	assert.ok(report.signals.some((signal) => signal.id === 'no-verification-detected'))
})
