/**
 * Màn hình VẬT TƯ — gộp phần xem và phần khai báo thiết bị làm một (user chốt
 * 07/08). Trước đó hai màn hình cùng hiển thị `wh_device` với hai mục đích
 * khác nhau, buộc người dùng nhớ "xem thì vào đây, sửa thì sang kia" cho cùng
 * một bản ghi.
 *
 * Bố cục 2 thẻ giống màn hình Sơ đồ đơn vị: danh sách bên trái, chi tiết bên
 * phải — hai màn hình cùng một thói quen thao tác, mắt không phải học lại.
 *
 * Khách hàng / điểm đo / kho nằm ở tab "Khai báo danh mục" riêng.
 */
import { useState, useMemo, useEffect } from 'react';
import {
  Search, Plus, RefreshCw, Pencil, Trash2, History, Package, Lock,
} from 'lucide-react';
import { useWhData, ErrorBar, Badge, StatCard, Field, viDate } from './shared';
import CatalogForm from './CatalogForm';
import {
  toAsset, fetchDeviceHistory, MOVEMENT_LABEL, DEVICE_TAGS, DEVICE_TAG_LABEL,
  type WhDevice, type WhMovement,
} from '../../lib/v2/wh';
import { isOverdue } from '../../lib/v2/rules';
import { V2_ASSET_TYPES, V2_ASSET_TYPE_LABEL, isMeter, type V2AssetType } from '../../lib/v2/schema';
import {
  canWrite, whyCannotWrite, deleteBlockers, deleteRecord, readableError,
} from '../../lib/v2/whWrite';
import { isAbort } from '../../lib/v2/pb';
import { toast as notify } from '../../lib/toast';

