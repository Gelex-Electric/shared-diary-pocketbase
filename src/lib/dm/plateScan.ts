/**
 * ĐỌC MỘT ẢNH NHÃN thành dữ liệu một dòng vật tư — dùng ở hộp "Thêm vật tư từ danh sách".
 * Thứ tự user chốt 27/10/2026 (thử ở trang `/thu-ma-vach`): OCR TRƯỚC (số No + loại + kiểu công tơ + tỷ số TI),
 * rồi mã vạch để KIỂM TRA LẠI số No; OCR không ra số thì lấy số từ mã vạch.
 * Chạy trên máy, không gửi ảnh, không lưu ảnh (chỉ trả ảnh thu nhỏ để đối chiếu trong hộp).
 */
import { scanBarcodeFile } from './barcodeScan';
import { readSerialByOcr } from './plateOcr';
import type { PlateReading } from './plateParse';

export interface PlateScan {
  serial: string;
  plate: PlateReading;
  /** Nguồn số No: 'mã vạch khớp' (OCR = mã vạch) | 'OCR' | 'mã vạch' | 'lệch' (OCR ≠ mã vạch) | '' (không ra). */
  source: 'mã vạch khớp' | 'OCR' | 'mã vạch' | 'lệch' | '';
  /** Số mã vạch khi lệch với OCR. */
  barcode?: string;
  thumb: string;
}

async function thumbOf(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = 160 / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.7);
}

export async function scanPlate(file: Blob, onStage?: (s: string) => void): Promise<PlateScan> {
  const thumb = await thumbOf(file);
  const ocr = await readSerialByOcr(file, onStage);
  onStage?.('Kiểm tra lại số No bằng mã vạch…');
  const bar = (await scanBarcodeFile(file)).hits.find(h => /^\d{10,15}$/.test(h.text))?.text ?? '';
  const serial = ocr.serial || bar;
  const source: PlateScan['source'] = !serial ? '' : !bar ? 'OCR' : !ocr.serial ? 'mã vạch'
    : bar === ocr.serial ? 'mã vạch khớp' : 'lệch';
  return { serial, plate: ocr.plate, source, barcode: source === 'lệch' ? bar : undefined, thumb };
}
