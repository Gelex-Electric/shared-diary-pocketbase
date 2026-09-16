/**
 * Những thứ dùng chung của các màn HES: hình dạng một dòng công tơ, một ô sản
 * lượng đã tính, và mấy hàm định dạng.
 *
 * Trước 16/09/2026 chúng nằm trong `useHesConsumption.ts` — hook của tab "Số
 * liệu đã chốt". Tab đó đã bỏ, nhưng tab "Gọi HES ngay" và bảng sản lượng vẫn
 * cần, nên tách ra đây thay vì bắt một hook đã chết sống tiếp chỉ vì vài hàm.
 */

export interface MeterRow {
  id: string;
  MeterNo: string;
  HSN: string;
  Line: string;
  area: string;
  /** TÊN TẮT khách hàng (`dm_customer.short_name`); rỗng thì lùi về tên đầy đủ. */
  Customer?: string;
}

/** Một ô sản lượng đã tính xong — hình dạng tối thiểu mà bảng cần. */
export interface ConsumptionCell {
  startTime: string;
  endTime: string;
  hsn: number;
  values: Record<string, number | null>;
}

/** Số → chuỗi kiểu Việt Nam, `null` thành gạch ngang. */
export const fmt = (val: number | null) =>
  val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** "YYYY-MM-DD HH:mm:ss" → "dd/MM HH:mm"; rỗng thành gạch ngang. */
export const fmtTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Id công tơ tiêu thụ lớn nhất (để tô nổi bật). '' nếu chưa có số nào. */
export function maxTotalMeterId(
  rows: MeterRow[],
  consumptions: Map<string, ConsumptionCell | null>,
): string {
  let bestId = ''; let best = -Infinity;
  for (const m of rows) {
    const total = consumptions.get(m.MeterNo)?.values.PG ?? null;
    if (total !== null && total > best) { best = total; bestId = m.id; }
  }
  return best > 0 ? bestId : '';
}

/** Một dòng cho file Excel. Dùng chung để các màn xuất cùng bộ cột. */
export const toExportRow = (m: MeterRow, c?: ConsumptionCell | null) => ({
  'Số công tơ':        m.MeterNo,
  'Trạm':              m.Line || '',
  'Hệ số nhân':        m.HSN || '',
  'Thời gian đầu kỳ':  fmtTime(c?.startTime),
  'Thời gian cuối kỳ': fmtTime(c?.endTime),
  'Tổng (kWh)':        c?.values.PG ?? '',
  'Biểu 1 (kWh)':      c?.values.BT ?? '',
  'Biểu 2 (kWh)':      c?.values.CD ?? '',
  'Biểu 3 (kWh)':      c?.values.TD ?? '',
  'Vô công (kVarh)':   c?.values.VC ?? '',
});

/**
 * BỘ CỘT DÙNG CHUNG cho hai bảng chỉ số (30 phút và theo hóa đơn) — user chốt
 * 16/09/2026: hai bảng phải giống hệt nhau về cột và cách căn, để đọc quen mắt
 * rồi chuyển tab không phải dò lại.
 *
 *   Số công tơ · Khách hàng (tên tắt) · HSN · Đầu kỳ · Cuối kỳ
 *   Tổng (kWh) · Biểu 1 · Biểu 2 · Biểu 3 · VC
 *
 * Bốn cột số cuối bày HAI TẦNG: sản lượng ở trên (số người dùng cần), chỉ số
 * thô "đầu → cuối" ở dưới cỡ nhỏ (để đối chiếu với biên bản).
 */
export const INDEX_COLUMNS = (
  <>
    <th className="w-[120px]">Số công tơ</th>
    <th className="w-[150px]">Khách hàng</th>
    <th className="w-[70px] text-center">HSN</th>
    <th className="w-[110px] text-center">Đầu kỳ</th>
    <th className="w-[110px] text-center">Cuối kỳ</th>
    <th className="w-[110px] text-center border-x border-[var(--border)]">Tổng (kWh)</th>
    <th className="w-[105px] text-center">Biểu 1</th>
    <th className="w-[105px] text-center">Biểu 2</th>
    <th className="w-[105px] text-center">Biểu 3</th>
    <th className="w-[105px] text-center">VC</th>
  </>
);

/** Bề ngang tối thiểu trước khi cho cuộn ngang — chung cho cả hai bảng. */
export const INDEX_MIN_WIDTH = 1090;

/** Ô số hai tầng: sản lượng ở trên, chỉ số thô đầu → cuối ở dưới. */
export function ValueCell({ value, dau, cuoi, tone = 'text-ink', strong = false }: {
  value: number | null;
  dau?: number | string | null;
  cuoi?: number | string | null;
  tone?: string;
  strong?: boolean;
}) {
  const has = dau != null && dau !== '' && cuoi != null && cuoi !== '';
  return (
    <>
      <div className={`${strong ? 'text-sm font-extrabold' : 'text-xs font-bold'} ${tone}`}>
        {fmt(value)}
      </div>
      {has && (
        <div className="text-[10px] font-mono text-faint whitespace-nowrap">
          {fmtIdx(dau)} → {fmtIdx(cuoi)}
        </div>
      )}
    </>
  );
}

/** Chỉ số thô giữ nguyên phần thập phân — đây là con số trên biên bản. */
export const fmtIdx = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? '—' : n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
};
