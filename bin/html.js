// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';

/**
 * @typedef {import('./check.js').HtmlEntry} HtmlEntry
 */

/**
 * @typedef {object} Attribute
 * @property {string} name Lower-cased attribute name.
 * @property {string | null} value Unquoted value; `null` when the attribute has none.
 * @property {string} raw The attribute exactly as written.
 */

/**
 * @typedef {object} StartTag
 * @property {string} name Lower-cased tag name.
 * @property {Attribute[]} attributes
 * @property {boolean} selfClosing Whether the tag ends in `/>`.
 * @property {number} end Index just after the closing `>`.
 */

/** Raised for an HTML build problem that prevents the output from being produced. */
export class HtmlError extends Error {}

/** Elements without content or closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is text, never markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/** Matches a reference with a URL scheme (`https:`, `data:`) or a protocol-relative one. */
const EXTERNAL_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const TAG_NAME = /<([a-z][^\s/>]*)/iy;

/**
 * Compiler options of `tsconfig/web.json` that affect emit. Browser scripts are
 * classic global scripts, so there is no module system.
 *
 * @type {import('typescript').CompilerOptions}
 */
const TRANSPILE_OPTIONS = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.None,
};

/**
 * Parses the start tag that begins at `start`, which must point at `<`.
 *
 * @param {string} html
 * @param {number} start
 * @returns {StartTag}
 * @throws {HtmlError} When the tag is never closed.
 */
function parseStartTag(html, start) {
  TAG_NAME.lastIndex = start;
  const match = /** @type {RegExpExecArray} */ (TAG_NAME.exec(html));
  const name = (match[1] ?? '').toLowerCase();
  let i = TAG_NAME.lastIndex;
  /** @type {Attribute[]} */
  const attributes = [];
  let selfClosing = false;
  for (;;) {
    while (i < html.length && /[\s]/.test(html.charAt(i))) i++;
    const char = html.charAt(i);
    if (i >= html.length) {
      throw new HtmlError(`unterminated <${name}> tag in HTML`);
    }
    if (char === '>') return { name, attributes, selfClosing, end: i + 1 };
    if (char === '/') {
      selfClosing = html.charAt(i + 1) === '>';
      i++;
      continue;
    }
    const attrStart = i;
    while (i < html.length && !/[\s=/>]/.test(html.charAt(i))) i++;
    if (i === attrStart) i++;
    const attrName = html.slice(attrStart, i).toLowerCase();
    let j = i;
    while (j < html.length && /\s/.test(html.charAt(j))) j++;
    /** @type {string | null} */
    let value = null;
    if (html.charAt(j) === '=') {
      j++;
      while (j < html.length && /\s/.test(html.charAt(j))) j++;
      const quote = html.charAt(j);
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, j + 1);
        if (close === -1) {
          throw new HtmlError(`unterminated <${name}> tag in HTML`);
        }
        value = html.slice(j + 1, close);
        i = close + 1;
      } else {
        const valueStart = j;
        while (j < html.length && !/[\s>]/.test(html.charAt(j))) j++;
        value = html.slice(valueStart, j);
        i = j;
      }
    }
    attributes.push({ name: attrName, value, raw: html.slice(attrStart, i) });
  }
}

/**
 * @param {Attribute[]} attributes
 * @param {string} name
 * @returns {string | null} The first value of the attribute, if it has one.
 */
function attribute(attributes, name) {
  return attributes.find((a) => a.name === name)?.value ?? null;
}

/**
 * Finds where the element opened by `tag` (at `start`) ends: the end of its
 * closing tag for raw-text elements, and of the matching one for others.
 *
 * @param {string} html
 * @param {number} start
 * @param {StartTag} tag
 * @returns {{ contentEnd: number, end: number }} Content end and the index after the closing tag.
 * @throws {HtmlError} When a non-raw element is never closed.
 */
