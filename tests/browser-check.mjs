import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const profile = mkdtempSync(join(tmpdir(), 'aleph-daily-smoke-'));
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const screenshotPath = join(tmpdir(), 'aleph-daily-board-smoke.png');
const testScreenshotPath = join(tmpdir(), 'aleph-daily-test-smoke.png');
const mobileScreenshotPath = join(tmpdir(), 'aleph-daily-board-mobile.png');
const testMobileScreenshotPath = join(tmpdir(), 'aleph-daily-test-mobile.png');
let server;
let browser;
let socket;
let mockMode = 'success';
const exceptions = [];
const consoleErrors = [];
const wait = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await wait(50);
  }
  throw new Error('브라우저 검사 제한 시간 초과');
}

try {
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(siteRoot, pathname === '/' ? './index.html' : `.${pathname}`);
    if (!target.startsWith(`${siteRoot}${sep}`)) { response.writeHead(403).end(); return; }
    try {
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      response.writeHead(200, { 'content-type': mime[extname(target)] || 'application/octet-stream' }).end(readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', '--no-first-run',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  const activePort = join(profile, 'DevToolsActivePort');
  await until(() => existsSync(activePort));
  const port = Number(readFileSync(activePort, 'utf8').split('\n')[0]);
  const page = await until(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find(tab => tab.type === 'page');
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  function call(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++nextId;
      pending.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId } = message.params;
      const raw = mockMode === 'schema'
        ? { timezone: 'Asia/Seoul', current_units: { temperature_2m: '°C' }, current: { time: '2026-09-29T11:15', temperature_2m: '21.4' } }
        : { timezone: 'Asia/Seoul', current_units: { temperature_2m: '°C' }, current: { time: '2026-09-29T11:15', temperature_2m: 21.4 } };
      await call('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: '*' }
        ],
        body: Buffer.from(JSON.stringify(raw)).toString('base64')
      });
    }
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    message.error ? task.fail(new Error(message.error.message)) : task.done(message.result);
  };
  async function evalPage(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*api.open-meteo.com/*' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base });
  await until(() => evalPage('document.readyState === "complete" && document.getElementById("live-value")?.textContent === "21.4" && document.getElementById("live-badge")?.textContent === "정상 조회"'));
  assert.equal(await evalPage('document.getElementById("live-badge").textContent'), '정상 조회');
  assert.equal(await evalPage('document.getElementById("row-count").textContent'), '1일');
  assert.match(await evalPage('document.getElementById("source-time").textContent'), /KST/);
  assert.match(await evalPage('document.getElementById("fetched-time").textContent'), /KST/);
  assert.equal(await evalPage('document.getElementById("record-date").textContent.length'), 10);
  assert.match(await evalPage('document.getElementById("source-link").href'), /api\.open-meteo\.com/);
  assert.equal(await evalPage('document.getElementById("raw-output")'), null);
  assert.match(await evalPage('document.querySelector(".history-updated").textContent'), /마지막 조회/);
  console.log('실제 조회 UI 경로(합성 HTTP 응답): 값·단위·출처·두 시각·KST 표시 PASS');

  const priorHistoryTime = await evalPage('document.querySelector(".history-updated time").dateTime');
  await wait(20);
  await evalPage('document.getElementById("live-refresh").click()');
  await until(() => evalPage('!document.getElementById("live-refresh").disabled'));
  assert.equal(await evalPage('document.getElementById("row-count").textContent'), '1일');
  assert.notEqual(await evalPage('document.querySelector(".history-updated time").dateTime'), priorHistoryTime);
  mockMode = 'schema';
  await evalPage('document.getElementById("live-refresh").click()');
  await until(() => evalPage('document.getElementById("live-badge").textContent === "오래된 값"'));
  assert.equal(await evalPage('document.getElementById("live-value").textContent'), '21.4');
  mockMode = 'success';
  await evalPage('document.getElementById("live-refresh").click()');
  await until(() => evalPage('document.getElementById("live-badge").textContent === "정상 조회"'));
  console.log('실제 조회 UI 경로(합성 HTTP 응답): 같은 날짜 중복 0, 형식 오류 후 마지막 정상값 유지·재시도 복구 PASS');

  for (const [width, height] of [[1366, 768], [1920, 1080], [375, 812]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evalPage('document.documentElement.scrollWidth > innerWidth'), false, `정보판 ${width}×${height} 가로 넘침`);
    if (width === 375) {
      const mobile = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(mobileScreenshotPath, Buffer.from(mobile.data, 'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  const liveStorageBefore = await evalPage('localStorage.getItem("aleph-daily-board-live-v1")');
  await call('Page.navigate', { url: `${base}/test.html` });
  await until(() => evalPage('document.readyState === "complete" && performance.getEntriesByType("resource").filter(entry => entry.name.includes("/fixtures/")).length === 9'));
  assert.equal(await evalPage('document.querySelector("[aria-current=page]").textContent'), '데이터 상태 시험');
  assert.equal(await evalPage('document.getElementById("live-value")'), null);

  await evalPage('document.querySelector("[data-scenario=same-day]").click()');
  assert.equal(await evalPage('document.getElementById("demo-rows").textContent'), '1');
  await evalPage('document.querySelector("[data-scenario=next-day]").click()');
  assert.equal(await evalPage('document.getElementById("demo-rows").textContent'), '2');

  const failureTitles = new Set();
  for (const [id, code] of [
    ['T04-TIMEOUT', 'timeout'], ['T04-AUTH-401', 'auth'],
    ['T04-RATE-429', 'rate_limit'], ['T04-OFFLINE', 'offline'],
    ['T04-SCHEMA-BREAK', 'schema_error']
  ]) {
    await evalPage(`document.querySelector('[data-failure="${id}"]').click()`);
    await until(() => evalPage(`document.getElementById("demo-code").textContent === "${code}"`));
    assert.match(await evalPage('document.getElementById("demo-badge").textContent'), /오래된 값/);
    assert.equal(await evalPage('document.getElementById("demo-value").textContent.trim()'), '105 pt');
    assert.equal(await evalPage('document.getElementById("demo-rows").textContent'), '1');
    assert.equal(await evalPage('document.getElementById("demo-retry").disabled'), false);
    failureTitles.add(await evalPage('document.getElementById("demo-title").textContent'));
    assert.match(await evalPage('document.getElementById("demo-next").textContent'), /다음 행동/);
  }
  assert.equal(failureTitles.size, 5);
  await evalPage('document.getElementById("demo-retry").click()');
  await until(() => evalPage('document.getElementById("demo-code").textContent === "none"'));
  assert.match(await evalPage('document.getElementById("demo-badge").textContent'), /fresh/);
  assert.equal(await evalPage('document.getElementById("demo-value").textContent.trim()'), '120 pt');
  assert.equal(await evalPage('document.getElementById("demo-rows").textContent'), '2');
  assert.equal(await evalPage('document.getElementById("demo-delta").textContent'), '+15.0 pt');
  console.log('공개 합성 화면: 실패 5종 각각 구분, 오래된 값 105 보존, 다시 시도 후 fresh/none · 120 · 2행 PASS');

  await evalPage('document.querySelector("[data-scenario=next-day]").click()');
  assert.equal(await evalPage('document.getElementById("demo-rows").textContent'), '2');
  assert.equal(await evalPage('localStorage.getItem("aleph-daily-board-live-v1")'), liveStorageBefore);
  for (const [width, height] of [[1366, 768], [1920, 1080], [375, 812]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    const overflow = await evalPage('document.documentElement.scrollWidth > innerWidth');
    assert.equal(overflow, false, `시험 화면 ${width}×${height} 가로 넘침`);
    if (width === 375) {
      const mobile = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(testMobileScreenshotPath, Buffer.from(mobile.data, 'base64'));
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  const testScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(testScreenshotPath, Buffer.from(testScreenshot.data, 'base64'));
  assert.deepEqual(exceptions, []);
  assert.deepEqual(consoleErrors, []);
  console.log(`두 화면 3종 크기 가로 넘침 0, JS 예외·콘솔 오류 0건 PASS; 스크린샷: ${screenshotPath}, ${testScreenshotPath}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (browser && !browser.killed) browser.kill();
  if (server) await new Promise(done => server.close(done));
  const safeProfile = resolve(profile);
  if (safeProfile.startsWith(`${resolve(tmpdir())}${sep}`) && safeProfile.includes('aleph-daily-smoke-')) {
    try { rmSync(safeProfile, { recursive: true, force: true }); } catch { /* 종료 직후 잠긴 Chrome 파일은 OS가 정리한다. */ }
  }
}
