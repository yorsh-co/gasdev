// @ts-check

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;
const CLEAR_LINE = '\r\x1b[2K';

/**
 * @typedef {object} Spinner
 * @property {(text: string) => void} update Changes the spinner text and redraws.
 * @property {() => void} stop Stops the animation and clears the line. Idempotent.
 */

/**
 * Starts a terminal spinner. Does nothing unless `stream` is a TTY, so piped
 * and CI output stays unchanged.
 * @param {{ isTTY?: boolean, write(chunk: string): unknown }} stream
 * @param {string} text Initial text shown next to the spinner.
 * @returns {Spinner}
 */
export function startSpinner(stream, text) {
  if (!stream.isTTY) {
    return { update() {}, stop() {} };
  }

  let current = text;
  let frame = 0;
  let stopped = false;

  const draw = () => {
    stream.write(`${CLEAR_LINE}${FRAMES[frame]} ${current}`);
  };

  draw();
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    draw();
  }, INTERVAL_MS);
  timer.unref();

  return {
    update(next) {
      if (stopped) return;
      current = next;
      draw();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      stream.write(CLEAR_LINE);
    },
  };
}
