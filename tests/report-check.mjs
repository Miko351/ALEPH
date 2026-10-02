import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const profile = mkdtempSync(join(tmpdir(), 'aleph-report-check-'));
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let server;
let browser;
let socket;

const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await pause(40);
  }
  throw new Error('브라우저 검사 시간 초과');
}

async function main() {
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const target = resolve(root, `.${file}`);
    if (!target.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    try {
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
      response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }).end(readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;

  browser = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', '--no-first-run',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${base}/report/`
  ], { stdio: 'ignore', windowsHide: true });
  const activePort = join(profile, 'DevToolsActivePort');
  await until(() => existsSync(activePort));
  const port = Number(readFileSync(activePort, 'utf8').split('\n')[0]);
  const tab = await until(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find(item => item.type === 'page');
  });
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.fail(new Error(message.error.message)) : task.done(message.result);
  };
  function call(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++nextId;
      pending.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function page(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: `${base}/report/` });
  await until(() => page('location.pathname === "/report/" && document.readyState === "complete"'));

  const summary = await page(`(() => ({
    title: document.title,
    h1: document.querySelectorAll('h1').length,
    fixedRows: document.querySelectorAll('.test-table tbody tr').length,
    tests: [...document.querySelectorAll('.test-table tbody tr')].map(row => [...row.cells].slice(0, 3).map(cell => cell.innerText.trim())),
    handoffItems: document.querySelectorAll('.handoff-grid article').length,
    measures: [...document.querySelectorAll('.comparison-table tbody tr')].map(row => row.innerText),
    names: /GPT-|OpenAI|Claude|Gemini/i.test(document.body.innerText)
  }))()`);
  assert.equal(summary.h1, 1);
  assert.equal(summary.fixedRows, 10);
  const fixedRows = readFileSync(resolve(root, '..', 'FIXED_TESTS.md'), 'utf8')
    .split(/\r?\n/).filter(line => /^\| D\d\d \|/.test(line))
    .map(line => line.split('|').slice(1, 4).map(cell => cell.trim()));
  assert.deepEqual(summary.tests, fixedRows, '공개 검사표의 ID·입력·기대값이 고정 원문과 다름');
  assert.equal(summary.handoffItems, 7);
  assert.equal(summary.measures.length, 2);
  assert.equal(summary.names, false, '공개 비교 화면에 모델·서비스 이름이 보임');
  assert.match(summary.measures[0], /7\s*\/\s*10/);
  assert.match(summary.measures[1], /10\s*\/\s*10/);

  for (const [width, height] of [[1366, 768], [1920, 1080], [375, 812]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await pause(100);
    const metrics = await page(`({ viewport: innerWidth, page: document.documentElement.scrollWidth })`);
    assert.ok(metrics.page <= metrics.viewport, `${width}×${height} 가로 넘침: ${metrics.page} > ${metrics.viewport}`);
    console.log(`${width}×${height}: 가로 넘침 0건`);
    if (width === 1366 && process.argv.includes('--screenshot')) {
      const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const shot = join(tmpdir(), 'aleph-report-1366-preview.png');
      writeFileSync(shot, Buffer.from(result.data, 'base64'));
      console.log(`미리보기 화면: ${shot}`);
    }
  }

  for (const file of ['/report/styles.css', '/report/HANDOFF.md', '/index.html']) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200, `${file} 연결 실패`);
  }
  const publishedHandoff = await (await fetch(`${base}/report/HANDOFF.md`)).text();
  const sourceHandoff = readFileSync(resolve(root, '..', 'HANDOFF.md'), 'utf8');
  assert.equal(publishedHandoff.replaceAll('\r\n', '\n').trimEnd(), sourceHandoff.replaceAll('\r\n', '\n').trimEnd());
  console.log('보고서 구조·링크·인수인계 원문 일치 PASS');
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill();
  if (server) await new Promise(done => server.close(done));
  const safePrefix = `${resolve(tmpdir())}${sep}aleph-report-check-`;
  if (resolve(profile).startsWith(safePrefix)) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
