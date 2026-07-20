const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL = 80;

let spinnerInterval = null;
let currentFrame = 0;

function drawStatusLine(content) {
  const row = process.stdout.rows || 24;
  process.stderr.write(`\x1b[s\x1b[${row};1H\x1b[2K${content}\x1b[u`);
}

export function start() {
  currentFrame = 0;
  if (spinnerInterval) clearInterval(spinnerInterval);
  spinnerInterval = setInterval(() => {
    const frame = BRAILLE_FRAMES[currentFrame % BRAILLE_FRAMES.length];
    drawStatusLine(`${frame} Enhancing prompt...`);
    currentFrame++;
  }, FRAME_INTERVAL);
}

export async function stop(state, message) {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  const symbol = state === 'success' ? '✓' : '✗';
  const colorCode = state === 'success' ? '32' : '31';
  drawStatusLine(`\x1b[${colorCode}m${symbol} ${message}\x1b[0m`);
  await new Promise(r => setTimeout(r, 400));
  drawStatusLine('');
}

export function clear() {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
  drawStatusLine('');
}
