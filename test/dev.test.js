import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevServer, DevError, runDev } from '../bin/dev.js';
import { REPO_ROOT } from './support.js';

const APP = join(REPO_ROOT, 'test', 'fixtures', 'html', 'app');
const ENTRY = 'src/web/app.html';

/** @type {Array<() => void>} */
const cleanups = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/**
 * Starts a dev server on a free port.
 *
 * @param {string} cwd
 * @param {string[]} entries
 */
async function start(cwd, entries) {
  const dev = createDevServer(cwd, entries);
  await new Promise((resolve) =>
    dev.server.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  cleanups.push(() => {
    dev.server.closeAllConnections();
    dev.server.close();
  });
  const address = /** @type {import('node:net').AddressInfo} */ (
    dev.server.address()
  );
  return { ...dev, base: `http://127.0.0.1:${address.port}` };
}

/** @returns {string} A copy of the `app` fixture. */
function createApp() {
  const dir = mkdtempSync(join(tmpdir(), 'gasdev-dev-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(APP, dir, { recursive: true });
  return dir;
}

/**
 * Sends a GET with a raw path, bypassing `fetch` URL normalization.
 *
 * @param {string} base
 * @param {string} path
 * @param {Record<string, string>} [headers]
 * @returns {Promise<number>} The response status.
 */
function rawGet(base, path, headers) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    request({ host: url.hostname, port: url.port, path, headers }, (res) => {
      res.resume();
      resolve(/** @type {number} */ (res.statusCode));
    })
      .on('error', reject)
      .end();
  });
}

/**
 * @param {ReadableStreamDefaultReader} reader
 * @param {TextDecoder} decoder
 */
async function readChunk(reader, decoder) {
  const { done, value } = await reader.read();
  if (done) throw new Error('SSE stream ended before the expected event');
  return decoder.decode(value);
}

