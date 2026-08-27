/**
 * Card chi tiết của màn "Quản lý chung" — hiện thông tin của phần tử vừa bấm
 * bên sơ đồ cây (user chốt 25/08/2026).
 *
 *   KCN     → tổng số trạm, tổng số điểm đo, phân bố trạng thái điểm đo
 *   Trạm    → số điểm đo chính/phụ, tình trạng vận hành hiện tại
 *   Điểm đo → vật tư đang gắn + vòng đời từng công tơ theo hóa đơn
 *
 * CHỈ ĐỌC. Dữ liệu danh mục lấy từ `CatalogData` mà `DataTree` đã nạp sẵn —
 * không gọi lại. Riêng hóa đơn phải tra thêm, nhưng chỉ tra theo ĐÚNG số công
 * tơ của điểm đo đang chọn (`invoicesOfSerial`), không kéo cả kho hóa đơn về.
 */
import { useEffect, useState } from 'react';
import { Building2, Factory, Gauge, MousePointerClick, X } from 'lucide-react';
import type { CatalogData } from '../../lib/dm/repo';
import { ASSET_LABEL, ROLE_LABEL, STATUS_LABEL } from '../../lib/dm/types';
import type { Asset, Point, PointStatus, Station, Zone } from '../../lib/dm/types';
import { invoicesOfSerial } from '../../lib/dm/invoiceRepo';
import { dmyRange, segmentOf, segmentsOf, ymd } from '../../lib/dm/lifecycle';
import type { Segment } from '../../lib/dm/lifecycle';
import { kcnColorOf } from '../../lib/kcnColors';
import { InfoTag, PointBadgeChip, StatusTag } from './pointIcons';
import { SegmentBar, Warn } from './lifecycleUi';

/** Phần tử đang được chọn bên cây. */
export type Sel = { kind: 'zone' | 'station' | 'point'; id: string } | null;

/** Thứ tự hiện 4 trạng thái — từ "đang chạy" xuống "đã bỏ". */
const STATUS_ORDER: Exclude<PointStatus, ''>[] = ['active', 'chua_van_hanh', 'du_kien', 'thao_go'];

/* ============================ mảnh dùng lại ============================ */

/** Ô số lớn: một con số kèm nhãn. */
function Stat({ n, label, hint }: { n: number | string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-subtle/40 px-4 py-3">
      <p className="text-2xl font-black leading-none text-ink">{n}</p>
      <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-soft">{hint}</p>}
    </div>
  );
}

/** Một cặp nhãn — giá trị, xếp dọc. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] py-2 last:border-0">
      <span className="w-36 shrink-0 text-[11px] font-bold uppercase tracking-wider text-faint">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-ink">{children}</span>
    </div>
  );
}

/** Đầu panel: icon màu + tiêu đề + dòng phụ. */
function Head({ icon: Icon, hex, title, sub }: {
  icon: typeof Building2; hex: string; title: string; sub?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 rounded-xl p-2.5" style={{ backgroundColor: `${hex}1f` }}>
        <Icon className="h-5 w-5" style={{ color: hex }} />
      </div>
      <div className="min-w-0">
        <h3 className="break-words text-lg font-black leading-tight text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[12px] text-soft">{sub}</p>}
      </div>
    </div>
  );
}

/** Dãy 4 trạng thái kèm số đếm; trạng thái không có bản ghi nào thì mờ đi. */
function StatusBreakdown({ points }: { points: Point[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_ORDER.map(st => {
        const n = points.filter(p => p.status === st).length;
        return (
          <span key={st} className={`inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 ${n ? '' : 'opacity-40'}`}>
            <StatusTag status={st} />
            <b className="text-[13px] text-ink">{n}</b>
          </span>
        );
      })}
      {points.some(p => !p.status) && (
        <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5">
          <span className="text-[11px] italic text-faint">chưa tính</span>
          <b className="text-[13px] text-ink">{points.filter(p => !p.status).length}</b>
        </span>
      )}
    </div>
  );
}

/* ============================== ba nhánh ============================== */

