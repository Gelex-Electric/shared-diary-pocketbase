/**
 * Gắn khách hàng (MKH) vào điểm đo — user chốt 05/08.
 *
 * Giao diện chỉ hỏi "điểm đo này của khách nào", KHÔNG bắt nhập kỳ. Nhưng dưới
 * nền vẫn ghi theo kỳ vào `dm_point_customer`, vì hai lý do:
 *   1. Đã có sẵn 98 kỳ seed từ hóa đơn — ghi đè kiểu "một khách một điểm đo" là
 *      MẤT toàn bộ lịch sử đó.
 *   2. Khi tranh chấp hóa đơn, câu hỏi luôn là "tháng 3/2025 điểm đo này của
 *      ai", mà chỉ giữ khách hiện tại thì không trả lời được.
 *
 * Nên: đổi khách = ĐÓNG kỳ cũ (to_date = hôm nay, is_current = false) rồi MỞ kỳ
 * mới, thay vì sửa đè lên bản ghi cũ.
 *
 * Không import PocketBase ở phần thuần tính toán để kiểm thử được bằng tsx.
 */
import { pb } from './pocketbase';
import type { CatalogData, PointCustomer } from './catalog';

/** Kỳ đang hiệu lực của một điểm đo. */
export function currentPeriodOf(periods: PointCustomer[], pointId: string): PointCustomer | null {
  return periods.find(p => p.point === pointId && p.is_current) ?? null;
}

export interface AssignPlan {
  /** Kỳ cần đóng lại (đổi sang khách khác, hoặc gỡ khách). */
  close: PointCustomer | null;
  /** Khách hàng mới cần mở kỳ. Rỗng = chỉ gỡ, không gắn ai. */
  openCustomerId: string;
  /** Không phải làm gì (chọn lại đúng khách đang có). */
  noop: boolean;
}

/**
 * Tính việc cần làm. Tách riêng khỏi phần ghi để kiểm thử được.
 * `customerId` rỗng = gỡ khách khỏi điểm đo.
 */
export function planAssign(
  periods: PointCustomer[], pointId: string, customerId: string,
): AssignPlan {
  const cur = currentPeriodOf(periods, pointId);
  if (cur && cur.customer === customerId) return { close: null, openCustomerId: '', noop: true };
  if (!cur && !customerId) return { close: null, openCustomerId: '', noop: true };
  return { close: cur, openCustomerId: customerId, noop: false };
}

/** Ghi thật. Trả về mô tả ngắn để hiện trong thông báo. */
export async function assignCustomer(
  d: CatalogData, pointId: string, customerId: string, date?: string,
): Promise<string> {
  const plan = planAssign(d.periods, pointId, customerId);
  if (plan.noop) return 'Không có gì thay đổi';

  const today = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const point = d.points.find(p => p.id === pointId);
  const cus = d.customers.find(c => c.id === customerId);

  // Đóng kỳ cũ TRƯỚC, để không có lúc nào hai kỳ cùng is_current.
  if (plan.close) {
    await pb.collection('dm_point_customer').update(plan.close.id, {
      is_current: false,
      to_date: plan.close.to_date || today,
    });
  }

  if (plan.openCustomerId) {
    await pb.collection('dm_point_customer').create({
      point: pointId,
      customer: plan.openCustomerId,
      mkh: cus?.mkh ?? '',
      from_date: today,
      to_date: '',
      is_current: true,
      shared: false,
    });
  }

  const ten = point?.line_name ?? 'điểm đo';
  if (!plan.openCustomerId) return `Đã gỡ khách hàng khỏi ${ten}`;
  return plan.close
    ? `${ten}: ${cus?.mkh} thay cho ${plan.close.mkh} (kỳ cũ đóng ngày ${today})`
    : `${ten}: gắn ${cus?.mkh}`;
}
