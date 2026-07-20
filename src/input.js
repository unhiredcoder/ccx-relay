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

// Parses standard CSI sequences: ESC [ params final
function parseCsiSeq(chunk, i) {
  if (i + 1 >= chunk.length || chunk[i + 1] !== 0x5b) return null;
  let j = i + 2;
  while (j < chunk.length && chunk[j] >= 0x20 && chunk[j] <= 0x3f) j++;
  if (j >= chunk.length || chunk[j] < 0x40 || chunk[j] > 0x7e) return null;
  const params = chunk.slice(i + 2, j).toString('ascii');
  const final = String.fromCharCode(chunk[j]);
  return { consumed: j + 1 - i, params, final };
}

export function createInputHandler({ marker, onEnhance, onSubmit, onPassthrough, onCtrlC }) {
  let lineBuffer = '';
  let cursor = 0;
  let busy = false;

  function reset() {
    lineBuffer = '';
    cursor = 0;
    busy = false;
  }

  function setBusy(b) {
    busy = b;
  }

  // Sync internal buffer after external rewrite (e.g. after enhancement)
  function setLine(str) {
    lineBuffer = str;
    cursor = str.length;
  }

  function processChunk(chunk) {
    if (busy) { onPassthrough(chunk); return; }

    let i = 0;
    while (i < chunk.length) {
      const byte = chunk[i];

      if (byte === 0x1b) {
        // 1. Win32 input mode sequence
        const seq = parseWin32InputSeq(chunk, i);
        if (seq !== null) {
          if (seq.kd === 1) {
            if (seq.vk === 13) {
              if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
                onEnhance(lineBuffer, cursor);
                return;
              } else {
                onSubmit(lineBuffer);
                lineBuffer = '';
                cursor = 0;
              }
            } else if (seq.vk === 8) {
              if (cursor > 0) {
                lineBuffer = lineBuffer.slice(0, cursor - 1) + lineBuffer.slice(cursor);
                cursor--;
              }
            } else if (seq.vk === 37) {
              cursor = Math.max(0, cursor - 1);
            } else if (seq.vk === 39) {
              cursor = Math.min(lineBuffer.length, cursor + 1);
            } else if (seq.vk === 36) {
              cursor = 0;
            } else if (seq.vk === 35) {
              cursor = lineBuffer.length;
            } else if (seq.vk === 77 && (seq.cs & (0x0001 | 0x0002)) && !(seq.cs & (0x0004 | 0x0008))) {
              if (lineBuffer.length > 0) { onEnhance(lineBuffer, cursor); return; }
            }
          }
          onPassthrough(chunk.slice(i, i + seq.consumed));
          i += seq.consumed;
          continue;
        }

        // 2. Alt+M (ESC m)
        if (i + 1 < chunk.length && chunk[i + 1] === 0x6d) {
          if (lineBuffer.length > 0) {
            onEnhance(lineBuffer, cursor);
            return;
          } else {
            onPassthrough(chunk.slice(i, i + 2));
            i += 2;
          }
          continue;
        }

        // 3. Standard CSI sequences (arrows, Home, End, etc.)
        const csi = parseCsiSeq(chunk, i);
        if (csi !== null) {
          if      (csi.final === 'D' && !csi.params) cursor = Math.max(0, cursor - 1);
          else if (csi.final === 'C' && !csi.params) cursor = Math.min(lineBuffer.length, cursor + 1);
          else if (csi.final === 'H' && !csi.params) cursor = 0;
          else if (csi.final === 'F' && !csi.params) cursor = lineBuffer.length;
          else if (csi.final === '~' && csi.params === '1') cursor = 0;
          else if (csi.final === '~' && csi.params === '4') cursor = lineBuffer.length;
          onPassthrough(chunk.slice(i, i + csi.consumed));
          i += csi.consumed;
          continue;
        }

        // 4. Unknown ESC sequence — forward rest of chunk
        onPassthrough(chunk.slice(i));
        return;
      } else if (byte === 0x0d) {
        if (lineBuffer.endsWith(marker) && lineBuffer.trim().length > marker.length) {
          onEnhance(lineBuffer, cursor);
          return;
        } else {
          onSubmit(lineBuffer);
          onPassthrough(Buffer.from([byte]));
          lineBuffer = '';
          cursor = 0;
        }
        i++;
      } else if (byte === 0x03) {
        onCtrlC();
        onPassthrough(Buffer.from([byte]));
        lineBuffer = '';
        cursor = 0;
        i++;
      } else if (byte === 0x7f || byte === 0x08) {
        if (cursor > 0) {
          lineBuffer = lineBuffer.slice(0, cursor - 1) + lineBuffer.slice(cursor);
          cursor--;
        }
        onPassthrough(Buffer.from([byte]));
        i++;
      } else {
        lineBuffer = lineBuffer.slice(0, cursor) + String.fromCharCode(byte) + lineBuffer.slice(cursor);
        cursor++;
        onPassthrough(Buffer.from([byte]));
        i++;
      }
    }
  }

  return { processChunk, setBusy, reset, setLine };
}
