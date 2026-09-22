/**
 * Phụ tải theo LỘ ĐƯỜNG DÂY — cộng công suất các trạm trên cùng một lộ.
 *
 * Module THUẦN: không gọi mạng, nhận sẵn `CatalogData` và các bản đọc đã parse.
 *
 * HAI CHỖ RẤT DỄ LÀM SAI, và đây là lý do file này tồn tại thay vì cộng tạm
 * trong component:
 *
 * 1. **Pmax của lộ KHÔNG phải tổng Pmax các trạm.** Các trạm đạt đỉnh ở những
 *    giờ khác nhau, nên phải cộng P theo TỪNG MỐC rồi mới lấy max của tổng
 *    (đỉnh trùng thời điểm). Đo trên dữ liệu thật ngày 21/09/2026: cộng các
 *    Pmax riêng lẻ cho ra số vống lên 3–25% tuỳ lộ (lộ 479E28.24 lệch 25,1%).
 *    Con số vống đó nếu dùng để chọn tiết diện dây hay máy cắt là tốn tiền thật.
 *
 * 2. **Phải GOM VỀ MỐC 30 PHÚT trước khi cộng.** Đồng hồ công tơ lệch nhau
 *    1–2 phút nên cùng một "mốc 10:00" thực tế nằm rải ở 10:00, 10:01, 10:02.
 *    Cộng theo mốc thô thì mỗi ô chỉ có vài công tơ và tổng bị HỤT: đo ngày
 *    21/09/2026 ra 134 mốc khác nhau trong một ngày (chỉ 47 mốc chuẩn), Pmax lộ
 *    479E28.24 hụt 135 kW (7,6%) và 472E28.6 hụt 168 kW (4,5%).
 *
 * 3. **Chỉ cộng điểm đo CHÍNH.** Điểm đo phụ nằm TRONG phạm vi đo của điểm
 *    chính (xem `PointRole`), cộng cả hai là đếm trùng. Trên dữ liệu thật có 44
 *    công tơ ở điểm đo phụ — cộng vào thì phụ tải lộ phồng lên vô căn cứ.
 */
import type { CatalogData } from './repo';

/** Một mốc đo = 30 phút. */
const SLOT_MS = 30 * 60 * 1000;

/**
 * Nhãn `HH:mm` của một mốc đã gom.
 *
 * Suy từ chính mốc chứ không lấy nhãn của bản đọc gốc: bản gốc mang giờ lệch
 * (10:01, 10:02) nên trục hoành sẽ lởm chởm và hai công tơ cùng một mốc lại
 * hiện hai nhãn khác nhau.
 */
const labelOf = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Một bản đọc 30 phút của một công tơ. Khớp hình dạng `datametter.csv`. */
export interface Reading {
  /** Mốc thời gian đã sắp được, dùng để xếp thứ tự. */
  t: number;
  /** Nhãn giờ `HH:mm`. */
  label: string;
  /** Công suất tác dụng, kW — đã ×HSN từ lúc pipeline ghi. */
  kw: number;
}

/** Danh sách công tơ của từng lộ, CHỈ điểm đo chính. */
export interface LineMeters {
  lineId: string;
  /** Số công tơ ở điểm đo chính thuộc lộ này. */
  serials: string[];
}

/**
 * Công tơ theo lộ: `dm_asset` (CONGTO) → `dm_point` → `dm_station` → `dm_line`.
 *
 * Bỏ điểm đo PHỤ (xem ghi chú đầu file). Bỏ công tơ chưa gắn điểm đo, điểm đo
 * chưa gắn trạm, và trạm chưa gắn lộ — không đoán, thiếu mắt xích nào thì
 * không xếp được vào lộ nào.
 */
export function lineMetersOf(d: CatalogData): Map<string, string[]> {
  const stationById = new Map(d.stations.map(s => [s.id, s]));
  const pointById = new Map(d.points.map(p => [p.id, p]));
  const out = new Map<string, string[]>();

  for (const a of d.assets) {
    if (a.type !== 'CONGTO' || !a.point) continue;
    const point = pointById.get(a.point);
    if (!point || point.role !== 'chinh') continue;
    const station = point.station ? stationById.get(point.station) : undefined;
    if (!station?.line) continue;
    const list = out.get(station.line);
    if (list) list.push(a.serial);
    else out.set(station.line, [a.serial]);
  }
  return out;
}

