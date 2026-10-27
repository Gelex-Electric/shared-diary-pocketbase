/**
 * BỘ ĐỌC CODE 128 TỰ VIẾT theo dòng quét — module THUẦN (không DOM, không thư viện).
 *
 * Vì sao có (phân tích 27/10/2026, `plans/2026-10-27-them-vat-tu-bang-anh.md`): mã vạch nhãn TI EMIC và công tơ GELEX
 * là Code 128 chuẩn, nhưng nhãn TI gần như KHÔNG có lề trắng (viền đen dính sát vạch) nên zxing không đọc được;
 * ảnh gốc công tơ ME-42 zxing cũng trượt trong khi giải tay ra số đúng checksum.
 *
 * Cách làm: lấy trung bình vài hàng ảnh thành một "dòng quét", ngưỡng cục bộ (trung bình trượt) để tách vạch tối /
 * khoảng sáng, tìm mẫu Start A/B/C, đọc từng ký hiệu (6 phần tử = 11 mô-đun, chuẩn hoá theo chính ký hiệu đó nên chịu
 * được ảnh nghiêng phối cảnh), đến mẫu Stop. CHỈ nhận khi checksum đúng ⇒ không trả số sai. Quét cả hai chiều
 * (ảnh lộn ngược) và cả ảnh xoay 90°. Không cần lề trắng.
 *
 * Test: `npx tsx scripts/dm_test_code128.ts`.
 */

const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 '
  + '122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 '
  + '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 '
  + '113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 '
  + '431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 '
  + '241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 '
  + '131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232')
  .split(' ').map(s => [...s].map(Number));
const STOP = [2, 3, 3, 1, 1, 1, 2];

/** Độ rộng các phần tử xen kẽ, bắt đầu bằng phần tử tối nếu `firstDark`. */
type Runs = { dark: boolean[]; len: number[] };

function matchSymbol(len: number[], i: number): [number, number] {
  let s = 0; for (let j = 0; j < 6; j++) s += len[i + j];
  let best = -1, bd = 1e9;
  for (let v = 0; v < PATTERNS.length; v++) {
    const p = PATTERNS[v]; let d = 0;
    for (let j = 0; j < 6 && d < bd; j++) d += Math.abs(p[j] - (len[i + j] * 11) / s);
    if (d < bd) { bd = d; best = v; }
  }
  return [best, bd];
}

function isStop(len: number[], i: number): boolean {
  let s = 0; for (let j = 0; j < 7; j++) s += len[i + j];
  let d = 0; for (let j = 0; j < 7; j++) d += Math.abs((len[i + j] * 13) / s - STOP[j]);
  return d < 2;
}

function toText(start: number, data: number[]): string {
  let set: 'A' | 'B' | 'C' = start === 105 ? 'C' : start === 104 ? 'B' : 'A';
  let txt = '';
  for (const v of data) {
    if (set === 'C') {
      if (v < 100) txt += String(v).padStart(2, '0');
      else if (v === 100) set = 'B'; else if (v === 101) set = 'A';
    } else if (v < 96) {
      // Bộ A: 64–95 là ký tự điều khiển — số No không dùng, bỏ qua.
      if (set === 'B' || v < 64) txt += String.fromCharCode(v + 32);
    } else if (v === 99) set = 'C';
    else if (v === 100 && set === 'A') set = 'B';
    else if (v === 101 && set === 'B') set = 'A';
  }
  return txt;
}

