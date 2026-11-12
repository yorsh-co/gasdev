// @ts-check
import { BundleError } from './errors.js';

/**
 * Orders libraries so that a peer loads before the library using it. Only peers that are
 * configured count; ties keep the configured order.
 *
 * @param {string[]} names Library names in config order.
 * @param {Record<string, string[]>} peers Peer names by library name.
 * @returns {string[]}
 * @throws {BundleError} Naming the libraries involved in a dependency cycle.
 */
export function orderLibraries(names, peers) {
  const pending = new Set(names);
  /** @type {string[]} */
  const ordered = [];
  while (pending.size > 0) {
    const next = names.find(
      (name) =>
        pending.has(name) &&
        (peers[name] ?? []).every(
          (peer) => peer === name || !pending.has(peer),
        ),
    );
    if (next === undefined) {
      throw new BundleError(
        `Peer dependency cycle between ${names.filter((name) => pending.has(name)).join(', ')}.`,
      );
    }
    pending.delete(next);
    ordered.push(next);
  }
  return ordered;
}
