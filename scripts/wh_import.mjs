/**
 * Task 3/4 — Import du lieu kho tu Excel goc "Quan ly kho V2.xlsx" vao PocketBase.
 * Plan: plans/2026-08-06-quan-ly-kho-thiet-bi.md (muc 0, 3, 6).
 *
 * Chay:
 *   XLSX_PATH="...\Quản lý kho V2.xlsx" node scripts/wh_import.mjs            # dry-run (mac dinh)
 *   XLSX_PATH=... PB_URL=... PB_EMAIL=... PB_PASS=... node scripts/wh_import.mjs --commit
 *
 * MAC DINH LA DRY-RUN: chi doc Excel, suy dien, in bao cao doi chieu. Khong cham PocketBase.
 * Chi ghi khi co --commit VA ty le khop bo doi chieu >= NGUONG (mac dinh 95%).
 *
 * Vi sao phai suy dien: Excel goc khong co cot phan biet TREO voi THAO
 * (LOAIGD chi co 4 gia tri, xem plan 3.10). Bo luat o buildMovements() ben duoi.
 */

import XLSX from 'xlsx';

const XLSX_PATH = process.env.XLSX_PATH || '';
const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_EMAIL || '';
const PB_PASS = process.env.PB_PASS || '';
const COMMIT = process.argv.includes('--commit');
const NGUONG = Number(process.env.NGUONG || 95);

if (!XLSX_PATH) { console.error('Thieu XLSX_PATH.'); process.exit(1); }
if (COMMIT && !(PB_URL && PB_EMAIL && PB_PASS)) {
  console.error('--commit can PB_URL / PB_EMAIL / PB_PASS.'); process.exit(1);
}

// ==================== Doc Excel ====================

const wb = XLSX.readFile(XLSX_PATH);
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' });

/** Excel luu ngay duoi dang so serial. 25569 = so ngay tu 1899-12-30 den 1970-01-01. */
function excelDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'string') return v.trim();
  return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
}
const s = (v) => String(v ?? '').trim();

const rawKcn = sheet('Quản lý KCN').slice(1).filter(r => s(r[0]));
const rawKh = sheet('Quản lý khách hàng').slice(1).filter(r => s(r[0]));
const rawDd = sheet('Quản lý điểm đo').slice(1).filter(r => s(r[0]));
const rawVt = sheet('Quản lý vật tư').slice(1).filter(r => s(r[1]));
const rawGd = sheet('Quản lý giao dịch').slice(1).filter(r => s(r[4]));
const rawBc = sheet('Báo cáo vật tư theo Điểm đo').slice(4).filter(r => s(r[1]));

// ==================== Anh xa danh muc ====================

/** Ma KCN Excel -> zone trong PocketBase (khop select da tao o wh_schema). */
const ZONE_OF_KCN = {
  KCNTH: 'KCN Tiền Hải', 'KCNPĐ': 'KCN Phong Điền', KCNTTI: 'KCN Thuận Thành I',
  KCNYM: 'KCN Yên Mỹ', KCN03: 'KCN Số 3', GETC: 'GETC',
};
/** Tien to ma diem do -> ma kho (wh_warehouse.code). */
const WAREHOUSE_OF_PREFIX = { TH: 'TH', 'PĐ': 'PĐ', TTI: 'TTI', YM: 'YM', '03': '03', GETC: 'GETC' };
/** Loai vat tu Excel -> {type, model}. ME41/ME42 la 2 MODEL cua cung loai CONGTO. */
const TYPE_OF_VT = {
  ME41: { type: 'CONGTO', model: 'ME41' },   // gian tiep — BAT BUOC co TI
  ME42: { type: 'CONGTO', model: 'ME42' },   // truc tiep — khong can TI, HSN=1
  'GP-03': { type: 'GP03', model: '' },
  GP03: { type: 'GP03', model: '' },
  TI: { type: 'TI', model: '' },
  TU: { type: 'TU', model: '' },
  Sim: { type: 'SIM', model: '' },
};

