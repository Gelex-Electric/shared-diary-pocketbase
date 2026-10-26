/**
 * VIỆC CẦN LÀM — luồng cấp vật tư (đợt 4, 26/10/2026). MỘT màn nhận prop
 * `group` (nguyên tắc 17), không chép theo nhóm:
 *   - kinh_doanh: điểm đo mới chưa khai nhu cầu vật tư.
 *   - vat_tu    : điểm đo thiếu vật tư, đơn mua trễ, TI chưa khai hình dạng.
 *   - van_hanh  : chính là màn Chờ treo (`HangPoints`).
 * Thanh số liệu trên cùng cho mọi nhóm thấy cả luồng đang dồn ở bước nào.
 */
import { ClipboardList, PackageSearch, Truck, Wrench, CheckCircle2, ArrowRight } from 'lucide-react';
import { StatTile, EmptyState } from '../ui/dashboard';
import HangPoints from './HangPoints';
import { dmy } from '../../lib/dm/lifecycle';
import { openBorrowsByPoint, type SupplyTasks as Tasks } from '../../lib/dm/supply';
import type { CatalogData } from '../../lib/dm/repo';
import type { Point } from '../../lib/dm/types';
import type { UserGroup } from '../../lib/userGroup';

export default function SupplyTasks({ group, tasks, data, onNavigate, onChanged }: {
  group: UserGroup;
  tasks: Tasks | null;
  data: CatalogData | null;
  /** Mở màn xử lý (mã tab của dashboard đang chứa màn này). */
  onNavigate?: (tab: string) => void;
  onChanged?: () => void;
}) {
  if (group === 'van_hanh') return <HangPoints scope="doi" onChanged={onChanged} />;

  const borrowed = openBorrowsByPoint(data?.borrows ?? []);
  const t = tasks;
  const go = (tab: string, label: string) => onNavigate && (
    <button className="vl-btn vl-btn-sm vl-btn-outline-primary flex items-center gap-1.5" onClick={() => onNavigate(tab)}>
      {label} <ArrowRight className="h-4 w-4" />
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-ink">Việc cần làm</h2>
        <p className="mt-1 text-sm text-soft">
          Luồng cấp vật tư điểm đo mới: Kinh Doanh khai nhu cầu → Vật Tư phân bổ / đặt mua → Vận Hành treo
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Chưa khai nhu cầu" value={t?.chuaKhai.length ?? '…'} icon={ClipboardList}
          tone={group === 'kinh_doanh' && t?.chuaKhai.length ? 'warn' : 'neutral'} loading={!t} sub="Kinh Doanh" />
        <StatTile label="Thiếu vật tư" value={t?.thieu.length ?? '…'} icon={PackageSearch}
          tone={group === 'vat_tu' && t?.thieu.length ? 'warn' : 'neutral'} loading={!t} sub="Vật Tư" />
        <StatTile label="Chờ hàng về" value={t?.choHang.length ?? '…'} icon={Truck}
          tone={t?.lateOrders.length ? 'bad' : 'neutral'} loading={!t}
          sub={t?.lateOrders.length ? `${t.lateOrders.length} đơn trễ` : 'Vật Tư'} />
        <StatTile label="Đủ – chờ treo" value={t?.choTreo.length ?? '…'} icon={Wrench} tone="neutral"
          loading={!t} sub="Vận Hành" />
      </div>

      {t && group === 'kinh_doanh' && (
        <PointList title={`Điểm đo chưa khai nhu cầu vật tư (${t.chuaKhai.length})`} points={t.chuaKhai}
          hint="Mở Quản lý chung → Điểm đo, sửa điểm đo và khai khối “Nhu cầu vật tư” (nút “Điền theo HSN”)."
          action={go('dm-catalog', 'Mở Quản lý chung')} empty="Mọi điểm đo mới đã khai nhu cầu." />
      )}

      {t && group === 'vat_tu' && (<>
        <PointList title={`Điểm đo thiếu vật tư (${t.thieu.length})`} points={t.thieu} borrowed={borrowed}
          hint="Phân bổ từ kho, điểm đo cần gấp có thể mượn; kho không còn thì đặt mua."
          action={go('supply-alloc', 'Phân bổ vật tư')} empty="Không có điểm đo nào thiếu vật tư." />
        {t.lateOrders.length > 0 && (
          <div className="vl-card space-y-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-ink">Đơn mua trễ hẹn ({t.lateOrders.length})</p>
              {go('purchase', 'Đặt mua vật tư')}
            </div>
            <div className="flex flex-wrap gap-2 text-[13px]">
              {t.lateOrders.map(o => (
                <span key={o.id} className="vl-badge-danger">{o.code} · hẹn {dmy(o.expected_at)}</span>
              ))}
            </div>
          </div>
        )}
        {t.tiNoShape > 0 && (
          <div className="vl-alert vl-alert-light-warning flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span><b>{t.tiNoShape}</b> TI chưa khai hình dạng (tròn/vuông) — khai dần ở Kho vật tư (lọc TI → “Chưa rõ hình dạng”).</span>
            {go('dm-catalog', 'Mở Kho vật tư')}
          </div>
        )}
      </>)}
    </div>
  );
}

function PointList({ title, points, hint, action, empty, borrowed }: {
  title: string; points: Point[]; hint: string; action?: React.ReactNode; empty: string;
  borrowed?: Map<string, number>;
}) {
  return (
    <div className="vl-card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-ink">{title}</p>
          <p className="text-[12px] text-soft">{hint}</p>
        </div>
        {action}
      </div>
      {points.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={empty} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {points.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-subtle px-2.5 py-1.5 text-[12px]">
              <span className="font-mono font-semibold text-ink">{p.code}</span>
              {p.urgent && <span className="vl-badge-danger">gấp{p.needed_by ? ` ${dmy(p.needed_by)}` : ''}</span>}
              {(borrowed?.get(p.id) ?? 0) > 0 && <span className="vl-badge-primary">bị mượn</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
