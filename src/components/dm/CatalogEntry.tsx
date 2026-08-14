/**
 * Màn "Danh mục" (khối Văn phòng) — nhập liệu cho 3 bảng nền:
 *   Tab 1 Khu công nghiệp (dm_zone)
 *   Tab 2 Trạm            (dm_station)
 *   Tab 3 Khách hàng      (dm_customer)
 *
 * Điểm đo (dm_point) KHÔNG ở đây — nó thuộc màn "Quản lý trạm & điểm đo" làm ở
 * bước sau, vì còn phải gắn vật tư (công tơ / GP-03 / TI).
 *
 * Mỗi tab = một khu nhập (FormPanel) + một danh sách bản ghi (ListPanel).
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, Factory, Users, Plus, Trash2, RefreshCw } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { customers, loadCatalog, pbErrorMessage, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import type { Scope } from '../../lib/scope';
import { Field, FormGrid, FormPanel, ListPanel, NumberInput, TextInput } from './entryUi';

type CatTab = 'zone' | 'station' | 'customer';

const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
];

const HEX = { zone: '#3b82f6', station: '#10b981', customer: '#8b5cf6' } as const;

const toNum = (s: string): number | undefined => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};

export default function CatalogEntry({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<CatTab>('zone');
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

  const [zForm, setZForm] = useState({ code: '', name: '', address: '' });
  const [sForm, setSForm] = useState({ code: '', name: '', zone: '', sdm_kva: '', p0_kw: '', pk_kw: '', note: '' });
  const [cForm, setCForm] = useState({ mkh: '', name: '', address: '', zone: '' });

  const zoneOpts = useMemo(
    () => (data?.zones ?? []).map(z => ({ value: z.id, label: `${z.code} — ${z.name}` })), [data]);
  const zoneName = (id?: string) => data?.zones.find(z => z.id === id)?.name ?? '—';

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

  const del = async (label: string, fn: () => Promise<unknown>, warn?: string) => {
    const ok = await confirm({
      title: `Xóa ${label}?`,
      message: warn ?? 'Bản ghi bị xóa khỏi PocketBase và không khôi phục được.',
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

  /* ------------------------------ lưu ------------------------------ */
  const saveZone = async () => {
    if (!zForm.code.trim() || !zForm.name.trim()) {
      return toast.warning('Thiếu thông tin', 'Mã và tên KCN là bắt buộc.');
    }
    if (await run('zone', () => zones.create({
      code: zForm.code.trim(), name: zForm.name.trim(),
      address: zForm.address.trim(), active: true,
    }), `KCN ${zForm.code.trim()}`)) setZForm({ code: '', name: '', address: '' });
  };

  const saveStation = async () => {
    if (!sForm.code.trim() || !sForm.zone) {
      return toast.warning('Thiếu thông tin', 'Mã trạm và KCN là bắt buộc.');
    }
    if (await run('station', () => stations.create({
      code: sForm.code.trim(), name: sForm.name.trim(), zone: sForm.zone,
      sdm_kva: toNum(sForm.sdm_kva), p0_kw: toNum(sForm.p0_kw), pk_kw: toNum(sForm.pk_kw),
      note: sForm.note.trim(),
    }), `Trạm ${sForm.code.trim()}`)) {
      // Giữ lại KCN đang chọn để khai liên tiếp nhiều trạm cùng khu.
      setSForm({ code: '', name: '', zone: sForm.zone, sdm_kva: '', p0_kw: '', pk_kw: '', note: '' });
    }
  };

  const saveCustomer = async () => {
    if (!cForm.mkh.trim() || !cForm.name.trim()) {
      return toast.warning('Thiếu thông tin', 'Mã và tên khách hàng là bắt buộc.');
    }
    if (await run('customer', () => customers.create({
      mkh: cForm.mkh.trim(), name: cForm.name.trim(),
      address: cForm.address.trim(), zone: cForm.zone || undefined, active: true,
    }), `Khách hàng ${cForm.mkh.trim()}`)) {
      setCForm({ mkh: '', name: '', address: '', zone: cForm.zone });
    }
  };

  const SaveButton = ({ label, busyKey, onClick }: { label: string; busyKey: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={saving === busyKey} className="vl-btn vl-btn-primary">
      <Plus className="h-4 w-4" />
      <span>{saving === busyKey ? 'Đang lưu…' : label}</span>
    </button>
  );

  const DeleteButton = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} title="Xóa"
      className="rounded-lg p-2 text-bad transition-colors hover:bg-[var(--danger-soft)]">
      <Trash2 className="h-4 w-4" />
    </button>
  );

  const d = data;
  const pointsOfStation = (id: string) => d?.points.filter(p => p.station === id).length ?? 0;
  const pointsOfCustomer = (id: string) => d?.points.filter(p => p.customer === id).length ?? 0;
  const stationsOfZone = (id: string) => d?.stations.filter(s => s.zone === id).length ?? 0;

  return (
    <div className="space-y-5">
      {dialog}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />
        <button onClick={() => void load()} className="vl-btn vl-btn-secondary vl-btn-sm" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Nạp lại</span>
        </button>
      </div>

      {/* ============================ KCN ============================ */}
      {tab === 'zone' && (
        <>
          <FormPanel icon={Building2} hex={HEX.zone} title="Thêm khu công nghiệp"
            subtitle="Gốc của cây đơn vị — khai trước trạm và điểm đo"
            footer={<SaveButton label="Thêm KCN" busyKey="zone" onClick={() => void saveZone()} />}>
            <FormGrid>
              <Field label="Mã KCN" required>
                <TextInput value={zForm.code} mono placeholder="KCNTH"
                  onChange={v => setZForm(f => ({ ...f, code: v }))} />
              </Field>
              <Field label="Tên KCN" required>
                <TextInput value={zForm.name} placeholder="KCN Tiền Hải"
                  onChange={v => setZForm(f => ({ ...f, name: v }))} />
              </Field>
              <Field label="Địa chỉ">
                <TextInput value={zForm.address} placeholder="Xã…, tỉnh…"
                  onChange={v => setZForm(f => ({ ...f, address: v }))} />
              </Field>
            </FormGrid>
          </FormPanel>

          <ListPanel title="Khu công nghiệp đã khai" count={d?.zones.length ?? 0}
            empty="Chưa có KCN nào. Khai bản ghi đầu tiên ở khu nhập phía trên.">
            <table className="vl-table">
              <thead><tr><th>Mã</th><th>Tên</th><th>Địa chỉ</th><th>Số trạm</th><th /></tr></thead>
              <tbody>
                {d?.zones.map(z => (
                  <tr key={z.id}>
                    <td className="font-mono font-bold">{z.code}</td>
                    <td className="font-semibold">{z.name}</td>
                    <td className="text-soft">{z.address || '—'}</td>
                    <td>{stationsOfZone(z.id)}</td>
                    <td className="text-right">
                      <DeleteButton onClick={() => void del(`KCN ${z.code}`, () => zones.remove(z.id),
                        stationsOfZone(z.id) > 0
                          ? `KCN này đang có ${stationsOfZone(z.id)} trạm. Xóa KCN KHÔNG xóa trạm — các trạm đó sẽ mất KCN cha.`
                          : undefined)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListPanel>
        </>
      )}

      {/* ============================ Trạm ============================ */}
      {tab === 'station' && (
        <>
          {!d?.zones.length ? (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm trạm.
            </div>
          ) : (
            <FormPanel icon={Factory} hex={HEX.station} title="Thêm trạm"
              subtitle="Mỗi trạm thuộc đúng một KCN — một KCN có nhiều trạm"
              footer={<SaveButton label="Thêm trạm" busyKey="station" onClick={() => void saveStation()} />}>
              <FormGrid>
                <Field label="Mã trạm" required>
                  <TextInput value={sForm.code} mono placeholder="TH.RICO.T1.2500kVA"
                    onChange={v => setSForm(f => ({ ...f, code: v }))} />
                </Field>
                <Field label="Tên trạm">
                  <TextInput value={sForm.name} placeholder="Trạm Rico số 1"
                    onChange={v => setSForm(f => ({ ...f, name: v }))} />
                </Field>
                <Field label="Khu công nghiệp" required>
                  <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                    options={zoneOpts} placeholder="Chọn KCN" searchable />
                </Field>
                <Field label="Công suất định mức">
                  <NumberInput value={sForm.sdm_kva} suffix="kVA" placeholder="2500"
                    onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
                </Field>
                <Field label="Tổn hao không tải" hint="P0 — dùng cho tính tổn thất MBA">
                  <NumberInput value={sForm.p0_kw} suffix="kW"
                    onChange={v => setSForm(f => ({ ...f, p0_kw: v }))} />
                </Field>
                <Field label="Tổn hao ngắn mạch" hint="Pk — dùng cho tính tổn thất MBA">
                  <NumberInput value={sForm.pk_kw} suffix="kW"
                    onChange={v => setSForm(f => ({ ...f, pk_kw: v }))} />
                </Field>
                <Field label="Ghi chú" className="sm:col-span-2 lg:col-span-3">
                  <TextInput value={sForm.note}
                    onChange={v => setSForm(f => ({ ...f, note: v }))} />
                </Field>
              </FormGrid>
            </FormPanel>
          )}

          <ListPanel title="Trạm đã khai" count={d?.stations.length ?? 0}
            empty="Chưa có trạm nào.">
            <table className="vl-table">
              <thead><tr><th>Mã trạm</th><th>Tên</th><th>KCN</th><th>Sdm (kVA)</th><th>Điểm đo</th><th /></tr></thead>
              <tbody>
                {d?.stations.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono font-bold">{s.code}</td>
                    <td>{s.name || '—'}</td>
                    <td className="text-soft">{zoneName(s.zone)}</td>
                    <td>{s.sdm_kva ?? '—'}</td>
                    <td>{pointsOfStation(s.id)}</td>
                    <td className="text-right">
                      <DeleteButton onClick={() => void del(`trạm ${s.code}`, () => stations.remove(s.id),
                        pointsOfStation(s.id) > 0
                          ? `Trạm này đang có ${pointsOfStation(s.id)} điểm đo. Xóa trạm KHÔNG xóa điểm đo — chúng sẽ mất trạm cha.`
                          : undefined)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListPanel>
        </>
      )}

      {/* ========================= Khách hàng ========================= */}
      {tab === 'customer' && (
        <>
          <FormPanel icon={Users} hex={HEX.customer} title="Thêm khách hàng"
            subtitle="Một khách hàng có nhiều điểm đo, có thể nằm ở nhiều trạm"
            footer={<SaveButton label="Thêm khách hàng" busyKey="customer" onClick={() => void saveCustomer()} />}>
            <FormGrid>
              <Field label="Mã khách hàng" required>
                <TextInput value={cForm.mkh} mono placeholder="KCNTH-001"
                  onChange={v => setCForm(f => ({ ...f, mkh: v }))} />
              </Field>
              <Field label="Tên khách hàng" required>
                <TextInput value={cForm.name} placeholder="CÔNG TY TNHH…"
                  onChange={v => setCForm(f => ({ ...f, name: v }))} />
              </Field>
              <Field label="Khu công nghiệp" hint="Không bắt buộc — KCN chính của khách hàng">
                <Select value={cForm.zone} onChange={v => setCForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chưa gắn" searchable />
              </Field>
              <Field label="Địa chỉ" className="sm:col-span-2 lg:col-span-3">
                <TextInput value={cForm.address}
                  onChange={v => setCForm(f => ({ ...f, address: v }))} />
              </Field>
            </FormGrid>
          </FormPanel>

          <ListPanel title="Khách hàng đã khai" count={d?.customers.length ?? 0}
            empty="Chưa có khách hàng nào.">
            <table className="vl-table">
              <thead><tr><th>Mã KH</th><th>Tên</th><th>KCN</th><th>Địa chỉ</th><th>Điểm đo</th><th /></tr></thead>
              <tbody>
                {d?.customers.map(c => (
                  <tr key={c.id}>
                    <td className="font-mono font-bold">{c.mkh}</td>
                    <td className="font-semibold">{c.name}</td>
                    <td className="text-soft">{c.zone ? zoneName(c.zone) : '—'}</td>
                    <td className="text-soft">{c.address || '—'}</td>
                    <td>{pointsOfCustomer(c.id)}</td>
                    <td className="text-right">
                      <DeleteButton onClick={() => void del(`khách hàng ${c.mkh}`, () => customers.remove(c.id),
                        pointsOfCustomer(c.id) > 0
                          ? `Khách hàng này đang gắn ${pointsOfCustomer(c.id)} điểm đo. Xóa KH KHÔNG xóa điểm đo — chúng sẽ không còn chủ.`
                          : undefined)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListPanel>
        </>
      )}
    </div>
  );
}
