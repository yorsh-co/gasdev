// @ts-check

/** An expected failure; its message is shown to the user without a stack trace. */
export class BundleError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'BundleError';
  }
}
