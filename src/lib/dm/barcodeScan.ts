/**
 * ĐỌC MÃ VẠCH trên nhãn thiết bị — miễn phí, chạy trong trình duyệt, không gửi ảnh đi đâu, không lưu ảnh
 * (user chốt 27/10/2026). Plan `plans/2026-10-27-them-vat-tu-bang-anh.md`.
 *
 * Hai bộ đọc, thử lần lượt:
 *  1. `code128.ts` — bộ Code 128 TỰ VIẾT theo dòng quét: đọc được nhãn TI EMIC không có lề trắng mà zxing trượt.
 *  2. `zxing-wasm` — mọi kiểu mã khác (QR, EAN…); wasm tự lưu trữ ở `public/ocr/` (mạng công ty chặn chứng chỉ CDN),
 *     chỉ tải khi cần (import động).
 */
import type { ReadResult, ReaderOptions } from 'zxing-wasm/reader';
import { readCode128 } from './code128';

let ready: Promise<typeof import('zxing-wasm/reader')> | null = null;
function zxing() {
  ready ??= import('zxing-wasm/reader').then(m => {
    m.prepareZXingModule({ overrides: { locateFile: (p: string) => (p.endsWith('.wasm') ? '/ocr/zxing_reader.wasm' : p) } });
    return m;
  });
  return ready;
}

const OPTS: ReaderOptions = {
  tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true,
  // Không giới hạn kiểu mã — đợt thử này cần biết nhãn thật dùng kiểu nào.
  maxNumberOfSymbols: 8,
};

export interface BarcodeHit {
  format: string;
  text: string;
  /** Bộ đọc ra kết quả: 'tự viết' (Code 128 theo dòng quét) | 'zxing'. */
  engine: string;
  /** Số dòng quét cùng ra số này (chỉ bộ tự viết) — càng nhiều càng chắc. */
  votes?: number;
}
export interface BarcodeScan {
  hits: BarcodeHit[];
  /** Lượt tìm thấy (vd "tự viết 2000", "zxing gốc"), '' nếu không thấy. */
  pass: string;
  width: number; height: number;
  ms: number;
}

function toImageData(src: CanvasImageSource, w: number, h: number, maxSide: number, grey: boolean): ImageData {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * k), ch = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (grey) g.filter = 'grayscale(1) contrast(1.6)';
  g.drawImage(src, 0, 0, cw, ch);
  return g.getImageData(0, 0, cw, ch);
}

function grayOf(img: ImageData): Uint8Array {
  const d = img.data, out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return out;
}

function ownHits(img: ImageData, opts?: Parameters<typeof readCode128>[3]): BarcodeHit[] {
  return readCode128(grayOf(img), img.width, img.height, opts)
    .map(r => ({ format: 'Code128', text: r.text, engine: 'tự viết', votes: r.votes }));
}

const uniq = (rs: ReadResult[]): BarcodeHit[] => {
  const seen = new Set<string>();
  return rs.filter(r => r.isValid && r.text).map(r => ({ format: r.format, text: r.text.trim(), engine: 'zxing' }))
    .filter(h => !seen.has(h.text) && (seen.add(h.text), true));
};

/** Nhường luồng cho giao diện vẽ lại (bộ tự viết chạy đồng bộ ~1–3 giây/ảnh). */
const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Đọc mã vạch trong một ảnh: bộ tự viết ở 2000 rồi 3200 điểm ảnh (mã TI nhỏ cần độ phân giải),
 * không ra thì zxing (gốc → thu nhỏ → xám + tương phản).
 */
export async function scanBarcodeFile(file: Blob): Promise<BarcodeScan> {
  const t0 = performance.now();
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bmp;
  const done = (hits: BarcodeHit[], pass: string): BarcodeScan =>
    ({ hits, pass, width, height, ms: Math.round(performance.now() - t0) });
  try {
    for (const side of [2000, 3200]) {
      if (side > 2000 && Math.max(width, height) <= 2000) break;
      await tick();
      const hits = ownHits(toImageData(bmp, width, height, side, false));
      if (hits.length) return done(hits, `tự viết ${Math.min(side, Math.max(width, height))}`);
    }
    const m = await zxing();
    const passes: [string, number, boolean][] = [
      ['zxing gốc', 4096, false], ['zxing thu 2000', 2000, false], ['zxing thu 1200', 1200, false], ['zxing xám 2000', 2000, true],
    ];
    for (const [name, side, grey] of passes) {
      const hits = uniq(await m.readBarcodes(toImageData(bmp, width, height, side, grey), OPTS));
      if (hits.length) return done(hits, name);
    }
    return done([], '');
  } finally {
    bmp.close();
  }
}

/** Đọc một khung hình camera (quét trực tiếp): bộ tự viết trên dải giữa khung, rồi zxing. */
export async function scanBarcodeFrame(video: HTMLVideoElement): Promise<BarcodeHit[]> {
  if (!video.videoWidth) return [];
  const img = toImageData(video, video.videoWidth, video.videoHeight, 1920, false);
  const own = ownHits(img, { y0: Math.round(img.height * 0.3), y1: Math.round(img.height * 0.7), step: 2, columns: false });
  if (own.length) return own;
  const m = await zxing();
  return uniq(await m.readBarcodes(img, OPTS));
}
