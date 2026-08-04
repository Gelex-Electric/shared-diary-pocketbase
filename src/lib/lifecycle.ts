/**
 * Vòng đời vật tư (task 7): gửi kiểm định → nhận kết quả → điều chuyển →
 * thanh lý, và đọc sổ cái của một vật tư.
 *
 * Nguyên tắc bất di bất dịch (plan §1.3):
 *   ghi `vt_event` TRƯỚC, cập nhật `vt_asset.current_*` SAU.
 * Nếu bước sau lỗi thì sổ cái vẫn đúng và dựng lại được; ngược lại thì mất dấu.
 */
import { pb } from './pocketbase';
import { type Asset, type CatalogData, calibrationSpan } from './catalog';

export type EventType =
  | 'nhap_kho' | 'dieu_chuyen' | 'treo' | 'thao'
  | 'gui_kiem_dinh' | 'ket_qua_kiem_dinh' | 'thanh_ly';

export interface LedgerEvent {
  id: string;
  asset: string;
  serial: string;
  event: EventType;
  from_warehouse: string;
  to_warehouse: string;
  from_point: string;
  to_point: string;
  at: string;
  by: string;
  document_no: string;
  result: 'dat' | 'khong_dat' | '';
  note: string;
  created: string;
}

export const EVENT_LABEL: Record<string, string> = {
  nhap_kho: 'Nhập kho',
  dieu_chuyen: 'Điều chuyển kho',
  treo: 'Treo lên điểm đo',
  thao: 'Tháo về kho',
  gui_kiem_dinh: 'Gửi đi kiểm định',
  ket_qua_kiem_dinh: 'Nhận kết quả kiểm định',
  thanh_ly: 'Thanh lý',
};

/** Sổ cái của một vật tư, mới nhất trước. */
export async function fetchLedger(assetId: string): Promise<LedgerEvent[]> {
  return pb.collection('vt_event').getFullList<LedgerEvent>({
    filter: `asset="${assetId}"`,
    sort: '-at,-created',
  });
}

export type ActionId = 'dieu_chuyen' | 'gui_kiem_dinh' | 'ket_qua_dat' | 'ket_qua_khong_dat' | 'thanh_ly';

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Cần chọn kho đích (điều chuyển, nhận kết quả đạt). */
  needsWarehouse?: boolean;
  danger?: boolean;
}

/**
 * Thao tác hợp lệ theo trạng thái hiện tại.
 *
 * Cố tình KHÔNG cho "treo/tháo" ở đây — hai việc đó gắn với điểm đo nên nằm
 * ở trang Sắp xếp, tránh hai chỗ cùng làm một việc theo hai cách khác nhau.
 */
export function actionsFor(a: Asset): ActionDef[] {
  switch (a.current_status) {
    case 'kho':
    case 'dat':
      return [
        { id: 'dieu_chuyen', label: 'Điều chuyển kho', needsWarehouse: true },
        { id: 'gui_kiem_dinh', label: 'Gửi đi kiểm định' },
        { id: 'thanh_ly', label: 'Thanh lý', danger: true },
      ];
    case 'cho_kiem_dinh':
      return [
        { id: 'gui_kiem_dinh', label: 'Gửi đi kiểm định' },
        { id: 'thanh_ly', label: 'Thanh lý', danger: true },
      ];
    case 'dang_kiem_dinh':
      return [
        { id: 'ket_qua_dat', label: 'Kết quả: ĐẠT', needsWarehouse: true },
        { id: 'ket_qua_khong_dat', label: 'Kết quả: KHÔNG ĐẠT', danger: true },
      ];
    case 'khong_dat':
      return [{ id: 'thanh_ly', label: 'Thanh lý', danger: true }];
    case 'dang_treo':
      return [];   // phải tháo ở trang Sắp xếp trước
    case 'thanh_ly':
      return [];
    default:
      return [{ id: 'thanh_ly', label: 'Thanh lý', danger: true }];
  }
}

