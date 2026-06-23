/**
 * parseInvoiceXml — đọc hóa đơn điện tử (XML chuẩn TT78) của GELEX.
 *
 * Mỗi file = 1 hóa đơn của 1 khách hàng (NMua), nhiều công tơ.
 * - HHDVu TChat=4: dòng "Chỉ số công tơ" (Old/New/HSN/MinusIndex) theo biểu BT/CD/TD/VC.
 * - HHDVu TChat=1: dòng tính tiền (SLuong/DGia/ThTien), nối với dòng chỉ số qua IndexId == MHHDVu.
 *   + Dòng MHHDVu='CSPK' = hóa đơn phản kháng (TongSL_HC/TongSL_PK/ThTien_HC/ThTien_PK/CosFi/KCosFi).
 *
 * Gom theo (SCT + StartDate + EndDate) → mỗi khoảng ngày là 1 row (hóa đơn đổi giá
 * giữa kỳ tự nhiên tách thành 2 row cho cùng công tơ).
 */

export type Bieu = 'BT' | 'CD' | 'TD' | 'VC';

export interface BieuData {
  old: number;
  moi: number;   // NewValue
  phuTru: number; // MinusIndex
  dgia: number;   // đơn giá trước thuế (chỉ BT/CD/TD)
}

export interface MeterPeriodRow {
  SCT: string;
  HSN: number;
  StartDate: string; // YYYY-MM-DD
  EndDate: string;   // YYYY-MM-DD
  pointAddress: string; // Địa chỉ sử dụng điện (PointAddress của từng công tơ)
  bieu: Record<Bieu, BieuData>;
  // Hóa đơn phản kháng (đọc trực tiếp, trước thuế) — 0 nếu hóa đơn thường
  TongSL_HC: number;
  TongSL_PK: number;
  ThTien_HC: number;
  ThTien_PK: number;
  CosFi: number;
  KCosFi: number;
}

export interface ParsedInvoice {
  shdon: string;
  loaiHD: 'HC' | 'VC';
  nban: { ten: string; dchi: string };
  nmua: { ten: string; mst: string; dchi: string; mkhang: string };
  rows: MeterPeriodRow[];
}

const toNum = (v: string | null | undefined): number => {
  if (!v) return 0;
  const n = parseFloat(v.toString().trim());
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v: string | null | undefined): string =>
  (v || '').split('T')[0].split(' ')[0].trim();

// Lấy text của tag con đầu tiên (đệ quy) trong 1 element
const childText = (parent: Element | null, tag: string): string => {
  if (!parent) return '';
  const el = parent.getElementsByTagName(tag)[0];
  return el ? (el.textContent || '').trim() : '';
};

// Gom các cặp <TTin><TTruong>k</TTruong><DLieu>v</DLieu></TTin> trong 1 HHDVu thành map
const collectTTin = (h: Element): Record<string, string> => {
  const map: Record<string, string> = {};
  const ttins = h.getElementsByTagName('TTin');
  for (let i = 0; i < ttins.length; i++) {
    const key = childText(ttins[i], 'TTruong');
    const val = childText(ttins[i], 'DLieu');
    if (key) map[key] = val;
  }
  return map;
};

const emptyBieu = (): BieuData => ({ old: 0, moi: 0, phuTru: 0, dgia: 0 });
const emptyRow = (SCT: string, StartDate: string, EndDate: string): MeterPeriodRow => ({
  SCT, HSN: 0, StartDate, EndDate, pointAddress: '',
  bieu: { BT: emptyBieu(), CD: emptyBieu(), TD: emptyBieu(), VC: emptyBieu() },
  TongSL_HC: 0, TongSL_PK: 0, ThTien_HC: 0, ThTien_PK: 0, CosFi: 0, KCosFi: 0,
});

