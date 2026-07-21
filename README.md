# ccx

A transparent PTY wrapper for [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) (or any interactive
CLI) that lets you refine your prompt with Gemini AI before you submit it — without leaving your normal terminal
session.

Run `ccx claude` instead of `claude`. Everything looks and behaves like a normal Claude Code session. When you want a
rough line cleaned up, append a trailing marker (default `;;`) and press Enter once — `ccx` sends what you typed
(minus the marker) to Gemini, gets back a grammatically corrected / clearer rewrite of the same intent, and swaps it
in-place on the line, as if you'd typed the better version yourself, without submitting it yet. Review it, then press
Enter again as usual to actually submit.

This marker-based trigger (rather than a keyboard shortcut) is deliberate: a hotkey has to survive three independent
layers of keybinding claims — the OS/global-hotkey tools, the terminal app (VS Code and its extensions), and the
wrapped CLI's own input handling — and on a sufficiently customized machine, every `Ctrl`/`Alt` combination worth
trying can already be spoken for by one of them. Plain typed text has no such competition.

## Prerequisites

- **Node.js 18+** (needed for the built-in `fetch` used to call the Gemini API).
- **A Gemini API key** — get one at https://aistudio.google.com/apikey. As of mid-2026, Google issues new keys as
  "Auth keys" starting with `AQ.` (the older `AIza`-prefixed "Standard" keys are being phased out through
  September 2026). `ccx` sends the key via the `x-goog-api-key` header, which works for both key types.
- **Windows only:** `node-pty` is a native module and needs to be compiled during `npm install`. Make sure you have:
  - Visual Studio Build Tools with the "Desktop development with C++" workload, and
  - Python 3.x on your PATH.

  If `npm install` fails while building `node-pty`, install the above and run `npm rebuild node-pty`.

## Install

```bash
npm install -g ccx-relay
```

## Setup

Run the one-time setup wizard:

```bash
ccx-init
```

