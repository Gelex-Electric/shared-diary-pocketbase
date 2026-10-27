/**
 * ĐỌC SỐ NO IN TRÊN NHÃN bằng OCR `tesseract.js` — miễn phí, chạy trong trình duyệt, không gửi ảnh, không lưu ảnh.
 * Dùng khi mã vạch không đọc được (user chốt 27/10/2026: "nếu không được chuyển sang quét OCR").
 * Dữ liệu tự lưu trữ ở `public/ocr/` (worker, lõi wasm, vie/eng.traineddata ~15 MB — tải lần đầu rồi trình duyệt giữ).
 *
 * Hai bước (thử trên 9 ảnh thật 27/10: 7 đúng, 2 không ra, 0 sai):
 *  1. OCR cả ảnh (vie+eng, phóng cạnh dài ~2400) → tìm cụm từ toàn chữ số ≥ 6 số, ưu tiên ngay sau chữ dẫn
 *     "Số:" / "Số sx:" / "NO:" và đủ 10 số.
 *  2. Cắt đúng cụm đó (nới rộng), tăng tương phản, OCR lại CHỈ chữ số một dòng — để bù khi bước 1 thiếu số.
 *  Bước 1 đủ 10 số thì lấy bước 1; không thì lấy bước 2. Hai bước khớp nhau ⇒ tin cậy cao.
 */
import type { Worker, Word } from 'tesseract.js';
import { parsePlate, type PlateReading } from './plateParse';

const OCR_PATHS = { workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', gzip: false };

let full: Promise<Worker> | null = null;
let digits: Promise<Worker> | null = null;
async function workers() {
  const T = await import('tesseract.js');
  full ??= T.createWorker(['vie', 'eng'], 1, OCR_PATHS);
  digits ??= T.createWorker('eng', 1, OCR_PATHS).then(async w => {
    await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: T.PSM.SINGLE_LINE });
    return w;
  });
  return Promise.all([full, digits]);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const fixDigits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
