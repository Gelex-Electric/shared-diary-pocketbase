/**
 * Phân tích + kiểm tra dữ liệu vật tư dán từ Excel (task 8, plan §4).
 *
 * ~600 bản ghi TI/TU/GP-03 không có ở bất kỳ nguồn nào, phải nhập tay ⇒ gõ
 * từng form là không khả thi. Đây là tầng thuần logic, không đụng React, để
 * quy tắc kiểm tra nằm một chỗ và soi được.
 */
import { type AssetType, type CatalogData, isMeter, hasRatio, needsCalibration, calibrationSpan } from './catalog';

export const IMPORT_COLUMNS = [
  'so_hieu', 'loai', 'so_cap', 'thu_cap', 'hang_sx',
  'model', 'cap_chinh_xac', 'nam_sx', 'ngay_kiem_dinh', 'kho', 'ghi_chu',
] as const;
export type ImportColumn = typeof IMPORT_COLUMNS[number];

/** Nhãn tiếng Việt cho hàng tiêu đề của file mẫu. */
export const COLUMN_LABEL: Record<ImportColumn, string> = {
  so_hieu: 'so_hieu', loai: 'loai', so_cap: 'so_cap', thu_cap: 'thu_cap',
  hang_sx: 'hang_sx', model: 'model', cap_chinh_xac: 'cap_chinh_xac',
  nam_sx: 'nam_sx', ngay_kiem_dinh: 'ngay_kiem_dinh', kho: 'kho', ghi_chu: 'ghi_chu',
};

/** Bí danh cho tiêu đề cột — người dùng có thể gõ tiếng Việt có dấu. */
const HEADER_ALIAS: Record<string, ImportColumn> = {
  'so_hieu': 'so_hieu', 'sohieu': 'so_hieu', 'serial': 'so_hieu',
  'socongto': 'so_hieu', 'so_cong_to': 'so_hieu',
  'loai': 'loai', 'type': 'loai',
  'so_cap': 'so_cap', 'socap': 'so_cap', 'ratio_primary': 'so_cap',
  'thu_cap': 'thu_cap', 'thucap': 'thu_cap', 'ratio_secondary': 'thu_cap',
  'hang_sx': 'hang_sx', 'hangsx': 'hang_sx', 'manufacturer': 'hang_sx',
  'model': 'model', 'model_desc': 'model',
  'cap_chinh_xac': 'cap_chinh_xac', 'capchinhxac': 'cap_chinh_xac',
  'nam_sx': 'nam_sx', 'namsx': 'nam_sx',
  'ngay_kiem_dinh': 'ngay_kiem_dinh', 'ngaykiemdinh': 'ngay_kiem_dinh',
  'kho': 'kho', 'warehouse': 'kho',
  'ghi_chu': 'ghi_chu', 'ghichu': 'ghi_chu', 'note': 'ghi_chu',
};

const TYPE_ALIAS: Record<string, AssetType> = {
  me41: 'ME41', me_41: 'ME41', me42: 'ME42', me_42: 'ME42',
  dts27: 'DTS27', dst27: 'DTS27',           // user hay gõ nhầm DST
  ti: 'TI', tu: 'TU', sim: 'SIM',
  gp03: 'GP03', gp_03: 'GP03', gp3: 'GP03', gp_3: 'GP03',
  khac: 'KHAC',
};

export interface ParsedRow {
  line: number;                 // số dòng trong ô dán (1-based, tính cả tiêu đề)
  raw: Record<string, string>;
  serial: string;
  type: AssetType | '';
  ratio_primary?: number;
  ratio_secondary?: number;
  ratio?: number;
  manufacturer?: string;
  model_desc?: string;
  accuracy_class?: string;
  manufacture_year?: number;
  calibration_date?: string;
  next_calibration?: string;
  warehouseCode?: string;
  note?: string;
  errors: string[];
  warnings: string[];
}

/** Bỏ dấu để so khớp tiêu đề/loại không phụ thuộc cách gõ. */
function slug(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .trim().toLowerCase().replace(/[\s.-]+/g, '_');
}

