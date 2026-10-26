/**
 * (chạy tay, một lần) Gán hình dạng TRÒN cho mọi TI trong kho (`dm_device`) đang
 * để trống `shape` — user chốt 26/10/2026: TI mặc định là tròn, vuông chỉ là
 * trường hợp đặc biệt (Nhóm Vật Tư sửa tay từng cái vuông ở Kho vật tư).
 *
 * Chỉ đụng `dm_device.shape` của loại TI đang trống; TI đã khai tròn/vuông giữ
 * nguyên, loại khác không đụng.
 *
 * Mặc định DRY-RUN. `--commit` mới ghi. Ghi tuần tự, lỗi thì dừng và báo đã ghi tới đâu.
 *   railway run -- node scripts/dm_backfill_ti_shape.mjs [--commit]
 * PC có proxy SSL: thêm `NODE_EXTRA_CA_CERTS=%TEMP%\corp-ca.pem` (lệnh PATCH dùng `fetch`).
 */
import { pbLogin, allOf, PB_URL, ymd } from './lib/pb_meters.mjs';

const COMMIT = process.argv.includes('--commit');
const token = await pbLogin();
const devices = await allOf('dm_device', token);

const tis = devices.filter(d => d.type === 'TI');
const blank = tis.filter(d => !d.shape);
const byShape = s => tis.filter(d => d.shape === s).length;

console.log(`\nPB: ${PB_URL}`);
console.log(`TI: ${tis.length} · tròn ${byShape('tron')} · vuông ${byShape('vuong')} · trống ${blank.length}`
  + ` (trong đó đã thanh lý ${blank.filter(d => ymd(d.liquidated_at)).length})`);
console.log(`SẼ GÁN "tron" cho ${blank.length} TI đang trống hình dạng.`);

if (!COMMIT) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --commit để ghi thật.');
  process.exit(0);
}
let n = 0;
for (const d of blank) {
  const r = await fetch(`${PB_URL}/api/collections/dm_device/records/${d.id}`, {
    method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ shape: 'tron' }),
  });
  if (!r.ok) {
    console.error(`\nDỪNG sau ${n}/${blank.length}: ${d.serial} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  n++;
}
console.log(`\nXong ${n}/${blank.length}. Chạy lại không --commit để kiểm tra (trống phải còn 0).`);
