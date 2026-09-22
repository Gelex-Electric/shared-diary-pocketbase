#!/usr/bin/env node
/**
 * Soát HSN của điểm đo so với TỶ SỐ TI/TU đang gắn tại chính điểm đo đó.
 *
 * Nguyên tắc (user nêu 22/09/2026): **HSN thuộc về ĐIỂM ĐO**, suy từ bộ TI gắn
 * ở đó — một điểm đo có đúng MỘT HSN. Công tơ treo lên điểm đo chỉ trả về dữ
 * liệu THÔ; nhân với HSN của điểm đo mới ra số liệu thật.
 *
 * Hệ quả: `METER_NAME` bên HES chỉ là bản khai của HES, KHÔNG phải nguồn chân
 * lý. Chỗ duy nhất quyết định HSN là tỷ số TI trong Danh mục.
 *
 *   HSN = (TI sơ cấp / TI thứ cấp) × (TU sơ cấp / TU thứ cấp)
 *
 * CHỈ ĐỌC PocketBase. Không ghi gì.
 *
 * Bốn thứ script này bắt:
 *   1. HSN khai ≠ HSN suy từ TI  → mọi sản lượng của điểm đo đó sai theo tỷ lệ
 *   2. Các TI tại một điểm LỆCH tỷ số nhau → không biết tin cái nào
 *   3. Nhiều hơn 3 TI cùng "đang treo" → bộ cũ chưa khai ngày tháo
 *   4. TI chưa khai tỷ số → HSN gõ tay, không kiểm chứng được
 *
 *   PB_EMAIL=... PB_PASS=... node scripts/dm_check_hsn.mjs
 */
import { pbLogin } from './lib/pb_meters.mjs';

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
/** Điểm đo 3 pha có đúng 3 TI. Nhiều hơn = bộ cũ chưa khai ngày tháo. */
const TI_PER_POINT = 3;

const token = await pbLogin();
const get = async (c) => {
  const r = await fetch(`${PB_URL}/api/collections/${c}/records?perPage=1000`,
    { headers: { Authorization: token } });
  if (!r.ok) { console.error(`Không đọc được ${c}: HTTP ${r.status}`); process.exit(1); }
  return (await r.json()).items;
};
const [points, assets, stations, customers] = await Promise.all(
  ['dm_point', 'dm_asset', 'dm_station', 'dm_customer'].map(get));

const stById = new Map(stations.map(s => [s.id, s]));
const cById = new Map(customers.map(c => [c.id, c]));
const ymd = (v) => String(v ?? '').slice(0, 10);
const installed = (a) => !ymd(a.date_off);
const ratioOf = (a) => {
  const p = a.ratio_primary;
  const s = a.ratio_secondary;
  if (p == null || s == null || !Number.isFinite(p) || !Number.isFinite(s) || s === 0) return null;
  return p / s;
};
const where = (p) => {
  const st = stById.get(p.station);
  const c = p.customer ? cById.get(p.customer) : undefined;
  return `${st?.code ?? '?'}${c?.short_name ? ` · ${c.short_name}` : ''}`;
};

const bad = { lechHsn: [], lechTi: [], duTi: [], thieuTyso: [] };
let ok = 0;
let boQua = 0;

for (const p of points) {
  /* Điểm đo đã tháo gỡ thì HSN không còn dùng cho gì. */
  if (p.status === 'thao_go') { boQua++; continue; }

  const at = assets.filter(a => a.point === p.id && installed(a));
  const tis = at.filter(a => a.type === 'TI');
  const tus = at.filter(a => a.type === 'TU');

  /* Đấu trực tiếp: công tơ đo thẳng, HSN phải bằng 1. */
  if (!tis.length) {
    if (p.connection === 'truc_tiep' && p.hsn != null && p.hsn !== 1) {
      bad.lechHsn.push([p, `đấu trực tiếp nên HSN phải = 1, đang khai ${p.hsn}`]);
    } else boQua++;
    continue;
  }

  if (tis.length > TI_PER_POINT) {
    const byRatio = new Map();
    for (const t of tis) {
      const r = ratioOf(t);
      const k = r == null ? '(chưa khai tỷ số)' : String(r);
      byRatio.set(k, (byRatio.get(k) ?? 0) + 1);
    }
    bad.duTi.push([p, [...byRatio].map(([r, n]) => `${n}×${r}`).join(', ')]);
  }

  const rs = tis.map(ratioOf).filter(r => r != null);
  if (!rs.length) { bad.thieuTyso.push([p, tis.length]); continue; }

  const uniq = [...new Set(rs)];
  if (uniq.length > 1) { bad.lechTi.push([p, uniq.join(', ')]); continue; }

  const tuRs = [...new Set(tus.map(ratioOf).filter(r => r != null))];
  if (tuRs.length > 1) { bad.lechTi.push([p, `TU lệch tỷ số: ${tuRs.join(', ')}`]); continue; }

  const derived = Math.round(uniq[0] * (tuRs.length ? tuRs[0] : 1) * 1e6) / 1e6;
  if (p.hsn == null) { bad.thieuTyso.push([p, tis.length]); continue; }
  if (Math.abs(p.hsn - derived) > 1e-6) {
    bad.lechHsn.push([p, `khai ${p.hsn} nhưng TI suy ra ${derived}`
      + (tuRs.length ? ` (TI ${uniq[0]} × TU ${tuRs[0]})` : '')]);
  } else ok++;
}

const show = (title, rows, fmt) => {
  if (!rows.length) return;
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) console.log('  ' + fmt(r));
};

console.log(`Điểm đo khớp TI↔HSN : ${ok}`);
console.log(`Không xét (đấu thẳng / chưa gắn TI / đã tháo gỡ): ${boQua}`);

show('HSN KHAI KHÁC HSN SUY TỪ TI — sản lượng điểm đo sai theo tỷ lệ',
  bad.lechHsn, ([p, why]) => `${(p.code ?? '').padEnd(34)} ${why}\n${' '.repeat(36)}${where(p)}`);

show('CÁC TI TẠI MỘT ĐIỂM LỆCH TỶ SỐ NHAU — không biết tin cái nào',
  bad.lechTi, ([p, why]) => `${(p.code ?? '').padEnd(34)} ${why}\n${' '.repeat(36)}${where(p)}`);

show(`NHIỀU HƠN ${TI_PER_POINT} TI CÙNG ĐANG TREO — bộ cũ chưa khai ngày tháo`,
  bad.duTi, ([p, detail]) => `${(p.code ?? '').padEnd(34)} ${detail}\n${' '.repeat(36)}${where(p)}`);

show('TI CHƯA KHAI TỶ SỐ — HSN gõ tay, không kiểm chứng được',
  bad.thieuTyso, ([p, n]) => `${(p.code ?? '').padEnd(34)} HSN khai ${p.hsn} · ${n} TI\n${' '.repeat(36)}${where(p)}`);

const total = bad.lechHsn.length + bad.lechTi.length + bad.duTi.length + bad.thieuTyso.length;
console.log(total ? `\n${total} điểm đo cần xem lại.` : '\nKhông có điểm đo nào lệch.');
