// Deterministic synthetic fixture: no customer photo, no AI generation.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const width = 320, height = 200;
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const border = x < 12 || x >= width - 12 || y < 12 || y >= height - 12;
  const cross = Math.abs(x - width / 2) < 3 || Math.abs(y - height / 2) < 3;
  const color = border ? [170, 70, 40] : cross ? [30, 60, 50] : ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [235, 240, 230] : [210, 220, 210]);
  for (let c = 0; c < 3; c++) pixels[y * (width * 3 + 1) + 1 + x * 3 + c] = color[c];
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('tEXt', Buffer.from('Description\0NON-CUSTOMER SYNTHETIC STORAGE TEST ONLY; NOT A SITE PHOTO OR CASE')), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const folder = resolve('local-setup');
mkdirSync(folder, { recursive: true });
const output = resolve(folder, 'non-customer-storage-test.png');
writeFileSync(output, png);
const packageFolder = resolve('miniprogram/package-engineer/fixtures');
mkdirSync(packageFolder, { recursive: true });
writeFileSync(resolve(packageFolder, 'non-customer-storage-test.png'), png);
console.log(output, png.length + ' bytes');
