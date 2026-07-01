# Pattern: thẻ khách hàng theo khu vực (gradient header + accordion)

**Dùng khi nào:** bất cứ lúc nào cần hiển thị một danh sách khách hàng/đối tượng có thể
**gộp theo nhóm** (khu công nghiệp, phòng ban, dự án…) và cho phép **thu gọn/mở từng nhóm**,
với khả năng mở rộng từng dòng để xem chi tiết con (công tơ, hóa đơn, hạng mục…).

Nhân bản trực tiếp từ `CustomerDebtManager.tsx` (bảng "Công nợ khách hàng") — nơi pattern này
ra đời đầu tiên. Đã được đóng gói thành component dùng chung, **KHÔNG viết lại tay** ở nơi khác.

## Component

`src/components/ui/dashboard.tsx` → `CustomerZoneCard`

```tsx
import { CustomerZoneCard, type ZoneCustomerRow } from './ui/dashboard';

<CustomerZoneCard
  icon={Building2}                 // icon trong badge tròn ở header (mặc định Building2)
  title="KCN Tiền Hải"             // tên nhóm
  subtitle="12 khách hàng"         // dòng phụ dưới tên
  kwh={z.kwh}                      // tổng sản lượng cả nhóm (hiện ở góc phải header)
  vnd={z.vnd}                      // tổng doanh thu cả nhóm
  rows={z.rows}                    // ZoneCustomerRow[]
  collapsed={!!collapsedZones[z.code]}
  onToggleCollapse={() => setCollapsedZones(c => ({ ...c, [z.code]: !c[z.code] }))}
  expandedRows={expanded}          // Record<mkh, boolean> — dòng khách nào đang mở chi tiết công tơ
  onToggleRow={mkh => setExpanded(e => ({ ...e, [mkh]: !e[mkh] }))}
  emptyLabel="Không có dữ liệu"    // tuỳ chọn
/>
```

`ZoneCustomerRow`:
```ts
interface ZoneCustomerRow {
  mkh: string; name: string; curKwh: number; curVnd: number; delta: number | null;
  meterList: Array<{ sct: string; addr: string; curKwh: number; curVnd: number; delta: number | null }>;
}
```

- Nhiều nhóm → render nhiều `CustomerZoneCard` trong một `<div className="space-y-4">` (xem
  `BusinessSummaryDashboard.tsx`, phần "Sản lượng & doanh thu theo khách hàng").
- Chỉ một nhóm (không cần chia nhóm) → vẫn dùng `CustomerZoneCard`, coi cả bảng là 1 "nhóm"
  (title = tên khu vực người dùng, xem `SummaryDashboard.tsx`).
- `DeltaBadge` (mũi tên xanh/đỏ %) cũng được export từ cùng file — dùng độc lập nếu cần
  hiển thị % tăng giảm ở nơi khác.

## Cấu trúc thị giác

- **Card ngoài:** `.vl-card overflow-hidden` (bo góc + viền + shadow chuẩn hệ thống).
- **Header:** dải gradient accent (`from-[var(--accent)] to-[var(--accent-hover)]`), có thể bấm
  để thu gọn/mở. Bên trái: icon tròn nền trắng mờ (`bg-white/20`) + tên nhóm (đậm, trắng) + phụ đề.
  Bên phải: tổng kWh/₫ của nhóm (ẩn ở màn hình rất nhỏ), rồi chevron xoay theo trạng thái.
- **Thu gọn/mở:** `motion.div` với `height: 0 ↔ 'auto'` (không dùng CSS `.vl-accordion` thuần —
  animation mượt hơn khi nội dung là bảng nhiều dòng).
- **Bảng bên trong:** header `bg-subtle/50` chữ hoa nhỏ muted; dòng khách bấm để mở dòng con
  (chevron xoay 90°, dòng nền `bg-accent-soft/50` khi mở); dòng con (công tơ) thụt lề, viền trái
  3px `border-l-accent/40`, nền `bg-accent-soft/10`, dòng con cuối có viền đáy đậm để khép nhóm.
- **Tổng cộng:** `<tfoot>` với viền trên đậm (`border-t-2 border-[var(--border-strong)]`), chữ đậm.

## Khi nào KHÔNG dùng pattern này

- Danh sách phẳng không cần nhóm và không cần dòng con chi tiết → dùng bảng `.vl-table` thường
  trong một `Panel` (xem các bảng "Top khách hàng" không có accordion).
- Accordion đơn giản không liên quan khách hàng (menu, FAQ…) → dùng `.vl-accordion` thuần trong
  `index.css`, không cần kéo theo toàn bộ logic bảng của `CustomerZoneCard`.

## Nơi đang dùng (2026-06-30)

- `CustomerDebtManager.tsx` — bản gốc (chưa refactor sang component dùng chung, giữ nguyên vì
  có thêm nghiệp vụ riêng: chỉnh ngày thanh toán, lưu thay đổi hàng loạt).
- `SummaryDashboard.tsx` — bảng "Sản lượng & doanh thu theo khách hàng" (1 card, không chia nhóm).
- `BusinessSummaryDashboard.tsx` — cùng bảng nhưng chia nhiều card theo khu công nghiệp.
