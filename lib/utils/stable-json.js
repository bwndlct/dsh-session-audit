/**
 * Deterministic stable serialization: object keys sorted recursively, so
 * `{"path":"a","query":"foo"}` and `{"query":"foo","path":"a"}` serialize
 * identically. Arrays keep order (order is semantic).
 *
 * @module dsh-session-audit/utils/stable-json
 */
/** recursively stringify `value` with sorted object keys. */
export function stableStringify(value) {
    return serialize(value);
}
function serialize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map((item) => serialize(item) ?? 'null').join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = entries.map(([key, v]) => `${JSON.stringify(key)}:${serialize(v)}`).join(',');
    return `{${body}}`;
}
/**
 * Stable identity key for a tool call: tool name plus stable-serialized
 * arguments. Identical calls with different JSON key order collide by design.
 */
export function toolCallKey(name, args, argsRaw) {
    const argsPart = args === undefined ? `raw:${argsRaw}` : serialize(args);
    return `${name}\u0000${argsPart}`;
}
