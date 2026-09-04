#!/usr/bin/env node
/**
 * Nạp VẬT TƯ còn thiếu từ "Quản lý kho V2.xlsx" vào `dm_device` (+ `dm_asset`
 * khi đã có điểm đo).
 *
 * Chạy được nhờ mô hình mới (schema v13/v14): `dm_device` chứa được thiết bị
 * CHƯA gắn điểm đo nào, nên hàng tồn kho — thứ trước đây PB không có chỗ chứa —
 * nay nạp được.
 *
 * Ba nhóm, xử lý khác nhau:
 *
 *   A. Đã gán một ĐIỂM ĐO THẬT  → tạo thiết bị + tạo lần lắp trỏ vào điểm đo.
 *   B. Chỉ nằm ở KHO ẢO của Excel (GETC / DỰ PHÒNG / THU HỒI / TRẢ)
 *                                → tạo thiết bị, KHÔNG gắn điểm đo; ghi nơi
 *                                  giữ vào `hold_for_note`.
 *   C. Có trong sổ vật tư nhưng chưa giao dịch nào → như B, không nơi giữ.
 *
 * NGÀY TREO: chỉ lấy từ dòng "Treo tháo". Dòng "Nhập kho" là hàng về kho, chưa
 * ra hiện trường — điền ngày đó vào `date_on` sẽ biến điểm đo thành "đang vận
 * hành" và đẻ ra một loạt cảnh báo giả (user chốt 28/08/2026).
 *
 * KHÔNG nạp 2 số là LỖI GÕ của Excel — xem `TYPO` bên dưới.
 *
 * CHẠY THỬ mặc định. `--apply` mới ghi. Chạy lại được.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_import_devices.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--all');
const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx'))
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/**
 * Số No Excel gõ sai — ĐÃ ĐỐI CHIẾU, PocketBase không thiếu gì.
 * Nạp vào là đẻ ra thiết bị ma.
 */
const TYPO = {
  '2620400965': 'gõ đảo của 2620400695 — PB đã có đủ 3 TI 3000/5 ở 03.AQ.T1.2500kVA',
  '24100121440': 'thừa một số 0 — PB đã có công tơ 2410121440 ở YM.TITAN.NX3.EVERJOY',
};

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
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(allOf));

const N = (s) => String(s ?? '').replace(/^'+/, '').trim().toUpperCase();
const have = new Map(devices.map(d => [N(d.serial), d]));
const codeOf = Object.fromEntries(points.map(p => [p.id, p.code || p.line_name || '—']));
/** số No → các điểm đo bên PB đang giữ nó, để dò điểm đo tương ứng của Excel. */
const pbAt = new Map();
for (const a of assets) {
  const s = N(a.serial);
  if (s && a.point) pbAt.set(s, new Set([...(pbAt.get(s) ?? []), a.point]));
}

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const J = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
const xTrans = J('Quản lý giao dịch');
const xAssets = J('Quản lý vật tư');

const ymdOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10) : '';
};
/** "Điểm đo" ảo của Excel để chứa hàng kho — PB không có khái niệm này. */
const isWarehouse = (dd) => /GETC|DỰ PHÒNG|DU PHONG|THU HỒI|THU HOI|^TH\.TRẢ|TRẢ$/i.test(dd);

/**
 * Loại: tin cột `LOAIVT`, TRỪ khi dạng số nói khác một cách chắc chắn.
 * IMEI `869…` (15 số) là GP-03, ICCID `8984…` là SIM — hai dạng này không nhầm
 * được. KHÔNG đoán công tơ với TI: cả hai đều 10 số bắt đầu bằng `2`.
 */
const typeOf = (loai, serial) => {
  if (/^869\d{12}$/.test(serial)) return 'GP03';
  if (/^8984\d{15,16}$/.test(serial)) return 'SIM';
  const t = String(loai);
  return /^me4/i.test(t) ? 'CONGTO' : /gp-?03/i.test(t) ? 'GP03'
    : /sim/i.test(t) ? 'SIM' : /^ti$/i.test(t) ? 'TI' : /^tu$/i.test(t) ? 'TU' : 'KHAC';
};
const ratioOf = (ts) => {
  const m = /^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/.exec(String(ts ?? '').trim());
  return m
    ? { ratio_primary: Number(m[1].replace(',', '.')), ratio_secondary: Number(m[2].replace(',', '.')) }
    : {};
};

