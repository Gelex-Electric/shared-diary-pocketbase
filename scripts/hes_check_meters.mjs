#!/usr/bin/env node
/**
 * Đối chiếu CÔNG TƠ ĐANG TREO giữa danh mục PocketBase và HES.
 *
 * Hai câu hỏi:
 *   1. Khai ĐÚNG chưa — HSN và mã trạm hai bên có khớp không?
 *   2. Khai ĐỦ chưa — bên nào có mà bên kia thiếu?
 *
 * Rồi gọi `GetInstantByDate` cho từng công tơ để biết nó CÒN PHÁT DỮ LIỆU hay
 * không: có mặt trong `GetMeterAccount` chỉ nghĩa là còn khai trong HES, chưa
 * chắc còn sống.
 *
 * `METER_NAME` của HES là HỆ SỐ NHÂN, không phải tên công tơ (xem API_HES.md).
 *
 * CHỈ ĐỌC cả hai phía. Token lấy từ `API_TOKEN`, không tự gọi Login.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... API_TOKEN=... node scripts/hes_check_meters.mjs
 */
const API = 'http://14.225.244.63:8899/api';
const TOKEN = process.env.API_TOKEN;
if (!TOKEN) { console.error('Thiếu API_TOKEN'); process.exit(1); }
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/** Cửa sổ soi dữ liệu tức thời — đủ rộng để công tơ đọc thưa vẫn lọt. */
const DAYS = Number(process.env.DAYS || 3);
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}000000`;
const NOW = new Date();
const FROM = stamp(new Date(NOW.getTime() - DAYS * 86400000));
const TO = stamp(new Date(NOW.getTime() + 86400000));

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
const [points, assets, customers, stations] = await Promise.all(
  ['dm_point', 'dm_asset', 'dm_customer', 'dm_station'].map(allOf));

const ymd = (v) => String(v ?? '').slice(0, 10);
const N = (s) => String(s ?? '').trim();
const pointById = new Map(points.map(p => [p.id, p]));
const mkhOf = (id) => customers.find(c => c.id === id)?.mkh ?? '';
const sdmOf = (id) => stations.find(s => s.id === id)?.sdm_kva;

/** Công tơ ĐANG TREO: có ngày treo, chưa có ngày tháo. */
const live = assets
  .filter(a => a.type === 'CONGTO' && ymd(a.date_on) && !ymd(a.date_off) && a.point)
  .map(a => {
    const p = pointById.get(a.point);
    return {
      serial: N(a.serial), point: p,
      code: p?.code || p?.line_name || '(không rõ)',
      hsn: p?.hsn, mkh: mkhOf(p?.customer), status: p?.status, sdm: sdmOf(p?.station),
      dateOn: ymd(a.date_on),
    };
  });
const pbBySerial = new Map(live.map(x => [x.serial, x]));

/* -------------------------------- HES -------------------------------- */
const hesRaw = await (await fetch(`${API}/GetMeterAccount?UserID=2&Token=${TOKEN}`)).json();
if (!Array.isArray(hesRaw)) {
  console.error('GetMeterAccount lỗi:', JSON.stringify(hesRaw));
  process.exit(1);
}
const hes = hesRaw.map(m => ({
  serial: N(m.METER_NO),
  // METER_NAME là HỆ SỐ NHÂN, không phải tên công tơ.
  hsn: Number(m.METER_NAME),
  line: N(m.LINE_NAME),
  customer: N(m.CUSTOMER_NAME),
  model: N(m.METER_MODEL_DESC),
  created: N(m.CREATED).slice(0, 10),
}));
const hesBySerial = new Map(hes.map(m => [m.serial, m]));

/* ------------------- Còn phát dữ liệu không (tức thời) ------------------- */
/** Chạy song song có giới hạn — HES là máy chủ nội bộ, đừng dội hết một lúc. */
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e).slice(0, 60) }; }
    }
  }));
  return out;
};

const probe = async (serial) => {
  const r = await fetch(
    `${API}/GetInstantByDate?MeterNo=${encodeURIComponent(serial)}&StartDate=${FROM}&EndDate=${TO}&Token=${TOKEN}`);
  const j = await r.json();
  if (!Array.isArray(j)) return { n: 0, last: '', msg: j?.MESSAGE ?? '' };
  const times = j.map(x => N(x.DATE_TIME)).filter(Boolean).sort();
  return { n: j.length, last: times[times.length - 1] ?? '', sample: j[j.length - 1] };
};

/** Soi MỌI công tơ ở cả hai phía — thiếu bên nào cũng cần biết nó còn sống không. */
const probeList = [...new Set([...pbBySerial.keys(), ...hesBySerial.keys()])];
const probed = await mapLimit(probeList, 6, probe);
const liveMap = new Map(probeList.map((s, k) => [s, probed[k]]));
const isAlive = (s) => (liveMap.get(s)?.n ?? 0) > 0;

/* ------------------------------- Báo cáo ------------------------------- */
const onlyPb = live.filter(x => !hesBySerial.has(x.serial));
const onlyHes = hes.filter(m => !pbBySerial.has(m.serial));
const both = live.filter(x => hesBySerial.has(x.serial));

/** So mã trạm bỏ dấu chấm/khoảng trắng — hai bên viết cách nhau. */
const loose = (s) => String(s ?? '').toUpperCase().replace(/[\s.()-]/g, '');
const hsnOff = both.filter(x => {
  const h = hesBySerial.get(x.serial).hsn;
  return Number.isFinite(h) && x.hsn != null && h !== x.hsn;
});
const lineOff = both.filter(x => {
  const l = hesBySerial.get(x.serial).line;
  return l && !loose(l).startsWith(loose(x.code).slice(0, 12));
});

console.log(`Cửa sổ soi dữ liệu: ${DAYS} ngày (${FROM} → ${TO})\n`);
console.log(`Công tơ ĐANG TREO trên PB : ${live.length}`);
console.log(`Công tơ trong HES         : ${hes.length}`);
console.log(`Có ở CẢ HAI               : ${both.length}`);
console.log(`  · còn phát dữ liệu      : ${both.filter(x => isAlive(x.serial)).length}`);
console.log(`  · IM LẶNG ${DAYS} ngày        : ${both.filter(x => !isAlive(x.serial)).length}`);
console.log(`\nChỉ có trên PB (HES thiếu): ${onlyPb.length}`);
console.log(`Chỉ có trên HES (PB thiếu): ${onlyHes.length}`);
console.log(`Lệch HSN                  : ${hsnOff.length}`);
console.log(`Lệch mã trạm              : ${lineOff.length}`);

const show = (title, rows, fmt) => {
  if (!rows.length) return;
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) console.log('  ' + fmt(r));
};

show('LỆCH HSN — sai một ly là sai toàn bộ sản lượng', hsnOff, x =>
  `${x.serial.padEnd(12)} PB ${String(x.hsn).padStart(5)}  ≠  HES ${String(hesBySerial.get(x.serial).hsn).padStart(5)}   ${x.code}`);

show('ĐANG TREO TRÊN PB MÀ HES KHÔNG CÓ', onlyPb, x =>
  `${x.serial.padEnd(12)} ${x.code.padEnd(34)} ${x.status} · treo ${x.dateOn}`
  + `${isAlive(x.serial) ? ' · CÓ dữ liệu tức thời' : ''}`);

show('CÓ TRONG HES MÀ PB KHÔNG KHAI ĐANG TREO', onlyHes, m =>
  `${m.serial.padEnd(12)} HSN ${String(m.hsn).padStart(5)} ${m.line.padEnd(34)} ${m.customer.slice(0, 34)}`
  + `${isAlive(m.serial) ? ' · CÒN SỐNG' : ' · im lặng'}`);

show(`CÓ Ở CẢ HAI NHƯNG IM LẶNG ${DAYS} NGÀY`, both.filter(x => !isAlive(x.serial)), x =>
  `${x.serial.padEnd(12)} ${x.code.padEnd(34)} ${x.sdm ?? '?'}kVA · ${x.status}`
  + `${liveMap.get(x.serial)?.msg ? ` · ${liveMap.get(x.serial).msg}` : ''}`);

show('LỆCH MÃ TRẠM (tham khảo — hai bên đặt tên khác nhau)', lineOff, x =>
  `${x.serial.padEnd(12)} PB ${x.code.padEnd(34)} HES ${hesBySerial.get(x.serial).line}`);
