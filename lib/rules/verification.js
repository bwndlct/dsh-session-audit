/**
 * Patterns are matched against the full command line (compound commands
 * included). Order matters: a line matching several classes resolves to the
 * first (test > lint > typecheck > build).
 */
const PATTERNS = [
    // `test` as its own script segment: matches `npm test`, `npm run test:unit`,
    // `npm run nonexistent-test`; does NOT match `npm run latest`.
    { type: 'test', re: /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:[\w:.]+-)?test[\w:.-]*/ },
    { type: 'test', re: /\b(?:pytest|py\.test)\b/ },
    { type: 'test', re: /\bcargo\s+test\b/ },
    { type: 'test', re: /\bgo\s+test\b/ },
    { type: 'test', re: /\bdotnet\s+test\b/ },
    { type: 'test', re: /\b(?:jest|vitest|mocha)\b/ },
    { type: 'test', re: /\b(?:node|deno|bun)\s+--?test\b/ },
    { type: 'test', re: /\b(?:mvn|gradle)\s+test\b/ },
    { type: 'test', re: /\bmake\s+test\b/ },
    { type: 'lint', re: /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+lint[\w:.-]*/ },
    { type: 'lint', re: /\b(?:eslint|biome|prettier|ruff|pylint|flake8|golangci-lint)\b/ },
    { type: 'typecheck', re: /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+typecheck[\w:.-]*/ },
    { type: 'typecheck', re: /\b(?:tsc|mypy|pyright|cargo\s+check)\b/ },
    { type: 'build', re: /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+build[\w:.-]*/ },
    { type: 'build', re: /\bcargo\s+build\b/ },
    { type: 'build', re: /\bgo\s+build\b/ },
    { type: 'build', re: /\bdotnet\s+build\b/ },
    { type: 'build', re: /\bmake\s+(?:build|all)\b/ },
];
/** Match one command line against the verification vocabulary. */
export function matchVerificationCommand(command) {
    for (const pattern of PATTERNS) {
        const match = pattern.re.exec(command);
        if (match !== null) {
            const matched = match[0].trim();
            if (matched !== '')
                return { type: pattern.type, command: matched };
        }
    }
    return undefined;
}
/** Extract the shell command line of one tool call, when it is a shell tool. */
export function shellCommandOf(call, t) {
    if (!t.shellTools.includes(call.name))
        return undefined;
    const command = call.args?.command;
    return typeof command === 'string' ? command : undefined;
}
const EXIT_MARKER = /\[exit code: (\d+)\]\s*$/;
/** Trailing `[exit code: N]` marker of a shell-tool result, when present. */
export function exitCodeMarkerOf(text) {
    const marker = EXIT_MARKER.exec(text);
    if (marker === null)
        return undefined;
    const value = Number.parseInt(marker[1] ?? '0', 10);
    return Number.isFinite(value) ? value : undefined;
}
/**
 * Observed outcome of one shell-tool call:
 * `false` = failed (harness error or non-zero exit marker), `true` = completed.
 */
export function shellCallSucceeded(call) {
    const result = call.result;
    if (result === undefined)
        return false; // no durable result: outcome unknown → not a success
    if (result.isError)
        return false;
    const exitCode = exitCodeMarkerOf(result.textPreview ?? '');
    if (exitCode !== undefined)
        return exitCode === 0;
    return true;
}
/** Fold all verification attempts out of the tool sequence. */
export function detectVerification(facts, t) {
    const byCommand = new Map();
    for (const call of facts.toolSequence) {
        if (call.result === undefined)
            continue; // unresolved call: outcome unknown, not an attempt
        const command = shellCommandOf(call, t);
        if (command === undefined)
            continue;
        const match = matchVerificationCommand(command);
        if (match === undefined)
            continue;
        const ok = shellCallSucceeded(call);
        const entry = byCommand.get(match.command);
        if (entry === undefined) {
            byCommand.set(match.command, {
                command: match.command,
                type: match.type,
                attempts: 1,
                okAttempts: ok ? 1 : 0,
                failedAttempts: ok ? 0 : 1,
                lastOk: ok,
            });
        }
        else {
            entry.attempts += 1;
            if (ok)
                entry.okAttempts += 1;
            else
                entry.failedAttempts += 1;
            entry.lastOk = ok;
        }
    }
    return [...byCommand.values()];
}
export function evaluateVerification(results, t) {
    const signals = [];
    if (results.length === 0) {
        signals.push({
            id: 'no-verification-detected',
            severity: 'info',
            title: 'no test/build/lint verification command was detected in the observed session',
            detail: 'verification may still have run through mechanisms this analysis cannot observe',
        });
        return signals;
    }
    for (const result of results) {
        if (result.failedAttempts >= t.consecutiveVerificationFailuresWarning && !result.lastOk) {
            signals.push({
                id: `verification-repeated-failure:${result.command}`,
                severity: 'warning',
                title: `${result.failedAttempts} consecutive failed attempts of \`${result.command}\``,
            });
            continue;
        }
        if (!result.lastOk && result.failedAttempts > 0) {
            signals.push({
                id: `verification-failed:${result.command}`,
                severity: 'warning',
                title: `last observed \`${result.command}\` attempt failed`,
            });
        }
    }
    return signals;
}
