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
 * Phía PB, HSN đọc từ `dm_point.hsn` — xem `lib/pb_meters.mjs`.
 *
 * CHỈ ĐỌC cả hai phía. Thêm `--notify` thì có ghi, nhưng chỉ TẠO bản ghi mới
 * trong collection `notifications` — không sửa/xóa gì, không chạm collection khác.
 *
 * Biến môi trường (tên khớp `daily-pipeline.yml` để chạy được trong Actions):
 *   PB_URL      địa chỉ PocketBase          — mặc định https://getc.up.railway.app/pb
 *   PB_EMAIL    tài khoản PocketBase        — hoặc PB_ADMIN_EMAIL khi chạy tay
 *   PB_PASS     mật khẩu PocketBase         — hoặc PB_ADMIN_PASSWORD
 *   API_TOKEN   token HES đã có sẵn         — thiếu thì mới dùng API_USER/API_PASS
 *   API_USER    tài khoản HES               — chỉ dùng khi không có API_TOKEN
 *   API_PASS    mật khẩu HES
 *   USER_ID     UserID cho GetMeterAccount  — mặc định 2 (GETC)
 *   DAYS        cửa sổ soi dữ liệu tức thời — mặc định 3 ngày
 *
 *   PB_EMAIL=... PB_PASS=... API_TOKEN=... node scripts/hes_check_meters.mjs
 */
import { getJson, mapLimit, stamp, getToken } from './lib/hes_api.mjs';
import { pbLogin, liveMeters } from './lib/pb_meters.mjs';
import { notifyOnce } from './lib/pb_notify.mjs';

/** Cửa sổ soi dữ liệu tức thời — đủ rộng để công tơ đọc thưa vẫn lọt. */
const DAYS = Number(process.env.DAYS || 3);
/** Mốc 00:00 của một ngày — API HES nhận `yyyyMMddHHmmss`. */
const dayStamp = (d) => stamp(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
const NOW = new Date();
const FROM = dayStamp(new Date(NOW.getTime() - DAYS * 86400000));
const TO = dayStamp(new Date(NOW.getTime() + 86400000));

const TOKEN = await getToken();
const N = (s) => String(s ?? '').trim();

/* ----------------------------- PocketBase ----------------------------- */
const pbToken = await pbLogin();
const { meters: live } = await liveMeters(pbToken);
const pbBySerial = new Map(live.map(x => [x.serial, x]));

/* -------------------------------- HES -------------------------------- */
const hesRaw = await getJson('GetMeterAccount', { UserID: process.env.USER_ID || '2', Token: TOKEN });
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
const probe = async (serial) => {
  const j = await getJson('GetInstantByDate',
    { MeterNo: serial, StartDate: FROM, EndDate: TO, Token: TOKEN });
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

/* ----------------------------- Thông báo ----------------------------- */
/*
  Mặc định script CHỈ ĐỌC và in ra. Phải truyền `--notify` mới ghi thông báo —
  staging dùng chung dữ liệu với production, nên mỗi lần chạy tay để soi số liệu
  mà tự đẩy thông báo là làm phiền người dùng thật.

  Gộp MỘT thông báo cho mỗi nhóm, không phải mỗi công tơ một cái: lệch 20 công
  tơ thì chuông ngập 20 dòng, không ai đọc nữa.

  Chỉ gửi `area=''` (khối Kinh doanh) — đối chiếu danh mục là việc quản trị,
  không thuộc về một KCN cụ thể.
*/
if (process.argv.includes('--notify')) {
  const list = (rows, f) => rows.map(f).join(', ');
  const groups = [
    onlyHes.length && {
      title: 'Công tơ chưa khai trong Danh mục',
      message: `Đối chiếu HES ↔ Danh mục: ${onlyHes.length} công tơ có trên HES nhưng chưa khai`
        + ` đang treo trong Danh mục — ${list(onlyHes, m => m.serial)}`,
      type: 'info',
    },
    hsnOff.length && {
      title: 'Lệch hệ số nhân (HSN) giữa HES và Danh mục',
      message: `Đối chiếu HES ↔ Danh mục: ${hsnOff.length} công tơ lệch HSN — `
        + list(hsnOff, x => `${x.serial} (Danh mục ${x.hsn} ≠ HES ${hesBySerial.get(x.serial).hsn})`),
      type: 'info',
    },
    onlyPb.length && {
      title: 'Công tơ đang treo mà HES không có',
      message: `Đối chiếu HES ↔ Danh mục: ${onlyPb.length} công tơ khai đang treo trong Danh mục`
        + ` nhưng HES không có — ${list(onlyPb, x => x.serial)}`,
      type: 'info',
    },
  ].filter(Boolean);

  let sent = 0;
  for (const g of groups) if (await notifyOnce(pbToken, g)) sent++;
  console.log(`\nThông báo: ${groups.length} nhóm lệch, đã gửi ${sent} (còn lại đã có sẵn, bỏ qua).`);
} else if (onlyHes.length || hsnOff.length || onlyPb.length) {
  console.log('\n(Thêm --notify để đẩy các nhóm lệch trên vào chuông thông báo.)');
}
