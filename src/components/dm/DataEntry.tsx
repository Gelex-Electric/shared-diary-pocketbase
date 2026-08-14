/**
 * Tab 2 của "Quản lý chung" — các vùng nhập liệu ghi vào 4 collection `dm_*`.
 *
 * Bố cục: 4 vùng xếp dọc theo đúng thứ tự phụ thuộc
 *   KCN → Trạm (cần KCN) → Khách hàng → Điểm đo (cần Trạm)
 * Vùng nào chưa đủ dữ liệu cha thì khoá form và chỉ rõ phải khai gì trước.
 *
 * Ràng buộc nghiệp vụ xử lý tại đây:
 * - Điểm đo đấu TRỰC TIẾP: HSN cưỡng bức = 1, khoá ô nhập (không có TI để nhân).
 * - `zone` của điểm đo suy ra từ trạm đã chọn, không cho nhập tay để khỏi lệch.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, Factory, Gauge, Users, Plus, Trash2, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { customers, loadCatalog, pbErrorMessage, points, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import {
  CONNECTION_LABEL, ROLE_LABEL, STATUS_LABEL, VOLTAGE_LABEL, defaultHsn,
} from '../../lib/dm/types';
import type { Connection, PointRole, PointStatus, VoltageLevel } from '../../lib/dm/types';

/* Chuỗi class ô nhập — lấy nguyên mẫu đang dùng trong app, không tự chế kiểu mới. */
const INPUT_CLS =
  'w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm outline-none focus:ring-2 focus:ring-accent';

const LABEL_CLS = 'text-[10px] font-bold text-faint uppercase block mb-1';

