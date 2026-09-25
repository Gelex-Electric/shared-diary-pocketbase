/* ============================================================
   ĐIỂM ĐO ĐẦU NGUỒN — đo TỔNG một lộ (vd TTI.DIEMDONGUON, lộ 473E27.4).

   Nó KHÔNG đại diện cho khách hàng nào (user nhắc lại 23/09/2026). Để lẫn vào
   danh sách khách hàng thì:
     - luôn chiếm hạng 1 mọi bảng xếp hạng (nó là tổng của tất cả),
     - làm sai giá trị trung bình,
     - lọt vào danh sách nhận thông báo ngừng cấp điện dù không có ai để gửi.

   NHẬN DIỆN THEO DANH MỤC (24/09/2026): công tơ gắn vào điểm đo `role =
   dau_nguon` (schema v17). Trước đây là danh sách LINE_NAME viết cứng
   (`HEAD_LINES = ['TTI.DIEMDOPHU']`) — thêm một đầu nguồn phải sửa code, và tên
   bên HES đổi là nhận sai. Nay khai trong Danh mục là mọi màn tự nhận.

   Lấy MỌI công tơ từng gắn ở điểm đầu nguồn (kể cả đã tháo): dữ liệu cũ của
   công tơ cũ vẫn là số đầu nguồn, không được lọt sang danh sách khách hàng.
   ============================================================ */
import { useEffect, useState } from 'react';
import { pb } from './pocketbase';

export interface HeadMeter {
  serial: string;
  /** Mã điểm đo đầu nguồn trong Danh mục. */
  code: string;
}

/** Nhãn hiển thị khi tách riêng ra khỏi danh sách khách hàng. */
export const HEAD_LABEL = 'Điểm đo đầu nguồn';

/** Mô tả ngắn dùng cho tooltip / dòng chú thích dưới nhãn. */
export const HEAD_HINT = 'Đo tổng một lộ — không phải phụ tải của một khách hàng';

let _cache: Promise<HeadMeter[]> | null = null;

/** Công tơ của các điểm đầu nguồn — nạp MỘT lần mỗi phiên (danh mục ít đổi). */
export function loadHeadMeters(): Promise<HeadMeter[]> {
  if (_cache) return _cache;
  _cache = (async () => {
    const pts = await pb.collection('dm_point').getFullList({
      filter: 'role = "dau_nguon"', fields: 'id,code', requestKey: null,
    });
    if (!pts.length) return [];
    const codeOf = new Map(pts.map(p => [p.id, String(p.code ?? '')]));
    const assets = await pb.collection('dm_asset').getFullList({
      filter: `type = "CONGTO" && (${pts.map(p => `point = "${p.id}"`).join(' || ')})`,
      fields: 'serial,point', requestKey: null,
    });
    return assets.map(a => ({ serial: String(a.serial ?? '').trim(), code: codeOf.get(a.point) ?? '' }));
  })().catch(err => {
    /* Lỗi mạng: lần sau thử lại, và lần này coi như chưa có đầu nguồn — màn vẫn
       chạy, chỉ là đầu nguồn tạm nằm chung danh sách. */
    _cache = null;
    console.error('Không tải được danh sách điểm đo đầu nguồn:', err);
    return [];
  });
  return _cache;
}

/** Hook: tập số công tơ đầu nguồn (rỗng trong lúc đang tải). */
export function useHeadSerials(): Set<string> {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void loadHeadMeters().then(list => { if (alive) setSet(new Set(list.map(m => m.serial))); });
    return () => { alive = false; };
  }, []);
  return set;
}
