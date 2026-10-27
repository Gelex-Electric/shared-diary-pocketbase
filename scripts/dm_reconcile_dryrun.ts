/**
 * (chạy tay, CHỈ ĐỌC) Chạy thử đối chiếu nhu cầu ↔ treo thực tế (`reconcile`,
 * điểm đo hai phần 27/10/2026) trên dữ liệu PB thật — KHÔNG ghi gì.
 * In: điểm đo nào sẽ bị trả kho dòng nhu cầu nào, điểm đo nào cần treo bổ sung,
 * và đếm trạng thái quy trình.
 *
 *   railway run -- npx tsx scripts/dm_reconcile_dryrun.ts
 */
import { pbLogin, allOf } from './lib/pb_meters.mjs';
import { pointSupply, reconcile, SUPPLY_STATE_LABEL, type SupplyState } from '../src/lib/dm/supply';
import { ASSET_LABEL, type Asset, type Device, type Point, type Purchase, type PurchaseLine } from '../src/lib/dm/types';

const token = await pbLogin();
const [devices, assets, points, purchases, purchaseLines] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point', 'dm_purchase', 'dm_purchase_line'].map(c => allOf(c, token))) as
  [Device[], Asset[], Point[], Purchase[], PurchaseLine[]];
const ctx = { assets, devices, purchases, purchaseLines };

const count: Partial<Record<SupplyState, number>> = {};
let release = 0, short = 0;
for (const p of points) {
  const st = pointSupply(p, ctx).state;
  count[st] = (count[st] ?? 0) + 1;
  const rc = reconcile(p, assets, devices);
  if (rc.release.length) {
    release += rc.release.length;
    console.log(`TRẢ KHO  ${p.code}: ${rc.release.map(a => `${a.serial} (${ASSET_LABEL[a.type]})`).join(', ')}`);
  }
  if (rc.shortages.length && rc.shortages.some(l => l.have.some(a => (a.date_on ?? '').slice(0, 10)))) {
    short++;
    console.log(`BỔ SUNG  ${p.code}: ${rc.shortages.map(l => `${l.missing} × ${ASSET_LABEL[l.line.type]}`).join(', ')}`);
  }
  if (rc.extraHung.length && (p.need ?? []).length) {
    console.log(`NGOÀI NC ${p.code}: ${rc.extraHung.map(a => a.serial).join(', ')}`);
  }
}
console.log(`\nĐiểm đo ${points.length}: ` + Object.entries(count).map(([k, n]) => `${SUPPLY_STATE_LABEL[k as SupplyState]} ${n}`).join(' · '));
console.log(`Sẽ trả kho ${release} dòng nhu cầu · ${short} điểm đo đã treo cần treo bổ sung. (CHỈ ĐỌC — chưa ghi gì)`);
