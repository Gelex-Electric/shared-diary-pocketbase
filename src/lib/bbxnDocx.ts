import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

/* ============================================================
   Tạo file Word "Biên bản xác nhận chỉ số" từ template BBXN.docx
   (đã có sẵn Quốc huy + định dạng bảng trong template, không cần
   dựng bảng bằng pdfMake nữa).
============================================================ */

const num = (v: any) => {
  const n = parseFloat((v ?? '').toString().replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const fmtDate = (s?: string) => {
  if (!s) return '';
  const datePart = s.split('T')[0].split(' ')[0];
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
};

// NKy mặc định khi trống: "00 giờ 00 phút ngày DD tháng MM năm YYYY" theo ngày cuối kỳ
const defaultNKy = (endDate?: string) => {
  const datePart = (endDate || '').split('T')[0].split(' ')[0];
  const [y, m, d] = datePart.split('-');
  return d && m && y ? `00 giờ 00 phút ngày ${d} tháng ${m} năm ${y}` : '';
};

// Hiển thị số: tối đa 2 số lẻ, dấu phân cách kiểu VN
const fmtNum = (n: number, digits = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(n);

export interface BbxnRecordLike {
  SCT?: string;
  HSN?: number | string;
  StartDate?: string;
  EndDate?: string;
  NBan?: string;
  DChiNBan?: string;
  NMua?: string;
  DChiNMua?: string;
  NKy?: string;
  [key: string]: any; // BT_dau/cuoi, CD_dau/cuoi, TD_dau/cuoi, VC_dau/cuoi, phu_BT/CD/TD/VC
}

export async function generateBbxnDocx(r: BbxnRecordLike): Promise<Blob> {
  const response = await fetch('/BBXN-template/BBXN.docx');
  if (!response.ok) throw new Error('Không tìm thấy template BBXN.docx');
  const buf = await response.arrayBuffer();
  // File .docx là zip, luôn bắt đầu bằng "PK" — chặn trường hợp SPA fallback trả HTML
  const sig = new Uint8Array(buf.slice(0, 2));
  if (sig[0] !== 0x50 || sig[1] !== 0x4b)
    throw new Error('Server không trả về file .docx hợp lệ cho template BBXN.docx');
  const zip = new PizZip(buf);
  Object.keys(zip.files).forEach(name => {
    if (!name.endsWith('.xml')) return;
    let text = zip.files[name].asText();
    if (text.includes('{{') || text.includes('}}'))
      text = text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
    zip.file(name, text);
  });
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
  });

  const hsn = num(r.HSN);
  const dau = (k: string) => num(r[`${k}_dau`]);
  const cuoi = (k: string) => num(r[`${k}_cuoi`]);
  const phu = (k: string) => num(r[`phu_${k}`]);
  const sl = (k: string) => (cuoi(k) - dau(k)) * hsn;
  // Sản lượng thực tế = trực tiếp - phụ trừ, không cho âm (và tránh hiển thị -0)
  const tsl = (k: string) => Math.max(0, sl(k) - phu(k)) || 0;

  const PG_dau = dau('BT') + dau('CD') + dau('TD');
  const PG_cuoi = cuoi('BT') + cuoi('CD') + cuoi('TD');
  const phu_PG = phu('BT') + phu('CD') + phu('TD');
  const SL_PG = sl('BT') + sl('CD') + sl('TD');

  const TSL_BT = tsl('BT');
  const TSL_CD = tsl('CD');
  const TSL_TD = tsl('TD');
  const TSL_VC = tsl('VC');
  const TSL_PG = TSL_BT + TSL_CD + TSL_TD;

  const apparent = Math.sqrt(TSL_PG * TSL_PG + TSL_VC * TSL_VC);
  const cosfi = apparent > 0 ? TSL_PG / apparent : 0;

  doc.render({
    SCT: r.SCT || '',
    HSN: fmtNum(hsn),
    StartDate: fmtDate(r.StartDate),
    EndDate: fmtDate(r.EndDate),
    NBan: r.NBan || '',
    DChiNBan: r.DChiNBan || '',
    NMua: r.NMua || '',
    DChiNMua: r.DChiNMua || '',
    NKy: (r.NKy && r.NKy.trim()) || defaultNKy(r.EndDate),

    BT_dau: fmtNum(dau('BT'), 2), BT_cuoi: fmtNum(cuoi('BT'), 2),
    CD_dau: fmtNum(dau('CD'), 2), CD_cuoi: fmtNum(cuoi('CD'), 2),
    TD_dau: fmtNum(dau('TD'), 2), TD_cuoi: fmtNum(cuoi('TD'), 2),
    VC_dau: fmtNum(dau('VC'), 2), VC_cuoi: fmtNum(cuoi('VC'), 2),
    PG_dau: fmtNum(PG_dau, 2), PG_cuoi: fmtNum(PG_cuoi, 2),

    phu_BT: fmtNum(phu('BT')), phu_CD: fmtNum(phu('CD')),
    phu_TD: fmtNum(phu('TD')), phu_VC: fmtNum(phu('VC')),
    phu_PG: fmtNum(phu_PG),

    SL_BT: fmtNum(sl('BT')), SL_CD: fmtNum(sl('CD')),
    SL_TD: fmtNum(sl('TD')), SL_VC: fmtNum(sl('VC')),
    SL_PG: fmtNum(SL_PG),

    TSL_BT: fmtNum(TSL_BT), TSL_CD: fmtNum(TSL_CD),
    TSL_TD: fmtNum(TSL_TD), TSL_VC: fmtNum(TSL_VC),
    TSL_PG: fmtNum(TSL_PG),

    cosfi: cosfi.toFixed(2),
  });

  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
