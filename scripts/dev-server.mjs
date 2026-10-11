import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { GET, POST } from '../api/data.js';
import { GET as authGET, POST as authPOST } from '../api/auth.js';

const publicRoot = resolve('public');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/data' || url.pathname === '/api/auth') {
    if (!['GET', 'POST'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, POST' });
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const webRequest = new Request(url, {
      method: request.method,
      headers: request.headers,
      ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
    const authRoute = url.pathname === '/api/auth';
    const webResponse = request.method === 'GET'
      ? await (authRoute ? authGET : GET)(webRequest)
      : await (authRoute ? authPOST : POST)(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
    return;
  }

  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const filePath = resolve(publicRoot, `.${pathname}`);
  if (!filePath.startsWith(`${publicRoot}${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(Number(process.env.PORT ?? 8000), () => {
  process.stdout.write(`Local preview: http://localhost:${process.env.PORT ?? 8000}\n`);
});
