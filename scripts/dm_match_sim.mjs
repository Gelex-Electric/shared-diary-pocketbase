#!/usr/bin/env node
/**
 * Ghép SIM trong "Danh sách sim.xlsx" với điểm đo trên PocketBase. CHỈ ĐỌC
 * trừ khi có `--apply`.
 *
 * File SIM không có mã điểm đo — chỉ có cột `Khách hàng đã biết` viết tự do
 * ("Trạm T1 2500kVA BE BRIGHT", "Asahi", "JPVN 560"). Nên phải ghép mờ, và
 * ghép mờ thì BẮT BUỘC phải cho người đọc soát lại: script in ra từng cặp kèm
 * lý do khớp, và chỉ ghi những cặp CHẮC CHẮN (đúng một điểm đo ứng viên).
 *
 * Cách ghép, theo thứ tự tin cậy giảm dần:
 *   1. Tên tắt khách hàng xuất hiện trong ô ghi chú, VÀ ô đó có công suất khớp
 *      Sdm của trạm  → chắc chắn.
 *   2. Tên tắt khớp, khách hàng đó chỉ có ĐÚNG MỘT điểm đo → chắc chắn.
 *   3. Tên tắt khớp nhưng khách có nhiều điểm đo, không phân biệt được → BỎ,
 *      đưa vào mục "phải chọn tay".
 *
 * SIM chỉ được khai vào điểm đo CHƯA CÓ SIM. Điểm đo đã có SIM khác thì bỏ
 * qua — thay SIM là việc phải khai ngày tháo, không phải thêm bừa dòng mới.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_match_sim.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx'))
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/10. KHo/Danh sách sim.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

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

const zoneOf = Object.fromEntries(zones.map(z => [z.id, z]));
const stOf = Object.fromEntries(stations.map(s => [s.id, s]));
const cusOf = Object.fromEntries(customers.map(c => [c.id, c]));

/** Bỏ dấu + viết hoa, để so tên tắt với chữ người ta gõ tay trong Excel. */
const nz = (s) => String(s ?? '').toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D');

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

/** Số serial ngày của Excel -> `YYYY-MM-DD`. Mốc 1899-12-30 = 25569 ngày. */
const ymdOf = (v) => {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v).slice(0, 10);
  return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
};