export function parseInvoiceXml(xml: string): ParsedInvoice {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML không hợp lệ');
  }

  const dl = doc.getElementsByTagName('DLHDon')[0];
  if (!dl) throw new Error('Không tìm thấy DLHDon');
  const ndhdon = dl.getElementsByTagName('NDHDon')[0] || dl;

  const shdon = childText(dl.getElementsByTagName('TTChung')[0] || null, 'SHDon');
  const thdon = childText(dl.getElementsByTagName('TTChung')[0] || null, 'THDon');

  const nbanEl = ndhdon.getElementsByTagName('NBan')[0] || null;
  const nmuaEl = ndhdon.getElementsByTagName('NMua')[0] || null;
  const nban = { ten: childText(nbanEl, 'Ten'), dchi: childText(nbanEl, 'DChi') };
  const nmua = {
    ten: childText(nmuaEl, 'Ten'),
    mst: childText(nmuaEl, 'MST'),
    dchi: childText(nmuaEl, 'DChi'),
    mkhang: childText(nmuaEl, 'MKHang'),
  };

  const loaiHD: 'HC' | 'VC' = /CSPK/i.test(thdon) ? 'VC' : 'HC';

  const rowMap = new Map<string, MeterPeriodRow>();
  // indexId (MHHDVu của dòng chỉ số) -> { key, bieu } để nối dòng tính tiền
  const readingIndex = new Map<string, { key: string; bieu: Bieu }>();

  const hhdvus = ndhdon.getElementsByTagName('HHDVu');

  // Vòng 1: đọc các dòng chỉ số (TChat=4)
  for (let i = 0; i < hhdvus.length; i++) {
    const h = hhdvus[i];
    if (childText(h, 'TChat') !== '4') continue;
    const mhh = childText(h, 'MHHDVu'); // = IndexId
    const m = collectTTin(h);
    const sct = m['ElectricityMeterNumber'] || '';
    const tou = (m['TimeOfUse'] || '') as Bieu;
    if (!sct || !['BT', 'CD', 'TD', 'VC'].includes(tou)) continue;
    const start = toDate(m['StartDate']);
    const end = toDate(m['EndDate']);
    const key = `${sct}|${start}|${end}`;
    if (!rowMap.has(key)) rowMap.set(key, emptyRow(sct, start, end));
    const row = rowMap.get(key)!;
    row.HSN = toNum(m['Coefficient']) || row.HSN;
    row.pointAddress = m['PointAddress'] || row.pointAddress;
    row.bieu[tou] = {
      old: toNum(m['OldValue']),
      moi: toNum(m['NewValue']),
      phuTru: toNum(m['MinusIndex']),
      dgia: 0,
    };
    if (mhh) readingIndex.set(mhh, { key, bieu: tou });
  }

  // Vòng 2: đọc các dòng tính tiền (TChat=1) và nối qua IndexId
  for (let i = 0; i < hhdvus.length; i++) {
    const h = hhdvus[i];
    if (childText(h, 'TChat') !== '1') continue;
    const mhh = childText(h, 'MHHDVu'); // 'TD' (giờ) hoặc 'CSPK'
    const m = collectTTin(h);
    const indexId = m['IndexId'] || '';
    const ref = readingIndex.get(indexId);
    if (!ref) continue;
    const row = rowMap.get(ref.key);
    if (!row) continue;

    if (/CSPK/i.test(mhh)) {
      // Hóa đơn phản kháng: CHỈ lấy số liệu vô công. Hữu công (TongSL_HC/ThTien_HC)
      // của hóa đơn VC luôn = 0 (giữ giá trị mặc định, không đọc từ XML).
      row.TongSL_PK = toNum(childText(h, 'SLuong'));
      row.ThTien_PK = toNum(childText(h, 'ThTien'));
      row.CosFi = toNum(m['CosFi']);
      row.KCosFi = toNum(m['KCosFi']);
    } else {
      // Dòng tính tiền hữu công: đơn giá theo biểu + cộng dồn Tổng sản lượng & Thành
      // tiền hữu công ĐỌC TRỰC TIẾP từ XML (SLuong/ThTien), không suy từ chỉ số nữa.
      row.bieu[ref.bieu].dgia = toNum(childText(h, 'DGia'));
      row.TongSL_HC += toNum(childText(h, 'SLuong'));
      row.ThTien_HC += toNum(childText(h, 'ThTien'));
    }
  }

  return { shdon, loaiHD, nban, nmua, rows: Array.from(rowMap.values()) };
}
