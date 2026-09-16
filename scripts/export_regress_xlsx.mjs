#!/usr/bin/env node
/**
 * Xuất danh sách CA LÙI CHỈ SỐ ra file Excel.
 *
 * Nguồn là collection `alerts` trên PocketBase, KHÔNG phải `public/hes_30min/`:
 * file 30 phút chỉ lưu 5 biểu chiều ACTIVE, thiếu hẳn chiều NHẬN, nên soi từ đó
 * ra thiếu khoảng 20% số ca (59 so với 76 tại mốc 15/09 02:30, và mất trắng
 * khung 13/09). `alerts` được ghi từ API đủ 10 biểu.
 *
 * Hai sheet, tách bạch vì ý nghĩa khác hẳn nhau:
 *   "Chi tiết"  — mỗi dòng một ca, kèm cột PHÂN LOẠI và ĐƠN VỊ.
 *   "Tổng hợp"  — cộng theo KCN, CHỈ cộng kWh (vô công là kVArh, không cộng chung).
 *
 * CHỈ ĐỌC PocketBase, không ghi gì.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/export_regress_xlsx.mjs
 *   ... node scripts/export_regress_xlsx.mjs --out "D:/bao-cao.xlsx" --from 2026-09-01
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';

const arg = (name, def = '') => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const FROM = arg('--from');
const TO = arg('--to');
const OUT = arg('--out', `chi-so-lui-${new Date().toISOString().slice(0, 10)}.xlsx`);

/** Vô công đo bằng kVArh — không được cộng chung vào tổng kWh. */
const isReactive = (r) => /^Vô công/.test(r.register ?? '');

if (!EMAIL || !PASSWORD) {
  console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.');
  process.exit(1);
}

const auth = await (await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại.'); process.exit(1); }

/* `lui` = lùi thật · `lamtron` = sai số làm tròn của HES. Lấy CẢ HAI rồi ghi rõ
   phân loại ở một cột, để người đọc tự lọc — giấu bớt một loại là quyết định
   thay họ. */
const res = await (await fetch(
  `${PB_URL}/api/collections/alerts/records?perPage=500&sort=day`
  + `&filter=${encodeURIComponent('kind="lui" || kind="lamtron"')}`,
  { headers: { Authorization: auth.token } })).json();

const rows = [];
for (const a of res.items ?? []) {
  if (FROM && a.day < FROM) continue;
  if (TO && a.day > TO) continue;
  for (const d of a.details ?? []) {
    rows.push({
      'Ngày': d.day || a.day,
      'Số công tơ': d.meter,
      'Khách hàng': d.customer || '(chưa khai)',
      'Trạm / điểm đo': d.station || '',
      'KCN': d.zone || '(nhiều KCN)',
      'Từ giờ': d.fromTime || '',
      'Đến giờ': d.toTime || '',
      'Biểu': d.register || '',
      'Chỉ số trước': d.fromIndex ?? '',
      'Chỉ số sau': d.toIndex ?? '',
      'Mức lùi': d.fromIndex != null && d.toIndex != null
        ? Number((d.fromIndex - d.toIndex).toFixed(3)) : '',
      'Lượng': d.value ?? '',
      'Đơn vị': isReactive(d) ? 'kVArh' : 'kWh',
      'Phân loại': a.kind === 'lamtron' ? 'Sai số làm tròn (HES)' : 'Lùi thật',
    });
  }
}

if (!rows.length) {
  console.error('Không có ca nào trong phạm vi đã chọn.');
  process.exit(1);
}

rows.sort((a, b) => String(b['Ngày']).localeCompare(String(a['Ngày']))
  || a['KCN'].localeCompare(b['KCN'])
  || a['Số công tơ'].localeCompare(b['Số công tơ'])
  || String(a['Từ giờ']).localeCompare(String(b['Từ giờ'])));

/* ------------------------------ Tổng hợp ------------------------------ */
const byZone = new Map();
for (const r of rows) {
  const k = `${r['Ngày']}|${r['KCN']}`;
  const cur = byZone.get(k) ?? {
    'Ngày': r['Ngày'], 'KCN': r['KCN'],
    'Số ca': 0, 'Số công tơ': new Set(),
    'Tổng kWh': 0, 'Số ca vô công (kVArh)': 0,
  };
  cur['Số ca']++;
  cur['Số công tơ'].add(r['Số công tơ']);
  if (r['Đơn vị'] === 'kVArh') cur['Số ca vô công (kVArh)']++;
  else if (typeof r['Lượng'] === 'number') cur['Tổng kWh'] += r['Lượng'];
  byZone.set(k, cur);
}
const summary = [...byZone.values()].map(x => ({
  ...x,
  'Số công tơ': x['Số công tơ'].size,
  'Tổng kWh': Number(x['Tổng kWh'].toFixed(3)),
}));

/* ------------------------------- Ghi file ------------------------------- */
const wb = XLSX.utils.book_new();

const wsDetail = XLSX.utils.json_to_sheet(rows);
wsDetail['!cols'] = [
  { wch: 11 }, { wch: 13 }, { wch: 26 }, { wch: 34 }, { wch: 17 },
  { wch: 8 }, { wch: 8 }, { wch: 23 }, { wch: 13 }, { wch: 13 },
  { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 21 },
];
wsDetail['!autofilter'] = { ref: wsDetail['!ref'] };
/* Khoá dòng tiêu đề: bảng trăm dòng mà cuộn xuống là mất tên cột. */
wsDetail['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, wsDetail, 'Chi tiết');

const wsSum = XLSX.utils.json_to_sheet(summary);
wsSum['!cols'] = [{ wch: 11 }, { wch: 17 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 21 }];
XLSX.utils.book_append_sheet(wb, wsSum, 'Tổng hợp');

XLSX.writeFile(wb, OUT);

const real = rows.filter(r => r['Phân loại'] === 'Lùi thật').length;
const meters = new Set(rows.map(r => r['Số công tơ'])).size;
const days = new Set(rows.map(r => r['Ngày'])).size;
console.log(`✔ ${OUT}`);
console.log(`  ${rows.length} ca · ${meters} công tơ · ${days} ngày`);
console.log(`  Lùi thật: ${real} · Sai số làm tròn: ${rows.length - real}`);
console.log(`  Vô công (kVArh, KHÔNG cộng vào tổng kWh): ${rows.filter(r => r['Đơn vị'] === 'kVArh').length}`);
