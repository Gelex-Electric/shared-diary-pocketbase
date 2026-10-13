/**
 * (chạy tay) Dọn các chỗ LỆCH giữa kho (`dm_device`) và lần lắp (`dm_asset`).
 * Phát hiện ở rà soát 13/10/2026 (logs/2026-10-13-chuyen-vat-tu-du-kien-giua-diem-do.md).
 *
 * Tự phát hiện theo luật, không hard-code danh sách:
 *   A. `hold_point` trỏ điểm đo mà thiết bị ĐÃ TREO ở đó   ⇒ bỏ giữ chỗ.
 *   B. `hold_point` trỏ điểm đo không còn dòng dự kiến     ⇒ trỏ về điểm đo đang
 *      có dòng dự kiến của nó (nếu đúng một), không thì bỏ giữ chỗ.
 *   C. TI/TU trong kho thiếu tỷ số mà MỌI lần lắp cùng một tỷ số ⇒ lấy tỷ số đó.
 *   D. `active` ≠ (chưa có ngày tháo)                       ⇒ sửa theo ngày tháo.
 *   E. ngày tháo < ngày treo                                ⇒ CHỈ BÁO (không đoán ngày).
 *
 * Mặc định DRY-RUN. `--commit` mới ghi. Ghi tuần tự, lỗi thì dừng và báo đã ghi tới đâu.
 *
 * Chạy (PC có proxy SSL — xem logs/2026-08-21-tao-nhanh-QLVH.md):
 *   NODE_EXTRA_CA_CERTS=<corp-ca.pem> PB_ADMIN_EMAIL=… PB_ADMIN_PASSWORD=… \
 *     node scripts/dm_fix_stock_consistency.mjs [--commit]
 */
import { pbLogin, allOf, PB_URL, ymd } from './lib/pb_meters.mjs';

const COMMIT = process.argv.includes('--commit');
const token = await pbLogin();
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(c => allOf(c, token)));

const code = (id) => points.find(p => p.id === id)?.code ?? `(điểm đo ${id})`;
const isLive = (a) => ymd(a.date_on) && !ymd(a.date_off);
const isPlan = (a) => !ymd(a.date_on) && !ymd(a.date_off);
const mineOf = (d) => assets.filter(a => a.device === d.id || (!a.device && a.serial.trim() === d.serial.trim()));

/** [collection, id, patch, mô tả] */
const plan = [];
const reportOnly = [];

for (const d of devices) {
  const mine = mineOf(d);
  // A + B
  if (d.hold_point) {
    const atHold = mine.filter(a => a.point === d.hold_point);
    if (!atHold.some(isPlan)) {
      const plans = mine.filter(isPlan);
      const to = plans.length === 1 ? plans[0].point : '';
      const why = atHold.some(isLive) ? 'đã treo ở chính điểm đo đó' : 'điểm đo đó không còn dòng dự kiến';
      plan.push(['dm_device', d.id, { hold_point: to },
        `${d.serial}: giữ chỗ ${code(d.hold_point)} (${why}) → ${to ? code(to) : 'bỏ giữ chỗ'}`]);
    }
  } else {
    const plans = mine.filter(isPlan);
    if (plans.length === 1) {
      plan.push(['dm_device', d.id, { hold_point: plans[0].point },
        `${d.serial}: dự kiến ở ${code(plans[0].point)} mà chưa giữ chỗ → giữ chỗ`]);
    }
  }
  // C
  if (['TI', 'TU'].includes(d.type) && !(d.ratio_primary > 0 && d.ratio_secondary > 0)) {
    const kinds = [...new Set(mine.filter(a => a.ratio_primary > 0 && a.ratio_secondary > 0)
      .map(a => `${a.ratio_primary}/${a.ratio_secondary}`))];
    if (kinds.length === 1) {
      const [p, s] = kinds[0].split('/').map(Number);
      plan.push(['dm_device', d.id, { ratio_primary: p, ratio_secondary: s },
        `${d.serial}: tỷ số kho trống → ${kinds[0]} (theo các lần lắp)`]);
    } else {
      reportOnly.push(`${d.serial}: ${d.type} trong kho thiếu tỷ số, các lần lắp ${kinds.length ? kinds.join(' ≠ ') : 'cũng trống'} — khai tay`);
    }
  }
}

for (const a of assets) {
  // D
  const want = !ymd(a.date_off);
  if (a.active !== want) {
    plan.push(['dm_asset', a.id, { active: want, status: want ? (ymd(a.date_on) ? 'dang_treo' : 'kho') : 'thao_go' },
      `${a.serial} @${code(a.point)}: active ${a.active} → ${want}`]);
  }
  // E
  if (ymd(a.date_on) && ymd(a.date_off) && ymd(a.date_off) < ymd(a.date_on)) {
    reportOnly.push(`${a.serial} @${code(a.point)}: ngày tháo ${ymd(a.date_off)} < ngày treo ${ymd(a.date_on)} — sửa tay ở form điểm đo`);
  }
}

console.log(`Đọc: ${devices.length} thiết bị · ${assets.length} lần lắp · ${points.length} điểm đo`);
console.log(`\n== Sẽ sửa (${plan.length}) — ${COMMIT ? 'GHI THẬT' : 'dry-run'}`);
for (const [, , , why] of plan) console.log(`  - ${why}`);
console.log(`\n== Chỉ báo, cần người quyết (${reportOnly.length})`);
for (const x of reportOnly) console.log(`  - ${x}`);
if (!COMMIT) { console.log('\nChạy lại với --commit để ghi.'); process.exit(0); }

let n = 0;
for (const [col, id, patch, why] of plan) {
  const r = await fetch(`${PB_URL}/api/collections/${col}/records/${id}`, {
    method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    console.error(`\nDỪNG sau ${n}/${plan.length}: ${why} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  n++;
  console.log(`  ✓ ${why}`);
}
console.log(`\nXong ${n}/${plan.length}. Chạy lại không --commit để kiểm tra còn sót.`);
