/**
 * Kiểm thử bộ đọc Code 128 tự viết — chạy: npx tsx scripts/dm_test_code128.ts
 * Mã giả lập giống nhãn TI EMIC: lề trắng chỉ 1 mô-đun, viền đen dính sát (ca zxing không đọc được).
 */
import { encode128B, readCode128 } from '../src/lib/dm/code128';

let pass = 0;
const fails: string[] = [];
const eq = (a: unknown, b: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++; else fails.push(`${label}: mong đợi ${JSON.stringify(b)}, nhận ${JSON.stringify(a)}`);
};

function label(text: string, px: number, opts: { flip?: boolean; vertical?: boolean; noise?: number } = {}) {
  const mods = encode128B(text);
  const frame = 8, quiet = 1, barW = Math.round((mods.length + 2 * quiet) * px) + 2 * frame;
  const W = barW + 200, H = 140;
  const g = new Uint8Array(W * H).fill(200);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  for (let y = 50; y < 90; y++) for (let x = 100; x < 100 + barW; x++) {
    const xi = x - 100 - frame;
    let v = 15;
    if (xi >= 0 && xi < barW - 2 * frame) { const m = Math.floor(xi / px) - quiet; v = m < 0 || m >= mods.length || !mods[m] ? 235 : 25; }
    g[y * W + x] = Math.max(0, Math.min(255, v + (opts.noise ?? 0) * rnd()));
  }
  if (opts.flip) g.reverse();
  if (!opts.vertical) return { g, W, H };
  const t = new Uint8Array(W * H); // xoay 90°: cột thành hàng
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x * H + y] = g[y * W + x];
  return { g: t, W: H, H: W };
}

const S = '2620014915';
for (const px of [1.5, 2, 3, 4]) {
  const { g, W, H } = label(S, px);
  eq(readCode128(g, W, H)[0]?.text, S, `nhãn TI lề 1 mô-đun, ${px} px/mô-đun`);
}
{ const { g, W, H } = label(S, 2.5, { noise: 60 }); eq(readCode128(g, W, H)[0]?.text, S, 'có nhiễu'); }
{ const { g, W, H } = label(S, 2.5, { flip: true }); eq(readCode128(g, W, H)[0]?.text, S, 'ảnh lộn ngược'); }
{ const { g, W, H } = label('2610563853', 3, { vertical: true }); eq(readCode128(g, W, H)[0]?.text, '2610563853', 'ảnh xoay 90°'); }
{ const g = new Uint8Array(400 * 100).map((_, i) => (i * 7919) % 251); eq(readCode128(g, 400, 100), [], 'ảnh nhiễu không ra số bịa'); }

if (fails.length) { console.error(`✗ ${fails.length} ca đỏ / ${pass + fails.length}`); fails.forEach(f => console.error('  - ' + f)); process.exit(1); }
console.log(`✓ ${pass} ca xanh`);
