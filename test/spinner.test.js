import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSpinner } from '../src/spinner.js';

/**
 * @param {boolean} isTTY
 */
function fakeStream(isTTY) {
  /** @type {string[]} */
  const writes = [];
  return {
    isTTY,
    writes,
    write: (/** @type {string} */ chunk) => writes.push(chunk),
  };
}

describe('startSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes nothing when the stream is not a TTY', () => {
    const stream = fakeStream(false);
    const spinner = startSpinner(stream, 'Working...');
    spinner.update('Still working...');
    vi.advanceTimersByTime(500);
    spinner.stop();
    expect(stream.writes).toEqual([]);
  });

  it('writes the first frame and text on start', () => {
    const stream = fakeStream(true);
    startSpinner(stream, 'Working...').stop();
    expect(stream.writes[0]).toBe('\r\x1b[2K⠋ Working...');
  });

  it('advances the frame every 80 ms', () => {
    const stream = fakeStream(true);
    const spinner = startSpinner(stream, 'Working...');
    vi.advanceTimersByTime(80);
    expect(stream.writes.at(-1)).toBe('\r\x1b[2K⠙ Working...');
    spinner.stop();
  });

  it('redraws with the new text on update', () => {
    const stream = fakeStream(true);
    const spinner = startSpinner(stream, 'Working...');
    spinner.update('Pushing...');
    expect(stream.writes.at(-1)).toBe('\r\x1b[2K⠋ Pushing...');
    spinner.stop();
  });

  it('clears the line once on stop and stays silent afterwards', () => {
    const stream = fakeStream(true);
    const spinner = startSpinner(stream, 'Working...');
    spinner.stop();
    const count = stream.writes.length;
    expect(stream.writes.at(-1)).toBe('\r\x1b[2K');
    vi.advanceTimersByTime(500);
    spinner.stop();
    spinner.update('ignored');
    expect(stream.writes).toHaveLength(count);
  });
});