/** Một mốc trên đường phụ tải của lộ. */
export interface LinePoint {
  t: number;
  label: string;
  /** Tổng P của các trạm trên lộ tại mốc này, kW. */
  p: number;
  /** Số công tơ thực sự có số liệu tại mốc này. */
  n: number;
}

export interface LineSeries {
  data: LinePoint[];
  /** Đỉnh TRÙNG THỜI ĐIỂM — max của tổng, không phải tổng của max. */
  peakP: number;
  peakLabel: string;
  /** Số công tơ có dữ liệu / tổng số công tơ của lộ. */
  covered: number;
  total: number;
  /**
   * Tổng các Pmax riêng lẻ. KHÔNG dùng làm Pmax của lộ — giữ lại chỉ để màn
   * hình nói được "thấp hơn tổng các đỉnh riêng lẻ bao nhiêu", cho người đọc
   * thấy hệ số đồng thời chứ không phải tin suông.
   */
  sumOfPeaks: number;
}

/**
 * Đường phụ tải của một lộ trong một ngày.
 *
 * `readingsOf` trả các bản đọc của MỘT công tơ trong ngày đang xét, hoặc
 * `undefined` nếu công tơ đó không có số liệu.
 *
 * Mốc thời gian lấy HỢP của mọi công tơ chứ không lấy giao: công tơ đọc thưa
 * hoặc mất một vài mốc thì lấy giao sẽ cắt cụt cả đường phụ tải của lộ. Tại mốc
 * một công tơ không có số liệu thì coi phần đóng góp của nó bằng 0 và ghi lại
 * `n` để màn hình nói rõ mốc đó dựa trên mấy công tơ.
 */
export function buildLineSeries(
  serials: string[],
  readingsOf: (serial: string) => Reading[] | undefined,
): LineSeries {
  const lists = serials
    .map(s => readingsOf(s))
    .filter((x): x is Reading[] => !!x && x.length > 0);

  if (lists.length === 0) {
    return { data: [], peakP: 0, peakLabel: '', covered: 0, total: serials.length, sumOfPeaks: 0 };
  }

  /*
    Gom về mốc 30 phút TRƯỚC khi cộng (xem ghi chú 2 đầu file).

    Mỗi công tơ chỉ góp MỘT giá trị cho mỗi mốc: công tơ báo cả 10:01 lẫn 10:02
    thì cộng cả hai là đếm trùng chính nó. Lấy giá trị LỚN NHẤT trong mốc — đây
    là bài toán tìm ĐỈNH phụ tải, lấy trung bình sẽ làm tròn mất đỉnh.
  */
  const byTime = new Map<number, LinePoint>();
  for (const list of lists) {
    const perSlot = new Map<number, number>();
    for (const r of list) {
      const slot = Math.round(r.t / SLOT_MS) * SLOT_MS;
      const cur = perSlot.get(slot);
      if (cur === undefined || r.kw > cur) perSlot.set(slot, r.kw);
    }
    for (const [slot, kw] of perSlot) {
      const cur = byTime.get(slot);
      if (cur) { cur.p += kw; cur.n += 1; }
      else byTime.set(slot, { t: slot, label: labelOf(slot), p: kw, n: 1 });
    }
  }

  const data = [...byTime.values()].sort((a, b) => a.t - b.t);

  let peakP = 0;
  let peakLabel = '';
  for (const d of data) {
    if (d.p > peakP) { peakP = d.p; peakLabel = d.label; }
  }

  /* Đỉnh riêng lẻ của từng công tơ — KHÔNG gom mốc vì mỗi công tơ tự nó đã
     nhất quán; gom mốc chỉ cần khi CỘNG nhiều công tơ với nhau. */
  const sumOfPeaks = lists.reduce((n, list) => n + Math.max(...list.map(r => r.kw)), 0);

  return { data, peakP, peakLabel, covered: lists.length, total: serials.length, sumOfPeaks };
}

/**
 * Hệ số đồng thời = Pmax lộ / tổng các Pmax riêng lẻ.
 *
 * Luôn ≤ 1. Càng nhỏ nghĩa là các trạm càng ít khi cùng đạt đỉnh một lúc.
 * Trả `null` khi chưa đủ số liệu — thà không hiện còn hơn hiện một số bịa.
 */
export function diversityFactor(s: LineSeries): number | null {
  if (!s.sumOfPeaks || !s.peakP) return null;
  return s.peakP / s.sumOfPeaks;
}