function findClosingTag(html, start, tag) {
  const pattern = new RegExp(`<(/?)${tag.name}(?=[\\s/>])`, 'gi');
  pattern.lastIndex = tag.end;
  const raw = RAW_TEXT_ELEMENTS.has(tag.name);
  let depth = 1;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    if (m[1] === '') {
      if (raw) continue;
      if (!parseStartTag(html, m.index).selfClosing) depth++;
      continue;
    }
    if (--depth === 0) {
      const close = html.indexOf('>', m.index);
      return {
        contentEnd: m.index,
        end: close === -1 ? html.length : close + 1,
      };
    }
  }
  if (raw) return { contentEnd: html.length, end: html.length };
  throw new HtmlError(
    `<${tag.name}> at offset ${start} has no closing tag in HTML`,
  );
}

/**
 * Reads a project file referenced from an entry.
 *
 * @param {string} cwd
 * @param {string} entry Referencing HTML file.
 * @param {string} path Project-relative POSIX path.
 * @returns {string} The text with LF line endings.
 * @throws {HtmlError} When the file does not exist.
 */
function readSource(cwd, entry, path) {
  const file = resolve(cwd, path);
  if (!existsSync(file)) {
    throw new HtmlError(`${path} not found (referenced by ${entry})`);
  }
  return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

/**
 * Resolves a local reference against the directory of the entry.
 *
 * @param {string} entry
 * @param {string} reference
 * @returns {string} Project-relative POSIX path.
 * @throws {HtmlError} For a root-relative reference, which has no defined base.
 */
function resolveReference(entry, reference) {
  if (reference.startsWith('/')) {
    throw new HtmlError(
      `${entry}: "${reference}" must be relative to the HTML file, not absolute`,
    );
  }
  return posix.join(posix.dirname(entry), reference);
}

/**
 * Loads the code of a local script: the `.ts` next to a referenced `.js` is
 * transpiled (without type-checking), otherwise the file is used as is.
 *
 * @param {string} cwd
 * @param {string} entry
 * @param {string} path Project-relative path of the referenced file.
 * @returns {{ file: string, code: string }} Source file used and the code to inline.
 * @throws {HtmlError} When neither file exists, or the reference is a `.ts` file.
 */
function loadScript(cwd, entry, path) {
  if (path.endsWith('.ts')) {
    const js = path.replace(/\.ts$/, '.js');
    throw new HtmlError(
      `${entry}: reference ${posix.basename(js)}, not ${posix.basename(path)} (the .ts source is transpiled automatically)`,
    );
  }
  const tsPath = path.replace(/\.js$/, '.ts');
  if (tsPath !== path && existsSync(resolve(cwd, tsPath))) {
    const { outputText } = ts.transpileModule(readSource(cwd, entry, tsPath), {
      compilerOptions: TRANSPILE_OPTIONS,
      fileName: tsPath,
    });
    return { file: tsPath, code: outputText };
  }
  return { file: path, code: readSource(cwd, entry, path) };
}

/**
 * Wraps code in an element, rejecting content that would end it early.
 *
 * @param {string} open Opening tag.
 * @param {string} close Closing tag name, without brackets.
 * @param {string} code
 * @param {string} file Source file named in the error.
 * @returns {string}
 * @throws {HtmlError} When the code contains the closing tag.
 */
function wrap(open, close, code, file) {
  if (new RegExp(`</${close}`, 'i').test(code)) {
    throw new HtmlError(`${file} contains </${close}, so it cannot be inlined`);
  }
  return `${open}\n${code.replace(/\n+$/, '')}\n</${close}>`;
}

/**
 * Inlines the local stylesheets and scripts of an HTML page and removes the
 * elements marked `data-dev-only`, unless `dev` is set. Tags inside comments,
 * scripts and styles are left alone.
 *
 * @param {string} cwd Project root.
 * @param {string} entry Project-relative POSIX path of the HTML file.
 * @param {{ dev?: boolean }} [options] With `dev`, `data-dev-only` elements are
 *   kept and processed like any other.
 * @returns {string} The inlined page.
 * @throws {HtmlError} When a referenced file is missing or cannot be inlined.
 */
export function inlinePage(cwd, entry, { dev = false } = {}) {
  const html = readSource(cwd, entry, entry);
  let out = '';
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf('<', i);
    if (start === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, start);
    if (html.startsWith('<!--', start)) {
      const close = html.indexOf('-->', start + 4);
      i = close === -1 ? html.length : close + 3;
      out += html.slice(start, i);
      continue;
    }
    TAG_NAME.lastIndex = start;
    if (!TAG_NAME.test(html)) {
      out += '<';
      i = start + 1;
      continue;
    }
    const tag = parseStartTag(html, start);
    const { name, attributes } = tag;
    const devOnly = !dev && attributes.some((a) => a.name === 'data-dev-only');
    // Raw-text elements are always skipped as a unit; other elements only
    // when they are removed together with their content.
    const hasContent =
      !VOID_ELEMENTS.has(name) &&
      (RAW_TEXT_ELEMENTS.has(name) || (devOnly && !tag.selfClosing));
    const element = hasContent ? findClosingTag(html, start, tag) : undefined;
    i = element?.end ?? tag.end;
    if (devOnly) continue;

    const src = attribute(attributes, 'src');
    const href = attribute(attributes, 'href');
    const rel = (attribute(attributes, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (name === 'script' && src && !EXTERNAL_URL.test(src)) {
      const { file, code } = loadScript(
        cwd,
        entry,
        resolveReference(entry, src),
      );
      const kept = attributes.filter((a) => a.name !== 'src');
      out += wrap(
        `<script${kept.map((a) => ` ${a.raw}`).join('')}>`,
        'script',
        code,
        file,
      );
    } else if (
      name === 'link' &&
      rel.includes('stylesheet') &&
      href &&
      !EXTERNAL_URL.test(href)
    ) {
      const path = resolveReference(entry, href);
      const media = attributes.find((a) => a.name === 'media');
      out += wrap(
        `<style${media ? ` ${media.raw}` : ''}>`,
        'style',
        readSource(cwd, entry, path),
        path,
      );
    } else {
      out += html.slice(start, i);
    }
  }
  return out;
}

/**
 * Produces the generated TypeScript file of an entry.
 *
 * @param {string} cwd Project root.
 * @param {HtmlEntry} config
 * @returns {string} The file contents, with LF line endings and a trailing newline.
 * @throws {HtmlError} When the page cannot be built.
 */
export function generateModule(cwd, { entry, name }) {
  const page = JSON.stringify(inlinePage(cwd, entry))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return [
    `// Generated by \`gasdev html\` from ${entry}. Do not edit.`,
    '// prettier-ignore',
    `const ${name}: string = ${page};`,
    '',
  ].join('\n');
}

/**
 * Compares the generated file of an entry with the one on disk.
 *
 * @param {string} cwd Project root.
 * @param {HtmlEntry} config
 * @returns {'current' | 'stale' | 'missing'}
 * @throws {HtmlError} When the page cannot be built.
 */
export function compareModule(cwd, config) {
  const expected = generateModule(cwd, config);
  const file = resolve(cwd, config.out);
  if (!existsSync(file)) return 'missing';
  return readFileSync(file, 'utf8') === expected ? 'current' : 'stale';
}

/**
 * `html`: writes the generated files, or with `check` only reports stale ones.
 *
 * @param {string} cwd Project root.
 * @param {HtmlEntry[] | undefined} entries Configured `gasdev.html`.
 * @param {{ check: boolean }} options
 * @returns {number} The exit code.
 * @throws {HtmlError} When `html` is not configured or a page cannot be built.
 */
export function runHtml(cwd, entries, { check }) {
  if (entries === undefined) {
    throw new HtmlError('package.json: "gasdev.html" is not configured');
  }
  if (check) {
    const stale = entries.filter((e) => compareModule(cwd, e) !== 'current');
    for (const { out } of stale) {
      process.stderr.write(`${out} is out of date: run gasdev html\n`);
    }
    if (stale.length === 0)
      process.stdout.write('✓ HTML build is up to date\n');
    return stale.length === 0 ? 0 : 1;
  }
  for (const config of entries) {
    const file = resolve(cwd, config.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generateModule(cwd, config));
    process.stdout.write(`✓ Generated ${config.out}\n`);
  }
  return 0;
}
