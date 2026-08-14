/**
 * Deterministic stable serialization: object keys sorted recursively, so
 * `{"path":"a","query":"foo"}` and `{"query":"foo","path":"a"}` serialize
 * identically. Arrays keep order (order is semantic).
 *
 * @module dsh-session-audit/utils/stable-json
 */
/** recursively stringify `value` with sorted object keys. */
export declare function stableStringify(value: unknown): string;
/**
 * Stable identity key for a tool call: tool name plus stable-serialized
 * arguments. Identical calls with different JSON key order collide by design.
 */
export declare function toolCallKey(name: string, args: Record<string, unknown> | undefined, argsRaw: string): string;
