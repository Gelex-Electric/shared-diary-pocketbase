/**
 * Thẻ chi tiết bên phải của màn hình Hồ sơ Kho — nội dung đổi theo phần tử
 * đang chọn trên cây: KCN, trạm, hay điểm đo.
 *
 * Nguyên tắc trình bày: mỗi cấp trả lời đúng câu hỏi của cấp đó.
 *   KCN     → quy mô: bao nhiêu trạm, điểm đo, khách hàng, thiết bị.
 *   Trạm    → danh sách điểm đo thuộc trạm và tình trạng từng cái.
 *   Điểm đo → thiết bị đang treo, hệ số nhân suy ra, và lịch sử treo/tháo.
 */
import { useState, useEffect } from 'react';
import { MapPin, Building2, Gauge, Lock, AlertTriangle, CircleCheck, History } from 'lucide-react';
import { Badge, Field, StatCard, POINT_STATUS_LABEL, viDate } from './shared';
import type { ZoneNode, PointRow } from './TreeExplorer';
import {
  fetchPointHistory, pointStatusOf, MOVEMENT_LABEL,
  type WhData, type WhMovement,
} from '../../lib/v2/wh';
import { hsnOf, pointViolations } from '../../lib/v2/rules';
import { V2_ASSET_TYPE_LABEL, isMeter } from '../../lib/v2/schema';
import { isAbort } from '../../lib/v2/pb';

export interface Selection {
  kind: 'zone' | 'station' | 'point';
  key: string;
  zone?: string;
}

export default function NodeDetail({
  data, zones, sel, loading,
}: { data: WhData; zones: ZoneNode[]; sel: Selection | null; loading: boolean }) {
  if (!sel) {
    return (
      <div className="vl-card p-10 text-center text-faint text-[13px]">
        <Gauge className="w-7 h-7 mx-auto mb-2 opacity-40" />
        {loading ? 'Đang tải dữ liệu...' : 'Chọn một KCN, trạm hoặc điểm đo trên cây bên trái để xem chi tiết.'}
      </div>
    );
  }
  if (sel.kind === 'zone') return <ZoneDetail data={data} zones={zones} code={sel.key} />;
  if (sel.kind === 'station') return <StationDetail zones={zones} key_={sel.key} />;
  return <PointDetail data={data} zones={zones} pointId={sel.key} />;
}

/* ------------------------------------------------------------------ */

