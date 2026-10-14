import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { GET, POST } from '../api/passkey.js';

const root = resolve('dist');
const port = Number(process.env.PORT ?? 8000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/passkey') {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(incoming.method === 'POST' ? { body } : {}),
      });
      const response = incoming.method === 'GET' ? await GET(request) :
        incoming.method === 'POST' ? await POST(request) : new Response('Method Not Allowed', { status: 405 });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${sep}`) || !(await stat(file)).isFile()) {
      outgoing.writeHead(404); outgoing.end(); return;
    }
    outgoing.writeHead(200, {
      'content-type': mime[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    });
    outgoing.end(await readFile(file));
  } catch {
    outgoing.writeHead(404); outgoing.end();
  }
}).listen(port, 'localhost', () => {
  process.stdout.write(`Local: http://localhost:${port}\n`);
});
