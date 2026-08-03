/**
 * Quy tắc + thực thi việc GẮN KẾT danh mục (trang Sắp xếp điểm đo).
 *
 * Thay cho lib/dnd.ts: user chốt 03/08 bỏ kéo thả, dùng tích chọn nhiều dòng
 * + thanh thao tác — 28 điểm đo chưa gắn trạm và ~600 TI/TU thì kéo từng món
 * là không khả thi.
 *
 * Mọi hàm kiểm tra trả về LÝ DO cụ thể, không phải true/false, để nút bị vô
 * hiệu luôn nói được vì sao.
 */
import { pb } from './pocketbase';
import { type CatalogData, type Asset, type Point, assetsAtPoint, isOverdue } from './catalog';

export interface Check { ok: boolean; reason?: string }

/** Tài khoản khối kinh doanh (users.area rỗng) mới được ghi. */
export function canEdit(): boolean {
  const raw = pb.authStore.model?.area;
  return pb.authStore.isValid && (!raw || (typeof raw === 'string' && !raw.trim()));
}

/* ---------------- Kiểm tra ---------------- */

export function checkAssignStation(point: Point, stationId: string, d: CatalogData): Check {
  const st = d.stations.find(s => s.id === stationId);
  if (!st) return { ok: false, reason: 'Không tìm thấy trạm' };
  if (point.station === stationId) return { ok: false, reason: 'Đã thuộc trạm này' };
  if (point.zone && st.zone && point.zone !== st.zone) {
    const zp = d.zones.find(z => z.id === point.zone)?.code ?? '?';
    const zs = d.zones.find(z => z.id === st.zone)?.code ?? '?';
    return { ok: false, reason: `Khác khu vực: điểm đo ${zp}, trạm ${zs}` };
  }
  return { ok: true };
}

export function checkChangeRole(point: Point, role: 'chinh' | 'phu'): Check {
  if (point.role === role) return { ok: false, reason: 'Đã ở vai trò này' };
  return { ok: true };
}

/**
 * Treo vật tư lên điểm đo. `alsoHanging` = các vật tư khác trong cùng lô đang
 * treo lên chính điểm đo này — cần để bắt ca "chọn 2 công tơ cùng lúc".
 */
export function checkHang(
  asset: Asset, point: Point, d: CatalogData, alsoHanging: Asset[] = [],
): Check {
  if (asset.current_status !== 'kho' && asset.current_status !== 'dat') {
    return { ok: false, reason: `Đang ở trạng thái "${asset.current_status}", chỉ vật tư trong kho mới treo được` };
  }
  if (isOverdue(asset)) {
    return { ok: false, reason: `Quá hạn kiểm định ${asset.next_calibration?.slice(0, 10)}` };
  }
  if (point.point_status === 'dismounted') {
    return { ok: false, reason: 'Điểm đo đã tháo, không nhận vật tư' };
  }

  const at = assetsAtPoint(d, point.id);
  if (asset.type === 'CONGTO') {
    const cur = at.find(x => x.asset?.type === 'CONGTO')?.asset;
    if (cur) return { ok: false, reason: `Điểm đo đã có công tơ ${cur.serial}` };
    const dup = alsoHanging.find(a => a.id !== asset.id && a.type === 'CONGTO');
    if (dup) return { ok: false, reason: `Chọn cùng lúc 2 công tơ (${dup.serial}) — mỗi điểm đo chỉ 1` };
  }
  if (asset.type === 'TI') {
    const others = [...at.filter(x => x.asset?.type === 'TI').map(x => x.asset!),
                    ...alsoHanging.filter(a => a.id !== asset.id && a.type === 'TI')];
    const diff = others.find(t => (t.ratio ?? 0) !== (asset.ratio ?? 0));
    if (diff) return { ok: false, reason: `TI khác tỷ số: ${diff.serial} có ${diff.ratio}, cái này ${asset.ratio}` };
  }
  return { ok: true };
}

export function checkRemove(asset: Asset): Check {
  if (asset.current_status !== 'dang_treo') {
    return { ok: false, reason: 'Vật tư không đang treo ở điểm đo nào' };
  }
  return { ok: true };
}

/* ---------------- Thực thi ---------------- */

export interface EventPayload { date: string; documentNo?: string; note?: string }

export async function assignStation(pointIds: string[], stationId: string) {
  for (const id of pointIds) await pb.collection('dm_point').update(id, { station: stationId });
}

export async function changeRole(pointIds: string[], role: 'chinh' | 'phu') {
  for (const id of pointIds) await pb.collection('dm_point').update(id, { role });
}

/**
 * Treo: ghi `vt_event` TRƯỚC, cập nhật `vt_asset.current_*` SAU — nếu bước sau
 * lỗi thì sổ cái vẫn đúng và dựng lại được (plan §1.3).
 */
export async function hangAssets(assets: Asset[], point: Point, p: EventPayload) {
  const by = pb.authStore.model?.id;
  for (const a of assets) {
    await pb.collection('vt_event').create({
      asset: a.id, serial: a.serial, event: 'treo',
      from_warehouse: a.current_warehouse || '', to_point: point.id,
      at: p.date, by, document_no: p.documentNo || '', note: p.note || '',
    });
    await pb.collection('vt_install').create({
      asset: a.id, serial: a.serial, type: a.type, point: point.id,
      from_date: p.date, is_current: true, note: p.note || '',
    });
    await pb.collection('vt_asset').update(a.id, {
      current_status: 'dang_treo', current_point: point.id, current_warehouse: '',
    });
  }
}

export async function removeAssets(
  assets: Asset[], warehouseId: string, d: CatalogData, p: EventPayload,
) {
  const by = pb.authStore.model?.id;
  for (const a of assets) {
    const open = d.installs.find(i => i.asset === a.id && i.is_current);
    await pb.collection('vt_event').create({
      asset: a.id, serial: a.serial, event: 'thao',
      from_point: a.current_point || '', to_warehouse: warehouseId,
      at: p.date, by, document_no: p.documentNo || '', note: p.note || '',
    });
    if (open) {
      await pb.collection('vt_install').update(open.id, { to_date: p.date, is_current: false });
    }
    await pb.collection('vt_asset').update(a.id, {
      current_status: 'kho', current_warehouse: warehouseId, current_point: '',
    });
  }
}

/** Kho của một KCN — mỗi KCN đúng 1 kho (user chốt 03/08). */
export function warehouseOfZone(d: CatalogData, zoneId: string) {
  return d.warehouses.find(w => w.zone === zoneId);
}
