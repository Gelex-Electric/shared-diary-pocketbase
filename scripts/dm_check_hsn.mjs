#!/usr/bin/env node
/**
 * Soát HSN của điểm đo so với TỶ SỐ TI/TU đang treo tại chính điểm đo đó.
 *
 * Nguyên tắc (user nêu 22/09/2026): **HSN thuộc về ĐIỂM ĐO**, suy từ bộ TI treo
 * ở đó — một điểm đo có đúng MỘT HSN, không bao giờ hai. Công tơ treo lên điểm
 * đo chỉ trả dữ liệu THÔ; nhân HSN của điểm đo mới ra số liệu thật. Hệ quả:
 * `METER_NAME` bên HES chỉ là bản khai của HES, KHÔNG phải nguồn chân lý.
 *
 *   HSN = (TI sơ cấp / TI thứ cấp) × (TU sơ cấp / TU thứ cấp)
 *
 * BA TRẠNG THÁI VẬT TƯ — phân biệt sai là ra báo động giả (tôi đã dính 22/09):
 *   · đang treo : CÓ ngày treo, chưa có ngày tháo  → quyết định HSN
 *   · đã tháo   : có ngày treo VÀ ngày tháo        → giữ HSN lịch sử
 *   · dự kiến   : CHƯA có ngày treo                → mua sẵn, KHÔNG tính vào HSN
 * Vị từ này phải khớp `isHung` trong `src/components/dm/CatalogEntry.tsx`.
 *
 * CHỈ ĐỌC PocketBase. Không ghi gì.
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

const hung = (a) => !!ymd(a.date_on) && !ymd(a.date_off);
const duKien = (a) => !ymd(a.date_on);
const ratioOf = (a) => {
  const p = a.ratio_primary;
  const s = a.ratio_secondary;
  if (p == null || s == null || !Number.isFinite(p) || !Number.isFinite(s) || s === 0) return null;
  return p / s;
};
const uniqRatios = (rows) => [...new Set(rows.map(ratioOf).filter(r => r != null))];
const where = (p) => {
  const st = stById.get(p.station);
  const c = p.customer ? cById.get(p.customer) : undefined;
  return `${st?.code ?? '?'}${c?.short_name ? ` · ${c.short_name}` : ''}`;
};

const bad = { lechHsn: [], lechTi: [], duTi: [], thieuTyso: [] };
/** Không phải lỗi — là việc SẮP tới: TI mua sẵn có tỷ số khác bộ đang treo. */
const sapDoiHsn = [];
let ok = 0;
let boQua = 0;

