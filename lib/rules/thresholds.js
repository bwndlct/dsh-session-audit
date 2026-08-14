/**
 * Centralized rule thresholds — every default lives here; nothing is
 * hard-coded inside a rule. Overridable programmatically (a future config
 * surface can pass a partial object).
 *
 * @module dsh-session-audit/rules/thresholds
 */
export const DEFAULT_THRESHOLDS = {
    toolCallsInfo: 15,
    toolCallsWarning: 30,
    duplicateToolCallMin: 3,
    repeatedFileReadMin: 4,
    failureRateWarning: 0.15,
    failureRateMinSamples: 3,
    consecutiveFailuresWarning: 3,
    consecutiveVerificationFailuresWarning: 2,
    // DSH built-in reader is `read` (file_path); common aliases covered for
    // custom setups. Extensible by configuration without code changes.
    fileReaderTools: {
        read: ['file_path', 'path'],
        read_file: ['file_path', 'path'],
        Read: ['file_path', 'path'],
    },
    // DSH built-in shell tools (`bash`, `pwsh`) carry `command`.
    shellTools: ['bash', 'pwsh', 'shell'],
};
