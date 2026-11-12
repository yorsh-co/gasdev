import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HtmlError, generateModule, inlinePage } from '../bin/html.js';
import { REPO_ROOT } from './support.js';

const BIN = join(REPO_ROOT, 'bin', 'gasdev.js');
const APP = join(REPO_ROOT, 'test', 'fixtures', 'html', 'app');
const OUT = 'src/generated/app.html.ts';
const CONFIG = { entry: 'src/web/app.html', out: OUT, name: '_APP_HTML' };

/** @type {string[]} */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} A copy of the `app` fixture. */
function createApp() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-html-'));
  dirs.push(dir);
  cpSync(APP, dir, { recursive: true });
  return dir;
}

/**
 * Creates a project whose entry is `src/web/app.html`.
 *
 * @param {string} html Entry contents.
 * @param {Record<string, string>} [files] Other files by project-relative path.
 * @returns {string} Project directory.
 */
function createPage(html, files = {}) {
  const dir = createApp();
  rmSync(join(dir, 'src', 'web'), { recursive: true });
  for (const [path, text] of Object.entries({
    'src/web/app.html': html,
    ...files,
  })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function run(cwd, args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * @param {string} dir
 * @param {Record<string, unknown>} gasdev
 */
function setConfig(dir, gasdev) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', gasdev }),
  );
}

describe('inlinePage', () => {
  const page = inlinePage(APP, 'src/web/app.html');

  it('inlines a local stylesheet as a style element', () => {
    expect(page).toContain('<style>\nbody {\n  margin: 0;\n}\n</style>');
    expect(page).not.toContain('href=app.css');
  });

  it('inlines a local script, keeping its other attributes', () => {
    expect(page).toContain(
      '<script type="text/javascript" defer>\nwindow.plain = true;\n</script>',
    );
  });

  it('transpiles the .ts next to a referenced .js without types', () => {
    expect(page).toContain("const greeting = { text: 'hello' };");
    expect(page).toContain('function show(g) {');
    expect(page).not.toMatch(/interface|: Greeting|: string| as unknown/);
  });

  it('leaves external references untouched', () => {
    expect(page).toContain('<link rel="preconnect" href="https://fonts');
    expect(page).toContain(
      '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />',
    );
    expect(page).toContain('<script src="//cdn.example.com/lib.js"></script>');
    expect(page).toContain('<script src="data:text/javascript,1"></script>');
  });

  it('removes data-dev-only elements, including nested content', () => {
    expect(page).not.toContain('mock');
    expect(page).not.toContain('dev banner');
    expect(page).not.toContain('nested');
  });

  it('keeps and inlines data-dev-only elements in dev mode', () => {
    const dev = inlinePage(APP, 'src/web/app.html', { dev: true });
    expect(dev).toContain('dev banner');
    expect(dev).toContain('nested');
    expect(dev).toContain('window.mock = true;');
    expect(dev).toContain('.mock {}');
    expect(dev).not.toContain('src="mock.js"');
  });

  it('leaves comments, inline scripts and styles alone', () => {
    expect(page).toContain('<!-- <script src="commented.js"></script> -->');
    expect(page).toContain(
      `const tpl = '<script src="inline.js"></script' + '>';`,
    );
    expect(page).toContain('/* <link rel="stylesheet" href="ignored.css"> */');
  });

  it('keeps the surrounding markup unchanged', () => {
    expect(page.startsWith('<!doctype html>\n<html>\n  <head>')).toBe(true);
    expect(page.endsWith('  </body>\n</html>\n')).toBe(true);
  });

  it('inlines a plain .js when no .ts exists, and prefers the .ts otherwise', () => {
    const dir = createPage(
      '<script src="a.js"></script><script src="b.js"></script>',
      {
        'src/web/a.js': 'var a = 1;\n',
        'src/web/b.js': 'var b = "js";\n',
        'src/web/b.ts': 'const b: string = "ts";\n',
      },
    );
    const result = inlinePage(dir, 'src/web/app.html');
    expect(result).toContain('<script>\nvar a = 1;\n</script>');
    expect(result).toContain('"ts"');
    expect(result).not.toContain('"js"');
  });

  it('resolves references against the directory of the entry', () => {
    const dir = createPage('<script src="../shared/s.js"></script>', {
      'src/shared/s.js': 'var s = 1;',
    });
    expect(inlinePage(dir, 'src/web/app.html')).toContain('var s = 1;');
  });

  it('handles attribute order, quoting, case and self-closing links', () => {
    const dir = createPage(
      [
        '<link href="a.css" rel="stylesheet">',
        "<LINK REL='Stylesheet' HREF='b.css' media=print/>",
        '<link\n  rel="stylesheet"\n  href="c.css"\n/>',
        '<Script defer SRC=d.js></Script>',
        '<script src = "e.js" async></script>',
      ].join('\n'),
      Object.fromEntries(
        ['a.css', 'b.css', 'c.css', 'd.js', 'e.js'].map((f) => [
          `src/web/${f}`,
          `/* ${f} */`,
        ]),
      ),
    );
    const result = inlinePage(dir, 'src/web/app.html');
    expect(result).toContain('<style>\n/* a.css */\n</style>');
    expect(result).toContain('<style media=print/>\n/* b.css */\n</style>');
    expect(result).toContain('<style>\n/* c.css */\n</style>');
    expect(result).toContain('<script defer>\n/* d.js */\n</script>');
    expect(result).toContain('<script async>\n/* e.js */\n</script>');
  });

  it('leaves a script without src and a non-stylesheet link alone', () => {
    const html =
      '<script>var x = 1;</script>\n<link rel="icon" href="local.ico">\n';
    expect(inlinePage(createPage(html), 'src/web/app.html')).toBe(html);
  });

  it('removes data-dev-only link and general elements', () => {
    const dir = createPage(
      '<link rel="stylesheet" href="x.css" data-dev-only>a<section data-dev-only><section>b</section>c</section>d<br data-dev-only>',
    );
    expect(inlinePage(dir, 'src/web/app.html')).toBe('ad');
  });

  it('names the resolved path of a missing file', () => {
    const dir = createPage('<script src="missing.js"></script>');
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'src/web/missing.js not found (referenced by src/web/app.html)',
    );
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(HtmlError);
  });

  it('rejects a direct reference to a .ts file', () => {
    const dir = createPage('<script src="a.ts"></script>', {
      'src/web/a.ts': 'const a: number = 1;',
    });
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'src/web/app.html: reference a.js, not a.ts (the .ts source is transpiled automatically)',
    );
  });

  it('rejects a root-relative reference', () => {
    const dir = createPage('<script src="/a.js"></script>');
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      '"/a.js" must be relative to the HTML file',
    );
  });

  it('rejects script code containing </script, naming the source file', () => {
    const dir = createPage('<script src="a.js"></script>', {
      'src/web/a.js': 'var s = "</SCRIPT>";',
    });
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'src/web/a.js contains </script',
    );
  });

  it('checks the transpiled code of a .ts source', () => {
    const dir = createPage('<script src="a.js"></script>', {
      'src/web/a.ts': 'const s: string = "</script>";',
    });
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'src/web/a.ts contains </script',
    );
  });

  it('rejects stylesheet code containing </style, naming the file', () => {
    const dir = createPage('<link rel="stylesheet" href="a.css">', {
      'src/web/a.css': 'a::after { content: "</Style>"; }',
    });
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'src/web/a.css contains </style',
    );
  });

  it('allows <? in inlined code', () => {
    const dir = createPage('<script src="a.js"></script>', {
      'src/web/a.js': 'var s = "<?= x ?>";',
    });
    expect(inlinePage(dir, 'src/web/app.html')).toContain('<?= x ?>');
  });

  it('rejects an unterminated tag', () => {
    const dir = createPage('<script src="a.js"');
    expect(() => inlinePage(dir, 'src/web/app.html')).toThrow(
      'unterminated <script> tag',
    );
  });
});

