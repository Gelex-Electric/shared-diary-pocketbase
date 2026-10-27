/**
 * ĐỌC NHÃN THIẾT BỊ GELEX / EMIC từ chữ OCR — module THUẦN, không mạng, không DOM.
 * Plan `plans/2026-10-27-them-vat-tu-bang-anh.md` (user duyệt 27/10/2026).
 *
 * Cách làm tham khảo `huggingface.co/constructelligence/data-centre-nameplates`
 * (Apache-2.0): đọc theo NHÃN có chữ dẫn ("Số:", "Số sx:", "NO:", "Tỷ số:", "KIỂU:"),
 * sửa ký tự OCR hay nhầm trong dãy số (O/0, I/l/1, S/5, B/8, Z/2), không đoán thứ
 * không đọc được. Bộ đọc trường của repo đó viết cho nhãn trung tâm dữ liệu tiếng
 * Anh nên không dùng thẳng — đây là bộ riêng cho công tơ / TI / TU / GP-03.
 *
 * Nhãn mẫu (ảnh user gửi 27/10/2026):
 *   TI      "BIẾN DÒNG HẠ THẾ - CT0.6" · "Tỷ số: 2000/5A" · "Số: 2620014915"
 *   Công tơ "KIỂU: ME-41" (gián tiếp) / "KIỂU: ME-42" (trực tiếp) · "Số sx: 2610026964"
 *   GP-03   "GP-03" · "MODEM GPRS/3G/4G" · "NO: 2542200533"
 * Số No 10 chữ số: chữ số THỨ 3 là loại — 1 công tơ, 2 TI/TU, 4 GP-03 (đối chiếu kho 27/10).
 *
 * Test: `npx tsx scripts/dm_test_plate.ts`.
 */
import type { AssetType, Connection } from './types';

