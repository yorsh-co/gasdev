import { request } from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevServer } from '../bin/dev.js';
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
      text += decoder.decode((await reader.read()).value);
    }
    reload();
    while (!text.includes('event: reload')) {
      text += decoder.decode((await reader.read()).value);
    }
    await reader.cancel();
    expect(text).toContain('event: reload');
  });
});
