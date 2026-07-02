import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PowerOutage } from '../types';

const AREA_TEMPLATE: Record<string, string> = {
  'KCN Tiền Hải':      'PO.KCN-TH.docx',
  'KCN Phong Điền':    'PO.KCN-PĐ.docx',
  'KCN Thuận Thành I': 'PO.KCN-TT.docx',
  'KCN Yên Mỹ':        'PO.KCN-YM.docx',
  'KCN Số 3':          'PO.KCN-03.docx',
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
  const response = await fetch(`/TBCD-template/${filename}`);
  if (!response.ok) throw new Error(`Không tìm thấy template: ${filename}`);
  const buf = await response.arrayBuffer();
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
