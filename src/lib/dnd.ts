/**
 * Quy tắc kéo thả + thực thi 4 thao tác (plan §6).
 *
 * Nguyên tắc: mọi lần thả đều phải qua hộp thoại xác nhận rồi mới ghi.
 * Hai thao tác treo/tháo sinh `vt_event` **append-only, không sửa/xoá được**,
 * nên kéo nhầm là để lại vết vĩnh viễn — vì thế `canDrop` phải chặn TRƯỚC
 * khi thả, không cho thả rồi mới báo lỗi.
 */
import { pb } from './pocketbase';
import {
  type CatalogData, type Asset, type Point, type Station,
  assetsAtPoint, isOverdue, ASSET_TYPE_LABEL,
} from './catalog';

export type DragKind = 'point' | 'asset';
export type DropKind = 'station' | 'point' | 'warehouse' | 'role-group';

export interface DragItem {
  kind: DragKind;
  id: string;
  /** Với asset: đang ở kho hay đang treo tại điểm đo nào. */
  fromPoint?: string;
}

export interface DropTarget {
  kind: DropKind;
  id: string;
  /** Với 'role-group': nhóm chính hay phụ. */
  role?: 'chinh' | 'phu';
}

export type DropAction =
  | 'move-point-to-station'
  | 'change-point-role'
  | 'hang-asset'      // kho → điểm đo
  | 'remove-asset';   // điểm đo → kho

export interface DropCheck {
  ok: boolean;
  /** Lý do KHÔNG thả được — hiện lên tooltip, không để người dùng đoán. */
  reason?: string;
  action?: DropAction;
}

/** Tài khoản khối kinh doanh (users.area rỗng) mới được ghi. */
export function canEdit(): boolean {
  const raw = pb.authStore.model?.area;
  return pb.authStore.isValid && (!raw || (typeof raw === 'string' && !raw.trim()));
}

/**
 * 7 quy tắc chặn của plan §6.2. Trả về lý do cụ thể thay vì chỉ true/false —
 * người dùng phải biết VÌ SAO không thả được.
 */
export function canDrop(item: DragItem, target: DropTarget, data: CatalogData): DropCheck {
  if (!canEdit()) return { ok: false, reason: 'Chỉ tài khoản khối kinh doanh mới được sửa danh mục' };

  /* ---- Kéo ĐIỂM ĐO ---- */
  if (item.kind === 'point') {
    const point = data.points.find(p => p.id === item.id);
    if (!point) return { ok: false, reason: 'Không tìm thấy điểm đo' };

    if (target.kind === 'station') {
      const st = data.stations.find(s => s.id === target.id);
      if (!st) return { ok: false, reason: 'Không tìm thấy trạm' };
      if (point.station === st.id) return { ok: false, reason: 'Điểm đo đã thuộc trạm này' };
      // Quy tắc 7: chỉ trong cùng KCN
      if (point.zone && st.zone && point.zone !== st.zone) {
        const zp = data.zones.find(z => z.id === point.zone)?.code ?? '?';
        const zs = data.zones.find(z => z.id === st.zone)?.code ?? '?';
        return { ok: false, reason: `Khác khu vực: điểm đo thuộc ${zp}, trạm thuộc ${zs}` };
      }
      return { ok: true, action: 'move-point-to-station' };
    }

    if (target.kind === 'role-group') {
      if (point.role === target.role) return { ok: false, reason: 'Điểm đo đã ở nhóm này' };
      return { ok: true, action: 'change-point-role' };
    }
    return { ok: false, reason: 'Chỉ thả điểm đo vào trạm hoặc nhóm chính/phụ' };
  }

  /* ---- Kéo VẬT TƯ ---- */
  const asset = data.assets.find(a => a.id === item.id);
  if (!asset) return { ok: false, reason: 'Không tìm thấy vật tư' };

  if (target.kind === 'warehouse') {
    if (!item.fromPoint) return { ok: false, reason: 'Vật tư này không đang treo ở điểm đo nào' };
    return { ok: true, action: 'remove-asset' };
  }

  if (target.kind === 'point') {
    const point = data.points.find(p => p.id === target.id);
    if (!point) return { ok: false, reason: 'Không tìm thấy điểm đo' };

    // Quy tắc 2: chỉ vật tư trong kho mới treo được
    if (asset.current_status !== 'kho' && asset.current_status !== 'dat') {
      return { ok: false, reason: `Vật tư đang ở trạng thái "${asset.current_status}", chỉ vật tư trong kho mới treo được` };
    }
    // Quy tắc 3: quá hạn kiểm định
    if (isOverdue(asset)) {
      return { ok: false, reason: `Quá hạn kiểm định (${asset.next_calibration?.slice(0, 10)}) — phải kiểm định trước khi treo` };
    }
    // Quy tắc 6: điểm đo đã tháo / dự kiến bỏ
    if (point.point_status === 'dismounted') {
      return { ok: false, reason: 'Điểm đo đã tháo, không nhận vật tư mới' };
    }

    const at = assetsAtPoint(data, point.id);
    // Quy tắc 4: mỗi điểm đo chỉ 1 công tơ
    if (asset.type === 'CONGTO' && at.some(x => x.asset?.type === 'CONGTO')) {
      const cur = at.find(x => x.asset?.type === 'CONGTO')!.asset!;
      return { ok: false, reason: `Điểm đo đã có công tơ ${cur.serial} — phải tháo trước khi treo cái khác` };
    }
    // Quy tắc 5: các TI cùng điểm đo phải cùng tỷ số
    if (asset.type === 'TI') {
      const otherTi = at.filter(x => x.asset?.type === 'TI').map(x => x.asset!);
      const diff = otherTi.find(t => (t.ratio ?? 0) !== (asset.ratio ?? 0));
      if (diff) {
        return { ok: false, reason: `TI tại điểm đo này có tỷ số ${diff.ratio}, không khớp tỷ số ${asset.ratio} của TI đang kéo` };
      }
    }
    return { ok: true, action: 'hang-asset' };
  }

  return { ok: false, reason: 'Chỉ thả vật tư vào điểm đo hoặc kho' };
}

