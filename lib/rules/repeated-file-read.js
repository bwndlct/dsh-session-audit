export function evaluateRepeatedFileReads(facts, t) {
    const reads = new Map();
    for (const call of facts.toolSequence) {
        const argNames = t.fileReaderTools[call.name];
        if (argNames === undefined || call.args === undefined)
            continue;
        for (const argName of argNames) {
            const value = call.args[argName];
            if (typeof value === 'string' && value !== '') {
                reads.set(value, (reads.get(value) ?? 0) + 1);
                break;
            }
        }
    }
    const signals = [];
    for (const [path, count] of reads) {
        if (count < t.repeatedFileReadMin)
            continue;
        signals.push({
            id: `repeated-file-read:${path}`,
            severity: count >= t.repeatedFileReadMin * 2 ? 'warning' : 'info',
            title: `\`${path}\` was read ${count} times`,
        });
    }
    return signals;
}
