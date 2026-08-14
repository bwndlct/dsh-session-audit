export function evaluateHighFrequencyTools(facts, t) {
    const signals = [];
    for (const [name, { calls }] of facts.byTool) {
        if (calls >= t.toolCallsWarning) {
            signals.push({ id: `high-frequency-tool:${name}`, severity: 'warning', title: `\`${name}\` called ${calls} times` });
        }
        else if (calls >= t.toolCallsInfo) {
            signals.push({ id: `high-frequency-tool:${name}`, severity: 'info', title: `\`${name}\` called ${calls} times` });
        }
    }
    return signals;
}