function ZoneDetail({ data, zones, code }: { data: WhData; zones: ZoneNode[]; code: string }) {
  const z = zones.find(x => x.code === code);
  if (!z) return null;
  const rows = z.stations.flatMap(s => s.points);
  const pointIds = new Set(rows.map(r => r.point.id));
  const customers = new Set(rows.map(r => r.point.customer).filter(Boolean));
  const hanging = data.devices.filter(d => d.status === 'dang_treo' && d.current_point && pointIds.has(d.current_point));
  const kva = rows.reduce((n, r) => n + (r.point.cong_suat_kva ?? 0), 0);

  return (
    <div className="space-y-4">
      <Header icon={<MapPin className="w-4 h-4" />} title={code} sub="Khu công nghiệp" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Trạm" value={z.stations.length} />
        <StatCard label="Điểm đo" value={z.pointCount} />
        <StatCard label="Khách hàng" value={customers.size} />
        <StatCard label="Thiết bị đang treo" value={hanging.length} />
      </div>

      <div className="vl-card p-4">
        <Field label="Tổng công suất MBA" value={kva ? `${kva.toLocaleString('vi-VN')} kVA` : '—'} />
        <Field label="Điểm đo đang vận hành" value={rows.filter(r => pointStatusOf(r.point) === 'active').length} />
        <Field label="Điểm đo lắp sai (khoá ghi)" value={<span className="text-bad">{rows.filter(r => r.locked).length}</span>} />
        <Field label="Điểm đo còn lắp dở" value={<span className="text-warn">{rows.filter(r => r.incomplete && !r.locked).length}</span>} />
      </div>

      <div className="vl-card overflow-x-auto">
        <table className="vl-table w-full text-[13px]">
          <thead>
            <tr><th className="text-left">Trạm</th><th className="text-right">Điểm đo</th><th className="text-right">Lắp sai</th></tr>
          </thead>
          <tbody>
            {z.stations.map(s => (
              <tr key={s.code}>
                <td>{s.code}</td>
                <td className="text-right tnum">{s.points.length}</td>
                <td className="text-right tnum">{s.points.filter(p => p.locked).length || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StationDetail({ zones, key_ }: { zones: ZoneNode[]; key_: string }) {
  const [zoneCode, stationCode] = key_.split('/');
  const st = zones.find(z => z.code === zoneCode)?.stations.find(s => s.code === stationCode);
  if (!st) return null;
  const kva = st.points.reduce((n, r) => n + (r.point.cong_suat_kva ?? 0), 0);
  const mbas = [...new Set(st.points.map(r => r.point.mba).filter(Boolean))];

  return (
    <div className="space-y-4">
      <Header icon={<Building2 className="w-4 h-4" />} title={stationCode} sub={`Trạm · ${zoneCode}`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Điểm đo" value={st.points.length} />
        <StatCard label="Đang vận hành" value={st.points.filter(r => pointStatusOf(r.point) === 'active').length} tone="ok" />
        <StatCard label="Lắp sai" value={st.points.filter(r => r.locked).length} tone="bad" />
        <StatCard label="Công suất" value={kva ? `${kva.toLocaleString('vi-VN')} kVA` : '—'} />
      </div>

      <div className="vl-card p-4">
        <Field label="Máy biến áp" value={mbas.length ? mbas.join(', ') : '—'} />
        <Field label="Khách hàng dùng chung" value={new Set(st.points.map(r => r.point.customer).filter(Boolean)).size} />
      </div>

      <div className="vl-card overflow-x-auto">
        <table className="vl-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">Điểm đo</th><th className="text-left">Trạng thái</th>
              <th className="text-right">Thiết bị</th><th className="text-left">Tình trạng</th>
            </tr>
          </thead>
          <tbody>
            {st.points.map(r => (
              <tr key={r.point.id}>
                <td className="font-medium">{r.point.point_code}</td>
                <td className="text-dim">{POINT_STATUS_LABEL[pointStatusOf(r.point)]}</td>
                <td className="text-right tnum">{r.assets.length}</td>
                <td><StateBadge row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PointDetail({ data, zones, pointId }: { data: WhData; zones: ZoneNode[]; pointId: string }) {
  const row = zones.flatMap(z => z.stations).flatMap(s => s.points).find(r => r.point.id === pointId);
  const [history, setHistory] = useState<WhMovement[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingHist(true);
    fetchPointHistory(pointId)
      .then(h => { if (alive) setHistory(h); })
      .catch(e => { if (!isAbort(e)) setHistory([]); })
      .finally(() => { if (alive) setLoadingHist(false); });
    return () => { alive = false; };
  }, [pointId]);

  if (!row) return null;
  const { point, assets } = row;
  const status = pointStatusOf(point);
  const hsn = hsnOf(assets);
  const violations = pointViolations(status, assets);
  const customer = data.customers.find(c => c.id === point.customer);
  const serialOf = (id: string) => data.devices.find(d => d.id === id)?.serial ?? id;
  const pointCodeOf = (id?: string) =>
    id ? (data.points.find(p => p.id === id)?.point_code ?? id) : '';
  const zoneName = (id?: string) => {
    const z = data.zones.find(x => x.id === id);
    return z ? (z.short_code || z.code) : (id ?? '');
  };

  return (
    <div className="space-y-4">
      <Header icon={<Gauge className="w-4 h-4" />} title={point.point_code}
        sub={`Điểm đo · ${point.station_code || 'chưa gán trạm'} · ${point.zone || 'chưa gán KCN'}`} />

      <div className="vl-card p-4">
        <Field label="Khách hàng" value={customer ? `${customer.mkh} — ${customer.ten}` : '—'} />
        <Field label="Trạng thái" value={POINT_STATUS_LABEL[status]} />
        <Field label="Máy biến áp" value={point.mba || '—'} />
        <Field label="Công suất" value={point.cong_suat_kva ? `${point.cong_suat_kva.toLocaleString('vi-VN')} kVA` : '—'} />
        <Field label="Ngày đóng điện" value={viDate(point.ngay_dong_dien)} />
        <Field label="Lộ đường dây" value={point.line_name || <span className="text-faint">chưa có dữ liệu</span>} />
      </div>

      <div className="vl-card p-4">
        <p className="text-[12px] text-faint">Hệ số nhân (suy ra từ thiết bị đang treo, không sửa tay)</p>
        <p className="text-[26px] font-semibold tnum">{hsn.value ?? '—'}</p>
        <p className="text-[12px] text-dim mt-1">{hsn.explain}</p>
      </div>

      <div className="vl-card p-4">
        <p className="text-[13px] font-medium mb-2">Thiết bị đang treo ({assets.length})</p>
        {assets.length ? (
          <table className="vl-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Loại</th><th className="text-left">Số hiệu</th>
                <th className="text-left">Tỷ số</th><th className="text-left">Hạn kiểm định</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id}>
                  <td><Badge tone={isMeter(a.type) ? 'info' : 'muted'}>{V2_ASSET_TYPE_LABEL[a.type]}</Badge></td>
                  <td className="font-medium">{a.serial}</td>
                  <td className="tnum text-dim">{a.ratio_primary ? `${a.ratio_primary}/${a.ratio_secondary}` : '—'}</td>
                  <td className="text-dim">{viDate(a.next_calibration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-[13px] text-faint">Chưa treo thiết bị nào.</p>}
      </div>

      <div className="vl-card p-4">
        <p className="text-[13px] font-medium mb-2">Soát luật</p>
        {violations.length ? (
          <ul className="space-y-1.5">
            {violations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                {v.level === 'sai'
                  ? <Lock className="w-4 h-4 text-bad shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />}
                <span><span className="text-faint">{v.rule}</span> {v.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ok flex items-center gap-1.5">
            <CircleCheck className="w-4 h-4" /> Không có vi phạm nào.
          </p>
        )}
      </div>

      <div className="vl-card p-4">
        <p className="text-[13px] font-medium mb-2 flex items-center gap-1.5">
          <History className="w-4 h-4 text-faint" /> Lịch sử treo / tháo
        </p>
        {loadingHist ? (
          <p className="text-[13px] text-faint">Đang tải lịch sử...</p>
        ) : history.length ? (
          <table className="vl-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Ngày</th><th className="text-left">Thao tác</th>
                <th className="text-left">Thiết bị</th><th className="text-left">Từ → đến</th>
              </tr>
            </thead>
            <tbody>
              {history.map(m => (
                <tr key={m.id}>
                  <td className="text-dim">{viDate(m.event_date)}</td>
                  <td>{MOVEMENT_LABEL[m.action] ?? m.action}</td>
                  <td className="font-medium">{serialOf(m.device)}</td>
                  <td className="text-dim">
                    {[zoneName(m.from_zone) || pointCodeOf(m.from_point),
                      zoneName(m.to_zone) || pointCodeOf(m.to_point)]
                      .filter(Boolean).join(' → ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-faint">Chưa có giao dịch nào ghi cho điểm đo này.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="vl-card p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[16px] font-semibold">{title}</p>
        <p className="text-[12px] text-faint">{sub}</p>
      </div>
    </div>
  );
}

function StateBadge({ row }: { row: PointRow }) {
  if (row.locked) return <Badge tone="bad">Lắp sai</Badge>;
  if (row.incomplete) return <Badge tone="warn">Lắp dở</Badge>;
  return <Badge tone="ok">Hợp lệ</Badge>;
}
