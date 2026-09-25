/**
 * Tập công tơ thuộc từng LỘ — nguồn DUY NHẤT cho Pmax lộ (`pmax_line_daily.mjs`) và
 * đối soát đầu nguồn (`head_balance_daily.mjs`). Hai nơi phải cùng một tập, nếu không
 * "Pmax lộ" và "tổng các điểm đo" của đối soát nói về hai tập khác nhau.
 *
 * Tách khỏi pmax_line_daily.mjs ngày 24/09/2026 (script đó chạy ngay khi import).
 * Điểm ĐẦU NGUỒN (role dau_nguon) tự bị loại vì chỉ lấy `chinh`.
 */
/**
 * Công tơ ĐANG TREO của từng lộ — CHỈ điểm đo chính.
 * `dm_asset` (CONGTO) → `dm_point` → `dm_station` → `dm_line`.
 *
 * "ĐANG TREO" = có ngày treo và CHƯA có ngày tháo — cùng định nghĩa với
 * `liveMeters` trong `lib/pb_meters.mjs`, chặt hơn cờ `active`.
 *
 * VÀ điểm đo phải ĐANG VẬN HÀNH (`status === 'active'`) (user chốt 22/09/2026).
 * Đo trước khi làm: 15 công tơ đang treo ở điểm đo "chưa vận hành" đều KHÔNG có
 * dữ liệu — loại chúng mất đúng 0 kW, chỉ làm mẫu số trung thực hơn. Điểm đo
 * chưa vận hành nằm trong mẫu số thì độ phủ trông thấp hơn thực tế và người đọc
 * mất tin vào cả những lộ đang đủ số liệu.
 *
 * Vì sao phải lọc (sửa 22/09/2026): bản đầu đếm MỌI công tơ từng gắn ở điểm đo
 * chính, nên mẫu số gồm cả công tơ đã tháo và công tơ dự kiến chưa ra hiện
 * trường. Lộ 477E11.9 hiện "10/31 công tơ có số liệu" trong khi thực tế là
 * 9/13 — nhìn vào tưởng mất 2/3 dữ liệu, mà 18 cái kia vốn KHÔNG THỂ có dữ liệu:
 * 10 đã tháo, 7 chưa treo, và chúng vẫn nằm trong mẫu số. Một con số như vậy
 * làm người đọc mất tin vào cả những lộ đang đúng.
 */
export function metersByLine({ stations, points, assets, customers }) {
  const stById = new Map(stations.map(s => [s.id, s]));
  const pById = new Map(points.map(p => [p.id, p]));
  const cById = new Map(customers.map(c => [c.id, c]));
  const ymd = (v) => String(v ?? '').slice(0, 10);
  const out = new Map();
  for (const a of assets) {
    if (a.type !== 'CONGTO' || !a.point) continue;
    if (!ymd(a.date_on) || ymd(a.date_off)) continue;
    const p = pById.get(a.point);
    if (!p || p.role !== 'chinh' || p.status !== 'active') continue;
    const st = p.station ? stById.get(p.station) : undefined;
    if (!st?.line) continue;
    const cus = p.customer ? cById.get(p.customer) : undefined;
    if (!out.has(st.line)) out.set(st.line, []);
    out.get(st.line).push({
      serial: a.serial,
      station: st.code ?? '',
      mkh: cus?.mkh ?? '',
      /* Tên TẮT: tên đầy đủ có dấu phẩy sẽ phá cấu trúc CSV. */
      name: cus?.short_name ?? '',
    });
  }
  return out;
}
