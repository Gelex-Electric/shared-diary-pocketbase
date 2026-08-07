/**
 * Ghi danh mục `wh_*`: khách hàng, điểm đo, thiết bị, kho.
 *
 * Ba nguyên tắc, đều có lý do đắt giá:
 *
 * 1. **Khai báo thiết bị kèm kho thì ghi luôn một dòng `wh_movement` "nhập
 *    kho"**. `wh_device.status` / `current_warehouse` là trường DẪN XUẤT từ sổ
 *    nhật ký. Tạo thiết bị mà không ghi sổ thì sổ nói một đằng, bảng nói một
 *    nẻo, và không ai dựng lại được thiết bị đó vào kho lúc nào.
 * 2. **Ghi sổ TRƯỚC, cập nhật trạng thái SAU.** Bước sau lỗi thì sổ vẫn đúng và
 *    dựng lại được; ngược lại là mất dấu.
 * 3. **Không cho sửa tay `status` / `current_point`** trong biểu mẫu danh mục.
 *    Muốn đổi thì phải qua thao tác treo/tháo/điều chuyển — nếu không thì luật
 *    R1–R7 vô hiệu vì ai cũng sửa thẳng được kết quả.
 */
import { pbv2 } from './pb';
import { WH } from './wh';

/** 5 KCN thật + kho văn phòng GETC (theo `scripts/wh_schema.mjs`). */
export const ZONES = [
  'KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I',
  'KCN Yên Mỹ', 'KCN Số 3', 'GETC',
];

/** 9 trạng thái điểm đo đang dùng thật trong Excel gốc. */
export const POINT_STATUS = [
  'Đang hoạt động', 'Chưa đóng điện', 'Chưa gán khách hàng',
  'Không hoạt động', 'Lưu tại chi nhánh', 'Lưu tại văn phòng',
  'Đã thu hồi', 'Đã thanh lý', 'Trả Emic',
];

export const NGUON_GOC = ['du_phong', 'thu_hoi'];

export type EntityKind = 'zone' | 'station' | 'customer' | 'point' | 'device';

export const ENTITY_LABEL: Record<EntityKind, string> = {
  zone: 'Khu công nghiệp', station: 'Trạm', customer: 'Khách hàng',
  point: 'Điểm đo', device: 'Thiết bị',
};

export const COLLECTION_OF: Record<EntityKind, string> = {
  zone: WH.zone, station: WH.station, customer: WH.customer,
  point: WH.point, device: WH.device,
};

/** Chỉ tài khoản khối kinh doanh (`users.area` rỗng) mới ghi được — khớp
 *  `WRITE = @request.auth.id != "" && @request.auth.area = ""` của collection. */
export function canWrite(): boolean {
  const raw = pbv2.authStore.record?.area;
  return pbv2.authStore.isValid && (!raw || (typeof raw === 'string' && !raw.trim()));
}

export function whyCannotWrite(): string {
  if (!pbv2.authStore.isValid) return 'Chưa đăng nhập';
  return 'Tài khoản vận hành chỉ được xem. Khai báo danh mục cần tài khoản khối kinh doanh.';
}

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'rel' | 'bool';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  /** Nguồn của ô chọn quan hệ. */
  relFrom?: 'customer' | 'deviceType' | 'point' | 'zone' | 'station';
  hint?: string;
}

