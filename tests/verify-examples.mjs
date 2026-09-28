import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../examples');
const expected = [
  ['01-square.png', 1080, 1080],
  ['02-portrait.png', 1080, 1350],
  ['03-story.png', 1080, 1920]
];
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const metadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

for (const [name, width, height] of expected) {
  const data = readFileSync(resolve(examples, name));
  assert.ok(data.subarray(0, 8).equals(signature), `${name}: PNG 서명 오류`);
  let offset = 8;
  let foundIend = false;
  const foundMetadata = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + 12 + length <= data.length, `${name}: PNG 청크 길이 오류`);
    if (type === 'IHDR') {
      assert.equal(data.readUInt32BE(offset + 8), width);
      assert.equal(data.readUInt32BE(offset + 12), height);
    }
    if (metadataChunks.has(type)) foundMetadata.push(type);
    offset += length + 12;
    if (type === 'IEND') { foundIend = true; break; }
  }
  assert.equal(foundIend, true, `${name}: PNG 종료 청크 없음`);
  assert.equal(offset, data.length, `${name}: PNG 끝에 추가 데이터 존재`);
  assert.deepEqual(foundMetadata, [], `${name}: 메타데이터 청크 발견`);
  console.log(`${name}: ${width}×${height}, ${data.length} bytes, EXIF·텍스트 메타데이터 0건`);
}