for (const p of points) {
  /* Điểm đo đã tháo gỡ thì HSN không còn dùng cho gì. */
  if (p.status === 'thao_go') { boQua++; continue; }

  const at = assets.filter(a => a.point === p.id);
  const tiAll = at.filter(a => a.type === 'TI');
  const tiHung = tiAll.filter(hung);
  const tuHung = at.filter(a => a.type === 'TU' && hung(a));

  /*
    Bộ TI mua sẵn có tỷ số KHÁC bộ đang chạy: hôm lắp là hôm HSN đổi. Mà một
    điểm đo chỉ được có một HSN ⇒ phải ĐÓNG điểm đo cũ (ngày tháo + `thao_go`)
    và MỞ điểm mới, chứ không sửa HSN tại chỗ — sửa tại chỗ thì toàn bộ sản
    lượng lịch sử bị tính lại theo hệ số mới và sai hết.
  */
  const rDuKien = uniqRatios(tiAll.filter(duKien));
  const rHung = uniqRatios(tiHung);
  const themRatio = rDuKien.filter(r => !rHung.includes(r));
  if (rHung.length === 1 && themRatio.length) {
    sapDoiHsn.push([p, `đang treo ${rHung[0]} · dự kiến ${themRatio.join(', ')}`]);
  }

  /* Đấu trực tiếp: công tơ đo thẳng, HSN phải bằng 1. Xét CẢ TI đã tháo —
     tháo TI ra không biến điểm đo gián tiếp thành đo thẳng. */
  if (!tiAll.length) {
    if (p.hsn != null && p.hsn !== 1) {
      bad.lechHsn.push([p, `không khai TI nào nên HSN phải = 1, đang khai ${p.hsn}`]);
    } else ok++;
    continue;
  }

  /* Chưa treo TI nào (điểm đo còn dự kiến) thì chưa có gì để đối chiếu. */
  if (!tiHung.length) { boQua++; continue; }

  if (tiHung.length > TI_PER_POINT) {
    const byRatio = new Map();
    for (const t of tiHung) {
      const k = ratioOf(t) == null ? '(chưa khai tỷ số)' : String(ratioOf(t));
      byRatio.set(k, (byRatio.get(k) ?? 0) + 1);
    }
    bad.duTi.push([p, [...byRatio].map(([r, n]) => `${n}×${r}`).join(', ')]);
  }

  if (!rHung.length) { bad.thieuTyso.push([p, tiHung.length]); continue; }
  if (rHung.length > 1) { bad.lechTi.push([p, `TI đang treo lệch tỷ số: ${rHung.join(', ')}`]); continue; }

  const rTu = uniqRatios(tuHung);
  if (rTu.length > 1) { bad.lechTi.push([p, `TU đang treo lệch tỷ số: ${rTu.join(', ')}`]); continue; }

  const derived = Math.round(rHung[0] * (rTu.length ? rTu[0] : 1) * 1e6) / 1e6;
  if (p.hsn == null) { bad.thieuTyso.push([p, tiHung.length]); continue; }
  if (Math.abs(p.hsn - derived) > 1e-6) {
    bad.lechHsn.push([p, `khai ${p.hsn} nhưng TI đang treo suy ra ${derived}`
      + (rTu.length ? ` (TI ${rHung[0]} × TU ${rTu[0]})` : '')]);
  } else ok++;
}

const show = (title, rows, fmt) => {
  if (!rows.length) return;
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) console.log('  ' + fmt(r));
};
const line = ([p, why]) => `${(p.code ?? '').padEnd(34)} ${why}\n${' '.repeat(36)}${where(p)}`;

console.log(`Điểm đo khớp TI↔HSN : ${ok}`);
console.log(`Không xét (đã tháo gỡ / chưa treo TI nào): ${boQua}`);

show('HSN KHAI KHÁC HSN SUY TỪ TI ĐANG TREO — sản lượng sai theo tỷ lệ', bad.lechHsn, line);
show('CÁC TI ĐANG TREO LỆCH TỶ SỐ NHAU — không biết tin cái nào', bad.lechTi, line);
show(`NHIỀU HƠN ${TI_PER_POINT} TI CÙNG ĐANG TREO — bộ cũ chưa khai ngày tháo`, bad.duTi, line);
show('TI ĐANG TREO CHƯA KHAI TỶ SỐ — HSN gõ tay, không kiểm chứng được',
  bad.thieuTyso, ([p, n]) => line([p, `HSN khai ${p.hsn} · ${n} TI đang treo`]));

show('SẮP ĐỔI HSN — có TI dự kiến khác tỷ số bộ đang treo (KHÔNG phải lỗi)',
  sapDoiHsn, line);
if (sapDoiHsn.length) {
  console.log('\n  Ngày lắp bộ mới: ĐÓNG điểm đo cũ (ngày tháo + trạng thái "tháo gỡ")');
  console.log('  rồi MỞ điểm đo mới. Không sửa HSN tại chỗ — sửa tại chỗ là tính lại');
  console.log('  sai toàn bộ sản lượng lịch sử của điểm đo.');
}

const total = bad.lechHsn.length + bad.lechTi.length + bad.duTi.length + bad.thieuTyso.length;
console.log(total ? `\n${total} điểm đo cần xem lại.` : '\nKhông có điểm đo nào lệch.');