/** Mô tả thao tác bằng tiếng Việt để hiện trong hộp thoại xác nhận. */
export function describeDrop(
  action: DropAction, item: DragItem, target: DropTarget, data: CatalogData,
): { title: string; detail: string; needsDate: boolean; irreversible: boolean } {
  const point = data.points.find(p => p.id === (item.kind === 'point' ? item.id : target.id));
  const asset = item.kind === 'asset' ? data.assets.find(a => a.id === item.id) : undefined;

  switch (action) {
    case 'move-point-to-station': {
      const st = data.stations.find(s => s.id === target.id) as Station;
      return {
        title: 'Gắn điểm đo vào trạm',
        detail: `Điểm đo ${point?.line_id} — ${point?.line_name || '—'}  →  trạm ${st?.code}`,
        needsDate: false, irreversible: false,
      };
    }
    case 'change-point-role':
      return {
        title: 'Đổi vai trò điểm đo',
        detail: `Điểm đo ${point?.line_id} → ${target.role === 'chinh' ? 'ĐIỂM ĐO CHÍNH' : 'ĐIỂM ĐO PHỤ'}`
          + (target.role === 'chinh'
            ? '\nĐiểm đo chính được tính vào tổn thất máy biến áp.'
            : '\nĐiểm đo phụ KHÔNG được tính vào tổn thất máy biến áp.'),
        needsDate: false, irreversible: false,
      };
    case 'hang-asset':
      return {
        title: 'Treo vật tư lên điểm đo',
        detail: `${ASSET_TYPE_LABEL[asset?.type ?? ''] ?? ''} ${asset?.serial}  →  điểm đo ${point?.line_id} — ${point?.line_name || '—'}`,
        needsDate: true, irreversible: true,
      };
    case 'remove-asset': {
      const wh = data.warehouses.find(w => w.id === target.id);
      return {
        title: 'Tháo vật tư về kho',
        detail: `${ASSET_TYPE_LABEL[asset?.type ?? ''] ?? ''} ${asset?.serial}  →  ${wh?.name || 'kho'}`,
        needsDate: true, irreversible: true,
      };
    }
  }
}

export interface DropPayload {
  date: string;        // ngày hiệu lực (YYYY-MM-DD)
  documentNo?: string;
  note?: string;
}

/**
 * Thực thi thao tác. Với treo/tháo: **ghi `vt_event` TRƯỚC**, cập nhật
 * `vt_asset.current_*` SAU — nếu bước sau lỗi thì sổ cái vẫn đúng và
 * `rebuild_current.py` dựng lại được (plan §1.3).
 */
export async function applyDrop(
  action: DropAction, item: DragItem, target: DropTarget,
  data: CatalogData, payload: DropPayload,
): Promise<void> {
  const userId = pb.authStore.model?.id;

  if (action === 'move-point-to-station') {
    await pb.collection('dm_point').update(item.id, { station: target.id });
    return;
  }

  if (action === 'change-point-role') {
    await pb.collection('dm_point').update(item.id, { role: target.role });
    return;
  }

  const asset = data.assets.find(a => a.id === item.id) as Asset;

  if (action === 'hang-asset') {
    const point = data.points.find(p => p.id === target.id) as Point;
    await pb.collection('vt_event').create({
      asset: asset.id, serial: asset.serial, event: 'treo',
      from_warehouse: asset.current_warehouse || '',
      to_point: point.id, at: payload.date, by: userId,
      document_no: payload.documentNo || '', note: payload.note || '',
    });
    await pb.collection('vt_install').create({
      asset: asset.id, serial: asset.serial, type: asset.type,
      point: point.id, from_date: payload.date, is_current: true,
      note: payload.note || '',
    });
    await pb.collection('vt_asset').update(asset.id, {
      current_status: 'dang_treo', current_point: point.id, current_warehouse: '',
    });
    return;
  }

  // remove-asset
  const open = data.installs.find(i => i.asset === asset.id && i.is_current);
  await pb.collection('vt_event').create({
    asset: asset.id, serial: asset.serial, event: 'thao',
    from_point: item.fromPoint || '', to_warehouse: target.id,
    at: payload.date, by: userId,
    document_no: payload.documentNo || '', note: payload.note || '',
  });
  if (open) {
    await pb.collection('vt_install').update(open.id, {
      to_date: payload.date, is_current: false,
    });
  }
  await pb.collection('vt_asset').update(asset.id, {
    current_status: 'kho', current_warehouse: target.id, current_point: '',
  });
}
