import { formatDuration, formatNumber, formatPercent } from "../utils/duration.js";
export function formatTextReport(report) {
    const lines = [];
    const push = (...values) => {
        lines.push(values.join(''));
    };
    push('DSH Session Audit');
    push('──────────────────────────────────────────────');
    push();
    // ── Session ─────────────────────────────────────────────────────────
    push('Session');
    const label = (name) => `${name}`.padEnd(16);
    push(label('ID'), report.session.id);
    if (report.session.model !== undefined)
        push(label('Model'), report.session.model);
    if (report.session.provider !== undefined)
        push(label('Provider'), report.session.provider);
    if (report.session.cwd !== undefined)
        push(label('Cwd'), report.session.cwd);
    push(label('Duration'), `${formatDuration(report.session.durationMs)}${report.execution.openTurn ? ' (turn still open — live session)' : ''}`);
    if (report.session.startedAt !== undefined)
        push(label('Started'), report.session.startedAt);
    push();
    // ── Execution ──────────────────────────────────────────────────────
    push('Execution');
    push(label('Turns'), String(report.execution.turns));
    push(label('Steps'), String(report.execution.steps));
    push(label('Assistant msgs'), String(report.execution.assistantMessages));
    const reasons = Object.entries(report.execution.turnEndReasons);
    if (reasons.length > 0) {
        push(label('Turn endings'), reasons.map(([kind, count]) => `${kind}×${count}`).join(', '));
    }
    push();
    // ── Tools ──────────────────────────────────────────────────────────
    push('Tools');
    push(label('Total calls'), String(report.tools.totalCalls));
    push(label('Succeeded'), String(report.tools.successfulCalls));
    push(label('Failed'), String(report.tools.failedCalls));
    if (report.tools.unresolvedCalls > 0)
        push(label('Unresolved'), String(report.tools.unresolvedCalls));
    push(label('Failure rate'), formatPercent(report.tools.failureRate));
    const top = report.tools.byTool.slice(0, 6);
    if (top.length > 0) {
        push();
        push('Top tools');
        for (const tool of top) {
            const failed = tool.failed > 0 ? `  (${tool.failed} failed)` : '';
            push(`  ${tool.name}`.padEnd(24), `${tool.calls}${failed}`);
        }
    }
    push();
    // ── Tokens ─────────────────────────────────────────────────────────
    push('Tokens');
    if (report.tokens === undefined) {
        push('  Unavailable — no provider usage records exist in this session log.');
        push('  (The configured provider did not report token accounting; dsh logs');
        push('  usage only when the provider supplies it. No values are estimated.)');
    }
    else {
        push(label('Input'), formatNumber(report.tokens.inputTokens));
        push(label('Output'), formatNumber(report.tokens.outputTokens));
        if (report.tokens.cacheReadTokens > 0)
            push(label('Cache read'), formatNumber(report.tokens.cacheReadTokens));
        if (report.tokens.cacheWriteTokens > 0)
            push(label('Cache write'), formatNumber(report.tokens.cacheWriteTokens));
        if (report.tokens.reasoningTokens > 0)
            push(label('Reasoning'), formatNumber(report.tokens.reasoningTokens));
        push(label('Total'), formatNumber(report.tokens.totalTokens));
    }
    push();
    // ── Signals ────────────────────────────────────────────────────────
    push('Execution signals');
    if (report.signals.length === 0) {
        push('  none');
    }
    else {
        for (const signal of report.signals) {
            const icon = signal.severity === 'warning' ? '⚠' : signal.severity === 'critical' ? '✖' : 'ℹ';
            push(`  ${icon} ${signal.title}`);
            if (signal.detail !== undefined)
                push(`     ${signal.detail}`);
        }
    }
    push();
    // ── Verification ───────────────────────────────────────────────────
    push('Verification');
    if (report.verification.length === 0) {
        push('  No test/build/lint verification command was detected in the observed');
        push('  session. This does not mean no verification happened — it may have run');
        push('  through a mechanism this analysis cannot observe.');
    }
    else {
        for (const item of report.verification) {
            const icon = item.lastOk ? '✓' : '✗';
            const attempts = item.attempts > 1 ? `  (${item.attempts} attempts, ${item.okAttempts} ok)` : '';
            push(`  ${icon} ${item.command}  [${item.type}]${attempts}`);
        }
    }
    push();
    // ── Data quality ───────────────────────────────────────────────────
    const quality = report.execution.dataQuality;
    if (quality.skippedEvents > 0 || quality.truncatedFrames > 0 || quality.unknownEventTypes.length > 0) {
        push('Data quality');
        if (quality.skippedEvents > 0) {
            push(`  ${quality.skippedEvents} events skipped (unrecognized or malformed)`);
            if (quality.unknownEventTypes.length > 0) {
                push(`    unknown types: ${quality.unknownEventTypes.join(', ')}`);
            }
        }
        if (quality.truncatedFrames > 0) {
            push(`  ${quality.truncatedFrames} torn log frame(s) skipped (crash tail)`);
        }
        push();
    }
    push(`schema dsh-session-audit/${report.schemaVersion}`);
    return lines.join('\n');
}