export interface PlateLine {
  text: string;
  /** Độ tin của dòng (0–100) — Tesseract trả theo dòng. */
  confidence?: number;
  /** Khung của dòng trong ảnh — để cắt đúng dòng số mà OCR lại (bước 2). */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface PlateReading {
  /** Số No đọc được ('' nếu không thấy). */
  serial: string;
  /** Dòng chứa số No — bước 2 cắt dòng này OCR lại chỉ chữ số. */
  serialLine?: PlateLine;
  type: AssetType | '';
  /** Tỷ số TI/TU, vd { primary: 2000, secondary: 5 }. */
  ratio?: { primary: number; secondary: number };
  /** Loại công tơ theo KIỂU: ME-41 ⇒ gián tiếp, ME-42 ⇒ trực tiếp (quy ước 26/10/2026). */
  meterKind?: Connection;
  /** Mã kiểu in trên nhãn (ME-41, ME-42, GP-03, CT0.6…) — để ghi model. */
  model?: string;
  year?: number;
}

/** Chữ thường, bỏ dấu tiếng Việt — so khớp chữ dẫn không phụ thuộc OCR đọc dấu đúng hay sai. */
export const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Sửa ký tự OCR hay nhầm TRONG một dãy số (chỉ dùng cho đoạn đã biết là số). */
export function fixDigits(s: string): string {
  return s.replace(/[Oo]/g, '0').replace(/[IlL|]/g, '1').replace(/[Ss]/g, '5')
    .replace(/B/g, '8').replace(/[Zz]/g, '2').replace(/[^0-9]/g, '');
}

/** Loại suy từ số No: 10 số theo chữ số thứ 3; 15 số là IMEI GP-03 đời cũ; 18–20 số là SIM. */
export function typeFromSerial(serial: string): AssetType | '' {
  if (/^\d{10}$/.test(serial)) {
    if (serial[2] === '1') return 'CONGTO';
    if (serial[2] === '2') return 'TI';
    if (serial[2] === '4') return 'GP03';
  }
  if (/^\d{15}$/.test(serial)) return 'GP03';
  if (/^\d{18,20}$/.test(serial)) return 'SIM';
  return '';
}

/**
 * Lấy dãy số No từ một đoạn chữ: gộp các nhóm số (OCR hay chèn khoảng trắng giữa
 * chữ số in giãn cách), sửa ký tự nhầm, nhận 10 số (GELEX) hoặc 15 số (IMEI).
 */
export function serialIn(text: string): string {
  const runs = text.match(/[0-9OoIlSBZ|][0-9OoIlSBZ| ]{8,}[0-9OoIlSBZ|]/g) ?? [];
  for (const run of runs) {
    const d = fixDigits(run);
    // Chỉ nhận khi đoạn gốc chủ yếu là chữ số — tránh biến một từ thành "số".
    const digitsRaw = (run.match(/\d/g) ?? []).length;
    if (digitsRaw < d.length * 0.7) continue;
    if (d.length === 10 || d.length === 15) return d;
    if (d.length > 10 && d.length < 15) return d.slice(0, 10);
  }
  return '';
}

const SERIAL_LABEL = /\b(so\s*sx|so|no|s\/n)\s*[:.]/;

export function parsePlate(lines: PlateLine[]): PlateReading {
  const out: PlateReading = { serial: '', type: '' };
  const all = lines.map(l => l.text).join('\n');
  const f = fold(all);

  // 1) Số No: dòng có chữ dẫn "Số:" / "Số sx:" / "NO:" trước; không có thì dòng toàn số.
  for (const l of lines) {
    const fl = fold(l.text);
    const m = fl.match(SERIAL_LABEL);
    if (!m) continue;
    const s = serialIn(l.text.slice((m.index ?? 0) + m[0].length));
    if (s) { out.serial = s; out.serialLine = l; break; }
    out.serialLine ??= l; // có chữ dẫn mà chưa đọc ra số — bước 2 vẫn cắt dòng này
  }
  if (!out.serial) {
    for (const l of lines) {
      const s = serialIn(l.text);
      if (s && (l.text.replace(/\s/g, '').length <= s.length + 4)) { out.serial = s; out.serialLine = l; break; }
    }
  }

  // 2) Loại + kiểu: chữ trên nhãn ưu tiên, số No là phương án hai.
  const kieu = all.match(/ME\s*[-–]?\s*4\s*([12])/i);
  if (kieu) {
    out.type = 'CONGTO';
    out.meterKind = kieu[1] === '1' ? 'gian_tiep' : 'truc_tiep';
    out.model = `ME-4${kieu[1]}`;
  } else if (/gp\s*[-–]?\s*0?3|modem/.test(f)) {
    out.type = 'GP03'; out.model = 'GP-03';
  } else if (/bien\s*dong|\bct\s*0[.,]?6/.test(f)) {
    out.type = 'TI';
    const ct = all.match(/CT\s*0[.,]\s*6/i); if (ct) out.model = 'CT0.6';
  } else if (/bien\s*dien\s*ap|\btu\b/.test(f)) {
    out.type = 'TU';
  } else if (/cong\s*to/.test(f)) {
    out.type = 'CONGTO';
  }
  if (!out.type && out.serial) out.type = typeFromSerial(out.serial);

  // 3) Tỷ số TI/TU: "Tỷ số: 2000/5A" — lấy dạng NNNN/1 hoặc NNNN/5 (TU: 22000/110).
  // Ưu tiên số ngay sau chữ "Tỷ số"; mẫu số 5/1 hay bị đọc thành "54"/"5A" nên chỉ cần không dính chữ số khác sau 1/5.
  const ratio = fold(all).match(/ty\s*\.?\s*so\s*[:.]?\s*(\d{2,6})\s*\/\s*(1|5)(?!\d{2})/)
    ?? all.match(/(\d{2,6})\s*\/\s*(1|5|100|110)\s*[AV]/);
  if (ratio && (out.type === 'TI' || out.type === 'TU')) {
    out.ratio = { primary: Number(ratio[1]), secondary: Number(ratio[2]) };
  }

  // 4) Năm: số 20xx đứng riêng (nhãn TI "| 2026", công tơ "Việt Nam-2026").
  const year = all.match(/\b(20[1-3]\d)\b/g)?.map(Number).filter(y => y >= 2015 && y <= 2035).pop();
  if (year) out.year = year;
  return out;
}

/**
 * Bước 2: chữ OCR lại riêng dòng số (chỉ nhận chữ số) — lấy số No nếu hợp lệ,
 * khớp loại đã biết thì tốt hơn.
 */
export function serialFromDigitPass(text: string, type: AssetType | ''): string {
  const d = text.replace(/[^0-9]/g, '');
  const cands = [d.length >= 15 ? d.slice(0, 15) : '', d.length >= 10 ? d.slice(0, 10) : '', d.length >= 10 ? d.slice(-10) : '']
    .filter(Boolean);
  return cands.find(c => !type || typeFromSerial(c) === type || (type === 'TU' && typeFromSerial(c) === 'TI')) ?? cands[0] ?? '';
}