/**
 * Diem do gia dai dien cho KHO (plan 3.4). Tra ve {warehouse, nguon_goc} hoac null.
 * "DU PHONG" = mua moi chua dung; "THU HOI"/"TRA" = da qua su dung.
 */
function khoCuaDiemDo(code) {
  const c = s(code).toUpperCase();
  if (!c) return null;
  if (c === 'GETC' || c === 'GETCHY') return { warehouse: 'GETC', nguon_goc: 'du_phong' };
  const m = c.match(/^(.+?)\.(DỰ PHÒNG|THU HỒI|TRẢ)\s*$/);
  if (!m) return null;
  const wh = WAREHOUSE_OF_PREFIX[m[1]];
  if (!wh) return null;
  return { warehouse: wh, nguon_goc: m[2] === 'DỰ PHÒNG' ? 'du_phong' : 'thu_hoi' };
}

/** Tien to KCN cua ma diem do -> ma kho, de biet "thu hoi ve kho nao". */
function khoTheoTienTo(code) {
  const p = s(code).split('.')[0].toUpperCase();
  return WAREHOUSE_OF_PREFIX[p] || '';
}

// ==================== Chuan hoa danh muc ====================

const customers = rawKh.map(r => ({
  mkh: s(r[0]), ten: s(r[1]), tat: s(r[2]),
  zone: ZONE_OF_KCN[s(r[3])] || '', trang_thai: '',
}));
const zoneOfMkh = Object.fromEntries(customers.map(c => [c.mkh, c.zone]));

const allDd = rawDd.map(r => ({
  point_code: s(r[0]), mkh: s(r[1]), trang_thai: s(r[2]),
  ngay_dong_dien: excelDate(r[3]), ngay_thanh_ly: excelDate(r[4]),
}));
const khoInfo = {};              // point_code (gia) -> {warehouse, nguon_goc}
const points = [];               // diem do THAT
for (const d of allDd) {
  const kho = khoCuaDiemDo(d.point_code);
  if (kho) { khoInfo[d.point_code] = kho; continue; }
  // Ma dang KCN.TENKH.T1.400kVA -> tach MBA + cong suat de hien thi
  const parts = d.point_code.split('.');
  const last = parts[parts.length - 1] || '';
  const kva = /^([\d.,]+)\s*kva$/i.exec(last.replace(/\s/g, ''));
  points.push({
    point_code: d.point_code,
    mkh: d.mkh,
    zone: zoneOfMkh[d.mkh] || '',
    mba: parts.length >= 3 ? parts[parts.length - 2] : '',
    cong_suat_kva: kva ? Number(kva[1].replace(',', '.')) : null,
    ngay_dong_dien: d.ngay_dong_dien,
    ngay_thanh_ly: d.ngay_thanh_ly,
    trang_thai: d.trang_thai,
  });
}
const isPoint = new Set(points.map(p => p.point_code));

// ==================== Thiet bi ====================

const devices = new Map();       // serial -> {...}
for (const r of rawVt) {
  const t = TYPE_OF_VT[s(r[0])];
  if (!t) { console.warn(`  [canh bao] loai vat tu la: "${s(r[0])}"`); continue; }
  devices.set(s(r[1]), {
    serial: s(r[1]), type: t.type, model: t.model, spec: s(r[2]),
    calib_expiry: excelDate(r[4]), note: s(r[5]), tu_dong_tao: false,
  });
}
const tuDanhMuc = devices.size;

/** LOAIGD trong Excel co 5 bien the do lech chu hoa (plan 3.10) -> phai chuan hoa. */
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, ' ');

const movementsRaw = rawGd.map(r => ({
  stt: Number(r[0]) || 0,
  loai: norm(r[1]),
  ngay: excelDate(r[2]),
  lvt: s(r[3]),
  serial: s(r[4]),
  tsti: s(r[5]),
  dd: s(r[6]),
  gc: s(r[7]),
  img: s(r[8]),
})).sort((a, b) => a.ngay.localeCompare(b.ngay) || a.stt - b.stt);