function num(v: string): number | undefined {
  const t = (v || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Năm SX từ 2 chữ số đầu serial (công tơ). Không đoán bừa — xem plan §1.4. */
export function yearFromSerial(serial: string): number | null {
  const s = (serial || '').trim();
  if (s.length < 2 || !/^\d{2}/.test(s)) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const now = new Date().getFullYear();
  if (y > now || y < 2000) return null;
  return y;
}

/** Công tơ 3 năm, TI/TU 5 năm, GP-03 không kiểm định (user chốt 03/08). */
export function calcNextCalibration(year: number | undefined, type: AssetType): string | undefined {
  const span = calibrationSpan(type);
  if (!span || !year) return undefined;
  return `${year + span}-01-01`;
}

/**
 * Tách văn bản dán thành các dòng. Excel dán ra dấu TAB; hỗ trợ thêm `;` và `,`
 * để người dùng dán từ CSV cũng chạy.
 */
function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  return line.split(',');
}

export function parseAssets(text: string, data: CatalogData): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Có hàng tiêu đề không?
  const firstCells = splitCells(lines[0]).map(slug);
  const hasHeader = firstCells.some(c => HEADER_ALIAS[c] === 'so_hieu');
  const cols: ImportColumn[] = hasHeader
    ? firstCells.map(c => HEADER_ALIAS[c] ?? ('' as ImportColumn))
    : [...IMPORT_COLUMNS];

  const whByCode = new Map(data.warehouses.map(w => [w.code.toLowerCase(), w]));
  const existing = new Set(data.assets.map(a => a.serial));
  const seen = new Map<string, number>();

  const out: ParsedRow[] = [];
  const body = hasHeader ? lines.slice(1) : lines;

  body.forEach((line, i) => {
    const cells = splitCells(line).map(c => c.trim());
    const raw: Record<string, string> = {};
    cols.forEach((c, idx) => { if (c) raw[c] = cells[idx] ?? ''; });

    const row: ParsedRow = {
      line: i + (hasHeader ? 2 : 1),
      raw,
      serial: (raw.so_hieu || '').trim(),
      type: (TYPE_ALIAS[slug(raw.loai || '')] ?? '') as AssetType | '',
      errors: [], warnings: [],
    };

    /* ---- Bắt buộc ---- */
    if (!row.serial) row.errors.push('Thiếu số hiệu');
    if (!row.type) {
      row.errors.push(raw.loai ? `Loại "${raw.loai}" không hợp lệ (ME41/ME42/DTS27/TI/TU/SIM/GP03/KHAC)` : 'Thiếu loại vật tư');
    }

    /* ---- Trùng lặp ---- */
    if (row.serial) {
      if (existing.has(row.serial)) row.errors.push('Số hiệu đã có trong hệ thống');
      const prev = seen.get(row.serial);
      if (prev) row.errors.push(`Trùng với dòng ${prev} trong danh sách dán`);
      else seen.set(row.serial, row.line);
    }

    /* ---- Tỷ số cho TI/TU ---- */
    row.ratio_primary = num(raw.so_cap || '');
    row.ratio_secondary = num(raw.thu_cap || '');
    if (hasRatio(row.type)) {
      if (row.ratio_primary === undefined || row.ratio_secondary === undefined) {
        row.errors.push('TI/TU phải có cả sơ cấp và thứ cấp (VD 800 và 5)');
      } else if (row.ratio_secondary === 0) {
        row.errors.push('Thứ cấp không được bằng 0');
      } else {
        row.ratio = row.ratio_primary / row.ratio_secondary;
      }
    } else if (row.ratio_primary !== undefined || row.ratio_secondary !== undefined) {
      row.warnings.push('Chỉ TI/TU mới cần tỷ số — bỏ qua sơ cấp/thứ cấp');
      row.ratio_primary = undefined;
      row.ratio_secondary = undefined;
    }

    /* ---- Năm sản xuất ---- */
    const yRaw = num(raw.nam_sx || '');
    if (yRaw !== undefined) {
      const now = new Date().getFullYear();
      if (yRaw < 1980 || yRaw > now) row.errors.push(`Năm SX ${yRaw} không hợp lệ`);
      else row.manufacture_year = yRaw;
    } else if (isMeter(row.type) && row.serial) {
      const y = yearFromSerial(row.serial);
      if (y) {
        row.manufacture_year = y;
        row.warnings.push(`Năm SX suy từ 2 số đầu số hiệu: ${y}`);
      } else {
        row.errors.push('Không suy được năm SX từ số hiệu — phải nhập cột nam_sx');
      }
    } else if (row.type && needsCalibration(row.type)) {
      row.errors.push('Thiếu năm SX (cần để tính hạn kiểm định)');
    }

    /* ---- Kiểm định ---- */
    const cal = (raw.ngay_kiem_dinh || '').trim();
    if (cal) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cal)) row.errors.push('Ngày kiểm định phải dạng YYYY-MM-DD');
      else {
        row.calibration_date = cal;
        // Đã kiểm định thì hạn tính TỪ NGÀY KIỂM ĐỊNH, không tính lại từ năm SX
        const span = calibrationSpan(row.type) ?? 0;
        if (span) {
          const d = new Date(cal); d.setFullYear(d.getFullYear() + span);
          row.next_calibration = d.toISOString().slice(0, 10);
        }
      }
    } else if (row.type) {
      row.next_calibration = calcNextCalibration(row.manufacture_year, row.type);
    }
    if (row.next_calibration && row.next_calibration < new Date().toISOString().slice(0, 10)) {
      row.warnings.push(`Đã quá hạn kiểm định (${row.next_calibration}) — nhập được nhưng không treo lên điểm đo được`);
    }

    /* ---- Kho ---- */
    const kho = (raw.kho || '').trim();
    if (kho) {
      const w = whByCode.get(kho.toLowerCase());
      if (!w) row.errors.push(`Không có kho mã "${kho}"`);
      else row.warehouseCode = w.code;
    } else {
      row.warnings.push('Chưa chọn kho — vật tư sẽ ở trạng thái "trong kho" nhưng chưa rõ kho nào');
    }

    row.manufacturer = raw.hang_sx || '';
    row.model_desc = raw.model || '';
    row.accuracy_class = raw.cap_chinh_xac || '';
    row.note = raw.ghi_chu || '';

    out.push(row);
  });

  return out;
}

/** Nội dung file mẫu (TSV để dán thẳng vào Excel). */
export function templateCsv(): string {
  const head = IMPORT_COLUMNS.join(',');
  const rows = [
    '2610123456,ME41,,,EMIC,,0.5S,,,809,vi du cong to',
    'TI-2026-001,TI,800,5,EMIC,,0.5,2026,,809,vi du TI 800/5',
    'TU-2026-001,TU,22000,220,EMIC,,0.5,2026,,809,vi du TU trung the',
    'GP03-000123,GP03,,,VIETTEL,,,2026,,809,thiet bi thu thap du lieu',
    'SIM-0912345678,SIM,,,VIETTEL,,,2026,,809,sim truyen du lieu',
  ];
  return [head, ...rows].join('\n');
}
