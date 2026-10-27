/**
 * ĐỌC MÃ VẠCH trên nhãn thiết bị bằng `zxing-wasm` — miễn phí, chạy trong trình duyệt,
 * không gửi ảnh đi đâu, không lưu ảnh (user chốt 27/10/2026).
 * Plan `plans/2026-10-27-them-vat-tu-bang-anh.md`. File wasm tự lưu trữ ở `public/ocr/`
 * (mạng công ty chặn chứng chỉ CDN — đã gặp khi thử).
 *
 * Thư viện chỉ tải khi gọi lần đầu (import động) — không làm nặng trang chính.
 */
import type { ReadResult, ReaderOptions } from 'zxing-wasm/reader';

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

export interface BarcodeHit { format: string; text: string }
export interface BarcodeScan {
  hits: BarcodeHit[];
  /** Lượt tìm thấy (vd "gốc 4000×3000", "thu 2000"), '' nếu không thấy. */
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

const uniq = (rs: ReadResult[]): BarcodeHit[] => {
  const seen = new Set<string>();
  return rs.filter(r => r.isValid && r.text).map(r => ({ format: r.format, text: r.text.trim() }))
    .filter(h => !seen.has(h.text) && (seen.add(h.text), true));
};

/** Đọc mã vạch trong một ảnh: thử ảnh gốc, rồi thu nhỏ, rồi xám + tăng tương phản. */
export async function scanBarcodeFile(file: Blob): Promise<BarcodeScan> {
  const t0 = performance.now();
  const m = await zxing();
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bmp;
  const passes: [string, number, boolean][] = [
    [`gốc ${width}×${height}`, 4096, false],
    ['thu 2000', 2000, false],
    ['thu 1200', 1200, false],
    ['xám + tương phản 2000', 2000, true],
  ];
  try {
    for (const [name, side, grey] of passes) {
      const hits = uniq(await m.readBarcodes(toImageData(bmp, width, height, side, grey), OPTS));
      if (hits.length) return { hits, pass: name, width, height, ms: Math.round(performance.now() - t0) };
    }
    return { hits: [], pass: '', width, height, ms: Math.round(performance.now() - t0) };
  } finally {
    bmp.close();
  }
}

/** Đọc một khung hình camera (quét trực tiếp) — một lượt, ảnh tối đa 1600. */
export async function scanBarcodeFrame(video: HTMLVideoElement): Promise<BarcodeHit[]> {
  const m = await zxing();
  if (!video.videoWidth) return [];
  return uniq(await m.readBarcodes(toImageData(video, video.videoWidth, video.videoHeight, 1600, false), OPTS));
}