// Thiet bi xuat hien trong giao dich nhung chua khai bao o danh muc (plan 3.6)
for (const g of movementsRaw) {
  if (devices.has(g.serial)) {
    const d = devices.get(g.serial);
    if (!d.spec && g.tsti) d.spec = g.tsti;   // bo sung ty so TI tu giao dich
    continue;
  }
  const t = TYPE_OF_VT[g.lvt];
  if (!t) { console.warn(`  [canh bao] loai vat tu la trong giao dich: "${g.lvt}"`); continue; }
  devices.set(g.serial, {
    serial: g.serial, type: t.type, model: t.model, spec: g.tsti,
    calib_expiry: '', note: '', tu_dong_tao: true,
  });
}
const tuGiaoDich = devices.size - tuDanhMuc;

// ==================== Suy dien vong doi (plan muc 6) ====================

/**
 * Chay tuan tu tung thiet bi theo (ngay, stt), giu trang thai hien tai de
 * quyet dinh moi giao dich la treo hay thao.
 * Tra ve {movements, state} — state la vi tri cuoi cung cua tung thiet bi.
 */
function buildMovements() {
  const byDevice = new Map();
  for (const g of movementsRaw) {
    if (!devices.has(g.serial)) continue;
    if (!byDevice.has(g.serial)) byDevice.set(g.serial, []);
    byDevice.get(g.serial).push(g);
  }

  const out = [];
  const state = new Map();       // serial -> {status, point, warehouse}
  const stat = { nhap_kho: 0, chuyen_kho: 0, treo: 0, thao: 0, xuat_kho: 0, thanh_ly: 0, can_review: 0 };

  for (const [serial, list] of byDevice) {
    let cur = { status: '', point: '', warehouse: '' };

    const push = (action, extra = {}) => {
      const mv = { serial, action, event_date: extra.event_date, ...extra };
      out.push(mv); stat[action]++;
      if (mv.can_review) stat.can_review++;
    };

    for (const g of list) {
      const base = { event_date: g.ngay, note: g.gc, img_path: g.img };
      const ddLaKho = khoInfo[g.dd];
      const ddLaDiemDo = isPoint.has(g.dd);

      if (g.loai === 'nhập kho') {
        if (!g.dd || ddLaKho) {
          // Nhap kho that su
          const wh = ddLaKho ? ddLaKho.warehouse : khoTheoTienTo(g.dd);
          push('nhap_kho', { ...base, to_warehouse: wh, from_point: cur.point });
          cur = { status: 'trong_kho', point: '', warehouse: wh };
        } else if (ddLaDiemDo) {
          // Ghi "Nhap kho" nhung tro vao diem do that -> thuc chat la lap dat
          if (cur.status === 'dang_treo' && cur.point && cur.point !== g.dd) {
            push('thao', { ...base, from_point: cur.point, can_review: true });
          }
          push('treo', { ...base, to_point: g.dd, from_warehouse: cur.warehouse, can_review: true });
          cur = { status: 'dang_treo', point: g.dd, warehouse: '' };
        } else {
          push('nhap_kho', { ...base, to_warehouse: khoTheoTienTo(g.dd), can_review: true });
          cur = { status: 'trong_kho', point: '', warehouse: khoTheoTienTo(g.dd) };
        }

      } else if (g.loai === 'treo tháo') {
        // "Treo thao" LUON la TREO. Viec go xuong duoc ghi bang "Thu hoi"
        // (kiem chung bang bo doi chieu: coi day la thao thi ty le khop tut
        // 93% -> 87%). Ten loai chi la ten goi nghiep vu, khong phai 2 chieu.
        if (cur.status === 'dang_treo' && cur.point && cur.point !== g.dd) {
          // Chuyen sang diem do khac -> sinh them but toan thao cho diem cu
          push('thao', { ...base, from_point: cur.point });
        }
        push('treo', { ...base, to_point: g.dd, from_warehouse: cur.warehouse });
        cur = { status: 'dang_treo', point: g.dd, warehouse: '' };

      } else if (g.loai === 'thu hồi') {
        // Thu hoi dung ra phai tro vao KHO (45/50 ban ghi lam vay). Ban ghi tro
        // vao DIEM DO THAT la mau thuan — thuc te deu ghi chu "Chua thao xuong",
        // tuc so ghi thu hoi nhung thiet bi van dang treo. Van ghi but toan theo
        // so, nhung danh dau de nguoi dung doi chieu lai ngoai hien truong.
        const wh = ddLaKho ? ddLaKho.warehouse : khoTheoTienTo(g.dd);
        push('thao', {
          ...base, from_point: cur.point, to_warehouse: wh, reason: 'thu_hoi',
          can_review: ddLaDiemDo || undefined,
        });
        cur = { status: 'da_thu_hoi', point: '', warehouse: wh };

      } else if (g.loai === 'xuất kho') {
        if (ddLaDiemDo) {
          push('treo', { ...base, to_point: g.dd, from_warehouse: cur.warehouse, can_review: true });
          cur = { status: 'dang_treo', point: g.dd, warehouse: '' };
        } else {
          push('xuat_kho', { ...base, from_warehouse: cur.warehouse });
          cur = { status: 'da_xuat_kho', point: '', warehouse: '' };
        }

      } else {
        console.warn(`  [canh bao] LOAIGD la: "${g.loai}" (STT ${g.stt})`);
      }
    }
    state.set(serial, cur);
  }
  return { movements: out, state, stat };
}