const isDigitWord = (w: Word) => /\d/.test(w.text) && /^[\dOoIl|SB]+$/.test(w.text.replace(/[.,:;"'|]+$/, ''));

interface Cand { digits: string; score: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** Bước 1: chọn cụm chữ số giống số No nhất trong các từ OCR (theo dòng). */
export function pickSerialWords(lines: { words: Word[] }[]): Cand | null {
  const cands: Cand[] = [];
  for (const { words: ws } of lines) {
    for (let i = 0; i < ws.length; i++) {
      if (!isDigitWord(ws[i])) continue;
      let j = i;
      while (j + 1 < ws.length && isDigitWord(ws[j + 1])) j++;
      const grp = ws.slice(i, j + 1);
      const d = fixDigits(grp.map(w => w.text).join('')).replace(/\D/g, '');
      if (d.length >= 6) {
        const prev = fold(ws.slice(Math.max(0, i - 2), i).map(w => w.text).join(' '));
        const label = /\b(so|sx|no|sb|sa|se)\b|so:|no:/.test(prev) || /:$/.test(ws[i - 1]?.text ?? '');
        cands.push({
          digits: d,
          score: (label ? 10 : 0) + (d.length === 10 ? 5 : 0) - Math.abs(d.length - 10),
          bbox: grp.reduce((a, w) => ({
            x0: Math.min(a.x0, w.bbox.x0), y0: Math.min(a.y0, w.bbox.y0), x1: Math.max(a.x1, w.bbox.x1), y1: Math.max(a.y1, w.bbox.y1),
          }), { x0: Infinity, y0: Infinity, x1: 0, y1: 0 }),
        });
      }
      i = j;
    }
  }
  return cands.sort((a, b) => b.score - a.score)[0] ?? null;
}

/** Bước 2: trong chuỗi chữ số OCR lại, lấy cửa sổ 10 số khớp bước 1 nhiều nhất (chữ số thứ 3 hợp lệ được cộng điểm). */
export function bestWindow(d: string, hint: string): string {
  const wins: string[] = [];
  for (let i = 0; i + 10 <= d.length; i++) wins.push(d.slice(i, i + 10));
  const sc = (x: string) => [...x].reduce((n, ch, i) => n + (ch === hint[i] ? 1 : 0), 0) + ('124'.includes(x[2]) ? 0.5 : 0);
  return wins.sort((a, b) => sc(b) - sc(a))[0] ?? '';
}

export interface OcrResult {
  serial: string;
  /** Hai bước cùng ra một số. */
  agreed: boolean;
  pass1: string; pass2: string;
  /** Loại, loại công tơ (KIỂU ME-41/42), tỷ số TI/TU, kiểu, năm — đọc từ chữ cả nhãn (`plateParse`). */
  plate: PlateReading;
  ms: number;
}

function canvasOf(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.filter = 'grayscale(1)';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

/** Cắt vùng (toạ độ trên canvas lớn), phóng cao 120, kéo giãn tương phản, viền trắng 20. */
function cropForDigits(big: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const H = 120, W = Math.max(1, Math.round((w * H) / h)), P = 20;
  const c = document.createElement('canvas');
  c.width = W + 2 * P; c.height = H + 2 * P;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(big, x, y, w, h, P, P, W, H);
  const img = g.getImageData(P, P, W, H), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] - lo) * k; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, P, P);
  return c;
}

/** Đọc số No in trên nhãn. `onStage` báo tiến độ (lần đầu phải tải ~15 MB dữ liệu OCR). */
export async function readSerialByOcr(file: Blob, onStage?: (s: string) => void): Promise<OcrResult> {
  const t0 = performance.now();
  onStage?.('Đang nạp bộ OCR (lần đầu tải ~15 MB)…');
  const [wFull, wDigits] = await workers();
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(2400 / Math.max(bmp.width, bmp.height), 2.5);
  const BW = Math.round(bmp.width * k), BH = Math.round(bmp.height * k);
  const big = canvasOf(bmp, BW, BH);
  bmp.close();

  onStage?.('OCR bước 1: đọc cả nhãn…');
  const { data } = await wFull.recognize(big, {}, { blocks: true, text: false });
  const lines = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines));
  const c = pickSerialWords(lines);
  const pass1 = c ? c.digits.slice(0, 10) : '';
  let pass2 = '';
  if (c) {
    onStage?.('OCR bước 2: đọc lại dòng số…');
    const h = c.bbox.y1 - c.bbox.y0;
    const x = Math.max(0, c.bbox.x0 - h), y = Math.max(0, c.bbox.y0 - Math.round(h * 0.35));
    const w = Math.min(BW - x, c.bbox.x1 - c.bbox.x0 + 4 * h), hh = Math.min(BH - y, Math.round(h * 1.7));
    const r2 = await wDigits.recognize(cropForDigits(big, x, y, w, hh));
    pass2 = bestWindow(r2.data.text.replace(/\D/g, ''), pass1);
  }
  const serial = pass1.length === 10 ? pass1 : pass2.length === 10 ? pass2 : '';
  let texts = lines.map(l => ({ text: l.text }));
  let plate = parsePlate(texts);
  if (!plate.type && serial) plate.type = parsePlate([{ text: `Số: ${serial}` }]).type;
  // Bước 3: TI/TU chưa có tỷ số (đường kẻ bảng trên nhãn làm OCR cả ảnh bỏ sót dòng "Tỷ số") hoặc công tơ chưa có
  // KIỂU ⇒ cắt riêng vùng nhãn quanh dòng số No (lên ~5 dòng, sang trái ~9 lần cao chữ), phóng x2, OCR lại.
  const needMore = (plate.type === 'TI' || plate.type === 'TU') ? !plate.ratio : plate.type === 'CONGTO' ? !plate.meterKind : false;
  if (c && needMore) {
    onStage?.('OCR bước 3: đọc lại vùng nhãn (tỷ số / kiểu)…');
    const h = c.bbox.y1 - c.bbox.y0;
    const x = Math.max(0, c.bbox.x0 - 9 * h), y = Math.max(0, c.bbox.y0 - 6 * h);
    const w = Math.min(BW - x, c.bbox.x1 + 3 * h - x), hh = Math.min(BH - y, c.bbox.y1 + h - y);
    const crop = document.createElement('canvas');
    crop.width = w * 2; crop.height = hh * 2;
    crop.getContext('2d')!.drawImage(big, x, y, w, hh, 0, 0, w * 2, hh * 2);
    const r3 = await wFull.recognize(crop);
    texts = [...texts, ...r3.data.text.split('\n').map(text => ({ text }))];
    const more = parsePlate(texts);
    plate = { ...plate, ratio: plate.ratio ?? more.ratio, meterKind: plate.meterKind ?? more.meterKind, model: plate.model ?? more.model };
  }
  return { plate, serial, agreed: !!serial && pass1 === pass2, pass1, pass2, ms: Math.round(performance.now() - t0) };
}
