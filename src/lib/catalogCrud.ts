/**
 * Thêm / sửa / xóa danh mục (trang Quản lý danh mục).
 *
 * Nguyên tắc XÓA (user chốt 03/08):
 *  - Còn thứ khác tham chiếu tới ⇒ CHẶN, bắt gỡ phụ thuộc trước.
 *    PocketBase không cascade: xóa trạm sẽ để lại điểm đo trỏ vào id không
 *    tồn tại, hỏng âm thầm chứ không báo lỗi.
 *  - Vật tư đã có lịch sử trong sổ cái ⇒ KHÔNG xóa, chỉ THANH LÝ.
 *    `vt_event` append-only; xóa vật tư sẽ làm sổ cái trỏ vào hư không.
 */
import { pb } from './pocketbase';
export { parseRatioText, ratioText } from './ratio';
import { type CatalogData, ASSET_TYPES, ASSET_TYPE_LABEL, hasRatio } from './catalog';

export type EntityKind = 'zone' | 'station' | 'point' | 'asset' | 'warehouse';

export const COLLECTION: Record<EntityKind, string> = {
  zone: 'dm_zone', station: 'dm_station', point: 'dm_point',
  asset: 'vt_asset', warehouse: 'vt_warehouse',
};

export const ENTITY_LABEL: Record<EntityKind, string> = {
  zone: 'Khu công nghiệp', station: 'Trạm', point: 'Điểm đo',
  asset: 'Vật tư', warehouse: 'Kho',
};

/**
 * Lý do KHÔNG xóa được. Rỗng = xóa được.
 * Trả về danh sách chứ không phải boolean để nói rõ vướng cái gì, bao nhiêu.
 */
export function deleteBlockers(kind: EntityKind, id: string, d: CatalogData): string[] {
  const out: string[] = [];

  if (kind === 'zone') {
    const st = d.stations.filter(x => x.zone === id).length;
    const pt = d.points.filter(x => x.zone === id).length;
    const cs = d.customers.filter(x => x.zone === id).length;
    const wh = d.warehouses.filter(x => x.zone === id).length;
    if (st) out.push(`còn ${st} trạm`);
    if (pt) out.push(`còn ${pt} điểm đo`);
    if (cs) out.push(`còn ${cs} khách hàng`);
    if (wh) out.push(`còn ${wh} kho`);
  }

  if (kind === 'station') {
    const pt = d.points.filter(x => x.station === id).length;
    if (pt) out.push(`còn ${pt} điểm đo`);
  }

  if (kind === 'point') {
    const inst = d.installs.filter(x => x.point === id && x.is_current).length;
    const hist = d.installs.filter(x => x.point === id && !x.is_current).length;
    const per = d.periods.filter(x => x.point === id).length;
    if (inst) out.push(`còn ${inst} vật tư đang treo`);
    if (hist) out.push(`có ${hist} lịch sử lắp đặt`);
    if (per) out.push(`có ${per} kỳ khách hàng`);
  }

  if (kind === 'asset') {
    const inst = d.installs.filter(x => x.asset === id).length;
    if (inst) out.push(`có ${inst} lịch sử lắp đặt`);
    // Sổ cái không nạp sẵn (có thể rất nhiều dòng) ⇒ kiểm tra ở tầng gọi
  }

  if (kind === 'warehouse') {
    const n = d.assets.filter(x => x.current_warehouse === id).length;
    if (n) out.push(`còn ${n} vật tư trong kho`);
  }

  return out;
}

/** Vật tư có bản ghi nào trong sổ cái chưa? Quyết định "xóa được" hay "chỉ thanh lý". */
export async function assetHasLedger(assetId: string): Promise<number> {
  const res = await pb.collection('vt_event').getList(1, 1, { filter: `asset="${assetId}"` });
  return res.totalItems;
}

export async function createRecord(kind: EntityKind, body: Record<string, unknown>) {
  return pb.collection(COLLECTION[kind]).create(body);
}

export async function updateRecord(kind: EntityKind, id: string, body: Record<string, unknown>) {
  return pb.collection(COLLECTION[kind]).update(id, body);
}

export async function deleteRecord(kind: EntityKind, id: string) {
  return pb.collection(COLLECTION[kind]).delete(id);
}

/**
 * Thanh lý vật tư: ghi sổ cái TRƯỚC rồi mới đổi trạng thái (plan §1.3).
 * Dùng thay cho xóa khi vật tư đã có lịch sử.
 */
