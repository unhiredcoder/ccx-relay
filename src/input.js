/**
 * src/input.js — pure stdin parser with Alt+M and ;; triggers
 * No fetch, no stderr writes, no process.exit
 */

/**
 * Parses ESC [ {digits/semicolons} _ sequences (win32-input-mode)
 * Returns { consumed, vk, sc, uc, kd, cs, rc } or null
 * @param {Buffer} chunk
 * @param {number} i  - index of ESC byte
 */
function parseWin32InputSeq(chunk, i) {
  if (chunk[i + 1] !== 0x5b) return null;
  let j = i + 2;
  const start = j;
  while (j < chunk.length && ((chunk[j] >= 0x30 && chunk[j] <= 0x39) || chunk[j] === 0x3b)) j++;
  if (j >= chunk.length || chunk[j] !== 0x5f || j === start) return null;
  const parts = chunk.slice(start, j).toString('ascii').split(';').map(Number);
  if (parts.length !== 6 || parts.some(Number.isNaN)) return null;
  const [vk, sc, uc, kd, cs, rc] = parts;
  return { consumed: j + 1 - i, vk, sc, uc, kd, cs, rc };
}

/**
 * @param {{ marker: string, onEnhance: Function, onSubmit: Function, onPassthrough: Function, onCtrlC: Function }} opts
 * @returns {{ processChunk(chunk: Buffer): void, setBusy(b: boolean): void, reset(): void }}
 */
export function createInputHandler({ marker, onEnhance, onSubmit, onPassthrough, onCtrlC }) {
  let lineBuffer = '';
  let busy = false;

  function reset() {
    lineBuffer = '';
    busy = false;
  }

  function setBusy(b) {
    busy = b;
  }

  function processChunk(chunk) {
    // When busy, forward everything as-is
    if (busy) {
      onPassthrough(chunk);
      return;
    }

    let i = 0;
    while (i < chunk.length) {
      const byte = chunk[i];

      if (byte === 0x1b) {
        // Try win32-input-mode sequence first
        const seq = parseWin32InputSeq(chunk, i);
        if (seq !== null) {
          if (seq.kd === 1) {
            if (seq.vk === 13) {
              // Win32 Enter
              if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
                onEnhance(lineBuffer);
                return;
              } else {
                onSubmit(lineBuffer);
                lineBuffer = '';
              }
            } else if (seq.vk === 8) {
              // Win32 Backspace
              if (lineBuffer.length > 0) lineBuffer = lineBuffer.slice(0, -1);
            } else if (seq.vk === 77 && (seq.cs & (0x0001 | 0x0002))) {
              // Win32 Alt+M
              if (lineBuffer.length > 0) {
                onEnhance(lineBuffer);
                return;
              }
            }
          }
          onPassthrough(chunk.slice(i, i + seq.consumed));
          i += seq.consumed;
          continue;
        }

        // No win32 sequence — check for standard Alt+M (ESC followed by 0x6d)
        if (i + 1 < chunk.length && chunk[i + 1] === 0x6d) {
          if (lineBuffer.length > 0) {
            onEnhance(lineBuffer);
            return;
          } else {
            onPassthrough(chunk.slice(i, i + 2));
            i += 2;
          }
        } else {
          // Forward rest untouched
          onPassthrough(chunk.slice(i));
          return;
        }
      } else if (byte === 0x0d) {
        // Enter
        if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
          onEnhance(lineBuffer);
          return;
        } else {
          onSubmit(lineBuffer);
          onPassthrough(Buffer.from([byte]));
          lineBuffer = '';
        }
        i++;
      } else if (byte === 0x03) {
        // Ctrl+C
        onCtrlC();
        onPassthrough(Buffer.from([byte]));
        lineBuffer = '';
        i++;
      } else if (byte === 0x7f || byte === 0x08) {
        // Backspace
        lineBuffer = lineBuffer.slice(0, -1);
        onPassthrough(Buffer.from([byte]));
        i++;
      } else {
        // Printable char
        lineBuffer += String.fromCharCode(byte);
        onPassthrough(Buffer.from([byte]));
        i++;
      }
    }
  }

  return { processChunk, setBusy, reset };
}
