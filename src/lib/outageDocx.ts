import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PowerOutage } from '../types';

const AREA_TEMPLATE: Record<string, string> = {
  'KCN Tiền Hải':      'PO.KCN-TH.docx',
  'KCN Phong Điền':    'PO.KCN-PĐ.docx',
  'KCN Thuận Thành I': 'PO.KCN-TTI.docx',
  'KCN Yên Mỹ':        'PO.KCN-YM.docx',
  'KCN Số 3':          'PO.KCN-03.docx',
};

/** Địa chỉ đầy đủ mặc định của cột "Khu vực" theo KCN (khớp text cũ trong template). */
export const AREA_ADDRESS: Record<string, string> = {
  'KCN Tiền Hải':      'KCN Tiền Hải, xã Ái Quốc, tỉnh Hưng Yên',
  'KCN Phong Điền':    'KCN Phong Điền – Viglacera, TP Huế',
  'KCN Thuận Thành I': 'KCN Thuận Thành I, tỉnh Bắc Ninh',
  'KCN Yên Mỹ':        'KCN Yên Mỹ, tỉnh Hưng Yên',
  'KCN Số 3':          'KCN Số 3, tỉnh Hưng Yên',
};

const p2 = (n: number) => String(n).padStart(2, '0');
const toUTC = (dt: string) => new Date(dt.includes('Z') ? dt : dt + 'Z');

/** "05h00 ngày 14/02/2026" */
const fmtMoment = (dt: string) => {
  const d = toUTC(dt);
  if (isNaN(d.getTime())) return '';
  return `${p2(d.getUTCHours())}h${p2(d.getUTCMinutes())} ngày ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

export async function generateOutageDocx(n: PowerOutage): Promise<Blob> {
  const filename = AREA_TEMPLATE[n.area] || 'PO.KCN-TH.docx';
  const response = await fetch(`/TBCD-template/${encodeURIComponent(filename)}`);
  if (!response.ok) throw new Error(`Không tìm thấy template: ${filename}`);
  const buf = await response.arrayBuffer();
  // File .docx là zip, luôn bắt đầu bằng "PK" — nếu không phải (ví dụ SPA fallback
  // trả index.html với status 200) thì báo lỗi rõ ràng thay vì để PizZip crash
  const sig = new Uint8Array(buf.slice(0, 2));
  if (sig[0] !== 0x50 || sig[1] !== 0x4b)
    throw new Error(`Server không trả về file .docx hợp lệ cho template: ${filename}`);
  const zip = new PizZip(buf);
  // Normalize {{...}} → {...} and optionally strip addLegal paragraph when empty
  const removeAddLegal = !n.addLegal;
  Object.keys(zip.files).forEach(name => {
    if (!name.endsWith('.xml')) return;
    let text = zip.files[name].asText();
    if (text.includes('{{') || text.includes('}}'))
      text = text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
    // Remove entire <w:p>...</w:p> containing addLegal when value is empty
    if (removeAddLegal && text.includes('addLegal')) {
      text = text.split('</w:p>').filter(part => !part.includes('addLegal')).join('</w:p>');
    }
    zip.file(name, text);
  });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
  });
  const appendices = n.appendices || [];
  doc.render({
    noticeDate: n.noticeDate,
    typeLabel:  n.type === 'planned' ? 'THEO KẾ HOẠCH' : 'KHẨN CẤP',
    reason:     n.reason || '',
    addLegal:   n.addLegal || null,
    slots: (n.slots || []).map((s, i) => ({
      slotIndex:   String(i + 1).padStart(2, '0'),
      startTime:   fmtMoment(s.startTime),
      endTime:     fmtMoment(s.endTime),
      scope:       s.scope || '',
      // Cột "Khu vực": địa chỉ nhập tay của khung giờ; trống → địa chỉ mặc định theo KCN.
      area:        (s.area && s.area.trim()) ? s.area : (AREA_ADDRESS[n.area] || n.area || ''),
      // Số phụ lục đính kèm khung giờ (theo appendixIndex đã chọn, KHÔNG theo số khung giờ).
      appendixNum: String((s.appendixIndex ?? 0) + 1).padStart(2, '0'),
      appendixRef: `Phụ lục ${String((s.appendixIndex ?? 0) + 1).padStart(2, '0')}`,
    })),
    appendices: appendices.map((a, i) => ({
      appendixIndex: String(i + 1).padStart(2, '0'),
      customers: (a.customers || []).map((c, j) => ({ stt: j + 1, name: c.Name, mkh: c.MKH })),
    })),
  });
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