/** Giải mọi mã Code 128 hợp lệ (đúng checksum) trên một chuỗi phần tử. */
function decodeRuns(r: Runs, out: string[]) {
  const { dark, len } = r;
  for (let i = 0; i + 6 < len.length; i++) {
    if (!dark[i]) continue;
    const [start, d0] = matchSymbol(len, i);
    if (start < 103 || d0 > 1.6) continue;
    const vals = [start];
    let k = i + 6, ok = false;
    while (k + 7 <= len.length && vals.length < 48) {
      if (vals.length >= 3 && isStop(len, k)) { ok = true; break; }
      const [v, d] = matchSymbol(len, k);
      if (d > 2.2 || v >= 103) break;
      vals.push(v); k += 6;
    }
    if (!ok) continue;
    const data = vals.slice(1, -1), chk = vals[vals.length - 1];
    let sum = start; data.forEach((v, j) => { sum += v * (j + 1); });
    if (sum % 103 !== chk) continue;
    const t = toText(start, data);
    if (t) out.push(t);
    i = k; // nhảy qua mã vừa đọc
  }
}

/** Tách dòng quét thành phần tử tối/sáng bằng ngưỡng = trung bình trượt ±win điểm ảnh. */
function runsOf(prof: Float64Array, win: number, cs: Float64Array): Runs {
  const n = prof.length, dark: boolean[] = [], len: number[] = [];
  let cur: boolean | null = null, l = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win);
    const d = prof[i] < (cs[b] - cs[a]) / (b - a);
    if (d === cur) l++;
    else { if (cur !== null) { dark.push(cur); len.push(l); } cur = d; l = 1; }
  }
  if (cur !== null) { dark.push(cur); len.push(l); }
  return { dark, len };
}

const reversed = (r: Runs): Runs => ({ dark: [...r.dark].reverse(), len: [...r.len].reverse() });

export interface Code128Options {
  /** Bước giữa hai dòng quét (điểm ảnh). Mặc định 2. */
  step?: number;
  /** Chỉ quét các hàng trong [y0, y1) — quét trực tiếp chỉ cần dải giữa khung. */
  y0?: number; y1?: number;
  /** Thử thêm cột (ảnh xoay 90°) khi hàng không ra. Mặc định true. */
  columns?: boolean;
}

/**
 * Đọc Code 128 trên ảnh xám (mỗi điểm 1 byte, `gray[y*width + x]`).
 * Trả các chuỗi đọc được kèm số dòng quét đồng ý, nhiều nhất trước.
 */
export function readCode128(gray: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: Code128Options = {}):
  { text: string; votes: number }[] {
  const step = opts.step ?? 2, band = 3;
  const votes = new Map<string, number>();
  const scanLines = (lineLen: number, at: (line: number, pos: number) => number, from: number, to: number) => {
    const prof = new Float64Array(lineLen), cs = new Float64Array(lineLen + 1);
    for (let y = from; y + band <= to; y += step) {
      prof.fill(0);
      for (let r = y; r < y + band; r++) for (let x = 0; x < lineLen; x++) prof[x] += at(r, x);
      for (let x = 0; x < lineLen; x++) cs[x + 1] = cs[x] + prof[x];
      for (const win of [6, 12, 24]) {
        const runs = runsOf(prof, win, cs), found: string[] = [];
        decodeRuns(runs, found); decodeRuns(reversed(runs), found);
        for (const t of found) votes.set(t, (votes.get(t) ?? 0) + 1);
      }
    }
  };
  scanLines(width, (r, x) => gray[r * width + x], opts.y0 ?? 0, opts.y1 ?? height);
  if (!votes.size && (opts.columns ?? true)) scanLines(height, (c, y) => gray[y * width + c], 0, width);
  return [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([text, v]) => ({ text, votes: v }));
}

/** Dựng chuỗi mô-đun (1 = vạch tối) của một mã Code 128 bộ B — dùng cho test. */
export function encode128B(text: string): number[] {
  const vals = [104, ...[...text].map(c => c.charCodeAt(0) - 32)];
  const chk = vals.reduce((s, v, i) => s + v * (i || 1), 0) % 103;
  const widths = [...vals, chk].map(v => PATTERNS[v].join('')).join('') + STOP.join('');
  const mods: number[] = [];
  [...widths].forEach((w, i) => { for (let k = 0; k < Number(w); k++) mods.push(i % 2 === 0 ? 1 : 0); });
  return mods;
}
