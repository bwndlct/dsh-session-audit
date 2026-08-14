/**
 * Small display helpers shared by formatters.
 *
 * @module dsh-session-audit/utils/duration
 */
/** `181000` → `3m 01s`; `2500` → `2s`; `<1000` → `<1s`. */
export declare function formatDuration(ms: number | undefined): string;
/** `184231` → `184,231`. */
export declare function formatNumber(n: number | undefined): string;
/** `0.073` → `7.3%`; `0` → `0%`. */
export declare function formatPercent(ratio: number | undefined): string;
