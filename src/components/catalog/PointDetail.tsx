import {
  Gauge, Building2, MapPin, User, History, AlertTriangle, Users, Package,
} from 'lucide-react';
import { hsnOfPoint, hsnExplain } from '../../lib/hsn';
import {
  type CatalogData, type Point, POINT_STATUS_LABEL, viDate, periodsOfPoint,
  assetsAtPoint, isOverdue, ASSET_TYPE_LABEL, isMeter,
} from '../../lib/catalog';


/** Bảng chi tiết một điểm đo: trạm, khách hàng theo kỳ, HSN, cảnh báo. */
export default function PointDetail({
  point, data, canEditNow = false, picked, onPick,
}: {
  point: Point | null;
  data: CatalogData;
  canEditNow?: boolean;
  /** Vật tư đang tích chọn (dùng chung với ngăn kho) */
  picked?: Set<string>;
  onPick?: (s: Set<string>) => void;
}) {
  if (!point) {
    return (
      <div className="vl-card flex flex-col items-center justify-center py-20 text-faint h-full">
        <Gauge className="w-14 h-14 mb-4 opacity-20" />
        <p className="font-semibold">Chọn một điểm đo để xem chi tiết</p>
      </div>
    );
  }

  const station = data.stations.find(s => s.id === point.station);
  const zone = data.zones.find(z => z.id === point.zone);
  const periods = periodsOfPoint(data.periods, point.id);
  const at = assetsAtPoint(data, point.id);

  // Điểm đo cùng trạm — để thấy ngay ca "1 trạm nhiều điểm đo, khác khách"
  const siblings = station
    ? data.points.filter(p => p.station === station.id && p.id !== point.id)
    : [];

  const hsn = hsnOfPoint(data, point.id);
  const hsnBad = point.hsn_invoice === 0 || (point.hsn_invoice ?? 0) > 100000;

  return (
    <div className="vl-card p-5 space-y-5 h-full overflow-y-auto">

      {/* Tiêu đề */}
      <div>
        <h3 className="text-lg font-bold text-ink break-words">{point.line_name || '—'}</h3>
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${point.role === 'chinh' ? 'vl-badge-primary' : 'bg-subtle text-faint'}`}>
            {point.role === 'chinh' ? 'Điểm đo chính' : point.role === 'phu' ? 'Điểm đo phụ' : '—'}
          </span>
          <span className="vl-badge-info text-xs font-bold px-2 py-0.5 rounded">
            {POINT_STATUS_LABEL[point.point_status] ?? point.point_status}
          </span>
          {zone && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-subtle text-soft flex items-center gap-1">
              <MapPin className="w-3 h-3" />{zone.code}
            </span>
          )}
        </div>
      </div>

      {/* Trạm */}
      <section>
        <p className="vl-section-title flex items-center gap-2"><Building2 className="w-4 h-4" />Trạm / MBA</p>
        {station ? (
          <div className="mt-2 text-sm">
            <p className="font-semibold text-ink">{station.code}</p>
            <p className="text-soft mt-1">
              {station.sdm_kva ? `Sdm ${station.sdm_kva} kVA` : 'Chưa có thông số MBA'}
              {station.p0_kw != null && ` · P0 ${station.p0_kw} kW`}
              {station.pk_kw != null && ` · Pk ${station.pk_kw} kW`}
            </p>
            {siblings.length > 0 && (
              <p className="text-xs text-faint mt-2">
                Trạm này còn {siblings.length} điểm đo khác: {siblings.map(s => s.line_name).join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-start gap-2 text-sm text-warn">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Chưa gắn trạm — cần gắn thủ công theo bản vẽ một sợi.</span>
          </div>
        )}
      </section>

      {/* Hệ số nhân */}
      <section>
        <p className="vl-section-title flex items-center gap-2"><Gauge className="w-4 h-4" />Hệ số nhân</p>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-faint">Theo hóa đơn</p>
            <p className={`font-mono font-bold ${hsnBad ? 'text-bad' : 'text-ink'}`}>
              {point.hsn_invoice ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-faint">Suy từ TI × TU</p>
            <p className="font-mono font-bold text-faint" title={hsnExplain(hsn)}>
              {hsn.value ?? 'chưa có'}{hsn.missingRatio.length ? ' ⚠' : ''}
            </p>
          </div>
        </div>
        {hsnBad && (
          <p className="mt-2 text-xs text-bad flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Giá trị hệ số nhân bất thường — sẽ được xác minh khi nhập đủ TI/TU.
          </p>
        )}
      </section>

      {/* Khách hàng theo kỳ */}
      <section>
        <p className="vl-section-title flex items-center gap-2"><History className="w-4 h-4" />Lịch sử khách hàng ({periods.length} kỳ)</p>
        {periods.length === 0 ? (
          <p className="mt-2 text-sm text-faint">Chưa có kỳ khách hàng nào (điểm đo phụ, hoặc công tơ chưa phát sinh hóa đơn).</p>
        ) : (
          <div className="mt-2 space-y-2">
            {periods.map(pr => {
              const cus = data.customers.find(c => c.id === pr.customer);
              return (
                <div
                  key={pr.id}
                  className={`p-3 rounded border text-sm ${pr.is_current ? 'border-accent bg-accent-soft' : 'border-[var(--border)]'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <User className="w-3.5 h-3.5 text-soft shrink-0" />
                    <span className="font-mono text-xs font-bold text-soft">{pr.mkh}</span>
                    {pr.is_current && <span className="vl-badge-success text-[0.65rem] font-bold px-1.5 py-0.5 rounded">HIỆN TẠI</span>}
                    {pr.shared && (
                      <span className="vl-badge-warning text-[0.65rem] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Users className="w-3 h-3" />DÙNG CHUNG
                      </span>
                    )}
                  </div>
                  <p className="text-ink font-semibold mt-1">{cus?.name || '—'}</p>
                  <p className="text-xs text-faint mt-1">{viDate(pr.from_date)} → {viDate(pr.to_date)}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Vật tư đang treo */}
      <section>
        <p className="vl-section-title flex items-center gap-2"><Package className="w-4 h-4" />Vật tư đang treo ({at.length})</p>
        {at.length === 0 ? (
          <p className="mt-2 text-sm text-faint">Chưa có vật tư nào. Tích chọn vật tư ở ngăn kho rồi bấm "Treo lên điểm đo".</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {at.map(({ install, asset }) => {
              if (!asset) return null;
              const overdue = isOverdue(asset);
              const on = picked?.has(asset.id) ?? false;
              return (
                <label key={install.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border text-sm ${canEditNow ? 'cursor-pointer' : ''} ${
                    on ? 'border-accent bg-accent-soft'
                      : overdue ? 'border-[var(--danger)]/40 bg-[var(--danger-soft)]'
                      : 'border-[var(--border)]'
                  }`}>
                  {canEditNow && onPick && (
                    <input type="checkbox" checked={on} className="w-3.5 h-3.5 shrink-0"
                      onChange={() => {
                        const n = new Set(picked ?? []);
                        if (n.has(asset.id)) n.delete(asset.id); else n.add(asset.id);
                        onPick(n);
                      }} />
                  )}
                  <span className="font-mono text-xs font-bold text-accent shrink-0">{asset.serial}</span>
                  <span className="text-[0.7rem] text-faint shrink-0">{ASSET_TYPE_LABEL[asset.type]}</span>
                  {asset.ratio ? <span className="text-[0.7rem] text-soft shrink-0">tỷ số {asset.ratio}</span> : null}
                  <span className="flex-1" />
                  <span className="text-[0.7rem] text-faint shrink-0">từ {viDate(install.from_date)}</span>
                  {overdue && (
                    <span className="text-[0.65rem] font-bold text-bad shrink-0"
                      title={`Hạn kiểm định ${asset.next_calibration?.slice(0, 10)}`}>quá hạn KĐ</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {!at.some(x => x.asset && isMeter(x.asset.type)) && (
          <p className="mt-2 text-xs text-warn flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />Điểm đo chưa có công tơ.
          </p>
        )}
        {!at.some(x => x.asset?.type === 'GP03') && (
          <p className="mt-1 text-xs text-faint flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />Chưa khai GP-03 (thiết bị thu thập dữ liệu).
          </p>
        )}
      </section>
    </div>
  );
}