describe('createDevServer', () => {
  it('serves the page at the root for a single entry', async () => {
    const { base } = await start(APP, [ENTRY]);
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('window.plain = true;');
  });

  it('serves an index linking every entry when there are several', async () => {
    const { base } = await start(APP, [ENTRY, 'src/other/b.html']);
    const body = await (await fetch(`${base}/`)).text();
    expect(body).toContain(`href="/${ENTRY}"`);
    expect(body).toContain('href="/src/other/b.html"');
    expect((await fetch(`${base}/${ENTRY}`)).status).toBe(200);
    const second = await fetch(`${base}/src/other/b.html`);
    expect(second.status).toBe(500);
    expect(await second.text()).toContain('src/other/b.html');
  });

  it('keeps data-dev-only elements', async () => {
    const { base } = await start(APP, [ENTRY]);
    const body = await (await fetch(`${base}/`)).text();
    expect(body).toContain('dev banner');
    expect(body).toContain('window.mock = true;');
  });

  it('inserts the reload script before </body>', async () => {
    const { base } = await start(APP, [ENTRY]);
    const body = await (await fetch(`${base}/`)).text();
    expect(body).toContain('/__gasdev/events');
    expect(body.indexOf('EventSource')).toBeLessThan(body.indexOf('</body>'));
  });

  it('answers 404 for paths that are not configured entries', async () => {
    const { base } = await start(APP, [ENTRY]);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/src/web/app.ts`)).status).toBe(404);
  });

  it('answers 404 for traversal paths', async () => {
    const { base } = await start(APP, [ENTRY]);
    expect(await rawGet(base, '/../package.json')).toBe(404);
    expect(await rawGet(base, '/%2e%2e/package.json')).toBe(404);
  });

  it('answers 400 for malformed percent-encoding', async () => {
    const { base } = await start(APP, [ENTRY]);
    expect(await rawGet(base, '/%E0%A4%A')).toBe(400);
  });

  it('rejects a foreign Host header and accepts localhost', async () => {
    const { base } = await start(APP, [ENTRY]);
    const port = new URL(base).port;
    expect(await rawGet(base, '/', { host: 'evil.example' })).toBe(403);
    expect(
      await rawGet(base, '/__gasdev/events', { host: 'evil.example' }),
    ).toBe(403);
    expect(await rawGet(base, '/', { host: `localhost:${port}` })).toBe(200);
  });

  it('answers 405 for non-GET methods', async () => {
    const { base } = await start(APP, [ENTRY]);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });

  it('shows a build error as an escaped 500 page that reloads', async () => {
    const dir = createApp();
    writeFileSync(
      join(dir, ENTRY),
      '<body><script src="<missing>.js"></script></body>',
    );
    const { base } = await start(dir, [ENTRY]);
    const res = await fetch(`${base}/`);
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).toContain('src/web/&lt;missing&gt;.js not found');
    expect(body).not.toContain('<missing>');
    expect(body).toContain('/__gasdev/events');
  });

  it('renders any build failure as a 500 and keeps serving', async () => {
    const dir = createApp();
    writeFileSync(join(dir, ENTRY), '<body><script src="."></script></body>');
    const { base } = await start(dir, [ENTRY]);
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('/__gasdev/events');
    expect((await fetch(`${base}/`)).status).toBe(500);
  });

  it('sends a reload event to SSE clients', async () => {
    const { base, reload } = await start(APP, [ENTRY]);
    const res = await fetch(`${base}/__gasdev/events`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = /** @type {ReadableStream} */ (res.body).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(': connected')) {
      text += await readChunk(reader, decoder);
    }
    reload();
    while (!text.includes('event: reload')) {
      text += await readChunk(reader, decoder);
    }
    await reader.cancel();
    expect(text).toContain('event: reload');
  });
});

describe('runDev', () => {
  const CONFIG = [
    { entry: ENTRY, out: 'src/generated/app.html.ts', name: '_APP_HTML' },
  ];

  /**
   * @param {string} cwd
   * @param {string[]} args
   */
  function cli(cwd, args) {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'bin', 'gasdev.js'), ...args],
      { cwd, encoding: 'utf8' },
    );
    return { status: result.status, stderr: result.stderr };
  }

  it('reloads SSE clients when a watched file changes', async () => {
    const dir = createApp();
    let output = '';
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = /** @type {typeof process.stdout.write} */ (
      (chunk) => {
        output += String(chunk);
        return true;
      }
    );
    const done = runDev(dir, CONFIG, { port: 0 });
    let base;
    try {
      while (!output.includes('\n'))
        await new Promise((r) => setTimeout(r, 10));
      base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    } finally {
      process.stdout.write = write;
    }
    const res = await fetch(`${base}/__gasdev/events`);
    const reader = /** @type {ReadableStream} */ (res.body).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(': connected')) {
      text += await readChunk(reader, decoder);
    }
    writeFileSync(join(dir, 'src', 'web', 'app.css'), 'body { color: red; }');
    while (!text.includes('event: reload')) {
      text += await readChunk(reader, decoder);
    }
    process.emit('SIGINT');
    expect(await done).toBe(0);
  });

  it('rejects an entry in a missing directory', async () => {
    const config = [
      { entry: 'missing/app.html', out: 'out.ts', name: '_APP_HTML' },
    ];
    const error = await runDev(APP, config, { port: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(DevError);
    expect(error.message).toMatch(/directory not found/);
  });

  it('keeps serving when a watched directory is removed', async () => {
    const dir = createApp();
    let output = '';
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = /** @type {typeof process.stdout.write} */ (
      (chunk) => {
        output += String(chunk);
        return true;
      }
    );
    const done = runDev(dir, CONFIG, { port: 0 });
    let base;
    try {
      while (!output.includes('\n'))
        await new Promise((r) => setTimeout(r, 10));
      base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    } finally {
      process.stdout.write = write;
    }
    rmSync(join(dir, 'src', 'web'), { recursive: true });
    await new Promise((r) => setTimeout(r, 200));
    const res = await fetch(`${base}/`);
    expect(res.status).toBeGreaterThan(0);
    process.emit('SIGINT');
    expect(await done).toBe(0);
  });

  it('rejects when html is not configured', async () => {
    await expect(runDev(APP, undefined, { port: 0 })).rejects.toBeInstanceOf(
      DevError,
    );
  });

  it('rejects a port that is in use', async () => {
    const { server } = createDevServer(APP, [ENTRY]);
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    cleanups.push(() => server.close());
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    await expect(runDev(APP, CONFIG, { port })).rejects.toThrow(
      `port ${port} is already in use`,
    );
  });

  it('rejects an invalid --port', () => {
    for (const port of ['abc', '0', '70000', '1.5']) {
      expect(cli(APP, ['dev', '--port', port]).status).toBe(2);
    }
  });

  it('rejects --port with another command', () => {
    const result = cli(APP, ['html', '--port', '3000']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--port is only valid with dev');
  });

  it('exits 1 when html is not configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gasdev-dev-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    const result = cli(dir, ['dev']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"gasdev.html" is not configured');
  });
});