const { movements, state, stat } = buildMovements();

// Gan nguon_goc + trang thai dan xuat cho tung thiet bi
for (const [serial, st] of state) {
  const d = devices.get(serial);
  if (!d) continue;
  d.status = st.status || 'trong_kho';
  d.current_point = st.point || '';
  d.current_warehouse = st.warehouse || '';
  d.nguon_goc = st.status === 'da_thu_hoi' ? 'thu_hoi' : 'du_phong';
}

// ==================== Doi chieu voi bo "dap an" 785 dong ====================

/**
 * Sheet "Bao cao vat tu theo Diem do" la ket qua tinh tay cua user (IsLatest=1).
 * Vi tri suy tu duong dan anh: 00.Source/<KCN>/<diem do>/<serial>.png
 */
const expected = new Map();
for (const r of rawBc) {
  const parts = s(r[6]).split('/');
  if (parts.length !== 4) continue;
  expected.set(s(r[0]), parts[2].trim());
}

function viTriHienTai(serial) {
  const d = devices.get(serial);
  if (!d) return '';
  if (d.current_point) return d.current_point;
  if (d.current_warehouse) return `KHO:${d.current_warehouse}`;
  return '';
}

let khop = 0, lech = 0, khongCo = 0;
const lechTheoLoai = {};
const viDuLech = [];
for (const [serial, wantRaw] of expected) {
  const d = devices.get(serial);
  if (!d) { khongCo++; continue; }
  const want = wantRaw;
  const got = viTriHienTai(serial);
  const wantKho = khoCuaDiemDo(want);
  const same = wantKho ? got === `KHO:${wantKho.warehouse}` : got === want;
  if (same) khop++;
  else {
    lech++;
    lechTheoLoai[d.type] = (lechTheoLoai[d.type] || 0) + 1;
    if (viDuLech.length < 12) viDuLech.push({ serial, type: d.type, want, got: got || '(khong xac dinh)' });
  }
}
const tong = khop + lech;
const tyLe = tong ? (khop / tong * 100) : 0;

// ==================== Bao cao ====================

