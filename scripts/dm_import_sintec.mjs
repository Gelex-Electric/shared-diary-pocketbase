#!/usr/bin/env node
/**
 * Nạp 9 trạm + 9 điểm đo DỰ KIẾN của SINTEC (KCNTH-020) từ "Quản lý kho V2.xlsx".
 *
 * Vì sao nạp từ Excel dù Excel đã bị kết luận là sai (27/08/2026): chỗ Excel
 * sai là dữ liệu ĐÃ VẬN HÀNH — nó lạc hậu so với PB. Riêng SINTEC thì PB chưa
 * có gì cả (0 trạm, 0 điểm đo, 0 hóa đơn) còn Excel có sổ nhập kho ngày
 * 07/08/2026, nên ở đây Excel là nguồn DUY NHẤT.
 *
 * Nạp gì:
 *   - 9 trạm, mã sinh bằng `buildStationCode` của app (không gõ tay).
 *   - 9 điểm đo CHÍNH, mỗi trạm một cái; mã trùng mã trạm vì khách hàng của
 *     điểm đo chính là chủ trạm.
 *   - 18 vật tư (9 công tơ ME41 + 9 GP-03) KHÔNG có ngày treo => vật tư DỰ KIẾN
 *     => điểm đo tự ra trạng thái "Dự kiến". Sổ giao dịch chỉ có "Nhập kho",
 *     chưa dòng "Treo tháo" nào, nên điền ngày treo là bịa.
 *
 * KHÔNG nạp: tỷ số TI (Excel không có TI cho SINTEC) => HSN chưa suy được, phải
 * khai tay sau. Cũng KHÔNG đặt `hsn` = 1: đó chính là lỗi đã làm 8 điểm đo khác
 * mang HSN sai.
 *
 * Mặc định CHẠY THỬ. Thêm `--apply` mới ghi:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_import_sintec.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APPLY = process.argv.includes('--apply');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx'))
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const MKH = 'KCNTH-020';

/* Dùng ĐÚNG hàm sinh mã của app, không chép lại quy tắc. */
const tmp = mkdtempSync(join(tmpdir(), 'dm-'));
const outFile = join(tmp, 'naming.mjs');
await build({
  entryPoints: [join(ROOT, 'src/lib/dm/naming.ts')], outfile: outFile,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { buildStationCode, buildPointCode } = await import(pathToFileURL(outFile).href);
rmSync(tmp, { recursive: true, force: true });

/* ----------------------------- PocketBase ----------------------------- */
const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

/** Lấy HẾT bản ghi — `dm_asset` đã vượt 500, một trang là thiếu im lặng. */
const allOf = async (col) => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = await (await fetch(
      `${PB}/api/collections/${col}/records?perPage=500&page=${p}`, { headers: H })).json();
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};
const [zones, customers, stations, points, assets] = await Promise.all(
  ['dm_zone', 'dm_customer', 'dm_station', 'dm_point', 'dm_asset'].map(allOf));

const cus = customers.find(c => c.mkh === MKH);
if (!cus) { console.error(`Không tìm thấy khách hàng ${MKH} trên PB`); process.exit(1); }
const zone = zones.find(z => z.id === cus.zone);
if (!zone) { console.error(`Khách hàng ${MKH} chưa gắn KCN`); process.exit(1); }

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const J = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
const xPoints = J('Quản lý điểm đo').filter(r => String(r.MKH ?? '').trim() === MKH);
const xTrans = J('Quản lý giao dịch').filter(r => String(r.DDDK ?? '').includes('SINTEC'));

/**
 * Tách mã Excel `TH.SINTEC.1TR1.1500kVA` thành định danh gốc + công suất.
 * Lấy mảnh CUỐI làm công suất, mảnh áp chót làm định danh — chịu được mã có
 * thêm/bớt đoạn, thay vì bám vào vị trí cố định.
 */
const parse = (code) => {
  const seg = String(code).split('.');
  const kva = Number(String(seg.at(-1)).replace(/kva/i, '').trim());
  return { raw: String(seg.at(-2)).toUpperCase(), sdmKva: Number.isFinite(kva) ? kva : null };
};

/**
 * ĐỊNH DANH TRẠM: quy về `T<n>` ĐÁNH SỐ TUẦN TỰ (user chốt 28/08/2026).
 *
 * Excel đặt `1TR1…3TR3` theo kiểu <nhà xưởng>TR<máy>, nhưng định danh của app
 * chỉ có MỘT đoạn nên không diễn đạt được hai cấp. Trên PB thì 99/113 trạm
 * đang dùng `T<n>` tuần tự, nên theo số đông.
 *
 * Cái mất là thông tin nhà xưởng — vì vậy mã Excel gốc được ghi vào `note` của
 * cả trạm lẫn điểm đo, để sau này còn lần ngược ra trạm nào thuộc xưởng nào.
 *
 * Thứ tự đánh số KHÔNG lấy theo thứ tự dòng trong sheet (dễ đổi khi ai đó sắp
 * xếp lại) mà tính từ chính mã: xưởng trước, máy sau, `TC` xếp cuối.
 */
const orderKey = (raw) => {
  const m = /^(\d+)TR(\d+)$/.exec(raw);
  return m ? [0, Number(m[1]), Number(m[2])] : [1, 0, 0];
};
const cmp = (a, b) => {
  const x = orderKey(a), y = orderKey(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.localeCompare(b);
};

/** Ghi chú riêng cho trạm thi công — nó sẽ được tháo sau khi xây xong. */
const NOTE_OF = { TC: 'Trạm thi công — sẽ tháo sau khi xây dựng xong.' };

/** ME41/ME42 là công tơ; GP-03 -> GP03 theo bảng loại của app. */
const typeOf = (t) => /^me4/i.test(t) ? 'CONGTO'
  : /gp-?03/i.test(t) ? 'GP03'
    : /sim/i.test(t) ? 'SIM'
      : /^ti$/i.test(t) ? 'TI'
        : /^tu$/i.test(t) ? 'TU' : 'KHAC';

const parsed = xPoints
  .map(xp => ({ excelCode: String(xp['Mã điểm đo']).trim(), ...parse(String(xp['Mã điểm đo']).trim()) }))
  .sort((a, b) => cmp(a.raw, b.raw));

const plan = [];
parsed.forEach((x, i) => {
  const ident = `T${i + 1}`;
  const parts = { zoneCode: zone.code, customerShortName: cus.short_name ?? '', ident, sdmKva: x.sdmKva };
  const stationCode = buildStationCode(parts);
  /*
    Mã Excel gốc (`1TR1`, `TC`) làm ĐỊNH DANH ĐIỂM ĐO — app bọc ngoặc ở cuối mã
    (user chốt 28/08/2026).

    Định danh trạm đã quy về `T<n>` tuần tự nên mã trạm không còn nói được trạm
    này thuộc nhà xưởng nào. Đưa mã gốc vào đuôi điểm đo thì thông tin đó nằm
    ngay trên mã, không phải mở ghi chú ra đọc — và mã điểm đo cũng khác mã
    trạm, khỏi trùng nếu sau này trạm có thêm điểm đo thứ hai.
  */
  const pointCode = buildPointCode({ ...parts, isSub: false, pointIdent: x.raw });
  const rows = xTrans.filter(t => String(t.DDDK).trim() === x.excelCode);
  const note = [`Excel: ${x.excelCode}`, NOTE_OF[x.raw]].filter(Boolean).join(' · ');
  plan.push({
    excelCode: x.excelCode, raw: x.raw, stationCode, pointCode, ident, sdmKva: x.sdmKva, note,
    assets: rows.map(t => ({ serial: String(t.ID).trim(), type: typeOf(String(t.LOAIVT)) })),
  });
});

/**
 * Loại Excel khai có khớp DẠNG SỐ CHẾ TẠO không.
 *
 * Số công tơ là 10 chữ số bắt đầu bằng `2`; số GP-03 (IMEI) là 15 chữ số bắt
 * đầu bằng `869`. Excel gõ nhầm cột `LOAIVT` thì cả bộ vật tư của điểm đo đó
 * lệch loại, mà loại lại quyết định điểm đo có đo xa hay không.
 */
const looksLike = (serial) => /^869\d{12}$/.test(serial) ? 'GP03'
  : /^2\d{9}$/.test(serial) ? 'CONGTO' : null;

const typeWarn = [];
for (const p of plan) {
  for (const a of p.assets) {
    const guess = looksLike(a.serial);
    if (guess && guess !== a.type) {
      typeWarn.push({ p, a, guess });
      // Tin DẠNG SỐ hơn cột LOAIVT: số chế tạo là thứ đọc từ thiết bị, còn cột
      // loại là thứ người nhập gõ tay.
      a.type = guess;
    }
  }
}

/* ------------------------------ Va chạm ------------------------------ */
/*
  Phân biệt hai thứ khác hẳn nhau:

  - ĐÃ CÓ ĐÚNG bản ghi này (trùng mã trạm / mã điểm đo, hoặc số No đã nằm ở
    đúng điểm đo của nó) — chỉ là lần chạy trước đã làm tới đó. Không chặn, chỉ
    báo rồi dùng lại.
  - VA CHẠM THẬT: số No đang gắn ở điểm đo KHÁC. Ghi đè là cướp vật tư của điểm
    đo kia, nên chặn.
*/
const already = [];
const clash = [];
const pointCodes = new Set(plan.map(p => p.pointCode));
for (const p of plan) {
  if (stations.some(s => s.code === p.stationCode)) already.push(`trạm ${p.stationCode}`);
  if (points.some(x => x.code === p.pointCode)) already.push(`điểm đo ${p.pointCode}`);
  for (const a of p.assets) {
    const other = assets.find(x => String(x.serial).trim() === a.serial);
    if (!other) continue;
    const at = points.find(x => x.id === other.point);
    if (at && pointCodes.has(at.code)) already.push(`số No ${a.serial} (ở ${at.code})`);
    else clash.push(`số No ${a.serial} đang gắn ở điểm đo ${at?.code ?? '(không rõ)'} — không ghi đè`);
  }
}

/* ------------------------------- In ra ------------------------------- */
console.log(`Khách hàng : ${cus.mkh} — ${cus.name} (tên tắt ${cus.short_name})`);
console.log(`KCN        : ${zone.code} — ${zone.name}`);
console.log(`Nguồn      : ${XLSX_PATH}`);
console.log('');
for (const p of plan) {
  console.log(`TRẠM   ${p.stationCode.padEnd(24)} Sdm ${p.sdmKva}kVA · ${p.note}`);
  console.log(`  ĐIỂM ${p.pointCode}   chính · dự kiến · HSN chưa suy được (thiếu tỷ số TI)`);
  for (const a of p.assets) console.log(`     ${a.type.padEnd(7)} ${a.serial}   (chưa có ngày treo)`);
}
const nAssets = plan.reduce((n, p) => n + p.assets.length, 0);
console.log(`\nSẼ TẠO: ${plan.length} trạm · ${plan.length} điểm đo · ${nAssets} vật tư`);
if (typeWarn.length) {
  console.log(`\nEXCEL GHI SAI LOẠI (${typeWarn.length}) — đã sửa theo dạng số chế tạo:`);
  for (const w of typeWarn) {
    console.log(`   ${w.a.serial}  ở ${w.p.excelCode}: Excel ghi công tơ, dạng số là ${w.guess}`);
  }
}
if (already.length) {
  console.log(`\nĐÃ CÓ SẴN (${already.length}) — lần chạy trước đã tạo, sẽ dùng lại:`);
  for (const a of already) console.log(`   ${a}`);
}
if (clash.length) {
  console.log(`\nVA CHẠM (${clash.length}) — phải xử lý trước khi ghi:`);
  for (const c of clash) console.log(`   ${c}`);
}

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }
if (clash.length) { console.error('\nDừng: còn va chạm.'); process.exit(1); }

/* -------------------------------- Ghi -------------------------------- */
const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(j)}`);
  return j;
};
/*
  CHẠY LẠI ĐƯỢC. Lần chạy đầu vỡ giữa chừng (`dm_point.connection` là trường
  bắt buộc mà script bỏ trống) sau khi đã tạo xong trạm đầu tiên. Nếu cứ tạo mù
  thì lần chạy sau đẻ ra trạm trùng. Vì vậy mỗi bản ghi đều TRA TRƯỚC theo mã;
  có rồi thì dùng lại, chưa có mới tạo.
*/
const findBy = (list, field, value) => list.find(x => String(x[field]).trim() === value);
const ensure = async (col, cache, field, value, body) => {
  const found = findBy(cache, field, value);
  if (found) return { rec: found, created: false };
  return { rec: await post(col, body), created: true };
};

let nS = 0, nP = 0, nA = 0;
for (const p of plan) {
  const s = await ensure('dm_station', stations, 'code', p.stationCode, {
    code: p.stationCode, zone: zone.id, customer: cus.id, ident: p.ident, sdm_kva: p.sdmKva,
    // Giữ mã Excel gốc: định danh T<n> tuần tự đã làm mất thông tin nhà xưởng.
    note: p.note,
  });
  if (s.created) nS++;

  const pt = await ensure('dm_point', points, 'code', p.pointCode, {
    code: p.pointCode, line_name: p.pointCode, station: s.rec.id, zone: zone.id, customer: cus.id,
    ident: p.raw, sub_label: '', role: 'chinh', status: 'du_kien', note: p.note,
    /*
      `connection` là trường BẮT BUỘC của `dm_point`. Chưa có tỷ số TI nên
      không suy được bằng `connectionOfHsn`, nhưng trạm 250–2000kVA thì chắc
      chắn đo GIÁN TIẾP qua TI — đo thẳng chỉ có ở phụ tải nhỏ. Vẫn để `hsn`
      trống: đoán cách đấu nối là an toàn, đoán con số nhân thì không.
    */
    connection: 'gian_tiep',
  });
  if (pt.created) nP++;

  for (const a of p.assets) {
    const r = await ensure('dm_asset', assets, 'serial', a.serial, {
      serial: a.serial, type: a.type, point: pt.rec.id, status: 'kho', active: true });
    if (r.created) nA++;
  }
  console.log(`${s.created || pt.created ? 'TẠO ' : 'CÓ  '} ${p.stationCode}  →  ${p.pointCode}`);
}
console.log(`\nĐã tạo mới: ${nS} trạm · ${nP} điểm đo · ${nA} vật tư`);
