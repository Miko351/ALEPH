import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(root, 'dist');
const profile = mkdtempSync(join(tmpdir(), 'aleph-drag-check-'));
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
let browser;
let server;
let socket;

const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await pause(40);
  }
  throw new Error('검사 시간 초과');
}

async function main() {
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(siteRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(`${siteRoot}${sep}`)) { response.writeHead(403).end(); return; }
    try {
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
      response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }).end(readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', '--no-first-run',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, base
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
  async function frame() {
    await page('new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)))');
  }
  async function input(id, value) {
    await page(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await frame();
  }
  async function reset(ratio = 'square', value = '이동 테스트') {
    await page(`document.querySelector('[data-ratio=${JSON.stringify(ratio)}]').click()`);
    await input('caption', value);
    await input('font-size', '72');
    await input('text-x', '50');
    await input('text-y', '50');
  }
  async function state() {
    return page(`(() => {
      const canvas = document.getElementById('preview-canvas');
      const rect = canvas.getBoundingClientRect();
      return {
        x: Number(document.getElementById('text-x').value),
        y: Number(document.getElementById('text-y').value),
        xLabel: document.getElementById('text-x-value').textContent,
        yLabel: document.getElementById('text-y-value').textContent,
        ratio: document.getElementById('ratio-badge').textContent,
        width: canvas.width, height: canvas.height,
        image: canvas.toDataURL(),
        status: document.getElementById('preview-status').textContent,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      };
    })()`);
  }
  function point(rect, xPercent, yPercent) {
    return { x: rect.left + rect.width * xPercent / 100, y: rect.top + rect.height * yPercent / 100 };
  }
  async function drag(from, to) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
    await frame();
  }
  async function caseRun(id, action) {
    try {
      await action();
      results.push({ id, result: 'PASS' });
      console.log(`${id} PASS`);
    } catch (error) {
      const reason = String(error.message).slice(0, 240);
      results.push({ id, result: 'FAIL', reason });
      console.log(`${id} FAIL: ${reason}`);
    }
  }
  function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= 2, `위치 ${actual}% (기대 ${expected}±2%p)`);
  }

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await until(() => page('document.readyState === "complete" && !!document.getElementById("preview-canvas")'));

  await caseRun('D01', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 50, 50), point(before.rect, 70, 50));
    const after = await state();
    near(after.x, 70); near(after.y, 50);
    assert.equal(after.xLabel, `${after.x}%`);
    assert.notEqual(after.image, before.image, '미리보기 변화 없음');
  });
  await caseRun('D02', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 50, 50), point(before.rect, 50, 70));
    const after = await state();
    near(after.x, 50); near(after.y, 70);
    assert.equal(after.yLabel, `${after.y}%`);
    assert.notEqual(after.image, before.image, '미리보기 변화 없음');
  });
  await caseRun('D03', async () => {
    await reset();
    const before = await state();
    const center = point(before.rect, 50, 50);
    await drag(center, center);
    const after = await state();
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
    assert.ok(after.image === before.image, '미리보기 그림 변경');
  });
  await caseRun('D04', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 5, 5), point(before.rect, 25, 25));
    const after = await state();
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
    assert.ok(after.image === before.image, '미리보기 그림 변경');
  });
  await caseRun('D05', async () => {
    await reset('square', '');
    const before = await state();
    await drag(point(before.rect, 50, 50), point(before.rect, 70, 70));
    const after = await state();
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
    assert.ok(after.image === before.image, '미리보기 그림 변경');
    assert.match(after.status, /비어/);
  });
  for (const [id, ratio, label, width, height] of [
    ['D06', 'portrait', '4:5', 1080, 1350],
    ['D07', 'story', '9:16', 1080, 1920]
  ]) {
    await caseRun(id, async () => {
      await reset(ratio);
      const before = await state();
      await drag(point(before.rect, 50, 50), point(before.rect, 60, 60));
      const after = await state();
      near(after.x, 60); near(after.y, 60);
      assert.match(after.ratio, new RegExp(label));
      assert.deepEqual([after.width, after.height], [width, height]);
      assert.notEqual(after.image, before.image, '미리보기 변화 없음');
    });
  }
  await caseRun('D08', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 50, 50), { x: before.rect.left - 40, y: before.rect.top - 40 });
    const after = await state();
    assert.deepEqual([after.x, after.y], [10, 10]);
    const drawn = await page(`(async () => {
      const original = CanvasRenderingContext2D.prototype.fillText;
      const calls = [];
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
        if (this.canvas.id === 'preview-canvas') calls.push({ x, y, width: this.measureText(text).width });
        return original.call(this, text, x, y);
      };
      const caption = document.getElementById('caption');
      caption.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
      CanvasRenderingContext2D.prototype.fillText = original;
      return calls;
    })()`);
    assert.ok(drawn.length > 0, '문구가 그려지지 않음');
    assert.ok(drawn.every(item => item.x - item.width / 2 >= 0 && item.y > 0), '문구가 미리보기 밖으로 나감');
  });
  await caseRun('D09', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 50, 50), point(before.rect, 70, 50));
    const dragged = await state();
    near(dragged.x, 70);
    await page('document.getElementById("text-x").focus()');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await frame();
    const after = await state();
    assert.equal(after.x, dragged.x + 1);
    assert.notEqual(after.image, dragged.image, '방향키 미리보기 변화 없음');
  });
  await caseRun('D10', async () => {
    await reset();
    const before = await state();
    await drag(point(before.rect, 50, 50), point(before.rect, 60, 60));
    const dragged = await state();
    near(dragged.x, 60); near(dragged.y, 60);
    await page(`(() => {
      document.getElementById('template-name').value = '드래그 검사';
      document.getElementById('template-create').click();
    })()`);
    await until(() => page('document.querySelectorAll("#template-list li").length === 1'));
    await input('text-x', '50');
    await input('text-y', '50');
    await page('document.querySelector("#template-list li [data-action=load]").click()');
    await until(() => page(`document.getElementById('text-x').value === ${JSON.stringify(String(dragged.x))} && document.getElementById('text-y').value === ${JSON.stringify(String(dragged.y))}`));
    await frame();
    const restored = await state();
    assert.deepEqual([restored.x, restored.y], [dragged.x, dragged.y]);
    assert.ok(restored.image === dragged.image, '저장 당시의 미리보기 그림이 복원되지 않음');
  });

  assert.equal(results.length, 10, '고정 검사 수가 10개여야 함');
  const passed = results.filter(item => item.result === 'PASS').length;
  console.log(`고정 검사 결과: ${passed}/10 PASS, ${10 - passed}/10 FAIL`);
  if (passed !== 10) process.exitCode = 1;
}

try { await main(); }
finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (browser && !browser.killed) browser.kill();
  if (server) await new Promise(done => server.close(done));
  if (resolve(profile).startsWith(`${resolve(tmpdir())}${sep}`)) {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* 종료 직후 잠긴 임시 파일은 OS가 정리한다. */ }
  }
}