/** Số SIM đôi khi bị Excel giữ nguyên dấu nháy dẫn ('8984…) — cắt đi. */
const serialOf = (v) => String(v ?? '').replace(/^'+/, '').trim();

const pbSerials = new Set(assets.map(a => String(a.serial).trim()));
/** Điểm đo nào đã có SIM đang treo. */
const hasSim = new Set(assets.filter(a => a.type === 'SIM' && a.active).map(a => a.point));

const sims = rows
  .map(r => ({
    serial: serialOf(r['Số']), zone: String(r.KCN ?? '').trim(),
    hint: String(r['Khách hàng đã biết'] ?? '').trim(),
    dateOn: ymdOf(r['Ngày đấu nối']),
  }))
  .filter(r => /^\d{15,20}$/.test(r.serial));

/* ------------------------------ Ghép mờ ------------------------------ */
const sure = [];      // ghép chắc chắn
const ambiguous = []; // khớp tên nhưng nhiều ứng viên
const noHint = [];    // không có gợi ý khách hàng
const already = [];   // SIM đã có trên PB
const occupied = [];  // điểm đo đã có SIM khác

for (const s of sims) {
  if (pbSerials.has(s.serial)) { already.push(s); continue; }
  if (!s.hint) { noHint.push(s); continue; }

  const hint = nz(s.hint);
  /*
    Công suất viết trong ô ghi chú: "Trạm T1 2500kVA BE BRIGHT" -> 2500.

    CHỈ nhận con số đứng ngay trước chữ "kVA". Bản đầu có nhánh dự phòng bắt
    bừa cụm 3–4 chữ số bất kỳ, nên "JPVN 560" bị hiểu là trạm 560kVA trong khi
    560 là một phần tên khách — rồi in ra nhãn "tên tắt + 560kVA" cho một trạm
    800kVA. Đoán sai thì thà đừng đoán.
  */
  const mKva = /(\d{2,5})\s*KVA/i.exec(hint);
  const kvaHint = mKva ? Number(mKva[1]) : null;

  /*
    Định danh trạm trong ô ghi chú: "Trạm T1 2500kVA BAIYANG" -> T1.

    Bắt buộc phải xét. Bản đầu bỏ qua nó, và vì T1 của BAIYANG đã có SIM nên
    bộ lọc "chỉ lấy điểm đo chưa có SIM" đẩy SIM của T1 sang T2 — gán sai hẳn
    một trạm mà vẫn báo là "chắc chắn".
  */
  const mIdent = /\b(T\d+|NX\d+)\b/i.exec(hint);
  const identHint = mIdent ? mIdent[1].toUpperCase() : null;

  // Điểm đo của khách nào có tên tắt nằm trong ô ghi chú.
  let cands = points.filter(p => {
    const c = cusOf[p.customer];
    const short = nz(c?.short_name);
    if (!short || short.length < 2) return false;
    return hint.includes(short);
  });
  // Cùng KCN với cột KCN của file SIM.
  if (s.zone) {
    const inZone = cands.filter(p => zoneOf[stOf[p.station]?.zone]?.code === s.zone);
    if (inZone.length) cands = inZone;
  }
  if (!cands.length) { noHint.push({ ...s, why: 'không tên tắt nào khớp' }); continue; }

  /*
    Lọc bằng công suất và định danh trạm. Mỗi bộ lọc chỉ áp khi nó THẬT SỰ thu
    hẹp được — lọc ra rỗng nghĩa là ghi chú nói về thứ PB không có, lúc đó giữ
    nguyên tập cũ nhưng KHÔNG ghi nhận là "đã lọc", để nhãn lý do khỏi nói dối.
  */
  let picked = cands;
  const used = [];
  if (kvaHint != null) {
    const byKva = picked.filter(p => stOf[p.station]?.sdm_kva === kvaHint);
    if (byKva.length) { picked = byKva; used.push(`${kvaHint}kVA`); }
  }
  if (identHint) {
    const byIdent = picked.filter(p => String(stOf[p.station]?.ident ?? '').toUpperCase() === identHint);
    if (byIdent.length) { picked = byIdent; used.push(identHint); }
  }

  /*
    Điểm đo đã có SIM ⇒ BỎ QUA CẢ SỐ SIM NÀY, không đẩy sang điểm đo khác.
    Thay SIM là thao tác phải khai ngày tháo cho cái cũ, không phải chuyện
    script tự quyết; mà gán sang trạm bên cạnh thì sai hẳn dữ liệu.
  */
  const free = picked.filter(p => !hasSim.has(p.id));
  if (!free.length) { occupied.push({ ...s, at: picked.map(p => p.code).join(', ') }); continue; }
  // Ghi chú đã chỉ đích danh một điểm đo mà nó bận ⇒ không tự chọn cái còn lại.
  if (free.length < picked.length && used.length) {
    occupied.push({ ...s, at: picked.filter(p => hasSim.has(p.id)).map(p => p.code).join(', ') });
    continue;
  }

  if (free.length === 1) {
    sure.push({ ...s, point: free[0],
      why: used.length ? `tên tắt + ${used.join(' + ')}` : 'tên tắt, khách chỉ 1 điểm đo chưa có SIM' });
  } else {
    ambiguous.push({ ...s, cands: free.map(p => p.code) });
  }
}

/* ------------------------------- In ra ------------------------------- */
console.log(`File SIM: ${sims.length} số hợp lệ / ${rows.length} dòng\n`);
console.log(`GHÉP CHẮC CHẮN     : ${sure.length}`);
console.log(`Nhiều ứng viên      : ${ambiguous.length}`);
console.log(`Điểm đo đã có SIM   : ${occupied.length}`);
console.log(`SIM đã có trên PB   : ${already.length}`);
console.log(`Không đủ gợi ý      : ${noHint.length}`);

if (sure.length) {
  console.log('\n=== SẼ KHAI ===');
  for (const s of sure) {
    console.log(`  ${s.serial}  →  ${s.point.code.padEnd(30)} treo ${s.dateOn || 'DỰ KIẾN'}`
      + `   ["${s.hint}" · ${s.why}]`);
  }
}
if (ambiguous.length) {
  console.log('\n=== PHẢI CHỌN TAY — khớp tên nhưng nhiều điểm đo ===');
  for (const s of ambiguous) console.log(`  ${s.serial}  "${s.hint}"  →  ${s.cands.join(' | ')}`);
}
if (occupied.length) {
  console.log('\n=== BỎ QUA — điểm đo đã có SIM đang treo ===');
  for (const s of occupied) console.log(`  ${s.serial}  "${s.hint}"  →  ${s.at}`);
}

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }

const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(j)}`);
  return j;
};
for (const s of sure) {
  await post('dm_asset', {
    serial: s.serial, type: 'SIM', point: s.point.id, active: true,
    /*
      "Ngày đấu nối" của nhà mạng là ngày SIM được kích hoạt, KHÔNG phải ngày
      lắp lên công tơ. Nhưng SIM chỉ đấu nối khi đã gắn vào GP-03 tại hiện
      trường, nên đây là mốc gần nhất có thật. Không có ngày thì để trống ⇒
      vật tư dự kiến.
    */
    ...(s.dateOn ? { date_on: s.dateOn, status: 'dang_treo' } : { status: 'kho' }),
  });
  console.log(`OK  ${s.serial} → ${s.point.code}`);
}