function ZoneDetail({ zone, d }: { zone: Zone; d: CatalogData }) {
  const stations = d.stations.filter(s => s.zone === zone.id);
  const ids = new Set(stations.map(s => s.id));
  const points = d.points.filter(p => ids.has(p.station));
  const sdm = stations.reduce((n, s) => n + (s.sdm_kva ?? 0), 0);
  const color = kcnColorOf(zone.name);

  return (
    <div className="space-y-5">
      <Head icon={Building2} hex={color.hex} title={zone.name} sub={`${zone.code}${zone.address ? ` · ${zone.address}` : ''}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat n={stations.length} label="Trạm" />
        <Stat n={points.length} label="Điểm đo" />
        <Stat n={d.customers.filter(c => c.zone === zone.id).length} label="Khách hàng" />
        <Stat n={sdm ? sdm.toLocaleString('vi-VN') : '—'} label="Tổng Sdm" hint="kVA" />
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Tình trạng điểm đo</p>
        <StatusBreakdown points={points} />
      </div>

      {stations.length === 0
        ? <p className="text-[13px] italic text-faint">KCN này chưa có trạm nào.</p>
        : (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
              Trạm trong KCN
            </p>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)]">
              {stations.map(s => {
                const n = d.points.filter(p => p.station === s.id).length;
                return (
                  <div key={s.id} className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-[13px] last:border-0">
                    <Factory className="h-3.5 w-3.5 shrink-0" style={{ color: color.hex }} />
                    <span className="min-w-0 flex-1 truncate font-mono font-bold text-dim">{s.code}</span>
                    <span className="shrink-0 text-[11px] text-faint">{s.sdm_kva ?? '—'} kVA</span>
                    <span className="shrink-0 text-[11px] font-semibold text-soft">{n} điểm đo</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}

function StationDetail({ station, d }: { station: Station; d: CatalogData }) {
  const points = d.points.filter(p => p.station === station.id);
  const mains = points.filter(p => p.role === 'chinh');
  const subs = points.filter(p => p.role === 'phu');
  const owner = d.customers.find(c => c.id === station.customer);
  const zone = d.zones.find(z => z.id === station.zone);
  const color = kcnColorOf(zone?.name);

  /**
   * Tình trạng vận hành của TRẠM suy từ các điểm đo con — trạm không có trường
   * trạng thái riêng, và cũng không nên có: trạm chỉ "chạy" khi có điểm đo chạy.
   */
  const live = points.filter(p => p.status === 'active').length;
  const stationState = points.length === 0 ? 'Chưa có điểm đo'
    : live > 0 ? `Đang vận hành (${live}/${points.length} điểm đo)`
      : points.every(p => p.status === 'thao_go') ? 'Đã tháo gỡ toàn bộ'
        : 'Chưa vận hành';

  return (
    <div className="space-y-5">
      <Head icon={Factory} hex={color.hex} title={station.code}
        sub={zone ? `${zone.name} · ${zone.code}` : 'chưa gắn KCN'} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat n={mains.length} label="Điểm đo chính" />
        <Stat n={subs.length} label="Điểm đo phụ" />
        <Stat n={station.sdm_kva ?? '—'} label="Công suất" hint="kVA" />
        <Stat n={live} label="Đang vận hành" />
      </div>

      <div className="rounded-xl border border-[var(--border)] px-4 py-1">
        <Row label="Tình trạng">{stationState}</Row>
        <Row label="Chủ trạm">
          {owner
            ? <><span className="font-mono font-bold">{owner.mkh}</span> · {owner.name}</>
            : <i className="text-faint">chưa gắn khách hàng</i>}
        </Row>
        <Row label="Tổn thất P0 / Pk">
          {station.p0_w ?? '—'} / {station.pk_w ?? '—'} W
        </Row>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Tình trạng điểm đo</p>
        <StatusBreakdown points={points} />
      </div>

      {points.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border)]">
          {points.map(p => {
            const c = d.customers.find(x => x.id === p.customer);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[13px] last:border-0">
                <Gauge className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono font-semibold text-dim">
                  {p.code || p.line_name || p.id}
                </span>
                <PointBadgeChip point={p} />
                <InfoTag title="Hệ số nhân">HSN {p.hsn ?? '—'}</InfoTag>
                <StatusTag status={p.status} />
                <InfoTag title={c?.name}>{c?.mkh ?? '—'}</InfoTag>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PointDetail({ point, d }: { point: Point; d: CatalogData }) {
  const rows = d.assets.filter(a => a.point === point.id);
  const station = d.stations.find(s => s.id === point.station);
  const customer = d.customers.find(c => c.id === point.customer);
  const zone = d.zones.find(z => z.id === station?.zone);
  const color = kcnColorOf(zone?.name);

  const meters = rows.filter(a => a.type === 'CONGTO');
  const serialKey = meters.map(a => a.serial).join('|');

  /** Chặng hóa đơn theo từng số công tơ; tra lười, chỉ khi mở đúng điểm đo này. */
  const [segs, setSegs] = useState<Record<string, Segment[]>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const need = meters.map(a => a.serial).filter(s => s && !(s in segs));
    if (!need.length) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const got: Record<string, Segment[]> = {};
        for (const s of need) got[s] = segmentsOf(await invoicesOfSerial(s));
        if (!cancelled) setSegs(prev => ({ ...prev, ...got }));
      } catch {
        // Tra hóa đơn hỏng thì thôi — phần vật tư khai tay vẫn xem được.
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialKey, point.id]);

  /** Các đời công tơ xếp theo ngày treo, kèm khoảng trống giữa hai đời. */
  const history = [...meters]
    .sort((a, b) => (ymd(a.date_on) < ymd(b.date_on) ? -1 : 1))
    .map((a, i, arr) => {
      const prev = arr[i - 1];
      const gap = prev && ymd(prev.date_off) && ymd(a.date_on) && ymd(prev.date_off) < ymd(a.date_on)
        ? dmyRange(prev.date_off, a.date_on) : '';
      return { asset: a, gap, seg: segmentOf(segs[a.serial] ?? [], customer?.mkh) };
    });

  const countOf = (t: Asset['type']) => rows.filter(a => a.type === t).length;

  return (
    <div className="space-y-5">
      <Head icon={Gauge} hex={color.hex} title={point.code || point.line_name || point.id}
        sub={station ? `${station.code}${zone ? ` · ${zone.name}` : ''}` : 'chưa gắn trạm'} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat n={rows.length} label="Vật tư" hint={`${rows.filter(a => a.active).length} đang hoạt động`} />
        <Stat n={countOf('CONGTO')} label="Công tơ" />
        <Stat n={countOf('TI')} label="TI" />
        <Stat n={point.hsn ?? '—'} label="HSN" />
      </div>

      <div className="rounded-xl border border-[var(--border)] px-4 py-1">
        <Row label="Loại điểm đo">
          {ROLE_LABEL[point.role]}
          {point.status && <> · {STATUS_LABEL[point.status]}</>}
        </Row>
        <Row label="Khách hàng">
          {customer
            ? <><span className="font-mono font-bold">{customer.mkh}</span> · {customer.name}</>
            : <i className="text-faint">chưa gắn khách hàng</i>}
        </Row>
      </div>

      {/* ---------------------------- vật tư ---------------------------- */}
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Vật tư đang gắn</p>
        {rows.length === 0 ? (
          <p className="text-[13px] italic text-faint">Điểm đo này chưa khai vật tư nào.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-3 py-2 font-bold">Thiết bị</th>
                  <th className="px-3 py-2 font-bold">Số chế tạo</th>
                  <th className="px-3 py-2 font-bold">Tỷ số</th>
                  <th className="px-3 py-2 font-bold">Treo → tháo</th>
                  <th className="px-3 py-2 font-bold">Hoạt động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map(a => (
                  <tr key={a.id} className={a.active ? '' : 'opacity-60'}>
                    <td className="px-3 py-2 font-semibold text-dim">{ASSET_LABEL[a.type]}</td>
                    <td className="px-3 py-2 font-mono font-bold text-ink">{a.serial || '—'}</td>
                    <td className="px-3 py-2 font-mono text-soft">
                      {a.ratio_primary != null || a.ratio_secondary != null
                        ? `${a.ratio_primary ?? '?'}/${a.ratio_secondary ?? '?'}` : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-soft">
                      {dmyRange(a.date_on, a.date_off)}
                    </td>
                    <td className="px-3 py-2">
                      {a.active
                        ? <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">Có</span>
                        : <span className="text-[11px] text-faint">ngưng</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --------------------------- vòng đời --------------------------- */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-faint">
          Vòng đời công tơ theo hóa đơn
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />}
        </p>
        {history.length === 0 ? (
          <p className="text-[13px] italic text-faint">Chưa khai công tơ nào.</p>
        ) : (
          <div className="space-y-2">
            {history.map(({ asset, gap, seg }) => (
              <div key={asset.id} className={`rounded-xl border border-[var(--border)] px-3 py-2.5 ${asset.active ? '' : 'opacity-75'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-bold text-ink">{asset.serial}</span>
                  {asset.active && (
                    <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">
                      đang treo
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-soft">
                    khai tay {dmyRange(asset.date_on, asset.date_off)}
                  </span>
                </div>
                <div className="mt-1.5">
                  {seg ? <SegmentBar seg={seg} />
                    : <span className="text-[11px] italic text-faint">chưa có hóa đơn cho khách hàng này</span>}
                </div>
                {gap && <Warn>Khoảng trống không có công tơ: {gap}</Warn>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== vỏ ngoài ============================== */

export function TreeDetail({ sel, d, onClose }: {
  sel: Sel;
  d: CatalogData | null;
  /** Có truyền = đang ở dạng drawer màn nhỏ, hiện nút đóng. */
  onClose?: () => void;
}) {
  const zone = sel?.kind === 'zone' ? d?.zones.find(z => z.id === sel.id) : undefined;
  const station = sel?.kind === 'station' ? d?.stations.find(s => s.id === sel.id) : undefined;
  const point = sel?.kind === 'point' ? d?.points.find(p => p.id === sel.id) : undefined;

  return (
    <div className="relative h-full">
      {onClose && (
        <button onClick={onClose} aria-label="Đóng"
          className="absolute right-0 top-0 rounded-lg p-2 text-faint transition-colors hover:bg-subtle hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      )}

      {!d || !sel ? (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
          <MousePointerClick className="h-9 w-9 text-faint" />
          <p className="mt-3 text-[14px] font-bold text-dim">Chưa chọn phần tử nào</p>
          <p className="mt-1 text-[12px] text-faint">
            Bấm một khu công nghiệp, trạm hoặc điểm đo ở sơ đồ cây để xem chi tiết.
          </p>
        </div>
      ) : zone ? <ZoneDetail zone={zone} d={d!} />
        : station ? <StationDetail station={station} d={d!} />
          : point ? <PointDetail point={point} d={d!} />
            : (
              <p className="py-10 text-center text-[13px] italic text-faint">
                Bản ghi vừa chọn không còn nữa — bấm "Nạp lại" để cập nhật cây.
              </p>
            )}
    </div>
  );
}
