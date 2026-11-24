// Generates build/icon.png (256x256) — a pastel memo card — with no dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const px = Buffer.alloc(S * S * 4);

const mix = (a, b, t) => Math.round(a + (b - a) * t);
function blend(x, y, [r, g, b], a) {
  const i = (y * S + x) * 4;
  const da = px[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa === 0) return;
  px[i] = Math.round((r * a + px[i] * da * (1 - a)) / oa);
  px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / oa);
  px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / oa);
  px[i + 3] = Math.round(oa * 255);
}
// signed distance to a rounded rect, for anti-aliased edges
function sdRound(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function rrect(x0, y0, x1, y1, r, colorAt, alpha = 1) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = sdRound(x + 0.5, y + 0.5, x0, y0, x1, y1, r);
    const cov = Math.min(1, Math.max(0, 0.5 - d));
    if (cov > 0) blend(x, y, colorAt(x, y), cov * alpha);
  }
}

// back card (lavender), slightly offset
rrect(58, 30, 234, 206, 34, () => [214, 198, 250], 1);
// shadow
rrect(26, 58, 206, 238, 36, () => [120, 70, 90], 0.18);
// main card (peach gradient)
rrect(22, 50, 202, 230, 34, (x, y) => {
  const t = (x + y) / (2 * S);
  return [255, mix(232, 205, t), mix(220, 190, t)];
});
// header strip
for (let y = 50; y < 88; y++) for (let x = 0; x < S; x++) {
  const d = sdRound(x + 0.5, y + 0.5, 22, 50, 202, 230, 34);
  const cov = Math.min(1, Math.max(0, 0.5 - d));
  if (cov > 0) blend(x, y, [255, 184, 160], cov);
}
// text lines
[[52, 116, 170], [52, 146, 156], [52, 176, 128]].forEach(([x0, y0, x1]) =>
  rrect(x0, y0, x1, y0 + 12, 6, () => [222, 140, 120], 0.75));

// ---- PNG encode ----
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('icon.png written');
