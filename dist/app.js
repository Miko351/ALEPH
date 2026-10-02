(() => {
  'use strict';

  const RATIOS = {
    square: { label: '1:1', width: 1080, height: 1080 },
    portrait: { label: '4:5', width: 1080, height: 1350 },
    story: { label: '9:16', width: 1080, height: 1920 }
  };
  const DB_NAME = 'aleph-card-studio-v1';
  const STORE_NAME = 'templates';
  const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1920;
  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  const imageInput = document.getElementById('image-input');
  const imageStatus = document.getElementById('image-status');
  const caption = document.getElementById('caption');
  const xInput = document.getElementById('text-x');
  const yInput = document.getElementById('text-y');
  const sizeInput = document.getElementById('font-size');
  const colorInput = document.getElementById('text-color');
  const ratioButtons = [...document.querySelectorAll('[data-ratio]')];
  const ratioBadge = document.getElementById('ratio-badge');
  const templateName = document.getElementById('template-name');
  const templateList = document.getElementById('template-list');
  const templateStatus = document.getElementById('template-status');
  const templateUpdate = document.getElementById('template-update');
  const jsonInput = document.getElementById('json-import');
  const jsonStatus = document.getElementById('json-status');
  const state = { ratio: 'square', image: null, imageBlob: null, selectedTemplateId: null };
  let loadSequence = 0;
  let renderFrame = 0;
  let dbPromise;
  let textDrag = null;
  let textHitRegions = [];

  function setStatus(node, message, isError = false) {
    node.textContent = message;
    node.classList.toggle('is-error', isError);
  }

  function drawCover(image) {
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }

  function drawBase() {
    if (state.image) { drawCover(state.image); return; }
    const { width, height } = canvas;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#3a7468');
    gradient.addColorStop(.55, '#183c46');
    gradient.addColorStop(1, '#15262f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff12';
    ctx.beginPath();
    ctx.arc(width * .77, height * .21, width * .26, 0, Math.PI * 2);
    ctx.fill();
    const inset = width * .05;
    ctx.strokeStyle = '#ffffff35';
    ctx.lineWidth = 2;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  function graphemes(value) {
    if (Intl.Segmenter) return [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)].map(part => part.segment);
    return Array.from(value);
  }

  function wrapParagraph(paragraph, maxWidth) {
    if (!paragraph) return [''];
    const lines = [];
    let line = '';
    for (const glyph of graphemes(paragraph)) {
      const candidate = line + glyph;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        const breakAt = line.lastIndexOf(' ');
        if (breakAt > 0) {
          lines.push(line.slice(0, breakAt).trimEnd());
          line = `${line.slice(breakAt + 1)}${glyph}`.trimStart();
        } else {
          lines.push(line);
          line = glyph.trimStart();
        }
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
    return lines;
  }

  function layoutText() {
    const requestedSize = Number(sizeInput.value);
    const maxWidth = canvas.width * .84;
    const maxHeight = canvas.height * .82;
    let result;
    for (let size = requestedSize; size >= 10; size -= 2) {
      ctx.font = `800 ${size}px "Malgun Gothic", "Segoe UI", sans-serif`;
      const lines = caption.value.split(/\r?\n/).flatMap(paragraph => wrapParagraph(paragraph, maxWidth));
      const lineHeight = size * 1.27;
      const height = lines.length * lineHeight;
      result = { lines, size, lineHeight, height, maxWidth };
      if (height <= maxHeight) break;
    }
    return result;
  }

  function drawText() {
    if (!caption.value) return;
    // Keep text styles from changing the background on the next render.
    ctx.save();
    const layout = layoutText();
    const { lines, size, lineHeight, height } = layout;
    ctx.font = `800 ${size}px "Malgun Gothic", "Segoe UI", sans-serif`;
    const widest = Math.max(0, ...lines.map(line => ctx.measureText(line).width));
    const margin = canvas.width * .04;
    const wantedX = canvas.width * Number(xInput.value) / 100;
    const wantedY = canvas.height * Number(yInput.value) / 100;
    const x = Math.min(canvas.width - margin - widest / 2, Math.max(margin + widest / 2, wantedX));
    const y = Math.min(canvas.height - margin - height / 2, Math.max(margin + height / 2, wantedY));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#091920b8';
    ctx.lineWidth = Math.max(3, size * .09);
    ctx.fillStyle = colorInput.value;
    lines.forEach((line, index) => {
      const lineY = y + (index - (lines.length - 1) / 2) * lineHeight;
      if (line.trim()) {
        const metrics = ctx.measureText(line);
        const padding = ctx.lineWidth / 2;
        textHitRegions.push({
          left: x - metrics.actualBoundingBoxLeft - padding,
          right: x + metrics.actualBoundingBoxRight + padding,
          top: lineY - metrics.actualBoundingBoxAscent - padding,
          bottom: lineY + metrics.actualBoundingBoxDescent + padding
        });
      }
      ctx.strokeText(line, x, lineY);
      ctx.fillText(line, x, lineY);
    });
    ctx.restore();
    if (height > canvas.height * .82) setStatus(document.getElementById('preview-status'), '문구가 너무 길어 화면 밖으로 나갈 수 있습니다. 문구를 줄여주세요.', true);
    else if (size < Number(sizeInput.value)) setStatus(document.getElementById('preview-status'), `긴 문구를 모두 표시하기 위해 글자 크기를 ${size}px로 자동 조정했습니다.`);
    else setStatus(document.getElementById('preview-status'), '미리보기와 내려받기는 같은 합성 화면을 사용합니다.');
  }

  function render() {
    renderFrame = 0;
    textHitRegions = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBase();
    if (!caption.value) setStatus(document.getElementById('preview-status'), '문구가 비어 있어 이미지 또는 배경만 표시됩니다.');
    else drawText();
    canvas.setAttribute('aria-label', `편집 중인 ${RATIOS[state.ratio].label} 이미지 미리보기. 문구: ${caption.value || '없음'}`);
  }

  function scheduleRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(render);
  }

  function setRatio(key) {
    if (!Object.hasOwn(RATIOS, key)) return;
    state.ratio = key;
    const ratio = RATIOS[key];
    canvas.width = ratio.width;
    canvas.height = ratio.height;
    ratioBadge.textContent = `${ratio.label} · ${ratio.width} × ${ratio.height}`;
    ratioButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.ratio === key)));
    scheduleRender();
  }

  async function cleanBitmap(source) {
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(source.width, source.height));
      const clean = document.createElement('canvas');
      clean.width = Math.max(1, Math.round(source.width * scale));
      clean.height = Math.max(1, Math.round(source.height * scale));
      clean.getContext('2d').drawImage(source, 0, 0, clean.width, clean.height);
      const blob = await new Promise(done => clean.toBlob(done, 'image/png'));
      if (!blob) throw new Error('이미지 변환 실패');
      return { bitmap: await createImageBitmap(blob), blob };
  }

  async function normalizedImage(file) {
    if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('PNG 또는 JPEG만 사용할 수 있습니다. 기존 작업은 유지됩니다.');
    if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('이미지 파일은 30MB 이하만 사용할 수 있습니다. 기존 작업은 유지됩니다.');
    let source;
    try { source = await createImageBitmap(file); }
    catch { throw new Error('이미지를 읽을 수 없습니다. 다른 PNG 또는 JPEG 파일을 선택하세요. 기존 작업은 유지됩니다.'); }
    try { return await cleanBitmap(source); }
    finally { source.close(); }
  }

  function applyImage(bitmap, blob) {
    state.image?.close();
    state.image = bitmap;
    state.imageBlob = blob;
    scheduleRender();
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((done, fail) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(new Error('브라우저 저장소를 열 수 없습니다.'));
    });
    return dbPromise;
  }

  async function allTemplates() {
    const db = await openDb();
    return new Promise((done, fail) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => done(request.result.sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => fail(new Error('템플릿을 읽을 수 없습니다.'));
    });
  }

  async function putTemplates(templates) {
    const db = await openDb();
    return new Promise((done, fail) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      for (const template of templates) transaction.objectStore(STORE_NAME).put(template);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(new Error('템플릿을 저장할 수 없습니다.'));
      transaction.onabort = () => fail(new Error('템플릿 저장이 취소됐습니다.'));
    });
  }

  async function deleteTemplate(id) {
    const db = await openDb();
    return new Promise((done, fail) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(new Error('템플릿을 삭제할 수 없습니다.'));
    });
  }

  function currentTemplate(id, createdAt = Date.now()) {
    return {
      id, name: templateName.value.trim(), ratio: state.ratio, caption: caption.value,
      x: Number(xInput.value), y: Number(yInput.value), size: Number(sizeInput.value),
      color: colorInput.value, imageBlob: state.imageBlob, createdAt, updatedAt: Date.now()
    };
  }

  async function renderTemplateList() {
    const templates = await allTemplates();
    templateList.replaceChildren();
    for (const template of templates) {
      const item = document.createElement('li');
      item.dataset.id = template.id;
      item.classList.toggle('is-selected', template.id === state.selectedTemplateId);
      const name = document.createElement('strong');
      name.textContent = template.name;
      const ratio = document.createElement('small');
      ratio.textContent = RATIOS[template.ratio]?.label || '?';
      const load = document.createElement('button');
      load.type = 'button';
      load.dataset.action = 'load';
      load.textContent = '불러오기';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.action = 'delete';
      remove.textContent = '삭제';
      item.append(name, ratio, load, remove);
      templateList.append(item);
    }
    if (!templates.length) setStatus(templateStatus, '저장된 템플릿이 없습니다.');
    return templates;
  }

  async function loadTemplate(template) {
    let bitmap = null;
    if (template.imageBlob) bitmap = await createImageBitmap(template.imageBlob);
    applyImage(bitmap, template.imageBlob);
    setStatus(imageStatus, template.imageBlob ? `“${template.name}” 템플릿의 이미지가 적용됐습니다.` : '템플릿에 저장된 기본 배경이 적용됐습니다.');
    templateName.value = template.name;
    caption.value = template.caption;
    for (const [input, output, value, suffix] of [
      [xInput, document.getElementById('text-x-value'), template.x, '%'],
      [yInput, document.getElementById('text-y-value'), template.y, '%'],
      [sizeInput, document.getElementById('font-size-value'), template.size, 'px']
    ]) { input.value = String(value); output.value = `${value}${suffix}`; }
    colorInput.value = template.color;
    setRatio(template.ratio);
    state.selectedTemplateId = template.id;
    templateUpdate.disabled = false;
    await renderTemplateList();
    setStatus(templateStatus, `“${template.name}” 템플릿을 불러왔습니다.`);
  }

  function blobToDataUrl(blob) {
    return new Promise((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.onerror = () => fail(new Error('이미지를 JSON으로 변환할 수 없습니다.'));
      reader.readAsDataURL(blob);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function validateImport(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.templates) || value.templates.length > 100) {
      throw new Error('JSON 형식이나 버전이 올바르지 않습니다. 기존 템플릿은 유지됩니다.');
    }
    const ids = new Set();
    const checked = [];
    for (const item of value.templates) {
      if (!item || typeof item !== 'object' ||
          typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 ||
          !Object.hasOwn(RATIOS, item.ratio) || typeof item.caption !== 'string' || item.caption.length > 10000 ||
          !Number.isInteger(item.x) || item.x < 10 || item.x > 90 ||
          !Number.isInteger(item.y) || item.y < 10 || item.y > 90 ||
          !Number.isInteger(item.size) || item.size < 24 || item.size > 144 ||
          typeof item.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color) ||
          !Number.isSafeInteger(item.createdAt) || item.createdAt <= 0 ||
          !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.createdAt ||
          !Object.hasOwn(item, 'imageDataUrl') ||
          !(item.imageDataUrl === null || (typeof item.imageDataUrl === 'string' && /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(item.imageDataUrl)))) {
        throw new Error('필수 항목이 빠졌거나 값이 잘못됐습니다. 기존 템플릿은 유지됩니다.');
      }
      ids.add(item.id);
      let imageBlob = null;
      if (item.imageDataUrl) {
        const sourceBlob = await (await fetch(item.imageDataUrl)).blob();
        if (sourceBlob.size > MAX_SOURCE_BYTES) throw new Error('JSON 이미지가 너무 큽니다. 기존 템플릿은 유지됩니다.');
        let bitmap;
        try {
          bitmap = await createImageBitmap(sourceBlob);
          const cleaned = await cleanBitmap(bitmap);
          imageBlob = cleaned.blob;
          cleaned.bitmap.close();
        } catch { throw new Error('JSON 이미지가 손상됐습니다. 기존 템플릿은 유지됩니다.'); }
        finally { bitmap?.close(); }
      }
      checked.push({
        id: item.id, name: item.name.trim(), ratio: item.ratio, caption: item.caption,
        x: item.x, y: item.y, size: item.size, color: item.color,
        createdAt: item.createdAt, updatedAt: item.updatedAt, imageBlob
      });
    }
    return checked;
  }

  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const thisLoad = ++loadSequence;
    try {
      const next = await normalizedImage(file);
      if (thisLoad !== loadSequence) { next.bitmap.close(); return; }
      applyImage(next.bitmap, next.blob);
      setStatus(imageStatus, `${file.name} · ${next.bitmap.width} × ${next.bitmap.height} 적용됨. 위치 정보가 포함된 원본 메타데이터는 합성에 사용하지 않습니다.`);
    } catch (error) {
      setStatus(imageStatus, error.message || '이미지를 읽을 수 없습니다. 기존 작업은 유지됩니다.', true);
    } finally { imageInput.value = ''; }
  });

  for (const [input, output, suffix] of [
    [xInput, document.getElementById('text-x-value'), '%'],
    [yInput, document.getElementById('text-y-value'), '%'],
    [sizeInput, document.getElementById('font-size-value'), 'px']
  ]) {
    input.addEventListener('input', () => { output.value = `${input.value}${suffix}`; scheduleRender(); });
  }
  caption.addEventListener('input', scheduleRender);
  colorInput.addEventListener('input', scheduleRender);
  ratioButtons.forEach(button => button.addEventListener('click', () => setRatio(button.dataset.ratio)));

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || textDrag || !caption.value.trim()) return;
    if (renderFrame) {
      cancelAnimationFrame(renderFrame);
      render();
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width * canvas.width;
    const y = (event.clientY - rect.top) / rect.height * canvas.height;
    if (!textHitRegions.some(region => x >= region.left && x <= region.right && y >= region.top && y <= region.bottom)) return;
    textDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTextX: Number(xInput.value),
      startTextY: Number(yInput.value),
      width: rect.width,
      height: rect.height
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!textDrag || textDrag.pointerId !== event.pointerId) return;
    if (!canvas.hasPointerCapture(event.pointerId)) {
      textDrag = null;
      canvas.style.cursor = '';
      return;
    }
    const nextX = Math.round(textDrag.startTextX + (event.clientX - textDrag.startX) / textDrag.width * 100);
    const nextY = Math.round(textDrag.startTextY + (event.clientY - textDrag.startY) / textDrag.height * 100);
    const x = String(Math.max(Number(xInput.min), Math.min(Number(xInput.max), nextX)));
    const y = String(Math.max(Number(yInput.min), Math.min(Number(yInput.max), nextY)));
    if (xInput.value === x && yInput.value === y) return;
    xInput.value = x;
    yInput.value = y;
    xInput.dispatchEvent(new Event('input', { bubbles: true }));
    yInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
      if (textDrag?.pointerId !== event.pointerId) return;
      textDrag = null;
      canvas.style.cursor = '';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
  }

  document.getElementById('download').addEventListener('click', async () => {
    try {
      await document.fonts.ready;
      if (renderFrame) cancelAnimationFrame(renderFrame);
      render();
      const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('이미지를 저장하지 못했습니다.');
      downloadBlob(blob, `card-studio-${RATIOS[state.ratio].label.replace(':', 'x')}.png`);
    } catch (error) { setStatus(imageStatus, error.message, true); }
  });

  document.getElementById('template-create').addEventListener('click', async () => {
    if (!templateName.value.trim()) { setStatus(templateStatus, '템플릿 이름을 입력하세요.', true); templateName.focus(); return; }
    try {
      const template = currentTemplate(crypto.randomUUID());
      await putTemplates([template]);
      state.selectedTemplateId = template.id;
      templateUpdate.disabled = false;
      await renderTemplateList();
      setStatus(templateStatus, `“${template.name}” 템플릿을 저장했습니다.`);
    } catch (error) { setStatus(templateStatus, error.message, true); }
  });

  templateUpdate.addEventListener('click', async () => {
    if (!state.selectedTemplateId) return;
    if (!templateName.value.trim()) { setStatus(templateStatus, '템플릿 이름을 입력하세요.', true); templateName.focus(); return; }
    try {
      const existing = (await allTemplates()).find(item => item.id === state.selectedTemplateId);
      if (!existing) throw new Error('수정할 템플릿을 찾을 수 없습니다.');
      const template = currentTemplate(existing.id, existing.createdAt);
      await putTemplates([template]);
      await renderTemplateList();
      setStatus(templateStatus, `“${template.name}” 템플릿을 수정했습니다.`);
    } catch (error) { setStatus(templateStatus, error.message, true); }
  });

  templateList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('li')?.dataset.id;
    try {
      const template = (await allTemplates()).find(item => item.id === id);
      if (!template) throw new Error('템플릿을 찾을 수 없습니다.');
      if (button.dataset.action === 'load') {
        await loadTemplate(template);
      } else if (button.dataset.action === 'delete' && confirm(`“${template.name}” 템플릿을 삭제할까요?`)) {
        await deleteTemplate(id);
        if (state.selectedTemplateId === id) { state.selectedTemplateId = null; templateUpdate.disabled = true; }
        await renderTemplateList();
        setStatus(templateStatus, `“${template.name}” 템플릿을 삭제했습니다.`);
      }
    } catch (error) { setStatus(templateStatus, error.message, true); }
  });

  document.getElementById('json-export').addEventListener('click', async () => {
    try {
      const templates = await allTemplates();
      const serialized = await Promise.all(templates.map(async template => ({
        ...template, imageBlob: undefined,
        imageDataUrl: template.imageBlob ? await blobToDataUrl(template.imageBlob) : null
      })));
      const blob = new Blob([JSON.stringify({ version: 1, templates: serialized }, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'card-studio-templates.json');
      setStatus(jsonStatus, `템플릿 ${templates.length}개를 JSON으로 내보냈습니다.`);
    } catch (error) { setStatus(jsonStatus, error.message, true); }
  });

  jsonInput.addEventListener('change', async () => {
    const file = jsonInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('JSON 파일이 너무 큽니다. 기존 템플릿은 유지됩니다.');
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error('JSON 문법이 잘못됐습니다. 기존 템플릿은 유지됩니다.'); }
      const checked = await validateImport(parsed);
      await putTemplates(checked);
      await renderTemplateList();
      setStatus(jsonStatus, `템플릿 ${checked.length}개를 복원했습니다. 같은 ID의 템플릿은 갱신됐습니다.`);
    } catch (error) { setStatus(jsonStatus, error.message || 'JSON을 가져올 수 없습니다.', true); }
    finally { jsonInput.value = ''; }
  });

  setRatio('square');
  renderTemplateList().catch(error => setStatus(templateStatus, error.message, true));
})();