/** Vì sao không còn thao tác nào — nói rõ thay vì để bảng trống khó hiểu. */
export function noActionReason(a: Asset): string {
  if (a.current_status === 'dang_treo') {
    return 'Vật tư đang treo trên điểm đo. Tháo về kho ở trang "Sắp xếp điểm đo" trước.';
  }
  if (a.current_status === 'thanh_ly') return 'Vật tư đã thanh lý — kết thúc vòng đời.';
  return '';
}

export interface LifecyclePayload {
  date: string;
  documentNo?: string;
  note?: string;
  warehouseId?: string;
}

/**
 * Thực thi một thao tác vòng đời.
 * Trả về mô tả ngắn để hiện trong thông báo.
 */
export async function applyLifecycle(
  action: ActionId, asset: Asset, d: CatalogData, p: LifecyclePayload,
): Promise<string> {
  const by = pb.authStore.model?.id;
  const base = {
    asset: asset.id, serial: asset.serial, at: p.date, by,
    document_no: p.documentNo || '', note: p.note || '',
  };

  switch (action) {
    case 'dieu_chuyen': {
      if (!p.warehouseId) throw new Error('Chưa chọn kho đích');
      if (p.warehouseId === asset.current_warehouse) throw new Error('Kho đích trùng kho hiện tại');
      await pb.collection('vt_event').create({
        ...base, event: 'dieu_chuyen',
        from_warehouse: asset.current_warehouse || '', to_warehouse: p.warehouseId,
      });
      await pb.collection('vt_asset').update(asset.id, {
        current_warehouse: p.warehouseId, current_status: 'kho',
      });
      return `Đã chuyển sang ${d.warehouses.find(w => w.id === p.warehouseId)?.name ?? 'kho mới'}`;
    }

    case 'gui_kiem_dinh': {
      await pb.collection('vt_event').create({
        ...base, event: 'gui_kiem_dinh',
        from_warehouse: asset.current_warehouse || '',
        to_label: p.note || 'Đơn vị kiểm định',
      });
      // Rời kho: cả kho lẫn điểm đo đều rỗng (plan §1.3)
      await pb.collection('vt_asset').update(asset.id, {
        current_status: 'dang_kiem_dinh', current_warehouse: '', current_point: '',
      });
      return 'Đã ghi nhận gửi đi kiểm định';
    }

    case 'ket_qua_dat': {
      if (!p.warehouseId) throw new Error('Chưa chọn kho nhận về');
      await pb.collection('vt_event').create({
        ...base, event: 'ket_qua_kiem_dinh', result: 'dat', to_warehouse: p.warehouseId,
      });
      // Hạn kiểm định mới tính TỪ NGÀY KIỂM ĐỊNH, không tính lại từ năm SX
      const span = calibrationSpan(asset.type);
      const patch: Record<string, unknown> = {
        current_status: 'kho', current_warehouse: p.warehouseId, current_point: '',
        calibration_date: p.date,
      };
      if (span) {
        const nx = new Date(p.date);
        nx.setFullYear(nx.getFullYear() + span);
        patch.next_calibration = nx.toISOString().slice(0, 10);
      }
      await pb.collection('vt_asset').update(asset.id, patch);
      return span
        ? `Đạt — hạn kiểm định mới ${String(patch.next_calibration)}`
        : 'Đạt — loại này không có hạn kiểm định';
    }

    case 'ket_qua_khong_dat': {
      await pb.collection('vt_event').create({
        ...base, event: 'ket_qua_kiem_dinh', result: 'khong_dat',
      });
      await pb.collection('vt_asset').update(asset.id, {
        current_status: 'khong_dat', calibration_date: p.date,
      });
      return 'Không đạt — vật tư chờ thanh lý, không treo lên điểm đo được';
    }

    case 'thanh_ly': {
      await pb.collection('vt_event').create({ ...base, event: 'thanh_ly' });
      await pb.collection('vt_asset').update(asset.id, {
        current_status: 'thanh_ly', current_warehouse: '', current_point: '',
      });
      return 'Đã thanh lý';
    }
  }
}