export function fieldsOf(kind: EntityKind): FieldDef[] {
  switch (kind) {
    case 'zone':
      return [
        { name: 'code', label: 'Mã KCN', type: 'text', required: true,
          hint: 'Phải trùng đúng chuỗi đang dùng ở điểm đo, ví dụ "KCN Yên Mỹ"' },
        { name: 'name', label: 'Tên đầy đủ', type: 'text', required: true },
        { name: 'short_code', label: 'Mã ngắn', type: 'text', hint: 'TH, PĐ, TTI, YM, 03, GETC' },
        { name: 'warehouse_name', label: 'Tên kho', type: 'text',
          hint: 'Mỗi đơn vị đúng một kho nên kho không còn là bảng riêng' },
        { name: 'order_index', label: 'Thứ tự hiển thị', type: 'number' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
    case 'station':
      return [
        { name: 'code', label: 'Mã trạm', type: 'text', required: true },
        { name: 'name', label: 'Tên trạm', type: 'text' },
        { name: 'zone', label: 'Khu công nghiệp', type: 'rel', relFrom: 'zone', required: true },
        { name: 'mba', label: 'Máy biến áp', type: 'text' },
        { name: 'cong_suat_kva', label: 'Công suất (kVA)', type: 'number' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
    case 'customer':
      return [
        { name: 'mkh', label: 'Mã khách hàng', type: 'text', required: true },
        { name: 'ten', label: 'Tên khách hàng', type: 'text', required: true },
        { name: 'tat', label: 'Tên viết tắt', type: 'text' },
        { name: 'zone', label: 'Khu công nghiệp', type: 'select', options: ZONES },
        { name: 'trang_thai', label: 'Trạng thái', type: 'text' },
      ];
    case 'point':
      return [
        { name: 'point_code', label: 'Mã điểm đo', type: 'text', required: true },
        { name: 'customer', label: 'Khách hàng', type: 'rel', relFrom: 'customer' },
        { name: 'zone', label: 'Khu công nghiệp', type: 'select', options: ZONES },
        { name: 'station', label: 'Trạm', type: 'rel', relFrom: 'station' },
        { name: 'role', label: 'Vai trò', type: 'select', options: ['chinh', 'phu'],
          hint: 'Điểm đo chính là điểm tính tổn thất; điểm phụ đã nằm trong điểm chính' },
        { name: 'line_name', label: 'Lộ đường dây', type: 'text' },
        { name: 'mba', label: 'Máy biến áp', type: 'text' },
        { name: 'cong_suat_kva', label: 'Công suất (kVA)', type: 'number' },
        { name: 'ngay_dong_dien', label: 'Ngày đóng điện', type: 'date' },
        { name: 'trang_thai', label: 'Trạng thái', type: 'select', options: POINT_STATUS },
      ];
    case 'device':
      return [
        { name: 'serial', label: 'Số hiệu', type: 'text', required: true },
        { name: 'type', label: 'Loại thiết bị', type: 'rel', relFrom: 'deviceType', required: true },
        { name: 'model', label: 'Model', type: 'text', hint: 'ME41 / ME42 / DTS27 — quyết định có cần TI hay không' },
        { name: 'spec', label: 'Tỷ số', type: 'text', hint: 'Dạng 1600/5, chỉ TI và TU mới có' },
        { name: 'manufacturer', label: 'Hãng sản xuất', type: 'text' },
        { name: 'year_made', label: 'Năm sản xuất', type: 'number' },
        { name: 'calib_date', label: 'Ngày kiểm định', type: 'date' },
        { name: 'calib_expiry', label: 'Hạn kiểm định', type: 'date' },
        { name: 'calib_cert_no', label: 'Số tem/chứng chỉ', type: 'text' },
        { name: 'nguon_goc', label: 'Nguồn gốc', type: 'select', options: NGUON_GOC },
        { name: 'zone', label: 'Nhập về kho của đơn vị', type: 'rel', relFrom: 'zone',
          hint: 'Chọn đơn vị sẽ ghi luôn một giao dịch "nhập kho" vào sổ' },
        { name: 'note', label: 'Ghi chú', type: 'text' },
      ];
  }
}

/** Bỏ ô trống để PocketBase không nuốt chuỗi rỗng vào trường số/ngày. */
function clean(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === '' || val === undefined || val === null) continue;
    out[k] = val;
  }
  return out;
}

export function validate(kind: EntityKind, v: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const f of fieldsOf(kind)) {
    if (f.required && !String(v[f.name] ?? '').trim()) errs.push(`Thiếu ${f.label.toLowerCase()}`);
  }
  if (kind === 'device') {
    const spec = String(v.spec ?? '').trim();
    if (spec && !/^\s*\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?\s*$/.test(spec)) {
      errs.push('Tỷ số phải viết dạng 1600/5');
    }
    const cd = String(v.calib_date ?? '').slice(0, 10);
    const ce = String(v.calib_expiry ?? '').slice(0, 10);
    if (cd && ce && ce < cd) errs.push('Hạn kiểm định sớm hơn ngày kiểm định');
  }
  if (kind === 'point') {
    const kva = Number(v.cong_suat_kva ?? 0);
    if (v.cong_suat_kva !== '' && v.cong_suat_kva != null && (!Number.isFinite(kva) || kva < 0)) {
      errs.push('Công suất không hợp lệ');
    }
  }
  return errs;
}

export async function createRecord(kind: EntityKind, v: Record<string, unknown>) {
  const body = clean(v);

  if (kind === 'device') {
    const zoneId = String(body.zone ?? '');
    // Trường dẫn xuất: thiết bị mới khai luôn ở trạng thái trong kho nếu đã
    // chọn kho, còn không thì để trống cho tới khi có giao dịch nhập kho.
    const rec = await pbv2.collection(WH.device).create({
      ...body,
      status: zoneId ? 'trong_kho' : '',
      tu_dong_tao: false,
    });
    if (zoneId) {
      // Ghi sổ SAU khi có id thiết bị, nhưng TRƯỚC khi coi là xong: thiếu dòng
      // này thì lịch sử thiết bị bắt đầu từ hư không.
      await pbv2.collection(WH.movement).create({
        device: rec.id, action: 'nhap_kho',
        event_date: new Date().toISOString().slice(0, 10),
        to_zone: zoneId,
        reason: 'Khai báo danh mục',
        performer: pbv2.authStore.record?.email ?? '',
      });
    }
    return rec;
  }

  return pbv2.collection(COLLECTION_OF[kind]).create(body);
}

export async function updateRecord(kind: EntityKind, id: string, v: Record<string, unknown>) {
  const body = clean(v);
  // Không bao giờ để biểu mẫu danh mục đụng vào trường dẫn xuất.
  delete body.status;
  delete body.current_point;
  if (kind === 'device') delete body.zone;
  return pbv2.collection(COLLECTION_OF[kind]).update(id, body);
}

/**
 * Xoá có chặn: thiết bị đã có giao dịch thì KHÔNG xoá (sổ sẽ mồ côi), điểm đo
 * còn thiết bị đang treo cũng không. Trả về lý do để nút nói được vì sao.
 */
export async function deleteBlockers(kind: EntityKind, id: string): Promise<string[]> {
  const out: string[] = [];
  if (kind === 'device') {
    const mv = await pbv2.collection(WH.movement).getList(1, 1, { filter: `device="${id}"`, requestKey: null });
    if (mv.totalItems) out.push(`Đã có ${mv.totalItems} giao dịch trong sổ`);
  }
  if (kind === 'point') {
    const dv = await pbv2.collection(WH.device).getList(1, 1, { filter: `current_point="${id}"`, requestKey: null });
    if (dv.totalItems) out.push(`Còn ${dv.totalItems} thiết bị đang treo`);
  }
  if (kind === 'customer') {
    const p = await pbv2.collection(WH.point).getList(1, 1, { filter: `customer="${id}"`, requestKey: null });
    if (p.totalItems) out.push(`Còn ${p.totalItems} điểm đo thuộc khách hàng này`);
  }
  if (kind === 'station') {
    const p = await pbv2.collection(WH.point).getList(1, 1, { filter: `station="${id}"`, requestKey: null });
    if (p.totalItems) out.push(`Còn ${p.totalItems} điểm đo thuộc trạm này`);
  }
  if (kind === 'zone') {
    const st = await pbv2.collection(WH.station).getList(1, 1, { filter: `zone="${id}"`, requestKey: null });
    if (st.totalItems) out.push(`Còn ${st.totalItems} trạm thuộc KCN này`);
    const dv = await pbv2.collection(WH.device).getList(1, 1, { filter: `zone="${id}"`, requestKey: null });
    if (dv.totalItems) out.push(`Còn ${dv.totalItems} thiết bị trong kho của đơn vị này`);
  }
  return out;
}

export async function deleteRecord(kind: EntityKind, id: string) {
  return pbv2.collection(COLLECTION_OF[kind]).delete(id);
}

/** Lỗi PocketBase → câu tiếng Việt đọc được. */
export function readableError(e: unknown): string {
  const err = e as { status?: number; message?: string; data?: { data?: Record<string, { message?: string }> } };
  const fields = err?.data?.data;
  if (fields && Object.keys(fields).length) {
    return Object.entries(fields)
      .map(([k, v]) => `${k}: ${v?.message ?? 'không hợp lệ'}`)
      .join('; ');
  }
  if (err?.status === 403) return 'Tài khoản không có quyền ghi vào dữ liệu kho';
  return err?.message ?? 'Lưu không thành công';
}
