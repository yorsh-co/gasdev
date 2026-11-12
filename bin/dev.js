// @ts-check
import { createServer } from 'node:http';
import { inlinePage } from './html.js';

/** Raised for a `gasdev dev` problem that prevents the server from running. */
export class DevError extends Error {}

const EVENTS_PATH = '/__gasdev/events';

/** Client script that reloads the page when the server sends `reload`. */
const RELOAD_SNIPPET = `<script>new EventSource('${EVENTS_PATH}').addEventListener('reload', function () { location.reload(); });</script>`;

/**
 * Escapes text for use in HTML content.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inserts the reload script before the last `</body>`, or appends it.
 *
 * @param {string} html
 * @returns {string}
 */
function withReload(html) {
  const index = html.toLowerCase().lastIndexOf('</body>');
  return index === -1
    ? html + RELOAD_SNIPPET
    : html.slice(0, index) + RELOAD_SNIPPET + html.slice(index);
}

/**
 * Creates the dev server. It is not listening yet.
 *
 * @param {string} cwd Project root.
 * @param {string[]} entries Project-relative POSIX paths of the HTML entries.
 * @returns {{ server: import('node:http').Server, reload: () => void }}
 */
export function createDevServer(cwd, entries) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();

  /**
   * @param {string} entry
   * @returns {{ status: number, html: string }}
   */
  function render(entry) {
    try {
      return {
        status: 200,
        html: withReload(inlinePage(cwd, entry, { dev: true })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 500,
        html: withReload(
          `<!doctype html>\n<meta charset="utf-8"><title>gasdev dev: build error</title>\n<h1>Build error</h1>\n<pre>${escapeHtml(message)}</pre>\n`,
        ),
      };
    }
  }

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end('Method Not Allowed');
      return;
    }
    const address = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    if (
      req.headers.host !== `127.0.0.1:${address.port}` &&
      req.headers.host !== `localhost:${address.port}`
    ) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }
    /** @type {string} */
    let path;
    try {
      path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad Request');
      return;
    }

    if (path === EVENTS_PATH) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }

    /** @type {string | undefined} */
    let html;
    let status = 200;
    const [only] = entries;
    if (path === '/' && only !== undefined && entries.length === 1) {
      ({ status, html } = render(only));
    } else if (path === '/' && entries.length > 1) {
      const links = entries
        .map((e) => `<li><a href="/${encodeURI(e)}">${escapeHtml(e)}</a></li>`)
        .join('\n');
      html = withReload(
        `<!doctype html>\n<meta charset="utf-8"><title>gasdev dev</title>\n<ul>\n${links}\n</ul>\n`,
      );
    } else {
      const entry = entries.find((e) => path === `/${e}`);
      if (entry !== undefined) ({ status, html } = render(entry));
    }

    if (html === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
      return;
    }
    res
      .writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      .end(html);
  });

  return {
    server,
    reload() {
      for (const client of clients) client.write('event: reload\ndata: {}\n\n');
    },
  };
}
