#!/usr/bin/env node
/**
 * Nạp hợp đồng QLVH từ file theo dõi Excel vào PocketBase.
 *
 *   node scripts/qlvh_import_excel.mjs "<file.xlsx>"            # dry-run
 *   node scripts/qlvh_import_excel.mjs "<file.xlsx>" --commit   # nạp thật
 *
 * NGUYÊN TẮC: nhập NGUYÊN số liệu trong bảng, KHÔNG sinh lại lịch bằng
 * buildSchedule. Các đợt thấp hơn công thức là do khách thanh lý sớm — số trong
 * bảng mới là số thật (user xác nhận 21/08/2026).
 *
 * Chỉ ghi vào `qlvh_contract` / `qlvh_payment`. `dm_customer` / `dm_zone` chỉ ĐỌC:
 * khách chưa có trong danh mục thì để trống quan hệ và giữ tên ở `customer_name`,
 * KHÔNG tự thêm bản ghi vào danh mục.
 *
 * Chạy lại nhiều lần được: hợp đồng đã có (theo số HĐ) thì bỏ qua.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const FILE = process.argv[2];
const COMMIT = process.argv.includes('--commit');
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

if (!FILE || FILE.startsWith('--')) {
  console.error('Thiếu đường dẫn file .xlsx.\n  node scripts/qlvh_import_excel.mjs "<file.xlsx>" [--commit]');
  process.exit(1);
}

/* ------------------------------------------------------------------ PB API */

