// @ts-check

const MIN_SECRET_LENGTH = 8;

/**
 * Collects every string leaf of at least 8 characters, recursively.
 *
 * @param {unknown} value
 * @returns {string[]} Unique secret values.
 */
export function secretValues(value) {
  /** @type {Set<string>} */
  const found = new Set();
  /** @param {unknown} node */
  const walk = (node) => {
    if (typeof node === 'string') {
      if (node.length >= MIN_SECRET_LENGTH) {
        found.add(node);
      }
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return [...found];
}

/**
 * @param {string[]} values
 * @returns {(text: string) => string} Replaces each value, longest first, with `***`.
 */
export function createRedactor(values) {
  const ordered = [...values].sort((a, b) => b.length - a.length);
  return (text) =>
    ordered.reduce((out, value) => out.split(value).join('***'), text);
}

/**
 * Escapes a value for a workflow command, so a literal `%0A` is not decoded.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeCommand(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

/**
 * @param {string[]} values
 * @returns {string[]} Unique GitHub Actions `::add-mask::` lines. Multi-line
 * values are masked line by line, since a command masks a single line only.
 */
export function maskCommands(values) {
  const masks = values.flatMap((value) =>
    /\r?\n/.test(value)
      ? value.split(/\r?\n/).filter((line) => line !== '')
      : [value],
  );
  return [...new Set(masks)].map(
    (mask) => `::add-mask::${escapeCommand(mask)}`,
  );
}
