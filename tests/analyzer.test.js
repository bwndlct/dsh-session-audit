/**
 * Analyzer metric tests: turn/step/tool/token aggregation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptSession } from '../src/dsh/session-adapter.ts'
import { analyzeSession } from '../src/audit/analyzer.ts'
import {
	assistantMessage,
	resetFixtures,
	sessionHeader,
	stepEnd,
	stepStart,
	toolCall,
	toolResult,
	turnEnd,
	turnStart,
	usageChunk,
	requestHeader,
} from './fixtures.ts'

function analyze(events) {
	const raw = { header: sessionHeader(), events }
	return analyzeSession({ header: raw.header, adapted: adaptSession(raw) })
}

test('counts turns, steps, assistant messages, and tool calls', () => {
	resetFixtures()
	const report = analyze([
		requestHeader('prov', 'model-a'),
		turnStart(1),
		stepStart(1, 1),
		assistantMessage(1, 1),
		toolCall(1, 1, 'c1', 'read', { file_path: '/a.ts' }),
		toolResult(1, 1, 'c1'),
		stepEnd(1, 1),
		stepStart(1, 2),
		assistantMessage(1, 2),
		stepEnd(1, 2),
		turnEnd(1),
		turnStart(2),
		stepStart(2, 1),
		assistantMessage(2, 1),
		stepEnd(2, 1),
		turnEnd(2),
	])
	assert.equal(report.execution.turns, 2)
	assert.equal(report.execution.steps, 3)
	assert.equal(report.execution.assistantMessages, 3)
	assert.equal(report.tools.totalCalls, 1)
	assert.equal(report.tools.successfulCalls, 1)
	assert.equal(report.tools.failedCalls, 0)
	assert.equal(report.session.model, 'model-a')
	assert.equal(report.session.provider, 'prov')
	assert.equal(report.session.cwd, '/tmp/project')
	assert.equal(report.execution.openTurn, false)
})

test('turn without closed step does not count (official sessionStats semantics)', () => {
	resetFixtures()
	const report = analyze([turnStart(1), stepStart(1, 1), assistantMessage(1, 1), turnEnd(1, 'aborted')])
	assert.equal(report.execution.turns, 0)
	assert.equal(report.execution.steps, 0)
	assert.equal(report.execution.openTurn, false)
	assert.equal(report.execution.turnEndReasons.aborted, 1)
})

test('open turn is reported for live sessions', () => {
	resetFixtures()
	const report = analyze([turnStart(1), stepStart(1, 1), assistantMessage(1, 1)])
	assert.equal(report.execution.openTurn, true)
	assert.ok(report.signals.some((signal) => signal.id === 'open-turn'))
})

test('duration uses header createdAt to last event time', () => {
	resetFixtures()
	const report = analyze([turnStart(1), stepStart(1, 1), assistantMessage(1, 1), stepEnd(1, 1), turnEnd(1)])
	// createdAt 1000; fixture times: turnStart 1050 … turnEnd 1250
	assert.equal(report.session.durationMs, 250)
})

test('failed tool results counted from isError and data.error', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		toolCall(1, 1, 'c1', 'bash', { command: 'npm test' }),
		toolResult(1, 1, 'c1', { isError: true, error: { name: 'BashError', code: 'BASH_TIMEOUT' }, text: 'Error: timed out' }),
		toolCall(1, 1, 'c2', 'read', { file_path: '/x' }),
		toolResult(1, 1, 'c2'),
		toolCall(1, 1, 'c3', 'web_search', {}),
		// c3 gets no result → unresolved
		stepEnd(1, 1),
		turnEnd(1),
	])
	assert.equal(report.tools.totalCalls, 3)
	assert.equal(report.tools.failedCalls, 1)
	assert.equal(report.tools.successfulCalls, 1)
	assert.equal(report.tools.unresolvedCalls, 1)
	assert.equal(report.tools.failureRate, 1 / 2)
})

test('token usage folds chunk samples and replaces with final message usage', () => {
	resetFixtures()
	const report = analyze([
		turnStart(1),
		stepStart(1, 1),
		usageChunk(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 40 }),
		assistantMessage(1, 1, { usage: { inputTokens: 110, outputTokens: 15, cacheReadTokens: 50, reasoningTokens: 5 } }),
		stepEnd(1, 1),
		stepStart(1, 2),
		usageChunk(1, 2, { inputTokens: 200, outputTokens: 20 }),
		// step 2 has no assistant/message → chunk sample stands
		stepEnd(1, 2),
		turnEnd(1),
	])
	assert.equal(report.tokens.inputTokens, 310) // 110 (final) + 200
	assert.equal(report.tokens.outputTokens, 35) // 15 + 20
	assert.equal(report.tokens.cacheReadTokens, 50)
	assert.equal(report.tokens.reasoningTokens, 5)
	assert.equal(report.tokens.totalTokens, 310 + 35 + 50)
	assert.equal(report.tokens.stepsWithUsage, 2)
})

test('tokens absent when provider reported none', () => {
	resetFixtures()
	const report = analyze([turnStart(1), stepStart(1, 1), assistantMessage(1, 1), stepEnd(1, 1), turnEnd(1)])
	assert.equal(report.tokens, undefined)
})