function TextField({ label, value, onChange, placeholder, required, disabled, mono }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; disabled?: boolean; mono?: boolean;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>
        {label} {required && <span className="text-bad">*</span>}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${INPUT_CLS} ${mono ? 'font-mono' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function NumberField({ label, value, onChange, disabled, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  disabled?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className={`${INPUT_CLS} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
      {hint && <p className="mt-1 text-[10px] italic text-faint">{hint}</p>}
    </div>
  );
}

/** Khung một vùng nhập liệu: tiêu đề màu + form + danh sách bản ghi đã có. */
function Section({ icon: Icon, hex, title, subtitle, count, children }: {
  icon: LucideIcon; hex: string; title: string; subtitle: string;
  count: number; children: React.ReactNode;
}) {
  return (
    <div className="vl-card">
      <div className="mb-4 flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-content-center rounded-lg"
          style={{ backgroundColor: `${hex}1f`, color: hex }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] font-bold text-ink leading-tight">{title}</p>
          <p className="text-[11px] text-faint leading-tight">{subtitle}</p>
        </div>
        <span
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ backgroundColor: `${hex}1f`, color: hex }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Nhắc khai bảng cha trước khi dùng được vùng này. */
function NeedParent({ what }: { what: string }) {
  return <div className="vl-alert vl-alert-light-warning">Phải khai {what} trước.</div>;
}

const num = (s: string): number | undefined => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};

export default function DataEntry() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const { confirm, dialog } = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      setData(await loadCatalog());
    } catch (e) {
      toast.error('Không nạp được danh mục', pbErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  /* ---------------- state của 4 form ---------------- */
  const [zForm, setZForm] = useState({ code: '', name: '', address: '' });
  const [sForm, setSForm] = useState({ code: '', name: '', zone: '', sdm_kva: '', p0_kw: '', pk_kw: '' });
  const [cForm, setCForm] = useState({ mkh: '', name: '', address: '', zone: '' });
  const [pForm, setPForm] = useState({
    line_id: '', line_name: '', station: '', customer: '',
    role: 'chinh' as PointRole, connection: 'truc_tiep' as Connection,
    hsn: '1', voltage_level: '' as VoltageLevel, status: '' as PointStatus,
  });

  const zoneOpts = useMemo(
    () => (data?.zones ?? []).map(z => ({ value: z.id, label: `${z.code} — ${z.name}` })), [data]);
  const stationOpts = useMemo(
    () => (data?.stations ?? []).map(s => ({ value: s.id, label: s.name ? `${s.code} — ${s.name}` : s.code })), [data]);
  const customerOpts = useMemo(
    () => (data?.customers ?? []).map(c => ({ value: c.id, label: `${c.mkh} — ${c.name}` })), [data]);

  const zoneName = (id?: string) => data?.zones.find(z => z.id === id)?.name ?? '—';
  const stationCode = (id?: string) => data?.stations.find(s => s.id === id)?.code ?? '—';
  const customerLabel = (id?: string) => {
    const c = data?.customers.find(x => x.id === id);
    return c ? `${c.mkh}` : '—';
  };

  /** Trạm đang chọn ở form điểm đo → suy ra KCN. */
  const pointZoneId = data?.stations.find(s => s.id === pForm.station)?.zone;

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setSaving(key);
    try {
      await fn();
      toast.success('Đã lưu', okMsg);
      await load();
      return true;
    } catch (e) {
      toast.error('Lưu thất bại', pbErrorMessage(e));
      return false;
    } finally {
      setSaving('');
    }
  };

  const del = async (label: string, fn: () => Promise<unknown>) => {
    const ok = await confirm({
      title: `Xóa ${label}?`,
      message: 'Bản ghi bị xóa khỏi PocketBase và không khôi phục được.',
      confirmLabel: 'Xóa',
    });
    if (!ok) return;
    try {
      await fn();
      toast.success('Đã xóa', label);
      await load();
    } catch (e) {
      toast.error('Xóa thất bại', pbErrorMessage(e));
    }
  };

  /* ---------------- hành động lưu ---------------- */
  const saveZone = async () => {
    if (!zForm.code.trim() || !zForm.name.trim()) {
      return toast.warning('Thiếu thông tin', 'Mã và tên KCN là bắt buộc.');
    }
    const ok = await run('zone', () => zones.create({
      code: zForm.code.trim(), name: zForm.name.trim(),
      address: zForm.address.trim(), active: true,
    }), `KCN ${zForm.code.trim()}`);
    if (ok) setZForm({ code: '', name: '', address: '' });
  };

  const saveStation = async () => {
    if (!sForm.code.trim() || !sForm.zone) {
      return toast.warning('Thiếu thông tin', 'Mã trạm và KCN là bắt buộc.');
    }
    const ok = await run('station', () => stations.create({
      code: sForm.code.trim(), name: sForm.name.trim(), zone: sForm.zone,
      sdm_kva: num(sForm.sdm_kva), p0_kw: num(sForm.p0_kw), pk_kw: num(sForm.pk_kw),
    }), `Trạm ${sForm.code.trim()}`);
    if (ok) setSForm({ code: '', name: '', zone: sForm.zone, sdm_kva: '', p0_kw: '', pk_kw: '' });
  };

  const saveCustomer = async () => {
    if (!cForm.mkh.trim() || !cForm.name.trim()) {
      return toast.warning('Thiếu thông tin', 'Mã và tên khách hàng là bắt buộc.');
    }
    const ok = await run('customer', () => customers.create({
      mkh: cForm.mkh.trim(), name: cForm.name.trim(),
      address: cForm.address.trim(), zone: cForm.zone || undefined, active: true,
    }), `Khách hàng ${cForm.mkh.trim()}`);
    if (ok) setCForm({ mkh: '', name: '', address: '', zone: cForm.zone });
  };

  const savePoint = async () => {
    if (!pForm.line_id.trim() || !pForm.line_name.trim() || !pForm.station) {
      return toast.warning('Thiếu thông tin', 'Mã điểm đo, tên và trạm là bắt buộc.');
    }
    const ok = await run('point', () => points.create({
      line_id: pForm.line_id.trim(), line_name: pForm.line_name.trim(),
      station: pForm.station, zone: pointZoneId || undefined,
      customer: pForm.customer || undefined,
      role: pForm.role, connection: pForm.connection,
      hsn: pForm.connection === 'truc_tiep' ? 1 : num(pForm.hsn),
      voltage_level: pForm.voltage_level || undefined,
      status: pForm.status || undefined,
    }), `Điểm đo ${pForm.line_name.trim()}`);
    if (ok) {
      setPForm(f => ({
        ...f, line_id: '', line_name: '', customer: '',
        hsn: f.connection === 'truc_tiep' ? '1' : '',
      }));
    }
  };

  /** Đổi kiểu đấu nối → trực tiếp thì ép HSN = 1. */
  const setConnection = (c: Connection) =>
    setPForm(f => ({ ...f, connection: c, hsn: c === 'truc_tiep' ? '1' : (defaultHsn(c)?.toString() ?? '') }));

  const d = data;
  const busy = (k: string) => saving === k;

  return (
    <div className="space-y-5">
      {dialog}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-soft">
          Khai theo thứ tự: KCN → Trạm → Khách hàng → Điểm đo.
        </p>
        <button onClick={() => void load()} className="vl-btn vl-btn-secondary vl-btn-sm" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Nạp lại</span>
        </button>
      </div>

      {/* ---------------- 1. KCN ---------------- */}
      <Section icon={Building2} hex="#3b82f6" title="Khu công nghiệp" count={d?.zones.length ?? 0}
        subtitle="dm_zone — gốc của cây, khai trước tiên">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Mã KCN" value={zForm.code} required mono
            onChange={v => setZForm(f => ({ ...f, code: v }))} placeholder="KCNTH" />
          <TextField label="Tên KCN" value={zForm.name} required
            onChange={v => setZForm(f => ({ ...f, name: v }))} placeholder="KCN Tiền Hải" />
          <TextField label="Địa chỉ" value={zForm.address}
            onChange={v => setZForm(f => ({ ...f, address: v }))} />
        </div>
        <button onClick={() => void saveZone()} disabled={busy('zone')} className="vl-btn vl-btn-primary vl-btn-sm mt-3">
          <Plus className="h-3.5 w-3.5" /> <span>Thêm KCN</span>
        </button>

        {!!d?.zones.length && (
          <div className="mt-4 overflow-x-auto">
            <table className="vl-table">
              <thead><tr><th>Mã</th><th>Tên</th><th>Địa chỉ</th><th /></tr></thead>
              <tbody>
                {d.zones.map(z => (
                  <tr key={z.id}>
                    <td className="font-mono font-bold">{z.code}</td>
                    <td>{z.name}</td>
                    <td className="text-soft">{z.address || '—'}</td>
                    <td className="text-right">
                      <button onClick={() => void del(`KCN ${z.code}`, () => zones.remove(z.id))}
                        className="p-1.5 rounded text-bad hover:bg-[var(--danger-soft)]" title="Xóa">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------------- 2. Trạm ---------------- */}
      <Section icon={Factory} hex="#10b981" title="Trạm" count={d?.stations.length ?? 0}
        subtitle="dm_station — mỗi trạm thuộc đúng một KCN">
        {!d?.zones.length ? <NeedParent what="ít nhất một KCN" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Mã trạm" value={sForm.code} required mono
                onChange={v => setSForm(f => ({ ...f, code: v }))} placeholder="TH.RICO.T1.2500kVA" />
              <TextField label="Tên trạm" value={sForm.name}
                onChange={v => setSForm(f => ({ ...f, name: v }))} />
              <div>
                <label className={LABEL_CLS}>KCN <span className="text-bad">*</span></label>
                <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chọn KCN" searchable />
              </div>
              <NumberField label="Sdm (kVA)" value={sForm.sdm_kva}
                onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
              <NumberField label="P0 (kW)" value={sForm.p0_kw}
                onChange={v => setSForm(f => ({ ...f, p0_kw: v }))} />
              <NumberField label="Pk (kW)" value={sForm.pk_kw}
                onChange={v => setSForm(f => ({ ...f, pk_kw: v }))} />
            </div>
            <button onClick={() => void saveStation()} disabled={busy('station')} className="vl-btn vl-btn-primary vl-btn-sm mt-3">
              <Plus className="h-3.5 w-3.5" /> <span>Thêm trạm</span>
            </button>
          </>
        )}

        {!!d?.stations.length && (
          <div className="mt-4 overflow-x-auto">
            <table className="vl-table">
              <thead><tr><th>Mã trạm</th><th>KCN</th><th>Sdm</th><th>Điểm đo</th><th /></tr></thead>
              <tbody>
                {d.stations.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono font-bold">{s.code}</td>
                    <td className="text-soft">{zoneName(s.zone)}</td>
                    <td>{s.sdm_kva ?? '—'}</td>
                    <td>{d.points.filter(p => p.station === s.id).length}</td>
                    <td className="text-right">
                      <button onClick={() => void del(`trạm ${s.code}`, () => stations.remove(s.id))}
                        className="p-1.5 rounded text-bad hover:bg-[var(--danger-soft)]" title="Xóa">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------------- 3. Khách hàng ---------------- */}
      <Section icon={Users} hex="#8b5cf6" title="Khách hàng" count={d?.customers.length ?? 0}
        subtitle="dm_customer — một khách hàng có nhiều điểm đo">
        <div className="grid gap-3 sm:grid-cols-4">
          <TextField label="Mã KH" value={cForm.mkh} required mono
            onChange={v => setCForm(f => ({ ...f, mkh: v }))} placeholder="KCNTH-001" />
          <TextField label="Tên khách hàng" value={cForm.name} required
            onChange={v => setCForm(f => ({ ...f, name: v }))} />
          <TextField label="Địa chỉ" value={cForm.address}
            onChange={v => setCForm(f => ({ ...f, address: v }))} />
          <div>
            <label className={LABEL_CLS}>KCN</label>
            <Select value={cForm.zone} onChange={v => setCForm(f => ({ ...f, zone: v }))}
              options={zoneOpts} placeholder="Không bắt buộc" searchable />
          </div>
        </div>
        <button onClick={() => void saveCustomer()} disabled={busy('customer')} className="vl-btn vl-btn-primary vl-btn-sm mt-3">
          <Plus className="h-3.5 w-3.5" /> <span>Thêm khách hàng</span>
        </button>

        {!!d?.customers.length && (
          <div className="mt-4 overflow-x-auto">
            <table className="vl-table">
              <thead><tr><th>Mã KH</th><th>Tên</th><th>KCN</th><th>Điểm đo</th><th /></tr></thead>
              <tbody>
                {d.customers.map(c => (
                  <tr key={c.id}>
                    <td className="font-mono font-bold">{c.mkh}</td>
                    <td>{c.name}</td>
                    <td className="text-soft">{c.zone ? zoneName(c.zone) : '—'}</td>
                    <td>{d.points.filter(p => p.customer === c.id).length}</td>
                    <td className="text-right">
                      <button onClick={() => void del(`khách hàng ${c.mkh}`, () => customers.remove(c.id))}
                        className="p-1.5 rounded text-bad hover:bg-[var(--danger-soft)]" title="Xóa">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------------- 4. Điểm đo ---------------- */}
      <Section icon={Gauge} hex="#f97316" title="Điểm đo" count={d?.points.length ?? 0}
        subtitle="dm_point — thuộc một trạm, gắn một khách hàng, phân chính/phụ">
        {!d?.stations.length ? <NeedParent what="ít nhất một trạm" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Mã điểm đo (LINE_ID)" value={pForm.line_id} required mono
                onChange={v => setPForm(f => ({ ...f, line_id: v }))} placeholder="1024" />
              <TextField label="Tên điểm đo" value={pForm.line_name} required
                onChange={v => setPForm(f => ({ ...f, line_name: v }))} placeholder="TH.RICO.T1.2500kVA" />
              <div>
                <label className={LABEL_CLS}>Trạm <span className="text-bad">*</span></label>
                <Select value={pForm.station} onChange={v => setPForm(f => ({ ...f, station: v }))}
                  options={stationOpts} placeholder="Chọn trạm" searchable />
              </div>

              <div>
                <label className={LABEL_CLS}>KCN (suy từ trạm)</label>
                <div className={`${INPUT_CLS} bg-subtle text-soft`}>{zoneName(pointZoneId)}</div>
              </div>
              <div>
                <label className={LABEL_CLS}>Khách hàng</label>
                <Select value={pForm.customer} onChange={v => setPForm(f => ({ ...f, customer: v }))}
                  options={customerOpts} placeholder="Chưa gắn" searchable />
              </div>
              <div>
                <label className={LABEL_CLS}>Loại điểm đo <span className="text-bad">*</span></label>
                <Select value={pForm.role} onChange={v => setPForm(f => ({ ...f, role: v as PointRole }))}
                  options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
              </div>

              <div>
                <label className={LABEL_CLS}>Đấu nối <span className="text-bad">*</span></label>
                <Select value={pForm.connection} onChange={v => setConnection(v as Connection)}
                  options={Object.entries(CONNECTION_LABEL).map(([value, label]) => ({ value, label }))} />
              </div>
              <NumberField label="HSN" value={pForm.hsn}
                onChange={v => setPForm(f => ({ ...f, hsn: v }))}
                disabled={pForm.connection === 'truc_tiep'}
                hint={pForm.connection === 'truc_tiep'
                  ? 'Đấu trực tiếp: HSN luôn = 1, không có TI để nhân.'
                  : 'Đấu gián tiếp: HSN = tỷ số TI (× TU nếu có).'} />
              <div>
                <label className={LABEL_CLS}>Cấp điện áp</label>
                <Select value={pForm.voltage_level}
                  onChange={v => setPForm(f => ({ ...f, voltage_level: v as VoltageLevel }))}
                  options={Object.entries(VOLTAGE_LABEL).map(([value, label]) => ({ value, label }))}
                  placeholder="Chưa xác định" />
              </div>
              <div>
                <label className={LABEL_CLS}>Trạng thái</label>
                <Select value={pForm.status}
                  onChange={v => setPForm(f => ({ ...f, status: v as PointStatus }))}
                  options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                  placeholder="Chưa xác định" />
              </div>
            </div>

            <div className="vl-alert vl-alert-light-primary mt-3 text-[12px]">
              Điểm đo còn cần <b>1 công tơ</b> + <b>1 đo xa GP-03</b>
              {pForm.connection === 'gian_tiep' && <> và <b>3 TI</b></>} — phần vật tư làm ở bước sau,
              hiện chưa kiểm tra được.
            </div>

            <button onClick={() => void savePoint()} disabled={busy('point')} className="vl-btn vl-btn-primary vl-btn-sm mt-3">
              <Plus className="h-3.5 w-3.5" /> <span>Thêm điểm đo</span>
            </button>
          </>
        )}

        {!!d?.points.length && (
          <div className="mt-4 overflow-x-auto">
            <table className="vl-table">
              <thead>
                <tr><th>Mã</th><th>Tên điểm đo</th><th>Trạm</th><th>Khách hàng</th>
                  <th>Loại</th><th>Đấu nối</th><th>HSN</th><th /></tr>
              </thead>
              <tbody>
                {d.points.map(p => (
                  <tr key={p.id}>
                    <td className="font-mono">{p.line_id}</td>
                    <td className="font-semibold">{p.line_name}</td>
                    <td className="text-soft font-mono text-[11px]">{stationCode(p.station)}</td>
                    <td className="text-soft font-mono text-[11px]">{customerLabel(p.customer)}</td>
                    <td>
                      <span className={p.role === 'chinh' ? 'vl-badge-primary' : 'vl-badge-info'}>
                        {ROLE_LABEL[p.role]}
                      </span>
                    </td>
                    <td>
                      <span className={p.connection === 'gian_tiep' ? 'vl-badge-warning' : 'vl-badge-success'}>
                        {CONNECTION_LABEL[p.connection]}
                      </span>
                    </td>
                    <td className="font-bold">{p.hsn ?? '—'}</td>
                    <td className="text-right">
                      <button onClick={() => void del(`điểm đo ${p.line_name}`, () => points.remove(p.id))}
                        className="p-1.5 rounded text-bad hover:bg-[var(--danger-soft)]" title="Xóa">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