describe('generateModule', () => {
  it('writes the header, prettier-ignore and a JSON string constant', () => {
    const text = generateModule(APP, CONFIG);
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      '// Generated by `gasdev html` from src/web/app.html. Do not edit.',
    );
    expect(lines[1]).toBe('// prettier-ignore');
    expect(lines[2]).toMatch(/^const _APP_HTML: string = ".*";$/);
    expect(lines).toHaveLength(4);
    expect(text).not.toContain('\r');
    const literal = /= (".*");$/m.exec(text)?.[1] ?? '';
    expect(JSON.parse(literal)).toBe(inlinePage(APP, 'src/web/app.html'));
  });

  it('is byte-stable and escapes line separators', () => {
    const dir = createPage('a b\r\nc');
    const first = generateModule(dir, CONFIG);
    expect(generateModule(dir, CONFIG)).toBe(first);
    expect(first).toContain('a\\u2028b\\nc');
    expect(first).not.toContain(' ');
  });
});

describe('html command', () => {
  it('writes the generated file, creating directories', () => {
    const dir = createApp();
    expect(existsSync(join(dir, OUT))).toBe(false);
    const result = run(dir, ['html']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`✓ Generated ${OUT}\n`);
    expect(readFileSync(join(dir, OUT), 'utf8')).toBe(
      generateModule(dir, CONFIG),
    );
  });

  it('writes identical bytes on a second run', () => {
    const dir = createApp();
    run(dir, ['html']);
    const first = readFileSync(join(dir, OUT));
    run(dir, ['html']);
    expect(readFileSync(join(dir, OUT)).equals(first)).toBe(true);
  });

  it('exits 1 on a build error', () => {
    const dir = createPage('<script src="nope.js"></script>');
    const result = run(dir, ['html']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gasdev: src/web/nope.js not found');
  });

  it('exits 1 when html is not configured', () => {
    const dir = createApp();
    setConfig(dir, { loadOrder: ['a.ts'] });
    const result = run(dir, ['html']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.html" is not configured');
  });

  it('exits 2 on invalid usage', () => {
    const dir = createApp();
    expect(run(dir, ['html', 'now']).status).toBe(2);
    const result = run(dir, ['check', '--check']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--check is only valid with html');
  });

  describe('--check', () => {
    it('passes when up to date, without writing', () => {
      const dir = createApp();
      run(dir, ['html']);
      const result = run(dir, ['html', '--check']);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('✓ HTML build is up to date\n');
    });

    it('reports a missing file and writes nothing', () => {
      const dir = createApp();
      const result = run(dir, ['html', '--check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(`${OUT} is out of date: run gasdev html\n`);
      expect(existsSync(join(dir, OUT))).toBe(false);
    });

    it('reports a stale file and leaves it unchanged', () => {
      const dir = createApp();
      run(dir, ['html']);
      const before = readFileSync(join(dir, OUT), 'utf8');
      writeFileSync(join(dir, 'src/web/app.css'), 'body { margin: 1px; }\n');
      const result = run(dir, ['html', '--check']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${OUT} is out of date`);
      expect(readFileSync(join(dir, OUT), 'utf8')).toBe(before);
    });

    it('works without any prior compile step', () => {
      const dir = createApp();
      expect(existsSync(join(dir, '.build'))).toBe(false);
      run(dir, ['html']);
      expect(run(dir, ['html', '--check']).status).toBe(0);
    });
  });
});

describe('check (html)', () => {
  /**
   * @param {unknown} html
   * @param {string[]} [loadOrder]
   */
  function make(html, loadOrder = ['generated/app.html.ts']) {
    const dir = createApp();
    setConfig(dir, { loadOrder, html });
    return dir;
  }

  /**
   * @param {Record<string, unknown>} [override]
   * @returns {unknown[]}
   */
  const entries = (override = {}) => [{ ...CONFIG, ...override }];

  it('reports staleness and a missing file as drift, and passes once generated', () => {
    const dir = make(entries());
    const missing = run(dir, ['check']);
    expect(missing.stderr).toContain(
      `${OUT}\n  file is missing: run gasdev html`,
    );
    run(dir, ['html']);
    writeFileSync(join(dir, 'src/web/app.css'), 'a {}\n');
    const stale = run(dir, ['check']);
    expect(stale.stderr).toContain(`${OUT}\n  is out of date: run gasdev html`);
    run(dir, ['html']);
    const result = run(dir, ['check']);
    expect(result.stderr).not.toContain('html');
    expect(result.stderr).toContain('package.json');
  });

  it('reports an entry that does not exist', () => {
    const dir = make(entries({ entry: 'src/web/none.html' }));
    expect(run(dir, ['check']).stderr).toContain(
      'gasdev.html: src/web/none.html does not exist',
    );
  });

  it('reports a build error against the entry', () => {
    const dir = make(entries());
    rmSync(join(dir, 'src/web/app.css'));
    expect(run(dir, ['check']).stderr).toContain(
      'src/web/app.html\n  src/web/app.css not found',
    );
  });

  it('reports an out missing from loadOrder', () => {
    const dir = make(entries(), ['other.ts']);
    run(dir, ['html']);
    expect(run(dir, ['check']).stderr).toContain(
      'gasdev.loadOrder: generated/app.html.ts (the output of src/web/app.html) is missing',
    );
  });

  it.each([
    ['a non-array', 'x', '"gasdev.html" must be a non-empty array'],
    ['an empty array', [], '"gasdev.html" must be a non-empty array'],
    ['a non-object entry', ['x'], 'html"[0] must be an object'],
    [
      'an unknown key',
      entries({ nope: 1 }),
      'unknown key(s): "gasdev.html[0].nope" (expected: entry, out, name)',
    ],
    ['a missing name', entries({ name: undefined }), '[0].name undefined'],
    [
      'an empty entry',
      entries({ entry: '' }),
      '[0].entry "" must be a non-empty',
    ],
    [
      'an absolute entry',
      entries({ entry: '/a.html' }),
      '[0].entry "/a.html" must be relative',
    ],
    [
      'a backslash entry',
      entries({ entry: 'src\\a.html' }),
      'must use "/" separators',
    ],
    [
      'a parent segment',
      entries({ entry: '../a.html' }),
      'must not contain empty, "." or ".." segments',
    ],
    [
      'a dot segment',
      entries({ out: 'src/./a.ts' }),
      'must not contain empty, "." or ".." segments',
    ],
    [
      'a non-html entry',
      entries({ entry: 'src/a.htm' }),
      '[0].entry "src/a.htm" must be an .html file',
    ],
    [
      'an out outside src',
      entries({ out: 'gen/a.ts' }),
      '[0].out "gen/a.ts" must be under src/',
    ],
    [
      'a declaration out',
      entries({ out: 'src/a.d.ts' }),
      'must be a .ts file other than .d.ts',
    ],
    [
      'a non-ts out',
      entries({ out: 'src/a.js' }),
      'must be a .ts file other than .d.ts',
    ],
    [
      'an invalid name',
      entries({ name: '1abc' }),
      '[0].name "1abc" must be a valid JavaScript identifier',
    ],
    [
      'a reserved name',
      entries({ name: 'class' }),
      '[0].name "class" must be a valid JavaScript identifier',
    ],
    [
      'a duplicate out',
      [...entries(), ...entries({ name: 'OTHER' })],
      'lists out "src/generated/app.html.ts" twice',
    ],
    [
      'a duplicate name',
      [...entries(), ...entries({ out: 'src/generated/b.ts' })],
      'lists name "_APP_HTML" twice',
    ],
  ])('rejects html with %s', (_name, html, message) => {
    const result = run(make(html), ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('requires loadOrder', () => {
    const dir = createApp();
    setConfig(dir, { html: entries() });
    expect(run(dir, ['check']).stderr).toContain(
      '"gasdev.html" requires "gasdev.loadOrder"',
    );
  });

  it('rejects html with the node preset', () => {
    const dir = createApp();
    setConfig(dir, { preset: 'node', html: entries() });
    expect(run(dir, ['check']).stderr).toContain(
      '"gasdev.html" requires the gas preset',
    );
  });
});
