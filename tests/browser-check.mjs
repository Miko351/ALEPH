import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(root, 'dist');
const profile = mkdtempSync(join(tmpdir(), 'aleph-card-c03-'));
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];
let browser;
let server;
let socket;

const wait = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await wait(50);
  }
  throw new Error('브라우저 검사 제한 시간 초과');
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
  const port = await until(() => {
    try { return Number(readFileSync(activePort, 'utf8').split('\n')[0]) || false; }
    catch { return false; }
  });
  const page = await until(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find(tab => tab.type === 'page');
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
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
  async function evalPage(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await until(() => evalPage('document.readyState === "complete" && !!document.getElementById("preview-canvas")'));

  const visible = await evalPage(`(() => {
    const ids = ['image-input', 'caption', 'text-x', 'text-y', 'font-size', 'text-color', 'preview-canvas'];
    return ids.every(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < innerHeight;
    }) && document.documentElement.scrollWidth <= innerWidth;
  })()`);
  assert.equal(visible, true, '이미지·문구 편집 도구가 첫 화면에 보여야 함');
  const before = await evalPage('document.getElementById("preview-canvas").toDataURL()');
  await evalPage(`(() => {
    const caption = document.getElementById('caption');
    caption.value = '새 문구';
    caption.dispatchEvent(new Event('input', { bubbles: true }));
    const position = document.getElementById('text-x');
    position.value = '30';
    position.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until(() => evalPage('document.getElementById("preview-canvas").getAttribute("aria-label").includes("새 문구")'));
  const after = await evalPage('document.getElementById("preview-canvas").toDataURL()');
  assert.notEqual(after, before, '문구 편집이 미리보기에 반영되어야 함');
  assert.equal(await evalPage('document.getElementById("text-x-value").textContent'), '30%');
  await evalPage(`(async () => {
    const sample = document.createElement('canvas');
    sample.width = 24;
    sample.height = 16;
    sample.getContext('2d').fillRect(0, 0, 24, 16);
    const blob = await new Promise(done => sample.toBlob(done, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'sample.png', { type: 'image/png' }));
    const input = document.getElementById('image-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(() => evalPage('document.getElementById("image-status").textContent.includes("sample.png")'));
  assert.notEqual(await evalPage('document.getElementById("preview-canvas").toDataURL()'), after, '이미지가 미리보기에 반영되어야 함');
  const exported = await evalPage(`(async () => {
    const canvas = document.getElementById('preview-canvas');
    const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
    const bitmap = await createImageBitmap(blob);
    const result = { type: blob.type, width: bitmap.width, height: bitmap.height, bytes: blob.size };
    bitmap.close();
    return result;
  })()`);
  assert.equal(exported.type, 'image/png');
  assert.equal(exported.width, 1080);
  assert.equal(exported.height, 1080);
  assert.ok(exported.bytes > 0);
  if (process.argv.includes('--long-text')) {
    const drawnLines = await evalPage(`(async () => {
      const original = CanvasRenderingContext2D.prototype.fillText;
      const lines = [];
      CanvasRenderingContext2D.prototype.fillText = function(text, ...rest) {
        if (this.canvas.id === 'preview-canvas') lines.push(text);
        return original.call(this, text, ...rest);
      };
      const caption = document.getElementById('caption');
      caption.value = '긴 한글 문구가 카드의 경계를 넘어가지 않도록 자연스럽게 줄바꿈되어야 합니다. '.repeat(5);
      caption.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
      CanvasRenderingContext2D.prototype.fillText = original;
      return lines.length;
    })()`);
    assert.ok(drawnLines >= 2, `긴 한글 문구가 ${drawnLines}줄로만 그려짐`);
    console.log(`T03-C15 동일 입력 수정 후 PASS: 긴 한글 문구 ${drawnLines}줄로 줄바꿈`);
  }
  if (process.argv.includes('--all')) {
    async function setValue(id, value) {
      await evalPage(`(() => {
        const input = document.getElementById(${JSON.stringify(id)});
        input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(80);
    }
    async function uploadImage(type, name, width, height, transparent = false) {
      await evalPage(`(async () => {
        const sample = document.createElement('canvas');
        sample.width = ${width}; sample.height = ${height};
        const context = sample.getContext('2d');
        if (!${transparent}) { context.fillStyle = '#ed9968'; context.fillRect(0, 0, sample.width, sample.height); }
        context.fillStyle = '#194f60'; context.fillRect(0, 0, sample.width / 3, sample.height / 3);
        const blob = await new Promise(done => sample.toBlob(done, ${JSON.stringify(type)}, .9));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
        const input = document.getElementById('image-input');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await until(() => evalPage(`document.getElementById('image-status').textContent.includes(${JSON.stringify(name)})`));
    }
    async function importJson(value, filename) {
      await evalPage(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(value)}], ${JSON.stringify(filename)}, { type: 'application/json' }));
        const input = document.getElementById('json-import');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }

    await uploadImage('image/jpeg', 'sample.jpg', 40, 24);
    assert.match(await evalPage('document.getElementById("image-status").textContent'), /sample\.jpg/);
    await setValue('caption', '검사');
    for (const [id, value] of [['text-x', '70'], ['text-y', '30'], ['font-size', '100'], ['text-color', '#ff3366']]) {
      const beforeChange = await evalPage('document.getElementById("preview-canvas").toDataURL()');
      await setValue(id, value);
      assert.notEqual(await evalPage('document.getElementById("preview-canvas").toDataURL()'), beforeChange, `${id} 변경 미반영`);
    }
    const savedImage = await evalPage('document.getElementById("preview-canvas").toDataURL()');
    await evalPage(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['not an image'], 'bad.txt', { type: 'text/plain' }));
      const input = document.getElementById('image-input');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(() => evalPage('document.getElementById("image-status").classList.contains("is-error")'));
    assert.equal(await evalPage('document.getElementById("preview-canvas").toDataURL()'), savedImage);
    assert.match(await evalPage('document.getElementById("image-status").textContent'), /PNG 또는 JPEG/);

    await setValue('caption', '가장자리 확인\nLine break 😄');
    await setValue('text-x', '10');
    await setValue('text-y', '10');
    const ratioResults = [];
    await evalPage(`(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { window.__downloadBlob = blob; return create(blob); };
      HTMLAnchorElement.prototype.click = function() {};
    })()`);
    for (const [key, expectedWidth, expectedHeight] of [['square', 1080, 1080], ['portrait', 1080, 1350], ['story', 1080, 1920]]) {
      await evalPage(`document.querySelector('[data-ratio="${key}"]').click()`);
      const result = await evalPage(`(async () => {
        await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
        const source = document.getElementById('preview-canvas');
        window.__downloadBlob = null;
        document.getElementById('download').click();
        const blob = await new Promise((done, fail) => {
          const started = Date.now();
          const check = () => {
            if (window.__downloadBlob) done(window.__downloadBlob);
            else if (Date.now() - started > 5000) fail(new Error('PNG 내려받기 실패'));
            else setTimeout(check, 20);
          };
          check();
        });
        const decoded = await createImageBitmap(blob);
        const copy = document.createElement('canvas');
        copy.width = source.width; copy.height = source.height;
        copy.getContext('2d').drawImage(decoded, 0, 0);
        decoded.close();
        const left = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
        const right = copy.getContext('2d').getImageData(0, 0, copy.width, copy.height).data;
        let differences = 0;
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differences++;
        const visible = source.getBoundingClientRect();
        const stage = document.querySelector('.preview-stage').getBoundingClientRect();
        return { width: source.width, height: source.height, differences, bytes: blob.size, type: blob.type,
          visibleRatio: visible.width / visible.height,
          visibleBox: { left: visible.left, right: visible.right, top: visible.top, bottom: visible.bottom },
          stageBox: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom },
          insideStage: visible.left >= stage.left && visible.right <= stage.right && visible.top >= stage.top && visible.bottom <= stage.bottom };
      })()`);
      assert.equal(result.width, expectedWidth);
      assert.equal(result.height, expectedHeight);
      assert.equal(result.type, 'image/png');
      assert.equal(result.differences, 0, `${key} 미리보기·파일 픽셀 불일치`);
      assert.ok(Math.abs(result.visibleRatio - expectedWidth / expectedHeight) < .01, `${key} 화면 비율 왜곡`);
      assert.equal(result.insideStage, true, `${key} 미리보기 영역 넘침: ${JSON.stringify(result)}`);
      ratioResults.push(`${key}:${result.differences}`);
    }

    for (const [name, textValue, ratio] of [['첫 카드', '첫 문구', 'square'], ['둘째 카드', '둘째 문구', 'portrait'], ['셋째 카드', '셋째 문구', 'story']]) {
      await setValue('caption', textValue);
      await setValue('template-name', name);
      await evalPage(`document.querySelector('[data-ratio="${ratio}"]').click()`);
      await evalPage('document.getElementById("template-create").click()');
      await until(() => evalPage(`document.querySelectorAll('#template-list li').length === ${['첫 카드', '둘째 카드', '셋째 카드'].indexOf(name) + 1}`));
    }
    await evalPage('document.querySelector("#template-list li:first-child [data-action=load]").click()');
    await until(() => evalPage('document.getElementById("caption").value === "첫 문구"'));
    await setValue('caption', '첫 문구 수정');
    await evalPage('document.getElementById("template-update").click()');
    await until(() => evalPage('document.getElementById("template-status").textContent.includes("수정했습니다")'));
    await evalPage('window.confirm = () => true; document.querySelector("#template-list li:nth-child(2) [data-action=delete]").click()');
    await until(() => evalPage('document.querySelectorAll("#template-list li").length === 2'));
    await call('Page.navigate', { url: `${base}/?reload=1` });
    await until(() => evalPage('location.search === "?reload=1" && document.querySelectorAll("#template-list li").length === 2'));
    await evalPage('document.querySelector("#template-list li:first-child [data-action=load]").click()');
    await until(() => evalPage('document.getElementById("caption").value === "첫 문구 수정"'));
    await wait(100);
    const beforeJsonPreview = await evalPage('document.getElementById("preview-canvas").toDataURL()');

    await evalPage(`(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { window.__exported = blob; return create(blob); };
      HTMLAnchorElement.prototype.click = function() {};
      document.getElementById('json-export').click();
    })()`);
    await until(() => evalPage('!!window.__exported'));
    const jsonText = await evalPage('window.__exported.text()');
    assert.equal(JSON.parse(jsonText).templates.length, 2);
    await evalPage('window.confirm = () => true; document.querySelector("#template-list li:first-child [data-action=delete]").click()');
    await until(() => evalPage('document.querySelectorAll("#template-list li").length === 1'));
    await evalPage('document.querySelector("#template-list li:first-child [data-action=delete]").click()');
    await until(() => evalPage('document.querySelectorAll("#template-list li").length === 0'));
    await importJson(jsonText, 'valid.json');
    await until(() => evalPage('document.querySelectorAll("#template-list li").length === 2'));
    await evalPage('document.querySelector("#template-list li:first-child [data-action=load]").click()');
    await until(() => evalPage('document.getElementById("caption").value === "첫 문구 수정"'));
    assert.match(await evalPage('document.getElementById("image-status").textContent'), /템플릿의 이미지가 적용/);
    await wait(100);
    assert.equal(await evalPage('document.getElementById("preview-canvas").toDataURL()'), beforeJsonPreview, 'JSON 복원 후 합성 이미지 불일치');
    await importJson('{ invalid', 'broken.json');
    await until(() => evalPage('document.getElementById("json-status").textContent.includes("문법")'));
    assert.equal(await evalPage('document.querySelectorAll("#template-list li").length'), 2);
    await importJson(JSON.stringify({ version: 1, templates: [{ id: 'missing' }] }), 'missing.json');
    await until(() => evalPage('document.getElementById("json-status").textContent.includes("필수 항목")'));
    assert.equal(await evalPage('document.querySelectorAll("#template-list li").length'), 2);
    console.log(`T03-C04~C13·C17~C24 검사 통과: JPEG·PNG, 위치·크기·색, 잘못된 파일 보존, 세 비율 픽셀 차이 ${ratioResults.join(', ')}, 템플릿 3개 CRUD·새로고침 유지, JSON 정상·문법 손상·필수 누락`);

    if (process.argv.includes('--extremes')) {
      async function drawnText(value) {
        return evalPage(`(async () => {
          const original = CanvasRenderingContext2D.prototype.fillText;
          const drawn = [];
          CanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
            if (this.canvas.id === 'preview-canvas') drawn.push({ text, x, y, width: this.measureText(text).width });
            return original.call(this, text, x, y);
          };
          const caption = document.getElementById('caption');
          caption.value = ${JSON.stringify(value)};
          caption.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
          CanvasRenderingContext2D.prototype.fillText = original;
          return drawn;
        })()`);
      }
      const results = [];
      const longKorean = '긴 한글 문구가 카드의 경계를 넘어가지 않도록 자연스럽게 줄바꿈되어야 합니다. '.repeat(5);
      const longDrawn = await drawnText(longKorean);
      assert.ok(longDrawn.length > 1);
      results.push(`01 긴 한글: ${longDrawn.length}줄 PASS`);
      const mixedValue = '한글 English mixed 123 ABC 테스트';
      const mixed = await drawnText(mixedValue);
      assert.ok(mixed.length >= 1);
      assert.equal(await evalPage('document.getElementById("caption").value'), mixedValue);
      results.push('02 한글·영문·숫자 혼합: 문구 유지 PASS');
      const newline = await drawnText('첫 줄\n둘째 줄\n셋째 줄');
      assert.equal(newline.length, 3);
      results.push('03 명시적 줄바꿈: 3줄 PASS');
      const emojiValue = '이모지 😄 👩‍💻 🌿';
      const emoji = await drawnText(emojiValue);
      assert.ok(emoji.length >= 1);
      assert.equal(await evalPage('document.getElementById("caption").value'), emojiValue);
      results.push('04 이모지·결합 문자: 입력 유지 PASS');
      assert.equal((await drawnText('')).length, 0);
      assert.match(await evalPage('document.getElementById("preview-status").textContent'), /비어/);
      results.push('05 빈 문구: 이미지 유지·문구 없음 PASS');
      await uploadImage('image/png', 'portrait.png', 24, 40);
      assert.match(await evalPage('document.getElementById("image-status").textContent'), /24 × 40/);
      results.push('06 세로 이미지: 24×40 불러오기 PASS');
      await uploadImage('image/jpeg', 'landscape.jpg', 40, 24);
      assert.match(await evalPage('document.getElementById("image-status").textContent'), /40 × 24/);
      results.push('07 가로 이미지: 40×24 불러오기 PASS');
      await uploadImage('image/png', 'transparent.png', 24, 24, true);
      await wait(80);
      assert.equal(await evalPage(`(() => {
        const canvas = document.getElementById('preview-canvas');
        return canvas.getContext('2d').getImageData(canvas.width - 8, canvas.height - 8, 1, 1).data[3];
      })()`), 0);
      results.push('08 투명 이미지: 투명 픽셀 유지 PASS');
      await uploadImage('image/png', 'tiny.png', 1, 1);
      assert.match(await evalPage('document.getElementById("image-status").textContent'), /1 × 1/);
      results.push('09 1×1 이미지: 불러오기 PASS');
      await setValue('font-size', '144');
      assert.equal((await drawnText('큰 글자')).length, 1);
      results.push('10 글자 크기 144px: 미리보기 PASS');
      await setValue('text-x', '10');
      await setValue('text-y', '10');
      const edge = await drawnText('가장자리');
      assert.ok(edge.length === 1 && edge[0].x - edge[0].width / 2 >= 0 && edge[0].y > 0);
      results.push('11 가장자리 위치 10%·10%: 문구 안쪽 유지 PASS');
      const beforeBroken = await evalPage('document.getElementById("preview-canvas").toDataURL()');
      await evalPage(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['broken data'], 'damaged.png', { type: 'image/png' }));
        const input = document.getElementById('image-input');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await until(() => evalPage('document.getElementById("image-status").textContent.includes("읽을 수 없습니다")'));
      assert.equal(await evalPage('document.getElementById("preview-canvas").toDataURL()'), beforeBroken);
      assert.equal(await evalPage('document.getElementById("caption").value'), '가장자리');
      results.push('12 손상된 PNG: 거부 이유 표시·기존 편집 유지 PASS');
      console.log(`T03-C14·C16 극단 입력 12건 통과:\n${results.join('\n')}`);
    }
    for (const [width, height] of [[1366, 768], [1920, 1080], [375, 812]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await evalPage('document.querySelector("[data-ratio=story]").click()');
      await wait(80);
      const layout = await evalPage(`(() => {
        const preview = document.getElementById('preview-canvas').getBoundingClientRect();
        const stage = document.querySelector('.preview-stage').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          previewInside: preview.left >= stage.left && preview.right <= stage.right && preview.top >= stage.top && preview.bottom <= stage.bottom };
      })()`);
      assert.equal(layout.overflow, false, `${width}×${height} 가로 넘침`);
      assert.equal(layout.previewInside, true, `${width}×${height} 미리보기 영역 넘침`);
    }
    console.log('레이아웃 검사 통과: 1366×768·1920×1080·375×812 가로 넘침 및 미리보기 영역 넘침 0건');
  }
  if (process.argv.includes('--examples')) {
    await call('Page.navigate', { url: `${base}/?examples=1` });
    await until(() => evalPage('location.search === "?examples=1" && !!document.getElementById("preview-canvas")'));
    const examples = [
      { file: '01-square.png', ratio: 'square', caption: '한 장으로 남기기', size: 90, y: 76, color: '#ffffff', palette: null },
      { file: '02-portrait.png', ratio: 'portrait', caption: '생각을 모아\n한 장의 카드로', size: 86, y: 72, color: '#fff2d5', palette: ['#d88b5e', '#402d4c', '#ffe4ad'] },
      { file: '03-story.png', ratio: 'story', caption: '오늘의 한 줄\n천천히, 선명하게', size: 84, y: 74, color: '#ffffff', palette: ['#365e75', '#111c32', '#e6b66b'] }
    ];
    for (const example of examples) {
      await evalPage(`(async () => {
        const example = ${JSON.stringify(example)};
        document.querySelector('[data-ratio="' + example.ratio + '"]').click();
        if (example.palette) {
          const source = document.createElement('canvas');
          source.width = 1080;
          source.height = example.ratio === 'story' ? 1920 : 1350;
          const context = source.getContext('2d');
          const gradient = context.createLinearGradient(0, 0, source.width, source.height);
          gradient.addColorStop(0, example.palette[0]);
          gradient.addColorStop(1, example.palette[1]);
          context.fillStyle = gradient;
          context.fillRect(0, 0, source.width, source.height);
          context.fillStyle = example.palette[2] + '55';
          context.beginPath();
          context.arc(source.width * .75, source.height * .24, source.width * .31, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = example.palette[2] + '99';
          context.lineWidth = 6;
          context.strokeRect(64, 64, source.width - 128, source.height - 128);
          const blob = await new Promise(done => source.toBlob(done, 'image/png'));
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], example.file, { type: 'image/png' }));
          const imageInput = document.getElementById('image-input');
          imageInput.files = transfer.files;
          imageInput.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((done, fail) => {
            const started = Date.now();
            const check = () => {
              const status = document.getElementById('image-status').textContent;
              if (status.includes(example.file) && status.includes('적용됨')) done();
              else if (Date.now() - started > 5000) fail(new Error('예시 이미지 적용 실패'));
              else setTimeout(check, 30);
            };
            check();
          });
        }
        for (const [id, value] of [['caption', example.caption], ['font-size', example.size], ['text-y', example.y], ['text-color', example.color]]) {
          const input = document.getElementById(id);
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await document.fonts.ready;
        await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
      })()`);
      const dataUrl = await evalPage('document.getElementById("preview-canvas").toDataURL("image/png")');
      const output = resolve(root, 'examples', example.file);
      if (!output.startsWith(`${root}${sep}`)) throw new Error('예시 출력 경로 오류');
      writeFileSync(output, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`완성 이미지 생성: ${example.file}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('T03-C03 통과: 1366×768 첫 화면에 이미지·문구 편집 도구 표시, 문구·위치·이미지 변경 후 미리보기 갱신, PNG 출력 1080×1080, JavaScript 예외 0건');
}

try { await main(); }
finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (browser && !browser.killed) browser.kill();
  if (server) await new Promise(done => server.close(done));
  if (resolve(profile).startsWith(`${resolve(tmpdir())}${sep}`)) {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 종료 직후 잠긴 파일은 OS가 정리한다. */ }
  }
}