/* ------------------- Gom mọi thông tin theo từng số No ------------------- */
const info = new Map();
const touch = (serial) => {
  if (!info.has(serial)) {
    info.set(serial, { serial, type: '', ratio: {}, dates: [], hungAt: [], holdAt: [], notes: [] });
  }
  return info.get(serial);
};

for (const t of xTrans) {
  const serial = N(t.ID);
  const dd = String(t.DDDK ?? '').trim();
  if (!serial || !dd) continue;
  const it = touch(serial);
  it.type ||= typeOf(t.LOAIVT, serial);
  if (!it.ratio.ratio_primary) Object.assign(it.ratio, ratioOf(t.TSTI));
  const day = ymdOf(t.NGAYGD);
  if (day) it.dates.push(day);
  const hung = /treo/i.test(String(t.LOAIGD));
  if (isWarehouse(dd)) it.notes.push(dd);
  else if (hung) it.hungAt.push({ dd, day });
  else it.holdAt.push({ dd, day });
}
for (const r of xAssets) {
  const serial = N(r['Số ID']);
  if (!serial) continue;
  const it = touch(serial);
  it.type ||= typeOf(r['Loại vật tư'], serial);
  if (!it.ratio.ratio_primary) Object.assign(it.ratio, ratioOf(r['Thông số kỹ thuật']));
  const gc = String(r['Ghi chú'] ?? '').trim();
  if (gc) it.notes.push(gc);
}

