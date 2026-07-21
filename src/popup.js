// Self-contained popup for clean multi-line prompt input.
// Owns its own raw-mode data listener — no shadow buffer, no drift.

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

// ── Win32 / CSI parsers (inlined to keep popup self-contained) ────────────────
function parseW32(buf, i) {
  if (buf[i + 1] !== 0x5b) return null;
  let j = i + 2;
  while (j < buf.length && ((buf[j] >= 0x30 && buf[j] <= 0x39) || buf[j] === 0x3b)) j++;
  if (j >= buf.length || buf[j] !== 0x5f || j === i + 2) return null;
  const parts = buf.slice(i + 2, j).toString('ascii').split(';').map(Number);
  if (parts.length !== 6 || parts.some(Number.isNaN)) return null;
  const [vk, sc, uc, kd, cs] = parts;
  return { consumed: j + 1 - i, vk, kd, cs };
}

function parseCsi(buf, i) {
  if (buf[i + 1] !== 0x5b) return null;
  let j = i + 2;
  while (j < buf.length && buf[j] >= 0x20 && buf[j] <= 0x3f) j++;
  if (j >= buf.length || buf[j] < 0x40 || buf[j] > 0x7e) return null;
  return { consumed: j + 1 - i, params: buf.slice(i + 2, j).toString('ascii'), final: String.fromCharCode(buf[j]) };
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(lines, cursorLine, cursorCol) {
  const cols  = Math.max((process.stdout.columns || 80) - 2, 20);
  const rows  = process.stdout.rows || 24;
  const MAX_VISIBLE = 8;
  const visLines    = lines.length;
  const popupH      = Math.min(visLines, MAX_VISIBLE) + 2; // header + content rows + footer hint
  const startRow    = Math.max(1, rows - popupH);

  // Show last MAX_VISIBLE lines
  const offset   = Math.max(0, visLines - MAX_VISIBLE);
  const visible  = lines.slice(offset);
  const relLine  = cursorLine - offset; // cursor row within visible slice

  const hint = `${c.dim}Shift+Enter: new line  ·  Ctrl+C / Esc: cancel${c.reset}`;
  const bar  = '─'.repeat(cols);

  let out = '\x1b[s'; // save cursor

  // Header
  out += `\x1b[${startRow};1H\x1b[2K`;
  out += `${c.cyan}◆${c.reset} ${c.bold}Enhance${c.reset}  ${hint}`;

  // Separator
  out += `\x1b[${startRow + 1};1H\x1b[2K${c.gray}${bar}${c.reset}`;

  // Content lines
  for (let r = 0; r < visible.length; r++) {
    out += `\x1b[${startRow + 2 + r};1H\x1b[2K`;
    out += `${c.gray}▶${c.reset} ${visible[r]}`;
  }

  // Position cursor
  const curRow = startRow + 2 + relLine;
  const curCol = 3 + cursorCol; // 3 = "▶ " prefix width
  out += `\x1b[${curRow};${curCol}H`;

  return out;
}

function clearArea(lines) {
  const rows   = process.stdout.rows || 24;
  const MAX_V  = 8;
  const popupH = Math.min(lines.length, MAX_V) + 2;
  const start  = Math.max(1, rows - popupH);
  let out = '';
  for (let r = start; r <= rows; r++) out += `\x1b[${r};1H\x1b[2K`;
  out += '\x1b[u'; // restore original cursor
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────
// Returns: string (the composed text) or null (cancelled).
export function openPopup() {
  return new Promise(resolve => {
    // State
    const lines  = [''];   // array of line strings
    let curLine  = 0;      // which line cursor is on
    let curCol   = 0;      // column within that line
    let inPaste  = false;

    function line()  { return lines[curLine]; }
    function redraw() { process.stdout.write(render(lines, curLine, curCol)); }

    function done(result) {
      process.stdout.write(clearArea(lines));
      process.stdin.removeListener('data', onData);
      resolve(result && result.trim() ? result : null);
    }

    function insertChar(ch) {
      lines[curLine] = line().slice(0, curCol) + ch + line().slice(curCol);
      curCol++;
    }

    function backspace() {
      if (curCol > 0) {
        lines[curLine] = line().slice(0, curCol - 1) + line().slice(curCol);
        curCol--;
      } else if (curLine > 0) {
        // Merge with previous line
        const prev = lines[curLine - 1];
        curCol = prev.length;
        lines[curLine - 1] = prev + lines[curLine];
        lines.splice(curLine, 1);
        curLine--;
      }
    }

    function newLine() {
      // Split current line at cursor
      const before = line().slice(0, curCol);
      const after  = line().slice(curCol);
      lines[curLine] = before;
      lines.splice(curLine + 1, 0, after);
      curLine++;
      curCol = 0;
    }

    redraw();

    function onData(buf) {
      let i = 0;
      while (i < buf.length) {
        const byte = buf[i];

        // ── ESC sequences ──
        if (byte === 0x1b) {
          // Win32 input mode
          const w = parseW32(buf, i);
          if (w && w.kd === 1) {
            i += w.consumed;
            switch (w.vk) {
              case 13: // Enter / Shift+Enter
                if (w.cs & 0x0010) { newLine(); redraw(); }
                else { done(lines.join('\n')); return; }
                break;
              case 8:  // Backspace
                backspace(); redraw(); break;
              case 37: // Left
                if (curCol > 0) { curCol--; redraw(); }
                break;
              case 39: // Right
                if (curCol < line().length) { curCol++; redraw(); }
                break;
              case 36: // Home
                curCol = 0; redraw(); break;
              case 35: // End
                curCol = line().length; redraw(); break;
              case 27: // Esc
                done(null); return;
            }
            continue;
          }

          // CSI sequences
          const csi = parseCsi(buf, i);
          if (csi) {
            i += csi.consumed;
            if      (csi.final === 'D' && !csi.params) { if (curCol > 0) { curCol--; redraw(); } }
            else if (csi.final === 'C' && !csi.params) { if (curCol < line().length) { curCol++; redraw(); } }
            else if (csi.final === 'H' && !csi.params) { curCol = 0; redraw(); }
            else if (csi.final === 'F' && !csi.params) { curCol = line().length; redraw(); }
            else if (csi.final === '~' && csi.params === '200') { inPaste = true; }
            else if (csi.final === '~' && csi.params === '201') { inPaste = false; }
            continue;
          }

          // ESC alone → cancel
          if (i + 1 >= buf.length || buf[i + 1] < 0x20) { done(null); return; }
          i += 2; // skip unknown ESC+byte
          continue;
        }

        // ── CR ──
        if (byte === 0x0d) {
          i++;
          if (inPaste) {
            newLine();
            if (i < buf.length && buf[i] === 0x0a) i++; // skip CRLF's LF
            redraw();
          } else {
            done(lines.join('\n')); return;
          }
          continue;
        }

        // ── LF ──
        if (byte === 0x0a) {
          i++;
          if (inPaste) { newLine(); redraw(); }
          continue;
        }

        // ── Ctrl+C ──
        if (byte === 0x03) { done(null); return; }

        // ── Ctrl+U (clear line) ──
        if (byte === 0x15) {
          lines[curLine] = line().slice(curCol);
          curCol = 0;
          i++; redraw(); continue;
        }

        // ── Ctrl+W (delete word) ──
        if (byte === 0x17) {
          let s = line().slice(0, curCol);
          s = s.replace(/\S+\s*$/, '');
          lines[curLine] = s + line().slice(curCol);
          curCol = s.length;
          i++; redraw(); continue;
        }

        // ── Ctrl+A / Ctrl+E ──
        if (byte === 0x01) { curCol = 0; i++; redraw(); continue; }
        if (byte === 0x05) { curCol = line().length; i++; redraw(); continue; }

        // ── Backspace ──
        if (byte === 0x7f || byte === 0x08) { backspace(); i++; redraw(); continue; }

        // ── Printable ──
        if (byte >= 0x20) {
          insertChar(String.fromCharCode(byte));
          i++; redraw(); continue;
        }

        i++; // skip unknown control byte
      }
    }

    process.stdin.on('data', onData);
  });
}