const line = '='.repeat(66);
console.log(`\n${line}\nBAO CAO IMPORT KHO THIET BI ${COMMIT ? '(CHE DO GHI)' : '(DRY-RUN — khong ghi gi)'}\n${line}`);
console.log(`Nguon: ${XLSX_PATH}\n`);

console.log('--- Danh muc doc duoc ---');
console.log(`  KCN                : ${rawKcn.length}`);
console.log(`  Khach hang         : ${customers.length}`);
console.log(`  Diem do THAT       : ${points.length}`);
console.log(`  Diem do gia = kho  : ${Object.keys(khoInfo).length}  [${Object.keys(khoInfo).join(', ')}]`);
console.log(`  Thiet bi           : ${devices.size}  (danh muc ${tuDanhMuc} + tu dong tao tu giao dich ${tuGiaoDich})`);
console.log(`  Giao dich goc      : ${movementsRaw.length}`);

console.log('\n--- But toan suy dien ---');
console.log(`  nhap_kho ${stat.nhap_kho} | treo ${stat.treo} | thao ${stat.thao} | ` +
  `xuat_kho ${stat.xuat_kho} | chuyen_kho ${stat.chuyen_kho} | thanh_ly ${stat.thanh_ly}`);
console.log(`  Tong but toan      : ${movements.length}  (tu ${movementsRaw.length} giao dich goc)`);
console.log(`  Can nguoi xac nhan : ${stat.can_review}  (can_review = true)`);

const theoLoai = {};
for (const d of devices.values()) theoLoai[d.type] = (theoLoai[d.type] || 0) + 1;
console.log(`  Thiet bi theo loai : ${Object.entries(theoLoai).map(([k, v]) => `${k} ${v}`).join(' | ')}`);

const theoTrangThai = {};
for (const d of devices.values()) theoTrangThai[d.status || '(chua co GD)'] = (theoTrangThai[d.status || '(chua co GD)'] || 0) + 1;
console.log(`  Trang thai cuoi    : ${Object.entries(theoTrangThai).map(([k, v]) => `${k} ${v}`).join(' | ')}`);

console.log('\n--- DOI CHIEU voi sheet "Bao cao vat tu theo Diem do" ---');
console.log(`  Bo doi chieu       : ${expected.size} thiet bi`);
console.log(`  Khop               : ${khop}`);
console.log(`  Lech               : ${lech}${lech ? '  -> ' + Object.entries(lechTheoLoai).map(([k, v]) => `${k} ${v}`).join(', ') : ''}`);
console.log(`  Khong co trong GD  : ${khongCo}`);
console.log(`  TY LE KHOP         : ${tyLe.toFixed(2)}%   (nguong ${NGUONG}%)`);
if (viDuLech.length) {
  console.log('\n  Vi du lech (toi da 12):');
  for (const v of viDuLech) console.log(`    ${v.serial.padEnd(20)} ${v.type.padEnd(7)} bao cao="${v.want}"  suy dien="${v.got}"`);
}

console.log(`\n${line}`);
if (tyLe < NGUONG) {
  console.log(`KET LUAN: ty le khop ${tyLe.toFixed(2)}% < nguong ${NGUONG}% -> KHONG IMPORT.`);
  console.log('Can sua lai luat suy dien o buildMovements() truoc khi chay --commit.');
  process.exit(COMMIT ? 1 : 0);
}
console.log(`KET LUAN: ty le khop ${tyLe.toFixed(2)}% >= nguong ${NGUONG}% -> du dieu kien import.`);
if (!COMMIT) {
  console.log('Day la DRY-RUN. Chay lai voi --commit de ghi vao PocketBase.');
  process.exit(0);
}

// ==================== Ghi vao PocketBase ====================
console.log('\nDang ghi vao PocketBase...');
// (Task 4 — chi chay khi user duyet bao cao dry-run.)
console.log('CHUA CAI DAT phan ghi — theo plan, task 4 moi thuc hien sau khi user duyet bao cao.');
process.exit(0);