/** Còn ≤ 60 ngày là sắp hết hạn — đủ thời gian gửi kiểm định trước khi phải tháo. */
function calibrationTone(next?: string): 'bad' | 'warn' | 'muted' {
  const d = (next || '').slice(0, 10);
  if (!d) return 'muted';
  const days = (new Date(d).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'bad';
  return days <= 60 ? 'warn' : 'muted';
}

export default function AssetsScreen() {
  const { data, loading, error, reload } = useWhData();
  const [term, setTerm] = useState('');
  const [type, setType] = useState<string>('');
  const [tag, setTag] = useState<string>('');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ record: WhDevice | null } | null>(null);
  const [confirming, setConfirming] = useState<{ record: WhDevice; blockers: string[] } | null>(null);
  const writable = canWrite();

  const typeCode = useMemo(
    () => new Map(data.deviceTypes.map(t => [t.id, t.code])),
    [data.deviceTypes],
  );

  const items = useMemo(
    () => data.devices.map(d => ({ device: d, asset: toAsset(d, typeCode) })),
    [data.devices, typeCode],
  );

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return items.filter(({ device, asset }) => {
      if (type && asset.type !== type) return false;
      if (tag === '__trong') { if (device.status) return false; }
      else if (tag && (device.status ?? '') !== tag) return false;
      if (!t) return true;
      return `${device.serial} ${device.model ?? ''} ${device.spec ?? ''}`.toLowerCase().includes(t);
    });
  }, [items, term, type, tag]);

  const stat = useMemo(() => ({
    total: items.length,
    inStock: items.filter(x => x.asset.current_status === 'kho').length,
    hanging: items.filter(x => x.asset.current_status === 'dang_treo').length,
    overdue: items.filter(x => isOverdue(x.asset)).length,
  }), [items]);

  const countByType = useMemo(() => {
    const c = new Map<V2AssetType, number>();
    for (const { asset } of items) {
      if (asset.current_status !== 'kho') continue;
      c.set(asset.type, (c.get(asset.type) ?? 0) + 1);
    }
    return c;
  }, [items]);

  const countByTag = useMemo(() => {
    const c = new Map<string, number>();
    for (const { device } of items) {
      const t = device.status ?? '';
      if (!t) continue;
      c.set(t, (c.get(t) ?? 0) + 1);
    }
    return c;
  }, [items]);

  /** 807 thiết bị nhập từ Excel đang để trống tag — đếm riêng để không bỏ sót. */
  const chuaCoTag = useMemo(
    () => items.filter(x => !x.device.status).length,
    [items],
  );

  const selected = picked ? items.find(x => x.device.id === picked) ?? null : null;

  const askDelete = async (device: WhDevice) => {
    try {
      setConfirming({ record: device, blockers: await deleteBlockers('device', device.id) });
    } catch (e) {
      notify.error(readableError(e));
    }
  };

  const doDelete = async () => {
    if (!confirming) return;
    try {
      await deleteRecord('device', confirming.record.id);
      notify.success('Đã xoá thiết bị');
      setConfirming(null);
      setPicked(null);
      reload();
    } catch (e) {
      notify.error(readableError(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="vl-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[15px] font-semibold">Vật tư trong kho</h2>
          <p className="text-[12px] text-faint">Xem, khai báo và tra vòng đời thiết bị</p>
        </div>
        <button onClick={reload} disabled={loading}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
        <button onClick={() => setEditing({ record: null })} disabled={!writable}
          title={writable ? '' : whyCannotWrite()}
          className="px-3 py-2 rounded-lg bg-accent text-[var(--on-accent)] text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
          <Plus className="w-4 h-4" /> Thêm thiết bị
        </button>
      </div>

      <ErrorBar message={error} />

      {!writable && (
        <div className="vl-alert vl-alert-light-warning flex items-center gap-2 text-[13px]">
          <Lock className="w-4 h-4 shrink-0" /> {whyCannotWrite()}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Tổng thiết bị" value={stat.total} />
        <StatCard label="Đang trong kho" value={stat.inStock} tone="ok" />
        <StatCard label="Đang treo" value={stat.hanging} />
        <StatCard label="Quá hạn kiểm định" value={stat.overdue} tone="bad" />
      </div>

      <div className="vl-card p-3">
        <p className="text-[12px] text-faint mb-2 flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5" /> Tồn kho theo loại
        </p>
        <div className="flex flex-wrap gap-2">
          {V2_ASSET_TYPES.map(t => (
            <button key={t} onClick={() => setType(type === t ? '' : t)}
              className={`px-3 py-1.5 rounded-lg border text-[13px] flex items-center gap-2 ${
                type === t ? 'border-[var(--accent)] text-accent' : 'border-hair text-dim'
              }`}>
              {V2_ASSET_TYPE_LABEL[t]}
              <span className="tnum font-semibold">{countByType.get(t) ?? 0}</span>
            </button>
          ))}
        </div>

        <p className="text-[12px] text-faint mt-3 mb-2">Trạng thái</p>
        <div className="flex flex-wrap gap-2">
          {DEVICE_TAGS.map(t => (
            <button key={t} onClick={() => setTag(tag === t ? '' : t)}
              className={`px-3 py-1.5 rounded-lg border text-[13px] flex items-center gap-2 ${
                tag === t ? 'border-[var(--accent)] text-accent' : 'border-hair text-dim'
              }`}>
              {DEVICE_TAG_LABEL[t]}
              <span className="tnum font-semibold">{countByTag.get(t) ?? 0}</span>
            </button>
          ))}
          {chuaCoTag > 0 && (
            <button onClick={() => setTag(tag === '__trong' ? '' : '__trong')}
              className={`px-3 py-1.5 rounded-lg border border-dashed text-[13px] flex items-center gap-2 ${
                tag === '__trong' ? 'border-[var(--danger)] text-bad' : 'border-hair text-faint'
              }`}>
              Chưa đặt tag
              <span className="tnum font-semibold">{chuaCoTag}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* ------------- Danh sách (trái) ------------- */}
        <div className="vl-card p-2 lg:sticky lg:top-4">
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={term} onChange={e => setTerm(e.target.value)}
              placeholder="Tìm số hiệu, model, tỷ số..."
              className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-inset border border-hair text-[12.5px]"
            />
          </div>

          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {rows.map(({ device, asset }) => (
              <button
                key={device.id} onClick={() => setPicked(device.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-subtle ${
                  picked === device.id ? 'bg-subtle text-accent' : ''
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{device.serial}</span>
                  <span className="block text-[11px] text-faint truncate">
                    {V2_ASSET_TYPE_LABEL[asset.type]}
                    {device.spec ? ` · ${device.spec}` : ''}
                    {` · ${DEVICE_TAG_LABEL[device.status ?? ''] ?? '—'}`}
                  </span>
                </span>
                {isOverdue(asset) && <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)] shrink-0" />}
              </button>
            ))}
            {!rows.length && (
              <p className="py-8 text-center text-[13px] text-faint">
                {loading ? 'Đang tải...' : 'Không có thiết bị nào khớp bộ lọc'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 px-2 pt-2 mt-1 border-t border-hair text-[11px] text-faint">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" /> quá hạn kiểm định
            </span>
            <span className="ml-auto tnum">{rows.length}</span>
          </div>
        </div>

        {/* ------------- Chi tiết (phải) ------------- */}
        {selected ? (
          <DeviceDetail
            device={selected.device}
            asset={selected.asset}
            data={data}
            writable={writable}
            onEdit={() => setEditing({ record: selected.device })}
            onDelete={() => askDelete(selected.device)}
          />
        ) : (
          <div className="vl-card p-10 text-center text-faint text-[13px]">
            <Package className="w-7 h-7 mx-auto mb-2 opacity-40" />
            Chọn một thiết bị bên trái để xem thông tin và vòng đời của nó.
          </div>
        )}
      </div>

      {editing && (
        <CatalogForm
          kind="device" record={editing.record} data={data}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); notify.success(msg); reload(); }}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="vl-card vl-drawer w-full max-w-[440px] p-5 space-y-3">
            <h3 className="text-[16px] font-semibold">Xoá thiết bị?</h3>
            <p className="text-[13px] text-dim">{confirming.record.serial}</p>
            {confirming.blockers.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[13px]">
                <p className="font-medium mb-1">Không xoá được:</p>
                {confirming.blockers.map((b, i) => <p key={i}>• {b}</p>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 rounded-lg border border-hair text-[13px]">Huỷ</button>
              <button onClick={doDelete} disabled={confirming.blockers.length > 0}
                className="px-4 py-2 rounded-lg bg-[var(--danger)] text-white text-[13px] font-semibold disabled:opacity-40">
                Xoá
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DeviceDetail({
  device, asset, data, writable, onEdit, onDelete,
}: {
  device: WhDevice;
  asset: ReturnType<typeof toAsset>;
  data: ReturnType<typeof useWhData>['data'];
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [history, setHistory] = useState<WhMovement[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingHist(true);
    fetchDeviceHistory(device.id)
      .then(h => { if (alive) setHistory(h); })
      .catch(e => { if (!isAbort(e)) setHistory([]); })
      .finally(() => { if (alive) setLoadingHist(false); });
    return () => { alive = false; };
  }, [device.id]);

  const zoneName = (id?: string) => {
    const z = data.zones.find(x => x.id === id);
    return z ? (z.short_code || z.code) : (id ?? '');
  };
  const pointCode = (id?: string) => (id ? data.points.find(p => p.id === id)?.point_code ?? id : '');
  const place = device.current_point
    ? `Điểm đo ${pointCode(device.current_point)}`
    : device.zone ? `Kho ${zoneName(device.zone)}` : '—';

  return (
    <div className="space-y-4">
      <div className="vl-card p-4 flex flex-wrap items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <Package className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <p className="text-[16px] font-semibold">{device.serial}</p>
          <p className="text-[12px] text-faint">
            {V2_ASSET_TYPE_LABEL[asset.type]}{device.model ? ` · ${device.model}` : ''}
          </p>
        </div>
        <button onClick={onEdit} disabled={!writable}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-40">
          <Pencil className="w-3.5 h-3.5" /> Sửa
        </button>
        <button onClick={onDelete} disabled={!writable}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] text-bad flex items-center gap-1.5 disabled:opacity-40">
          <Trash2 className="w-3.5 h-3.5" /> Xoá
        </button>
      </div>

      <div className="vl-card p-4">
        <Field label="Loại" value={<Badge tone={isMeter(asset.type) ? 'info' : 'muted'}>{V2_ASSET_TYPE_LABEL[asset.type]}</Badge>} />
        <Field label="Tỷ số" value={device.spec || '—'} />
        <Field label="Hãng sản xuất" value={device.manufacturer || '—'} />
        <Field label="Năm sản xuất" value={device.year_made || '—'} />
        <Field label="Ngày kiểm định" value={viDate(device.calib_date)} />
        <Field label="Hạn kiểm định" value={
          device.calib_expiry
            ? <Badge tone={calibrationTone(device.calib_expiry)}>{viDate(device.calib_expiry)}</Badge>
            : '—'
        } />
        <Field label="Số tem / chứng chỉ" value={device.calib_cert_no || '—'} />
        <Field label="Nguồn gốc" value={device.nguon_goc === 'thu_hoi' ? 'Thu hồi' : device.nguon_goc === 'du_phong' ? 'Dự phòng' : '—'} />
        <Field label="Trạng thái" value={<Badge tone={device.status === 'da_treo' ? 'info' : device.status === 'tra_hang' ? 'bad' : 'ok'}>{DEVICE_TAG_LABEL[device.status ?? ''] ?? '—'}</Badge>} />
        <Field label="Đang ở" value={place} />
        <Field label="Ghi chú" value={device.note || '—'} />
      </div>

      <div className="vl-card p-4">
        <p className="text-[13px] font-medium mb-2 flex items-center gap-1.5">
          <History className="w-4 h-4 text-faint" /> Vòng đời vật tư
        </p>
        {loadingHist ? (
          <p className="text-[13px] text-faint">Đang tải lịch sử...</p>
        ) : history.length ? (
          <table className="vl-table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Ngày</th><th className="text-left">Thao tác</th>
                <th className="text-left">Từ → đến</th><th className="text-left">Chứng từ</th>
              </tr>
            </thead>
            <tbody>
              {history.map(m => (
                <tr key={m.id}>
                  <td className="text-dim">{viDate(m.event_date)}</td>
                  <td>{MOVEMENT_LABEL[m.action] ?? m.action}</td>
                  <td className="text-dim">
                    {[zoneName(m.from_zone) || pointCode(m.from_point),
                      zoneName(m.to_zone) || pointCode(m.to_point)]
                      .filter(Boolean).join(' → ') || '—'}
                  </td>
                  <td className="text-dim">{m.doc_no || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-faint">
            Chưa có giao dịch nào. Thiết bị này chưa từng được ghi nhập kho, treo hay tháo.
          </p>
        )}
      </div>
    </div>
  );
}
