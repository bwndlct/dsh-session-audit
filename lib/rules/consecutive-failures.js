export function evaluateConsecutiveFailures(facts, t) {
    let run = 0;
    let worst = 0;
    let worstTool = '';
    for (const call of facts.toolSequence) {
        if (call.result?.isError === true) {
            run += 1;
            if (run > worst) {
                worst = run;
                worstTool = call.name;
            }
        }
        else {
            run = 0; // a call without a failed result breaks the run
        }
    }
    if (worst < t.consecutiveFailuresWarning)
        return [];
    return [
        {
            id: 'consecutive-tool-failures',
            severity: 'warning',
            title: `${worst} consecutive failed tool calls detected`,
            detail: worstTool !== '' ? `longest run ended at a failed \`${worstTool}\` call` : undefined,
        },
    ];
}
