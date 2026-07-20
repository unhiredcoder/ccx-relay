# Task 2: src/ui.js — Braille spinner and ANSI status lines

## Context
ccx-relay is a Node.js PTY wrapper CLI. This module owns ALL stderr output —
no other module may write to stderr directly.

## Global Constraints
- Node.js >= 18, no new runtime dependencies
- ESM only (`export`, not `module.exports`)
- `ui.js` is the ONLY module that writes to stderr — all others call ui.* methods
- No unit tests for this module (ANSI output not meaningful in terminal-less runner)
- Visual smoke test required instead

## Requirements

Create `src/ui.js` exporting three functions:

### `start(): void`
- Starts animating a Braille spinner on stderr
- Frames: `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']` at 80ms intervals
- Draws on line below current cursor using ANSI save/restore
- Format: `⠋ Enhancing prompt...`
- If already running, resets frame counter and restarts

### `stop(state: 'success'|'error', message: string): Promise<void>`
- Clears the spinner interval
- Draws final state:
  - success: `\x1b[32m✓ {message}\x1b[0m` (green)
  - error: `\x1b[31m✗ {message}\x1b[0m` (red)
- Waits 400ms
- Clears the status line
- Returns Promise that resolves after the 400ms + clear

### `clear(): void`
- Immediately clears the status line (synchronous)
- Stops spinner interval if running

### ANSI rendering
Draw status line using this pattern (write to `process.stderr`):
```
\x1b[s       = save cursor
\r\n         = move to line below
\x1b[2K      = erase line
{content}    = the status text
\x1b[u       = restore cursor
```

## Smoke test command
After implementing, verify visually:
```
node -e "
import('./src/ui.js').then(async ({ start, stop }) => {
  start();
  await new Promise(r => setTimeout(r, 1500));
  await stop('success', 'Enhanced');
  console.log('done');
  process.exit(0);
});
"
```
Expected: spinner animates ~1.5s, flashes green `✓ Enhanced`, clears, prints `done`.

## Commit message
`feat: add src/ui.js Braille spinner with ANSI status lines`

## Report
Write your report to: `.superpowers/sdd/task-2-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / BLOCKED
- Commit hash (short)
- Smoke test result: "spinner animated, green success shown, cleared"
- Any concerns
