import { formatDuration, formatNumber, formatPercent } from "../utils/duration.js";
export function formatMarkdownReport(report) {
    const lines = [];
    lines.push('# DSH Session Audit', '');
    lines.push('## Session', '');
    lines.push(`- **ID**: \`${report.session.id}\``);
    if (report.session.model !== undefined)
        lines.push(`- **Model**: ${report.session.model}`);
    if (report.session.provider !== undefined)
        lines.push(`- **Provider**: ${report.session.provider}`);
    if (report.session.cwd !== undefined)
        lines.push(`- **Cwd**: \`${report.session.cwd}\``);
    lines.push(`- **Duration**: ${formatDuration(report.session.durationMs)}${report.execution.openTurn ? ' *(turn still open — live session)*' : ''}`);
    if (report.session.startedAt !== undefined)
        lines.push(`- **Started**: ${report.session.startedAt}`);
    lines.push('');
    lines.push('## Execution', '');
    lines.push(`- **Turns**: ${report.execution.turns}`);
    lines.push(`- **Steps**: ${report.execution.steps}`);
    lines.push(`- **Assistant messages**: ${report.execution.assistantMessages}`);
    const reasons = Object.entries(report.execution.turnEndReasons);
    if (reasons.length > 0) {
        lines.push(`- **Turn endings**: ${reasons.map(([kind, count]) => `\`${kind}\`×${count}`).join(', ')}`);
    }
    lines.push('');
    lines.push('## Tools', '');
    lines.push(`- **Total calls**: ${report.tools.totalCalls}`);
    lines.push(`- **Succeeded**: ${report.tools.successfulCalls}`);
    lines.push(`- **Failed**: ${report.tools.failedCalls}`);
    if (report.tools.unresolvedCalls > 0)
        lines.push(`- **Unresolved**: ${report.tools.unresolvedCalls}`);
    lines.push(`- **Failure rate**: ${formatPercent(report.tools.failureRate)}`);
    if (report.tools.byTool.length > 0) {
        lines.push('');
        lines.push('| Tool | Calls | Failed |', '|---|---:|---:|');
        for (const tool of report.tools.byTool.slice(0, 10)) {
            lines.push(`| \`${tool.name}\` | ${tool.calls} | ${tool.failed} |`);
        }
    }
    lines.push('');
    lines.push('## Tokens', '');
    if (report.tokens === undefined) {
        lines.push('Unavailable — no provider usage records exist in this session log.');
        lines.push('');
        lines.push('dsh records token usage only when the provider reports it; the provider used by this session did not. No values are estimated.');
    }
    else {
        lines.push('| Bucket | Tokens |', '|---|---:|');
        lines.push(`| Input | ${formatNumber(report.tokens.inputTokens)} |`);
        lines.push(`| Output | ${formatNumber(report.tokens.outputTokens)} |`);
        if (report.tokens.cacheReadTokens > 0)
            lines.push(`| Cache read | ${formatNumber(report.tokens.cacheReadTokens)} |`);
        if (report.tokens.cacheWriteTokens > 0)
            lines.push(`| Cache write | ${formatNumber(report.tokens.cacheWriteTokens)} |`);
        if (report.tokens.reasoningTokens > 0)
            lines.push(`| Reasoning | ${formatNumber(report.tokens.reasoningTokens)} |`);
        lines.push(`| **Total** | **${formatNumber(report.tokens.totalTokens)}** |`);
    }
    lines.push('');
    lines.push('## Execution signals', '');
    if (report.signals.length === 0) {
        lines.push('none');
    }
    else {
        for (const signal of report.signals) {
            const badge = signal.severity === 'warning' ? '⚠️' : signal.severity === 'critical' ? '🛑' : 'ℹ️';
            const detail = signal.detail !== undefined ? ` — ${signal.detail}` : '';
            lines.push(`- ${badge} ${signal.title}${detail}`);
        }
    }
    lines.push('');
    lines.push('## Verification', '');
    if (report.verification.length === 0) {
        lines.push('No test/build/lint verification command was detected in the observed session. This does not mean no verification happened — it may have run through a mechanism this analysis cannot observe.');
    }
    else {
        for (const item of report.verification) {
            const icon = item.lastOk ? '✅' : '❌';
            const attempts = item.attempts > 1 ? ` *(${item.attempts} attempts, ${item.okAttempts} ok)*` : '';
            lines.push(`- ${icon} \`${item.command}\` [${item.type}]${attempts}`);
        }
    }
    lines.push('');
    const quality = report.execution.dataQuality;
    if (quality.skippedEvents > 0 || quality.truncatedFrames > 0 || quality.unknownEventTypes.length > 0) {
        lines.push('## Data quality', '');
        if (quality.skippedEvents > 0) {
            lines.push(`- ${quality.skippedEvents} events skipped (unrecognized or malformed)`);
            if (quality.unknownEventTypes.length > 0) {
                lines.push(`  - unknown types: ${quality.unknownEventTypes.map((type) => `\`${type}\``).join(', ')}`);
            }
        }
        if (quality.truncatedFrames > 0)
            lines.push(`- ${quality.truncatedFrames} torn log frame(s) skipped (crash tail)`);
        lines.push('');
    }
    lines.push('---', '', `*schema \`dsh-session-audit/${report.schemaVersion}\` · generated ${report.generatedAt}*`);
    return lines.join('\n');
}
