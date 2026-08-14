/**
 * Edge-case tests: empty session, malformed events, unknown types, missing
 * pieces — none of these may crash the audit.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptSession } from '../src/dsh/session-adapter.ts'
import { analyzeSession } from '../src/audit/analyzer.ts'
import { formatTextReport } from '../src/formatters/text.ts'
import { formatMarkdownReport } from '../src/formatters/markdown.ts'
import { formatJsonReport } from '../src/formatters/json.ts'
import { requestHeader, resetFixtures, sessionHeader, turnStart } from './fixtures.ts'

function analyze(events, header) {
	const raw = { header: header ?? sessionHeader(), events }
	return analyzeSession({ header: raw.header, adapted: adaptSession(raw) })
}

test('empty session produces a valid empty report', () => {
	resetFixtures()
	const report = analyze([])
	assert.equal(report.execution.turns, 0)
	assert.equal(report.execution.steps, 0)
	assert.equal(report.tools.totalCalls, 0)
	assert.equal(report.tokens, undefined)
	assert.equal(report.verification.length, 0)
	assert.ok(report.signals.some((signal) => signal.id === 'no-verification-detected'))
})

test('user-only session (no assistant events) works', () => {
	resetFixtures()
	const report = analyze([{ type: 'user/message', seq: 1, time: 1100, data: { message: { role: 'user', content: 'hi' } } }])
	assert.equal(report.execution.turns, 0)
	assert.equal(report.execution.assistantMessages, 0)
	assert.equal(report.execution.dataQuality.skippedEvents, 0) // user/message is known-skipped
})

test('unknown event types are counted, not fatal', () => {
	resetFixtures()
	const report = analyze([
		{ type: 'some/future-event', seq: 1, time: 1100, data: { whatever: true } },
		{ type: 'another/newthing', seq: 2, time: 1150, data: {} },
		turnStart(1),
	])
	assert.deepEqual(report.execution.dataQuality.unknownEventTypes, ['some/future-event', 'another/newthing'])
	assert.equal(report.execution.dataQuality.skippedEvents, 2)
	assert.equal(report.execution.openTurn, true)
})

test('malformed events (missing fields, wrong types) never throw', () => {
	resetFixtures()
	const report = analyze([
		'not-even-an-object',
		{ type: 'tool/call', data: {} }, // no turn/step/callId/name
		{ type: 'tool/call', seq: 3, time: 1200, data: { turn: 1, step: 1, callId: '', name: 'bash' } },
		{ type: 'tool/result', seq: 4, time: 1250, data: { turn: 1, step: 1, message: { source: {}, content: [] } } },
		{ type: 'turn/end', seq: 5, time: 1300, data: {} }, // no turn number
		{ type: 'assistant/message', seq: 6, time: 1350, data: { turn: 'x', step: 'y' } },
		null,
		42,
	])
	assert.equal(report.tools.totalCalls, 0)
	assert.ok(report.execution.dataQuality.skippedEvents >= 5)
})

test('orphan tool result (no matching call) is ignored gracefully', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		{
			type: 'tool/result',
			seq: 2,
			time: 1200,
			data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'ghost' }, content: [] } },
		},
	])
	assert.equal(report.tools.totalCalls, 0)
	assert.equal(report.tools.resolvedCalls, 0)
})

test('non-monotonic and out-of-order seqs still produce a stable tool order', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		{ type: 'tool/call', seq: 9, time: 1200, data: { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{"file_path":"/a"}' } },
		{ type: 'tool/call', seq: 5, time: 1250, data: { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{"file_path":"/b"}' } },
		{ type: 'tool/result', seq: 10, time: 1300, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'a' }, content: [{ type: 'tool-result', toolCallId: 'a', content: [] }] } } },
	])
	// sorted by seq: b (5) before a (9); only a has a result
	assert.equal(report.tools.totalCalls, 2)
	assert.equal(report.tools.successfulCalls, 1)
	assert.equal(report.tools.unresolvedCalls, 1)
})

test('missing header fields degrade to unavailable, not fake data', () => {
	resetFixtures()
	const report = analyze([requestHeader('p', 'm')], { type: 'session', version: 0, id: 'x' })
	assert.equal(report.session.startedAt, undefined)
	assert.equal(report.session.durationMs, undefined)
	assert.equal(report.session.cwd, undefined)
	assert.equal(report.session.model, 'm')
})

test('all three formatters render the same empty-session report without throwing', () => {
	resetFixtures()
	const report = analyze([])
	const text = formatTextReport(report)
	const markdown = formatMarkdownReport(report)
	const json = formatJsonReport(report)
	assert.match(text, /DSH Session Audit/)
	assert.match(text, /Unavailable/)
	assert.match(markdown, /# DSH Session Audit/)
	const parsed = JSON.parse(json)
	assert.equal(parsed.schemaVersion, '1.0')
	assert.equal(parsed.session.id, 'session-test-0001')
})