This will prompt for your Gemini API key (get one at https://aistudio.google.com/apikey), validate it, let you pick a model, and save config to your user directory (`%APPDATA%\ccx\config.json` on Windows, `~/.config/ccx/config.json` on macOS/Linux). Config survives npm upgrades.

Other init commands:

```bash
ccx-init --show    # print current config (key masked)
ccx-init --reset   # wipe config and start over
```

### Environment variable override

You can skip `ccx-init` and set env vars directly (useful for CI):

```bash
export GEMINI_API_KEY=AIza...
export GEMINI_MODEL=gemini-2.5-flash   # optional
export CCX_MARKER=;;                   # optional
export CCX_TIMEOUT=8                   # optional, seconds
```

## Usage

```bash
ccx claude          # launch Claude Code behind the ccx relay
ccx claude --resume  # any extra args are passed straight through
ccx bash             # or any other command — ccx just wraps argv
```

While the wrapped process is running:

- Type normally — every keystroke is forwarded to the child process exactly as if `ccx` weren't there.
- **Trigger with marker:** type `;;` at the end of your line, then press **Enter**. ccx enhances the line and replaces it in place — this first Enter does *not* submit.
- **Trigger with shortcut:** press **Alt+M** at any point on a non-empty line to enhance immediately without a marker.
- After enhancement, a Braille spinner animates while Gemini rewrites your prompt, then shows `✓ Enhanced` on success or `✗ error message` on failure.
- Review the rewritten line, then press **Enter** to submit it to the child process.
- A plain line with no trigger submits immediately on Enter, exactly as if `ccx` weren't there.
- Arrow keys, Ctrl+C, and other control sequences pass through untouched.
- **Multi-line prompts:** Shift+Enter adds a line break without submitting (same as in a plain Claude Code session).
  `ccx` tracks the whole multi-line prompt internally, so the marker/Alt+M trigger enhances the entire thing, and a
  multi-line rewrite gets spliced back in as multiple soft-broken lines rather than being submitted early.
- Typing ahead while a spinner is running (e.g. mashing Alt+M again) is queued and replayed once the enhancement
  finishes, instead of leaking into the child mid-rewrite. Ctrl+C still interrupts immediately even while enhancing.

### Changing the marker

Change `CCX_MARKER` via `ccx-init` or env var (default `;;`). No source changes needed.

## Testing it locally

1. `npm install`
2. `npm test` — runs the unit test suite (`node --test`) covering config loading, the Gemini client, and keystroke handling.
3. `npm link`
4. `ccx-init` — set up your real `GEMINI_API_KEY` (this validates the key and lets you pick a model live).
5. Sanity-check the relay mechanics with a safe command first, before pointing it at `claude`:

   ```bash
   ccx cmd        # Windows Command Prompt
   ccx powershell # or PowerShell
   ```

   You should see a completely normal shell. Type a sentence with a typo, e.g. `pls fix teh bug in server.js;;`,
   then press **Enter**. You should see a spinner flash briefly (`⠋ Enhancing prompt...`), then `✓ Enhanced`, then
   the line rewritten in place (e.g. `Please fix the bug in server.js`) with nothing submitted yet. Press Enter
   again to run it as a normal shell command.

6. Once the mechanics check out, run it against the real target:

   ```bash
   ccx claude
   ```

## Known limitations

- **Cursor position is tracked, including mid-line edits.** Left/Right/Home/End move an internal cursor that stays
  in sync with inserts, backspace-at-cursor, and both plain-byte and win32-input-mode key encodings — so arrowing
  back into the middle of a line and editing there is expected to work, including for the enhance trigger.
- **Byte-wise, not codepoint-wise.** Input is processed one byte at a time; multi-byte UTF-8 characters (accents,
  emoji, non-Latin scripts) may not round-trip through the buffer correctly, though they are still forwarded to the
  child untouched when you're not triggering enhancement.
- **Status bar display is best-effort.** `ccx` draws the spinner/result to the last row of the terminal via ANSI
  save/restore-cursor sequences. This works in standard ANSI/VT terminals (including the VS Code integrated
  terminal) but isn't guaranteed on every terminal emulator, and a terminal resize mid-animation could leave a
  stray line if the row count changes between draws.
- **The marker itself is reserved.** If you genuinely need a prompt to end with `;;` literally, either add a
  trailing space after it or change the marker to something you don't otherwise type (via `ccx-init` or `CCX_MARKER`).

## Windows-specific notes

- **`.cmd`/`.bat` shims:** `node-pty` spawns processes via Windows' `CreateProcess`, which cannot directly execute
  `.cmd`/`.bat` files (this is how `claude` and many other npm-installed global CLIs are shimmed on Windows). `ccx`
  works around this by routing the target command through `cmd.exe /c` on Windows. You shouldn't need to do anything
  differently — `ccx claude` just works — but if you add your own wrapped commands, keep in mind they're run via
  `cmd.exe`.
- **ConPTY vs. WSL:** on native Windows, `node-pty` uses ConPTY (Windows' native pseudoconsole API). This is
  different from running inside WSL, where `node-pty` behaves like it does on Linux/macOS (real PTYs). Resize
  events, signal delivery, and raw-mode behavior can differ subtly between the two — if you run `ccx` inside a WSL
  terminal instead of a native Windows one, treat it as a separate environment to re-test.
- **"win32-input-mode" can replace plain keys with escape sequences.** Some CLIs (Claude Code included) enable a
  ConPTY/Windows Terminal feature called win32-input-mode on startup, for full keyboard fidelity (e.g. to
  distinguish Enter from Shift+Enter). Once enabled, the *real* host terminal stops sending some keys as plain
  bytes and instead encodes them as `ESC[Vk;Sc;Uc;Kd;Cs;Rc_` (virtual-key code, scan code, Unicode char, key
  down/up flag, control-key state, repeat count) — this was observed for both Enter (`Vk=13`) and Backspace
  (`Vk=8`) while wrapping `claude`, arriving as a pair of sequences (key-down then key-up) in a single stdin read.
  `ccx` decodes this format specifically to recognize Enter and Backspace; if you see other keys behaving oddly
  when wrapping a different CLI on Windows, they may need the same treatment — check `parseWin32InputSeq` in
  `bin/ccx.js`.
- **Ctrl+C:** in raw mode with ConPTY's virtual-terminal input enabled, Ctrl+C arrives as byte `0x03` through stdin
  (like POSIX) rather than as a Windows console control event, so it's forwarded to the child like any other
  keystroke rather than killing `ccx` itself.

## Publishing

The npm package is named `ccx-relay` (`ccx` itself is already taken on npm). The command you run stays `ccx` — that
comes from the `bin` field, not the package name — so nothing about day-to-day usage changes.

```bash
npm login
npm publish
```

For subsequent releases:

```bash
npm version patch   # or minor / major
npm publish
```

`npm version patch` bumps the version in `package.json`, creates a git commit and tag (if this is a git repo), which
you can then push along with the new publish.
