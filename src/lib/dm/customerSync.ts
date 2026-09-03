/**
 * Đồng bộ danh mục khách hàng từ hóa đơn — module THUẦN.
 *
 * Vì sao cần: `MKHang` trong hóa đơn là khoá KHÔNG ĐỔI, còn tên và địa chỉ
 * khách hàng thì đổi theo thời gian. Bằng chứng trong dữ liệu thật:
 *   KCNYM-005  "LOGOS VIỆT NAM HY 1"        → "LOGOI GROUP VIỆT NAM"
 *   KCNYM-009  "CÔNG TY TNHH DAECHANG"      → "CÔNG TY CỔ PHẦN DAECHANG"
 *   KCNYM-006  "… – CHI NHÁNH HƯNG YÊN"     → bỏ đuôi chi nhánh
 * cộng với hàng loạt địa chỉ đổi do sáp nhập tỉnh (Thái Bình → Hưng Yên).
 * ⇒ Luôn lấy theo hóa đơn có NGÀY CHỐT MỚI NHẤT.
 *
 * Module này KHÔNG gọi mạng: nó nhận dữ liệu vào, trả về một BẢN KẾ HOẠCH để
 * tầng giao diện hỏi ý người dùng rồi mới ghi. Tách vậy để xem trước được thay
 * đổi trước khi đụng vào dữ liệu thật.
 */
import { KCN_CODE_TO_NAME } from '../kcnColors';
import type { Customer, Zone } from './types';
import { ymd } from './lifecycle';

/** Các cột hóa đơn cần cho việc đồng bộ. */
export interface CustomerFact {
  MKHang: string;
  NMua?: string;
  DChiNMua?: string;
  EndDate?: string;
}

/** Trạng thái mới nhất của một khách hàng, gom từ hóa đơn. */
export interface LatestCustomer {
  mkh: string;
  name: string;
  address: string;
  /** Ngày chốt chỉ số của hóa đơn đã lấy dữ liệu — để hiển thị "theo kỳ nào". */
  asOf: string;
  /** Mã KCN suy từ tiền tố mã khách hàng (`KCNTH-001` → `KCNTH`). */
  zoneCode: string;
}

export interface FieldChange {
  field: 'name' | 'address' | 'zone';
  from: string;
  to: string;
}

export interface SyncPlan {
  /** KCN chưa khai mà hóa đơn có nhắc tới — tạo trước để còn gắn khách vào. */
  zonesToCreate: { code: string; name: string }[];
  /** Mã KCN lạ, không có trong bảng tên chuẩn ⇒ không tự tạo, chỉ báo. */
  unknownZoneCodes: string[];
  customersToCreate: LatestCustomer[];
  customersToUpdate: { id: string; mkh: string; changes: FieldChange[] }[];
  /** Khách đã khai tay mà hóa đơn chưa có — giữ nguyên, chỉ để báo cáo. */
  untouchedMkh: string[];
}

/** Mã KCN = phần trước dấu `-` đầu tiên của mã khách hàng. */
export const zoneCodeOfMkh = (mkh: string): string => mkh.split('-')[0] ?? '';

/**
 * Gom hóa đơn theo mã khách hàng, mỗi mã lấy bản ghi có `EndDate` LỚN NHẤT.
 * Hóa đơn thiếu `MKHang` bị bỏ qua (thực tế 0 bản ghi, nhưng đừng tin mù).
 */
export function latestByMkh(facts: CustomerFact[]): LatestCustomer[] {
  const best = new Map<string, CustomerFact>();

  for (const f of facts) {
    const mkh = (f.MKHang ?? '').trim();
    if (!mkh) continue;
    const cur = best.get(mkh);
    if (!cur || ymd(f.EndDate) > ymd(cur.EndDate)) best.set(mkh, f);
  }

  return [...best.entries()]
    .map(([mkh, f]) => ({
      mkh,
      name: (f.NMua ?? '').trim(),
      address: (f.DChiNMua ?? '').trim(),
      asOf: ymd(f.EndDate),
      zoneCode: zoneCodeOfMkh(mkh),
    }))
    .sort((a, b) => a.mkh.localeCompare(b.mkh, 'vi', { numeric: true }));
}

/**
 * So dữ liệu mới nhất từ hóa đơn với danh mục hiện có, ra bản kế hoạch.
 *
 * NGUYÊN TẮC:
 * - Chỉ TẠO và CẬP NHẬT, **không bao giờ xoá**.
 * - Chỉ đụng 3 trường `name`, `address`, `zone`. **Không đụng `short_name`** —
 *   tên tắt do người dùng đặt và dùng để sinh mã trạm, suy máy móc từ tên công
 *   ty sẽ hỏng mã (user chốt 20/08/2026).
 * - Hóa đơn để trống trường nào thì bỏ qua trường đó, không ghi đè bằng rỗng.
 * - Idempotent: chạy lại khi không có gì đổi thì kế hoạch rỗng.
 */
export function planCustomerSync(
  latest: LatestCustomer[],
  zones: Zone[],
  customers: Customer[],
): SyncPlan {
  const zoneByCode = new Map(zones.map(z => [z.code, z]));
  const customerByMkh = new Map(customers.map(c => [c.mkh, c]));

  const zonesToCreate: { code: string; name: string }[] = [];
  const unknownZoneCodes: string[] = [];
  for (const code of new Set(latest.map(l => l.zoneCode))) {
    if (!code || zoneByCode.has(code)) continue;
    const name = KCN_CODE_TO_NAME[code];
    if (name) zonesToCreate.push({ code, name });
    else unknownZoneCodes.push(code);
  }

  const customersToCreate: LatestCustomer[] = [];
  const customersToUpdate: SyncPlan['customersToUpdate'] = [];

  for (const l of latest) {
    const existing = customerByMkh.get(l.mkh);
    if (!existing) { customersToCreate.push(l); continue; }

    const changes: FieldChange[] = [];
    if (l.name && l.name !== existing.name) {
      changes.push({ field: 'name', from: existing.name, to: l.name });
    }
    if (l.address && l.address !== (existing.address ?? '')) {
      changes.push({ field: 'address', from: existing.address ?? '', to: l.address });
    }
    // KCN chỉ gắn khi đang trống: người dùng có thể đã cố ý gắn khác đi.
    const zoneId = zoneByCode.get(l.zoneCode)?.id;
    if (zoneId && !existing.zone) {
      changes.push({ field: 'zone', from: '', to: l.zoneCode });
    }
    if (changes.length) customersToUpdate.push({ id: existing.id, mkh: l.mkh, changes });
  }

  const knownMkh = new Set(latest.map(l => l.mkh));
  const untouchedMkh = customers.filter(c => !knownMkh.has(c.mkh)).map(c => c.mkh);

  return { zonesToCreate, unknownZoneCodes, customersToCreate, customersToUpdate, untouchedMkh };
}

/** Kế hoạch có gì để làm không — dùng để báo "không có gì thay đổi". */
export const isEmptyPlan = (p: SyncPlan): boolean =>
  p.zonesToCreate.length === 0 && p.customersToCreate.length === 0
  && p.customersToUpdate.length === 0;