/* ------------------------ Chỉ giữ cái PB CHƯA CÓ ------------------------ */
const typos = [];
const plan = [];
for (const it of info.values()) {
  if (have.has(it.serial)) continue;
  if (TYPO[it.serial]) { typos.push(it.serial); continue; }

  /*
    Điểm đo tương ứng bên PB: dò qua CÁC SỐ ANH EM cùng điểm đo Excel, rồi
    KIỂM CHỨNG LẠI BẰNG MÃ.

    Phiếu bầu một mình KHÔNG đủ. Ba công tơ `2610323003/014/020` được nhập kho
    cho TRRBW-1/2/3 nhưng lắp thật ở NX10/11/12, nên phiếu của chúng kéo cả bộ
    TI của TRRBW về sai trạm. Tương tự `TTI.TITAN.NX6.2000kVA.P4` bị hút về
    điểm đo cha `TTI.TITAN.NX6.2000kVA`.

    Vì vậy chỉ nhận khi mã hai bên TRÙNG NHAU sau khi bỏ dấu chấm/gạch/ngoặc —
    đủ để bỏ qua khác biệt `VT_THANHAN` ↔ `VT-THANHAN`, mà vẫn phân biệt được
    `NX6` với `NX6.P4` và `TRRBW-1.1500kVA` với `NX11.560kVA`.

    Không khớp thì CHỈ TẠO THIẾT BỊ, không gắn điểm đo — thà để người dùng gắn
    tay còn hơn gắn nhầm trạm.
  */
  const loose = (s) => String(s ?? '').toUpperCase().replace(/[\s.()_-]/g, '');
  const target = it.hungAt[0]?.dd || it.holdAt[0]?.dd || '';
  let pointId = '';
  let rejected = '';
  if (target) {
    const votes = new Map();
    for (const t of xTrans) {
      if (String(t.DDDK ?? '').trim() !== target) continue;
      for (const p of pbAt.get(N(t.ID)) ?? []) votes.set(p, (votes.get(p) ?? 0) + 1);
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    if (top && loose(codeOf[top]) === loose(target)) pointId = top;
    else if (top) rejected = codeOf[top];
  }

  plan.push({
    ...it,
    group: target ? (pointId ? 'A' : 'A-thiếu-điểm-đo') : (it.notes.length ? 'B' : 'C'),
    target, pointId, rejected,
    // Ngày treo CHỈ lấy từ dòng "Treo tháo".
    dateOn: it.hungAt[0]?.day ?? '',
    dateIn: [...it.dates].sort()[0] ?? '',
    hold: [...new Set(it.notes)].join(' · ').slice(0, 200),
  });
}

/* ------------------------------- In ra ------------------------------- */
const g = (k) => plan.filter(p => p.group === k);
const byType = plan.reduce((m, p) => ({ ...m, [p.type]: (m[p.type] ?? 0) + 1 }), {});
console.log(`Nguồn : ${XLSX_PATH}`);
console.log(`dm_device đang có : ${devices.length}\n`);
console.log(`SẼ TẠO THIẾT BỊ   : ${plan.length}   ${JSON.stringify(byType)}`);
console.log(`   A. gắn được vào điểm đo có sẵn : ${g('A').length}`);
console.log(`   A'. có điểm đo Excel nhưng PB CHƯA CÓ điểm đo đó : ${g('A-thiếu-điểm-đo').length}`);
console.log(`   B. hàng kho (GETC / dự phòng / thu hồi)          : ${g('B').length}`);
console.log(`   C. có trong sổ vật tư, chưa giao dịch nào        : ${g('C').length}`);

const show = (k, title) => {
  const rows = g(k);
  if (!rows.length) return;
  console.log(`\n--- ${title} (${rows.length}) ---`);
  const lim = VERBOSE ? rows.length : 12;
  for (const p of rows.slice(0, lim)) {
    console.log(`   ${p.type.padEnd(7)} ${p.serial.padEnd(20)} `
      + `${(p.ratio.ratio_primary ? `${p.ratio.ratio_primary}/${p.ratio.ratio_secondary}` : '').padEnd(9)} `
      + `${p.pointId ? `→ ${codeOf[p.pointId]}` : p.target || p.hold || ''}`
      + `${p.dateOn ? `  treo ${p.dateOn}` : ''}`
      // Nói rõ đã TỪ CHỐI gán vào đâu, kẻo tưởng script không tìm ra gì.
      + `${p.rejected ? `   [không gán vào ${p.rejected}: mã không khớp]` : ''}`);
  }
  if (rows.length > lim) console.log(`   … còn ${rows.length - lim} (thêm --all)`);
};
show('A', 'Gắn vào điểm đo có sẵn');
show('A-thiếu-điểm-đo', 'CHƯA CÓ ĐIỂM ĐO trên PB — chỉ tạo thiết bị, KHÔNG gắn');
show('B', 'Hàng kho');
show('C', 'Chưa giao dịch nào');

if (typos.length) {
  console.log(`\nBỎ QUA vì Excel gõ sai (${typos.length}):`);
  for (const s of typos) console.log(`   ${s} — ${TYPO[s]}`);
}
const willAttach = g('A').filter(p => p.dateOn).length;
console.log(`\nSẼ TẠO LẦN LẮP    : ${g('A').length}  (trong đó ${willAttach} có ngày treo, `
  + `${g('A').length - willAttach} là GIỮ CHỖ — sổ chỉ ghi "Nhập kho")`);

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }

/* -------------------------------- Ghi -------------------------------- */
const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col} ${JSON.stringify(body)}: ${JSON.stringify(j)}`);
  return j;
};

let nDev = 0, nAsset = 0;
for (const p of plan) {
  const dev = await post('dm_device', {
    serial: p.serial, type: p.type, ...p.ratio,
    date_in: p.dateIn || '',
    hold_for_note: p.hold,
    // Có điểm đo nhưng chưa treo ⇒ giữ chỗ trên chính thiết bị (schema v14).
    ...(p.pointId && !p.dateOn ? { hold_point: p.pointId } : {}),
  });
  nDev++;
  if (p.pointId) {
    await post('dm_asset', {
      serial: p.serial, type: p.type, device: dev.id, point: p.pointId, ...p.ratio,
      date_on: p.dateOn || '', active: true,
      status: p.dateOn ? 'dang_treo' : 'kho',
    });
    nAsset++;
  }
  if (nDev % 25 === 0) console.log(`   … ${nDev} thiết bị`);
}
console.log(`\nĐã tạo ${nDev} thiết bị, ${nAsset} lần lắp.`);
