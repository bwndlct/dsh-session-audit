export function evaluateFailureRate(facts, t) {
    const { resolved, failed, failureRate } = facts.toolTotals;
    if (resolved < t.failureRateMinSamples)
        return [];
    if (failureRate < t.failureRateWarning)
        return [];
    return [
        {
            id: 'tool-failure-rate',
            severity: 'warning',
            title: `tool failure rate reached ${Math.round(failureRate * 100)}%`,
            detail: `${failed} of ${resolved} resolved tool calls failed`,
        },
    ];
}
