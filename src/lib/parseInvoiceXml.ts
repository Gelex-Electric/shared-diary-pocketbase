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
  dgia: number;   // đơn giá trước thuế (chỉ BT/CD/TD) — chỉ dùng hiển thị, KHÔNG lưu DB
  sluong: number; // sản lượng (SLuong dòng tính tiền) — đọc trực tiếp từ XML, lưu SL_BT/CD/TD
}

export interface MeterPeriodRow {
  SCT: string;
  HSN: number;
  StartDate: string; // YYYY-MM-DD
  EndDate: string;   // YYYY-MM-DD
  // Mã gộp hóa đơn = MIN(MHHDVu các dòng chỉ số) của CÙNG công tơ trong file. Hóa đơn đổi
  // giá tách 1 công tơ thành nhiều khoảng (mỗi khoảng IndexId riêng) nhưng cùng min →
  // gộp được; công tơ khác → min khác → tách. Luôn có trong XML & duy nhất toàn cục.
  indexId: string;
  pointAddress: string; // Địa chỉ sử dụng điện (PointAddress của từng công tơ)
  bieu: Record<Bieu, BieuData>;
  // Hóa đơn phản kháng (đọc trực tiếp, trước thuế) — 0 nếu hóa đơn thường
  TongSL_HC: number;
  TongSL_PK: number;
  ThTien_HC: number;
  ThTien_PK: number;
  CosFi: number;
  KCosFi: number;
  // Gộp: ThTien = ThTien_HC + ThTien_PK (trước thuế). VAT = thuế suất (0.08). ThTienVAT = sau thuế.
  ThTien: number;
  VAT: number;
  ThTienVAT: number;
}

export interface ParsedInvoice {
  billId: string; // mã hóa đơn duy nhất (từ SOAP GetBill); XML không chứa nên truyền vào
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

// "8%" → 0.08 (hệ số thuế suất). Rỗng/không hợp lệ → 0.
const toPct = (v: string | null | undefined): number => {
  if (!v) return 0;
  const n = parseFloat(v.toString().replace('%', '').trim());
  return Number.isFinite(n) ? n / 100 : 0;
};

const toDate = (v: string | null | undefined): string =>
  (v || '').split('T')[0].split(' ')[0].trim();

// Lấy text của tag con đầu tiên (đệ quy) trong 1 element
const childText = (parent: Element | null, tag: string): string => {
  if (!parent) return '';
  const el = parent.getElementsByTagName(tag)[0];
  return el ? (el.textContent || '').trim() : '';
};

// Tìm giá trị TTin theo tên TTruong trong 1 element (trả giá trị KHÔNG rỗng đầu tiên).
const ttinValue = (root: Element | null, truong: string): string => {
  if (!root) return '';
  const ttins = root.getElementsByTagName('TTin');
  for (let i = 0; i < ttins.length; i++) {
    if (childText(ttins[i], 'TTruong') === truong) {
      const v = childText(ttins[i], 'DLieu');
      if (v) return v;
    }
  }
  return '';
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

const emptyBieu = (): BieuData => ({ old: 0, moi: 0, phuTru: 0, dgia: 0, sluong: 0 });
const emptyRow = (SCT: string, StartDate: string, EndDate: string): MeterPeriodRow => ({
  SCT, HSN: 0, StartDate, EndDate, indexId: '', pointAddress: '',
  bieu: { BT: emptyBieu(), CD: emptyBieu(), TD: emptyBieu(), VC: emptyBieu() },
  TongSL_HC: 0, TongSL_PK: 0, ThTien_HC: 0, ThTien_PK: 0, CosFi: 0, KCosFi: 0,
  ThTien: 0, VAT: 0, ThTienVAT: 0,
});

export function parseInvoiceXml(xml: string, billId = ''): ParsedInvoice {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML không hợp lệ');
  }

  const dl = doc.getElementsByTagName('DLHDon')[0];
  if (!dl) throw new Error('Không tìm thấy DLHDon');
  const ndhdon = dl.getElementsByTagName('NDHDon')[0] || dl;

  const thdon = childText(dl.getElementsByTagName('TTChung')[0] || null, 'THDon');
  // BillId nằm ở TTKhac mức hóa đơn (DLHDon > TTKhac), không phải trong từng dòng HHDVu.
  // Ưu tiên billId truyền vào (từ SOAP GetBill); nếu trống thì đọc từ XML.
  const finalBillId = (billId || '').trim() || ttinValue(dl, 'BillId');

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
  // MIN(MHHDVu) theo từng công tơ trong file → mã gộp hóa đơn (indexId)
  const sctMinMHH = new Map<string, number>();

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
      sluong: 0, // điền ở vòng 2 từ dòng tính tiền (TChat=1)
    };
    if (mhh) {
      readingIndex.set(mhh, { key, bieu: tou });
      const n = toNum(mhh);
      if (n > 0) {
        const cur = sctMinMHH.get(sct);
        if (cur === undefined || n < cur) sctMinMHH.set(sct, n);
      }
    }
  }

  // Gán indexId = MIN(MHHDVu) của công tơ → mọi khoảng đổi giá của 1 công tơ chung 1 mã.
  rowMap.forEach(row => {
    const min = sctMinMHH.get(row.SCT);
    row.indexId = min !== undefined ? String(min) : '';
  });

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

    // Thuế suất VAT đọc TRỰC TIẾP từ tag <TSuat> của dòng tính tiền ("8%" → 0.08).
    // Đồng nhất trong 1 hóa đơn nên lấy giá trị > 0 gần nhất cho mỗi công tơ.
    const ts = toPct(childText(h, 'TSuat'));
    if (ts > 0) row.VAT = ts;

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
      row.bieu[ref.bieu].sluong = toNum(childText(h, 'SLuong')); // sản lượng theo biểu, đọc trực tiếp
      row.TongSL_HC += toNum(childText(h, 'SLuong'));
      row.ThTien_HC += toNum(childText(h, 'ThTien'));
    }
  }

  // Gộp thành tiền trước thuế + tính sau thuế theo TỪNG công tơ.
  // ThTien = ThTien_HC + ThTien_PK (hóa đơn HC không có PK & ngược lại). ThTienVAT = ThTien×(1+VAT).
  rowMap.forEach(row => {
    row.ThTien = Math.round(row.ThTien_HC + row.ThTien_PK);
    row.ThTienVAT = Math.round(row.ThTien * (1 + row.VAT));
  });

  return { billId: finalBillId, loaiHD, nban, nmua, rows: Array.from(rowMap.values()) };
}