export async function liquidateAsset(
  assetId: string, serial: string, at: string, documentNo: string, note: string,
) {
  await pb.collection('vt_event').create({
    asset: assetId, serial, event: 'thanh_ly', at,
    by: pb.authStore.model?.id, document_no: documentNo, note,
  });
  await pb.collection('vt_asset').update(assetId, {
    current_status: 'thanh_ly', current_point: '', current_warehouse: '',
  });
}

/* ------------------------------------------------------------------ */
/* Mô tả trường của từng loại — dựng form từ đây, không viết tay 5 form */
/* ------------------------------------------------------------------ */

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'rel' | 'bool';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Nguồn quan hệ: lấy danh sách từ CatalogData */
  relFrom?: 'zone' | 'station' | 'warehouse';
  hint?: string;
  /** Chỉ hiện khi hàm này trả true (VD tỷ số chỉ cho TI/TU) */
  showIf?: (v: Record<string, any>) => boolean;
}

export function fieldsOf(kind: EntityKind): FieldDef[] {
  switch (kind) {
    case 'zone':
      return [
        { name: 'code', label: 'Mã KCN', type: 'text', required: true, hint: 'Phải khớp users.area2, VD KCNTH' },
        { name: 'name', label: 'Tên', type: 'text', required: true },
        { name: 'area_label', label: 'Nhãn khu vực', type: 'text', hint: 'Khớp users.area, VD "KCN Tiền Hải"' },
      ];
    case 'station':
      return [
        { name: 'code', label: 'Mã trạm', type: 'text', required: true, hint: 'VD 03.AQ.T1.2500kVA' },
        { name: 'name', label: 'Tên', type: 'text' },
        { name: 'zone', label: 'Khu công nghiệp', type: 'rel', relFrom: 'zone', required: true },
        { name: 'sdm_kva', label: 'Sdm (kVA)', type: 'number' },
        { name: 'p0_kw', label: 'P0 (kW)', type: 'number', hint: 'Tổn thất không tải' },
        { name: 'pk_kw', label: 'Pk (kW)', type: 'number', hint: 'Tổn thất ngắn mạch' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
    case 'point':
      return [
        { name: 'line_id', label: 'Mã điểm đo', type: 'text', required: true },
        { name: 'line_name', label: 'Tên điểm đo', type: 'text' },
        { name: 'zone', label: 'Khu công nghiệp', type: 'rel', relFrom: 'zone', required: true },
        { name: 'station', label: 'Trạm', type: 'rel', relFrom: 'station', hint: 'Để trống nếu chưa xác định' },
        {
          name: 'role', label: 'Vai trò', type: 'select',
          options: [{ value: 'chinh', label: 'Chính' }, { value: 'phu', label: 'Phụ' }],
          hint: 'Chỉ điểm đo CHÍNH được tính vào tổn thất MBA',
        },
        {
          name: 'voltage_level', label: 'Cấp điện áp', type: 'select',
          options: [{ value: 'LV', label: 'Hạ thế (LV)' }, { value: 'MV', label: 'Trung thế (MV)' }],
        },
        {
          name: 'point_status', label: 'Trạng thái', type: 'select',
          options: [
            { value: 'du_kien', label: 'Dự kiến' }, { value: 'active', label: 'Đang vận hành' },
            { value: 'sub_meter', label: 'Điểm đo phụ' }, { value: 'dismounted', label: 'Đã tháo' },
          ],
        },
        { name: 'hsn_invoice', label: 'HSN theo hóa đơn', type: 'number', hint: 'Chỉ để đối chứng' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
    case 'asset':
      return [
        { name: 'serial', label: 'Số hiệu', type: 'text', required: true },
        {
          name: 'type', label: 'Loại', type: 'select', required: true,
          options: ASSET_TYPES.map(t => ({ value: t, label: ASSET_TYPE_LABEL[t] })),
        },
        {
          name: 'ratio_text', label: 'Tỷ số', type: 'text',
          hint: 'Dạng 2000/5 — hệ thống tự tách sơ cấp / thứ cấp',
          showIf: v => hasRatio(v.type),
        },
        { name: 'manufacturer', label: 'Hãng sản xuất', type: 'text' },
        { name: 'accuracy_class', label: 'Cấp chính xác', type: 'text' },
        { name: 'manufacture_year', label: 'Năm sản xuất', type: 'number', hint: 'Công tơ: 2 số đầu số hiệu' },
        { name: 'calibration_date', label: 'Ngày kiểm định', type: 'date' },
        { name: 'next_calibration', label: 'Hạn kiểm định', type: 'date', hint: 'Công tơ 3 năm, TI/TU 5 năm' },
        {
          name: 'current_status', label: 'Trạng thái', type: 'select',
          options: [
            { value: 'kho', label: 'Trong kho' }, { value: 'dang_treo', label: 'Đang treo' },
            { value: 'cho_kiem_dinh', label: 'Chờ kiểm định' }, { value: 'dang_kiem_dinh', label: 'Đang kiểm định' },
            { value: 'dat', label: 'Kiểm định đạt' }, { value: 'khong_dat', label: 'Không đạt' },
            { value: 'thanh_ly', label: 'Đã thanh lý' },
          ],
        },
        { name: 'current_warehouse', label: 'Kho', type: 'rel', relFrom: 'warehouse' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
    case 'warehouse':
      return [
        { name: 'code', label: 'Mã kho', type: 'text', required: true },
        { name: 'name', label: 'Tên kho', type: 'text', required: true },
        { name: 'zone', label: 'Khu công nghiệp', type: 'rel', relFrom: 'zone' },
        { name: 'active', label: 'Còn sử dụng', type: 'bool' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Cột của bảng sửa trực tiếp (kiểu Excel)                             */
/* ------------------------------------------------------------------ */

export type TagKind = 'zone' | 'role' | 'point_status' | 'asset_type' | 'asset_status' | 'location';

export interface ColumnDef {
  key: string;
  label: string;
  /** 'readonly' = ô tính toán, không sửa được (VD số điểm đo của trạm). */
  kind: 'text' | 'number' | 'date' | 'select' | 'rel' | 'readonly';
  options?: Array<{ value: string; label: string }>;
  relFrom?: 'zone' | 'station' | 'warehouse';
  /** Hiện dưới dạng tag màu thay vì chữ thường. */
  tag?: TagKind;
  required?: boolean;
  width?: string;
  hint?: string;
}

const F = fieldsOf;

export function columnsOf(kind: EntityKind): ColumnDef[] {
  const f = (name: string) => F(kind).find(x => x.name === name)!;
  const asCol = (name: string, extra: Partial<ColumnDef> = {}): ColumnDef => {
    const d = f(name);
    return {
      key: d.name, label: d.label, kind: d.type as ColumnDef['kind'],
      options: d.options, relFrom: d.relFrom, required: d.required, hint: d.hint,
      ...extra,
    };
  };

  switch (kind) {
    case 'zone':
      return [
        asCol('code', { width: 'w-28' }), asCol('name'), asCol('area_label'),
        { key: '_stations', label: 'Trạm', kind: 'readonly', width: 'w-16' },
        { key: '_points', label: 'Điểm đo', kind: 'readonly', width: 'w-16' },
      ];
    case 'station':
      return [
        asCol('code', { width: 'w-56' }),
        asCol('zone', { width: 'w-32' }),
        asCol('sdm_kva', { width: 'w-24' }), asCol('p0_kw', { width: 'w-24' }), asCol('pk_kw', { width: 'w-24' }),
        { key: '_points', label: 'Điểm đo', kind: 'readonly', width: 'w-16' },
        asCol('note'),
      ];
    case 'point':
      return [
        asCol('line_id', { width: 'w-20' }),
        asCol('line_name', { width: 'w-56' }),
        asCol('station', { relFrom: 'station', width: 'w-48' }),
        asCol('zone', { width: 'w-32' }),
        asCol('role', { tag: 'role', width: 'w-28' }),
        asCol('point_status', { tag: 'point_status', width: 'w-36' }),
        asCol('voltage_level', { width: 'w-24' }),
        asCol('hsn_invoice', { width: 'w-24' }),
        { key: '_assets', label: 'Vật tư', kind: 'readonly', width: 'w-16' },
      ];
    case 'asset':
      return [
        asCol('serial', { width: 'w-36' }),
        asCol('type', { tag: 'asset_type', width: 'w-28' }),
        asCol('ratio_text', { width: 'w-24' }),
        asCol('manufacture_year', { width: 'w-20' }),
        asCol('next_calibration', { width: 'w-32' }),
        asCol('current_status', { tag: 'asset_status', width: 'w-36' }),
        { key: '_location', label: 'Vị trí', kind: 'readonly', tag: 'location', width: 'w-32' },
      ];
    case 'warehouse':
      return [asCol('code'), asCol('name'), asCol('zone')];
  }
}

/** Tỷ số tự tính khi lưu TI/TU — không bắt người dùng tự nhân chia. */
export function withDerived(kind: EntityKind, v: Record<string, any>): Record<string, any> {
  if (kind !== 'asset') return v;
  const out = { ...v };
  const p = Number(out.ratio_primary), s = Number(out.ratio_secondary);
  if ((out.type === 'TI' || out.type === 'TU') && p && s) out.ratio = p / s;
  else { delete out.ratio_primary; delete out.ratio_secondary; out.ratio = null; }
  return out;
}