let tok = '';
const api = async (p, i = {}) => {
  const r = await fetch(PB_URL + p, {
    ...i,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: tok } : {}), ...(i.headers || {}) },
  });
  const t = await r.text();
  const b = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${i.method || 'GET'} ${p} → ${r.status} ${t.slice(0, 300)}`);
  return b;
};

/* ---------------------------------------------------------------- Tiện ích */

const fm = n => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));

/** Ô ngày của Excel đọc raw ra SỐ SERIAL (ngày kể từ 30/12/1899). */
function toDay(v) {
  const p = n => String(n).padStart(2, '0');
  if (typeof v === 'number' && v > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v || '').trim();
  if (!s) return '';
  const [m, d, y] = s.split('/').map(Number);
  if (!m || !d || !y) return '';
  return `${y < 100 ? 2000 + y : y}-${p(m)}-${p(d)}`;
}

const bool = v => String(v).trim().toUpperCase() === 'TRUE';
const num = v => Math.round(Number(v) || 0);

/** Chuẩn hoá tên doanh nghiệp để tra danh mục: bỏ dấu, bỏ loại hình, bỏ ký tự lạ. */
const normName = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase()
  .replace(/CONG TY|CTY|CO PHAN|\bCP\b|TNHH|MTV|MOT THANH VIEN|VIET NAM|CHI NHANH.*$/g, '')
  .replace(/[^A-Z0-9]/g, '');

/** Tên KCN trong bảng viết tắt, danh mục ghi đầy đủ. */
const ZONE_ALIAS = {
  'TIEN HAI': 'KCN Tiền Hải',
  'PD': 'KCN Phong Điền',
  'PHONG DIEN': 'KCN Phong Điền',
  'SO 3': 'KCN Số 3',
  'YEN MY': 'KCN Yên Mỹ',
  'THUAN THANH I': 'KCN Thuận Thành I',
};
const normZone = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase().trim();

/* Cột trong sheet TH-QLVH (dòng tiêu đề là dòng 6). */
const COL = {
  kcn: 0, kh: 1, so: 2, thanhLy: 3, ngayKy: 4, thang: 5, hieuLuc: 6, ketThuc: 7,
  giaTri: 9, cheXuat: 10,
  dot: [
    { due: 11, amt: 12, no: 13, tt: 14 },
    { due: 15, amt: 16, no: 17, tt: 18 },
    { due: 19, amt: 20, no: 21, tt: 22 },
  ],
};

/* -------------------------------------------------------------------- Chạy */

(async () => {
  console.log(`File : ${FILE}`);
  console.log(`PB   : ${PB_URL}`);
  console.log(COMMIT ? 'CHẾ ĐỘ: GHI THẬT (--commit)\n' : 'CHẾ ĐỘ: DRY-RUN (thêm --commit để nạp thật)\n');

  tok = (await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
  })).token;

  const customers = (await api('/api/collections/dm_customer/records?perPage=500')).items;
  const zones = (await api('/api/collections/dm_zone/records?perPage=50')).items;
  const existing = (await api('/api/collections/qlvh_contract/records?perPage=500&fields=id,contract_no')).items;
  const haveNo = new Set(existing.map(c => c.contract_no));

  const cusIdx = new Map(customers.map(c => [normName(c.name), c]));
  const zoneIdx = new Map(zones.map(z => [normZone(z.name), z]));

  const wb = XLSX.readFile(FILE, { raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['TH-QLVH'], { header: 1, raw: true, defval: '' })
    .slice(6).filter(r => String(r[COL.so] || '').trim());

  const seen = new Set();
  const noCustomer = new Set();
  let created = 0, skipped = 0, dup = 0, payments = 0;
  const problems = [];

  for (const r of rows) {
    const contractNo = String(r[COL.so]).trim();
    if (seen.has(contractNo)) { dup++; problems.push(`TRÙNG số HĐ trong file: ${contractNo}`); continue; }
    seen.add(contractNo);
    if (haveNo.has(contractNo)) { skipped++; continue; }

    const rawName = String(r[COL.kh]).trim();
    const cus = cusIdx.get(normName(rawName));
    if (!cus) noCustomer.add(rawName);

    const zoneKey = normZone(r[COL.kcn]);
    const zone = zoneIdx.get(zoneKey) || zoneIdx.get(normZone(ZONE_ALIAS[zoneKey] || ''));
    if (!zone) { problems.push(`Không map được KCN "${r[COL.kcn]}" — ${contractNo}`); continue; }

    const before = num(r[COL.giaTri]);
    const cheXuat = bool(r[COL.cheXuat]);
    const vatRate = cheXuat ? 0 : 8;
    const vat = Math.round((before * vatRate) / 100);

    const body = {
      contract_no: contractNo,
      customer: cus ? cus.id : '',
      customer_name: rawName,
      zone: zone.id,
      sign_date: toDay(r[COL.ngayKy]),
      effective_from: toDay(r[COL.hieuLuc]),
      effective_to: toDay(r[COL.ketThuc]),
      value_before_vat: before,
      vat_rate: vatRate,
      value_vat: vat,
      value_total: before + vat,
      che_xuat: cheXuat,
      status_manual: bool(r[COL.thanhLy]) ? 'da_thanh_ly' : 'dang_hieu_luc',
      note: 'Nhập từ file theo dõi hợp đồng (Excel) ngày ' + new Date().toISOString().slice(0, 10),
    };

    /* Đợt: lấy nguyên trong bảng. Đã thu ⇔ công nợ = 0 (bảng không có ca thu
       một phần). KHÔNG bịa ngày thu — bảng không ghi, để trống. */
    const dots = [];
    COL.dot.forEach((c, i) => {
      const amt = num(r[c.amt]);
      const due = toDay(r[c.due]);
      if (!amt && !due) return;
      const debt = num(r[c.no]);
      dots.push({
        seq: i + 1,
        due_date: due,
        amount_due: amt,
        amount_paid: Math.max(0, amt - debt),
        note: debt === 0 && amt > 0 ? 'Đã thu (theo file theo dõi, không có ngày thu)' : '',
      });
    });

    console.log(`${COMMIT ? '+' : '+ [dry-run]'} ${contractNo.padEnd(34).slice(0, 34)} | ${zone.code.padEnd(6)} | ${(cus ? cus.mkh : '(chưa có KH)').padEnd(11)} | ${String(fm(before)).padStart(13)}đ | ${dots.length} đợt${cheXuat ? ' | chế xuất' : ''}`);

    if (!COMMIT) { created++; payments += dots.length; continue; }

    const saved = await api('/api/collections/qlvh_contract/records', { method: 'POST', body: JSON.stringify(body) });
    for (const d of dots) {
      await api('/api/collections/qlvh_payment/records', { method: 'POST', body: JSON.stringify({ ...d, contract: saved.id }) });
      payments++;
    }
    created++;
  }

  console.log(`\n--- Tổng kết ---`);
  console.log(`Hợp đồng trong file : ${rows.length}`);
  console.log(`${COMMIT ? 'Đã nạp' : 'Sẽ nạp'}              : ${created} hợp đồng / ${payments} đợt`);
  console.log(`Đã có sẵn, bỏ qua   : ${skipped}`);
  if (dup) console.log(`Trùng số HĐ         : ${dup}`);
  if (noCustomer.size) {
    console.log(`\nKhách chưa có trong dm_customer (${noCustomer.size}) — hợp đồng vẫn nạp, giữ tên ở customer_name,`);
    console.log(`KHÔNG tự thêm vào danh mục. Thêm bằng màn Danh mục rồi nối lại sau:`);
    [...noCustomer].forEach(n => console.log('  -', n));
  }
  if (problems.length) { console.log('\nVấn đề:'); problems.forEach(p => console.log('  !', p)); }
})().catch(e => { console.error('\nLỖI:', e.message); process.exit(1); });
