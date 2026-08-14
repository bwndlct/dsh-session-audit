/**
 * Small display helpers shared by formatters.
 *
 * @module dsh-session-audit/utils/duration
 */
/** `181000` → `3m 01s`; `2500` → `2s`; `<1000` → `<1s`. */
export function formatDuration(ms) {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0)
        return 'unavailable';
    if (ms < 1000)
        return '<1s';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0)
        return `${hours}h ${h(minutes)}m`;
    if (minutes > 0)
        return `${minutes}m ${h(seconds)}s`;
    if (seconds >= 1)
        return `${seconds}s`;
    return '<1s';
}
/** zero-padded two digits */
function h(n) {
    return String(n).padStart(2, '0');
}
/** `184231` → `184,231`. */
export function formatNumber(n) {
    if (n === undefined || !Number.isFinite(n))
        return 'unavailable';
    return n.toLocaleString('en-US');
}
/** `0.073` → `7.3%`; `0` → `0%`. */
export function formatPercent(ratio) {
    if (ratio === undefined || !Number.isFinite(ratio))
        return 'unavailable';
    const percent = ratio * 100;
    const text = percent === 0 ? '0' : percent < 0.1 && percent > 0 ? percent.toFixed(2) : percent.toFixed(1);
    return `${text}%`;
}
