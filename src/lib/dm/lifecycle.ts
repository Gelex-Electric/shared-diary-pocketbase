/**
 * Vòng đời vật tư suy từ hóa đơn — module THUẦN.
 *
 * Không gọi mạng, không JSX, không đụng PocketBase: chỗ DUY NHẤT chứa luật cắt
 * chặng, để kiểm chứng được bằng script mà không phải dựng giao diện.
 *
 * KHÁI NIỆM "CHẶNG" (segment): một số công tơ + một mã khách hàng = một chặng.
 * Cùng một số công tơ có thể tái sử dụng cho khách khác, nên phải tách theo
 * `MKHang` chứ không gộp chung.
 *
 * ⚠️ Chặng KHÔNG PHẢI ngày treo / ngày tháo. Công tơ treo TRƯỚC rồi mới bắt đầu
 * dùng điện, và tháo SAU khi ngừng dùng điện. Chặng chỉ trả lời "quãng nào có
 * phát sinh tiền điện" — dùng làm THAM CHIẾU để đối chiếu với ngày khai tay,
 * không được tự điền vào form (user chốt 20/08/2026).
 */

/** Các cột invoice mà module này cần — trùng `fields=` của `invoiceRepo`. */
export interface InvoiceLite {
  SCT: string;
  MKHang: string;
  HSN?: number;
  StartDate?: string;
  EndDate?: string;
  ThTien?: number;
  LoaiHD?: string;
}

export interface Segment {
  /** Mã khách hàng dùng công tơ này trong quãng đó. */
  mkh: string;
  /** Ngày đầu tiên có phát sinh tiền điện, `YYYY-MM-DD`. */
  from: string;
  /** Ngày cuối cùng có phát sinh tiền điện, `YYYY-MM-DD`. */
  to: string;
  /** Số hóa đơn tính vào chặng. */
  count: number;
  /** HSN của kỳ MỚI NHẤT trong chặng — hóa đơn là nguồn chuẩn nhất cho HSN. */
  hsn?: number;
  /**
   * Mọi HSN từng dùng trong chặng, theo thứ tự thời gian. Nhiều hơn 1 giá trị
   * nghĩa là HSN đã đổi giữa chừng (thay TI, hoặc sửa sai) — phải nói cho người
   * dùng biết thay vì im lặng lấy cái cuối.
   */
  hsnHistory: number[];
  /**
   * Kỳ cuối nằm trong `RECENT_DAYS` ngày gần đây ⇒ công tơ còn đang phát sinh
   * tiền điện.
   */
  isCurrent: boolean;
}

/** `"2026-08-11 00:00:00.000Z"` → `"2026-08-11"`. Rỗng/thiếu → `''`. */
export const ymd = (v?: string): string => (v ? String(v).slice(0, 10) : '');

/**
 * Hóa đơn có được tính vào chặng không.
 *
 * Tính CẢ HC lẫn VC — hóa đơn vô công cũng chứng tỏ công tơ đang đo ở đó. Bỏ
 * hóa đơn `ThTien <= 0` vì không chứng minh được đang vận hành (user chốt 20/08).
 */
export const counts = (i: InvoiceLite): boolean =>
  (i.ThTien ?? 0) > 0 && !!ymd(i.StartDate) && !!ymd(i.EndDate);

/**
 * Cửa sổ "còn đang phát sinh": hóa đơn kỳ cuối cách hôm nay không quá bao nhiêu
 * ngày thì coi như công tơ vẫn đang chạy.
 *
 * Trước 20/08/2026 luật này là "rơi vào tháng hiện tại", nhưng hóa đơn thường
 * chốt cuối tháng và phát hành trễ — sang ngày 1 là mọi công tơ đang chạy đều
 * bị coi là ngừng. 40 ngày phủ trọn một kỳ cộng thời gian phát hành trễ.
 */
export const RECENT_DAYS = 40;

/** Mốc `YYYY-MM-DD` sớm nhất còn được coi là "gần đây" so với `today`. */
export function recentSince(today: Date): string {
  const d = new Date(today.getTime());
  d.setDate(d.getDate() - RECENT_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Cắt danh sách hóa đơn CỦA MỘT SỐ CÔNG TƠ thành các chặng theo khách hàng.
 * Chặng xếp theo `from` tăng dần.
 *
 * `today` chỉ dùng để biết chặng có còn "đang chạy" không; mặc định là hôm nay.
 */
export function segmentsOf(invoices: InvoiceLite[], today = new Date()): Segment[] {
  const since = recentSince(today);
  const byMkh = new Map<string, InvoiceLite[]>();

  for (const inv of invoices) {
    if (!counts(inv)) continue;
    const list = byMkh.get(inv.MKHang);
    if (list) list.push(inv);
    else byMkh.set(inv.MKHang, [inv]);
  }

  const segments: Segment[] = [];
  for (const [mkh, rows] of byMkh) {
    // Xếp theo kỳ để lấy HSN của kỳ mới nhất và dựng lịch sử HSN đúng thứ tự.
    const sorted = [...rows].sort((a, b) => (ymd(a.EndDate) < ymd(b.EndDate) ? -1 : 1));
    const hsnHistory: number[] = [];
    for (const r of sorted) {
      if (r.HSN != null && hsnHistory[hsnHistory.length - 1] !== r.HSN) hsnHistory.push(r.HSN);
    }
    const from = sorted.reduce((m, r) => (ymd(r.StartDate) < m ? ymd(r.StartDate) : m), ymd(sorted[0].StartDate));
    const to = ymd(sorted[sorted.length - 1].EndDate);

    segments.push({
      mkh,
      from,
      to,
      count: sorted.length,
      hsn: hsnHistory[hsnHistory.length - 1],
      hsnHistory,
      isCurrent: to >= since,
    });
  }

  return segments.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Chặng của đúng một khách hàng. Không có ⇒ `undefined`, KHÔNG lấy tạm chặng khác. */
export const segmentOf = (segments: Segment[], mkh?: string): Segment | undefined =>
  mkh ? segments.find(s => s.mkh === mkh) : undefined;

/**
 * Các cặp chặng CHỒNG LẤN thời gian nhau. Một công tơ không thể cùng lúc đo cho
 * hai khách ⇒ chồng lấn là dấu hiệu dữ liệu sai, phải báo chứ không tự gộp.
 */
export function overlaps(segments: Segment[]): [Segment, Segment][] {
  const pairs: [Segment, Segment][] = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (a.from <= b.to && b.from <= a.to) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Nhóm hóa đơn theo số công tơ — dùng cho màn vòng đời (tra hàng loạt). */
export function bySerial(invoices: InvoiceLite[]): Map<string, InvoiceLite[]> {
  const map = new Map<string, InvoiceLite[]>();
  for (const inv of invoices) {
    const list = map.get(inv.SCT);
    if (list) list.push(inv);
    else map.set(inv.SCT, [inv]);
  }
  return map;
}
