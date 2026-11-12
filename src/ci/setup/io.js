// @ts-check
import { styleText } from 'node:util';
import prompts from 'prompts';
import { CancelledError } from '../errors.js';

/**
 * @typedef {object} Log
 * @property {(message: string) => void} info
 * @property {(message: string) => void} success
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 * @property {(message: string) => void} raw Unstyled line on stdout.
 * @property {(title: string) => void} section
 */

/**
 * @typedef {object} Io
 * @property {Log} log
 * @property {(questions: prompts.PromptObject | prompts.PromptObject[]) => Promise<prompts.Answers<string>>} prompt
 */

/**
 * Minimal writer accepted by the helpers. Color is applied only when the
 * writer is a Node.js stream; any other writer receives plain text.
 *
 * @typedef {{ write: (text: string) => unknown }} Writer
 */

/**
 * Whether `styleText` accepts the writer as a stream (it requires a write
 * function together with an `on` function, as for Node.js streams).
 *
 * @param {Writer} writer
 * @returns {boolean}
 */
function isStream(writer) {
  const candidate = /** @type {{ on?: unknown }} */ (writer);
  return typeof candidate.on === 'function';
}

/**
 * Creates the console helpers used by the wizard.
 *
 * @param {object} [streams]
 * @param {Writer} [streams.stdout]
 * @param {Writer} [streams.stderr]
 * @returns {Io}
 */
export function createIo({
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  /**
   * @param {Writer} stream
   * @param {Parameters<typeof styleText>[0]} format
   * @param {string} text
   * @returns {string}
   */
  const style = (stream, format, text) =>
    isStream(stream)
      ? styleText(format, text, {
          stream: /** @type {NodeJS.WriteStream} */ (stream),
        })
      : text;

  /**
   * @param {Writer} stream
   * @param {Parameters<typeof styleText>[0]} format
   * @param {string} prefix
   * @returns {(message: string) => void}
   */
  const line = (stream, format, prefix) => (message) => {
    stream.write(`${style(stream, format, `${prefix}${message}`)}\n`);
  };

  return {
    log: {
      info: line(stdout, 'cyan', ''),
      success: line(stdout, 'green', '✓ '),
      warn: line(stderr, 'yellow', 'Warning: '),
      error: line(stderr, 'red', '✖ '),
      raw: (message) => {
        stdout.write(`${message}\n`);
      },
      section: (title) => {
        stdout.write(`\n${style(stdout, 'bold', title)}\n`);
      },
    },
    prompt: (questions) =>
      prompts(questions, {
        onCancel: () => {
          throw new CancelledError();
        },
      }),
  };
}
