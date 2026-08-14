import { toolCallKey } from "../utils/stable-json.js";
export function evaluateDuplicateToolCalls(facts, t) {
    const counts = new Map();
    for (const call of facts.toolSequence) {
        const key = toolCallKey(call.name, call.args, call.argsRaw);
        const entry = counts.get(key);
        if (entry === undefined)
            counts.set(key, { name: call.name, argsKey: key, count: 1, firstSeq: call.seq });
        else
            entry.count += 1;
    }
    const signals = [];
    for (const entry of counts.values()) {
        if (entry.count < t.duplicateToolCallMin)
            continue;
        const detail = describeArguments(entry.argsKey);
        signals.push({
            id: `duplicate-tool-call:${entry.name}:${entry.firstSeq}`,
            severity: 'warning',
            title: `identical \`${entry.name}\` call repeated ${entry.count} times`,
            detail,
        });
    }
    return signals;
}
/** Human-readable, bounded argument summary for a stable call key. */
function describeArguments(argsKey) {
    const separator = argsKey.indexOf('\u0000');
    if (separator === -1)
        return undefined;
    const raw = argsKey.slice(separator + 1);
    const text = raw.startsWith('raw:') ? raw.slice(4) : raw;
    return text.length > 120 ? `${text.slice(0, 120)}…` : text.length > 0 ? text : undefined;
}
