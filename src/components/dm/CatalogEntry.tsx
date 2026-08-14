/**
 * Màn "Danh mục" (khối Văn phòng) — 3 bảng nền:
 *   Tab 1 Khu công nghiệp (dm_zone)
 *   Tab 2 Trạm            (dm_station)
 *   Tab 3 Khách hàng      (dm_customer)
 *
 * Điểm đo (dm_point) KHÔNG ở đây — thuộc màn "Quản lý trạm & điểm đo" làm sau,
 * vì còn phải gắn vật tư (công tơ / GP-03 / TI).
 *
 * Khuôn giao diện bám mẫu `ElectricShiftManager`: tiêu đề + nút "Thêm …" ở đầu,
 * bảng full-width bên dưới, form nhập nằm trong MODAL nổi (không đặt cố định
 * đầu trang). Thêm và Sửa dùng chung một modal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, Factory, Users, Plus, Trash2, Edit2, RefreshCw } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { customers, loadCatalog, pbErrorMessage, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import type { Customer, Station, Zone } from '../../lib/dm/types';
import type { Scope } from '../../lib/scope';
import { Field, FormModal, NumberInput, TableCard, TextInput, TH_CLS } from './entryUi';

type CatTab = 'zone' | 'station' | 'customer';

const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
];

const HEAD: Record<CatTab, { title: string; desc: string; add: string }> = {
  zone: {
    title: 'Khu công nghiệp',
    desc: 'Gốc của cây đơn vị — khai trước trạm và điểm đo',
    add: 'Thêm KCN',
  },
  station: {
    title: 'Trạm',
    desc: 'Mỗi trạm thuộc đúng một KCN — một KCN có nhiều trạm',
    add: 'Thêm trạm',
  },
  customer: {
    title: 'Khách hàng',
    desc: 'Một khách hàng có nhiều điểm đo, có thể nằm ở nhiều trạm',
    add: 'Thêm khách hàng',
  },
};

const EMPTY_Z = { code: '', name: '', address: '' };
const EMPTY_S = { code: '', name: '', zone: '', sdm_kva: '', p0_kw: '', pk_kw: '', note: '' };
const EMPTY_C = { mkh: '', name: '', address: '', zone: '' };

const toNum = (s: string): number | undefined => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};
const str = (n?: number) => (n == null ? '' : String(n));

export default function CatalogEntry({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<CatTab>('zone');
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  /** Modal đang mở cho bảng nào; `editingId` rỗng = thêm mới. */
  const [modal, setModal] = useState<CatTab | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [zForm, setZForm] = useState(EMPTY_Z);
  const [sForm, setSForm] = useState(EMPTY_S);
  const [cForm, setCForm] = useState(EMPTY_C);

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

  const d = data;
  const zoneOpts = useMemo(
    () => (d?.zones ?? []).map(z => ({ value: z.id, label: `${z.code} — ${z.name}` })), [d]);
  const zoneName = (id?: string) => d?.zones.find(z => z.id === id)?.name ?? '—';
  const stationsOfZone = (id: string) => d?.stations.filter(s => s.zone === id).length ?? 0;
  const pointsOfStation = (id: string) => d?.points.filter(p => p.station === id).length ?? 0;
  const pointsOfCustomer = (id: string) => d?.points.filter(p => p.customer === id).length ?? 0;

  /* ------------------------- mở modal ------------------------- */
  const openAdd = () => {
    setEditingId(null);
    if (tab === 'zone') setZForm(EMPTY_Z);
    if (tab === 'station') setSForm({ ...EMPTY_S, zone: sForm.zone });
    if (tab === 'customer') setCForm({ ...EMPTY_C, zone: cForm.zone });
    setModal(tab);
  };

  const editZone = (z: Zone) => {
    setEditingId(z.id);
    setZForm({ code: z.code, name: z.name, address: z.address ?? '' });
    setModal('zone');
  };
  const editStation = (s: Station) => {
    setEditingId(s.id);
    setSForm({
      code: s.code, name: s.name ?? '', zone: s.zone,
      sdm_kva: str(s.sdm_kva), p0_kw: str(s.p0_kw), pk_kw: str(s.pk_kw), note: s.note ?? '',
    });
    setModal('station');
  };
  const editCustomer = (c: Customer) => {
    setEditingId(c.id);
    setCForm({ mkh: c.mkh, name: c.name, address: c.address ?? '', zone: c.zone ?? '' });
    setModal('customer');
  };

  const closeModal = () => { setModal(null); setEditingId(null); };

  /* --------------------------- lưu --------------------------- */
  const persist = async (fn: () => Promise<unknown>, okMsg: string) => {
    setSaving(true);
    try {
      await fn();
      toast.success(editingId ? 'Đã cập nhật' : 'Đã lưu', okMsg);
      closeModal();
      await load();
    } catch (e) {
      toast.error('Lưu thất bại', pbErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (modal === 'zone') {
      if (!zForm.code.trim() || !zForm.name.trim()) {
        return toast.warning('Thiếu thông tin', 'Mã và tên KCN là bắt buộc.');
      }
      const body = {
        code: zForm.code.trim(), name: zForm.name.trim(),
        address: zForm.address.trim(), active: true,
      };
      return void persist(
        () => (editingId ? zones.update(editingId, body) : zones.create(body)),
        `KCN ${body.code}`);
    }

    if (modal === 'station') {
      if (!sForm.code.trim() || !sForm.zone) {
        return toast.warning('Thiếu thông tin', 'Mã trạm và KCN là bắt buộc.');
      }
      const body = {
        code: sForm.code.trim(), name: sForm.name.trim(), zone: sForm.zone,
        sdm_kva: toNum(sForm.sdm_kva), p0_kw: toNum(sForm.p0_kw), pk_kw: toNum(sForm.pk_kw),
        note: sForm.note.trim(),
      };
      return void persist(
        () => (editingId ? stations.update(editingId, body) : stations.create(body)),
        `Trạm ${body.code}`);
    }

    if (modal === 'customer') {
      if (!cForm.mkh.trim() || !cForm.name.trim()) {
        return toast.warning('Thiếu thông tin', 'Mã và tên khách hàng là bắt buộc.');
      }
      const body = {
        mkh: cForm.mkh.trim(), name: cForm.name.trim(),
        address: cForm.address.trim(), zone: cForm.zone || undefined, active: true,
      };
      return void persist(
        () => (editingId ? customers.update(editingId, body) : customers.create(body)),
        `Khách hàng ${body.mkh}`);
    }
  };

  const del = async (label: string, fn: () => Promise<unknown>, warn?: string) => {
    const ok = await confirm({
      title: `Xóa ${label}?`,
      message: warn ?? 'Bản ghi bị xóa khỏi PocketBase và không khôi phục được.',
      confirmLabel: 'Xóa', variant: 'danger',
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

  /** Cụm nút sửa/xóa cuối mỗi hàng — khuôn giống các màn cũ. */
  const RowActions = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => (
    <div className="flex justify-end gap-2">
      <button onClick={onEdit} title="Sửa"
        className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
        <Edit2 className="h-5 w-5" />
      </button>
      <button onClick={onDelete} title="Xóa"
        className="rounded p-2 text-soft transition-colors hover:bg-[var(--danger-soft)] hover:text-red-500">
        <Trash2 className="h-5 w-5" />
      </button>
    </div>
  );

  const head = HEAD[tab];
  const modalTitle = editingId
    ? `Chỉnh sửa ${HEAD[modal ?? tab].title.toLowerCase()}`
    : HEAD[modal ?? tab].add;

  return (
    <div className="relative space-y-6">
      {dialog}

      {/* ---------- Đầu trang: tiêu đề + hành động ---------- */}
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">{head.title}</h2>
          <p className="mt-1 text-sm text-soft">{head.desc}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <button onClick={() => void load()} disabled={loading} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Nạp lại
          </button>
          <button onClick={openAdd} className="flex flex-1 items-center justify-center gap-2 vl-btn vl-btn-primary md:flex-none">
            <Plus className="h-5 w-5" />
            {head.add}
          </button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={t => setTab(t)} />

      {/* ============================ KCN ============================ */}
      {tab === 'zone' && (
        <TableCard loading={loading} isEmpty={(d?.zones.length ?? 0) === 0}
          empty="Chưa có khu công nghiệp nào được khai."
          columns={<>
            <th className={`${TH_CLS} w-40 pl-10`}>Mã KCN</th>
            <th className={TH_CLS}>Tên khu công nghiệp</th>
            <th className={TH_CLS}>Địa chỉ</th>
            <th className={`${TH_CLS} w-28`}>Số trạm</th>
            <th className={`${TH_CLS} w-32 pr-10 text-right`}>Thao tác</th>
          </>}>
          {d?.zones.map(z => (
            <tr key={z.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{z.code}</span>
              </td>
              <td className="px-6 py-4 font-bold text-ink">{z.name}</td>
              <td className="px-6 py-4 text-sm text-soft">{z.address || '—'}</td>
              <td className="px-6 py-4 text-sm font-semibold text-dim">{stationsOfZone(z.id)}</td>
              <td className="px-6 py-4 pr-10 text-right">
                <RowActions onEdit={() => editZone(z)}
                  onDelete={() => void del(`KCN ${z.code}`, () => zones.remove(z.id),
                    stationsOfZone(z.id) > 0
                      ? `KCN này đang có ${stationsOfZone(z.id)} trạm. Xóa KCN KHÔNG xóa trạm — các trạm đó sẽ mất KCN cha.`
                      : undefined)} />
              </td>
            </tr>
          ))}
        </TableCard>
      )}

      {/* ============================ Trạm ============================ */}
      {tab === 'station' && (
        <>
          {!d?.zones.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm trạm.
            </div>
          )}
          <TableCard loading={loading} isEmpty={(d?.stations.length ?? 0) === 0}
            empty="Chưa có trạm nào được khai."
            columns={<>
              <th className={`${TH_CLS} pl-10`}>Mã trạm</th>
              <th className={TH_CLS}>Tên trạm</th>
              <th className={TH_CLS}>Khu công nghiệp</th>
              <th className={`${TH_CLS} w-32`}>Sdm (kVA)</th>
              <th className={`${TH_CLS} w-28`}>Điểm đo</th>
              <th className={`${TH_CLS} w-32 pr-10 text-right`}>Thao tác</th>
            </>}>
            {d?.stations.map(s => (
              <tr key={s.id} className="transition-colors hover:bg-subtle/50">
                <td className="px-6 py-4 pl-10 font-mono text-sm font-bold text-ink">{s.code}</td>
                <td className="px-6 py-4 text-sm text-dim">{s.name || '—'}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    {zoneName(s.zone)}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{s.sdm_kva ?? '—'}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{pointsOfStation(s.id)}</td>
                <td className="px-6 py-4 pr-10 text-right">
                  <RowActions onEdit={() => editStation(s)}
                    onDelete={() => void del(`trạm ${s.code}`, () => stations.remove(s.id),
                      pointsOfStation(s.id) > 0
                        ? `Trạm này đang có ${pointsOfStation(s.id)} điểm đo. Xóa trạm KHÔNG xóa điểm đo — chúng sẽ mất trạm cha.`
                        : undefined)} />
                </td>
              </tr>
            ))}
          </TableCard>
        </>
      )}

      {/* ========================= Khách hàng ========================= */}
      {tab === 'customer' && (
        <TableCard loading={loading} isEmpty={(d?.customers.length ?? 0) === 0}
          empty="Chưa có khách hàng nào được khai."
          columns={<>
            <th className={`${TH_CLS} w-44 pl-10`}>Mã KH</th>
            <th className={TH_CLS}>Tên khách hàng</th>
            <th className={TH_CLS}>Khu công nghiệp</th>
            <th className={TH_CLS}>Địa chỉ</th>
            <th className={`${TH_CLS} w-28`}>Điểm đo</th>
            <th className={`${TH_CLS} w-32 pr-10 text-right`}>Thao tác</th>
          </>}>
          {d?.customers.map(c => (
            <tr key={c.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{c.mkh}</span>
              </td>
              <td className="px-6 py-4 font-bold text-ink">{c.name}</td>
              <td className="px-6 py-4 text-sm text-soft">{c.zone ? zoneName(c.zone) : '—'}</td>
              <td className="px-6 py-4 text-sm text-soft">{c.address || '—'}</td>
              <td className="px-6 py-4 text-sm font-semibold text-dim">{pointsOfCustomer(c.id)}</td>
              <td className="px-6 py-4 pr-10 text-right">
                <RowActions onEdit={() => editCustomer(c)}
                  onDelete={() => void del(`khách hàng ${c.mkh}`, () => customers.remove(c.id),
                    pointsOfCustomer(c.id) > 0
                      ? `Khách hàng này đang gắn ${pointsOfCustomer(c.id)} điểm đo. Xóa KH KHÔNG xóa điểm đo — chúng sẽ không còn chủ.`
                      : undefined)} />
              </td>
            </tr>
          ))}
        </TableCard>
      )}

      {/* ============================ Modal ============================ */}
      <FormModal open={modal !== null} title={modalTitle} onClose={closeModal} onSubmit={submit} saving={saving}>
        {modal === 'zone' && (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Mã KCN" required>
                <TextInput value={zForm.code} mono placeholder="KCNTH"
                  onChange={v => setZForm(f => ({ ...f, code: v }))} />
              </Field>
              <Field label="Tên KCN" required>
                <TextInput value={zForm.name} placeholder="KCN Tiền Hải"
                  onChange={v => setZForm(f => ({ ...f, name: v }))} />
              </Field>
            </div>
            <Field label="Địa chỉ">
              <TextInput value={zForm.address} placeholder="Xã…, tỉnh…"
                onChange={v => setZForm(f => ({ ...f, address: v }))} />
            </Field>
          </>
        )}

        {modal === 'station' && (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Mã trạm" required>
                <TextInput value={sForm.code} mono placeholder="TH.RICO.T1.2500kVA"
                  onChange={v => setSForm(f => ({ ...f, code: v }))} />
              </Field>
              <Field label="Tên trạm">
                <TextInput value={sForm.name} placeholder="Trạm Rico số 1"
                  onChange={v => setSForm(f => ({ ...f, name: v }))} />
              </Field>
            </div>
            <Field label="Khu công nghiệp" required>
              <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                options={zoneOpts} placeholder="Chọn KCN" searchable />
            </Field>
            <div className="grid gap-6 sm:grid-cols-3">
              <Field label="Công suất định mức">
                <NumberInput value={sForm.sdm_kva} suffix="kVA" placeholder="2500"
                  onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
              </Field>
              <Field label="Tổn hao không tải" hint="P0">
                <NumberInput value={sForm.p0_kw} suffix="kW"
                  onChange={v => setSForm(f => ({ ...f, p0_kw: v }))} />
              </Field>
              <Field label="Tổn hao ngắn mạch" hint="Pk">
                <NumberInput value={sForm.pk_kw} suffix="kW"
                  onChange={v => setSForm(f => ({ ...f, pk_kw: v }))} />
              </Field>
            </div>
            <Field label="Ghi chú">
              <TextInput value={sForm.note} onChange={v => setSForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
        )}

        {modal === 'customer' && (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Mã khách hàng" required>
                <TextInput value={cForm.mkh} mono placeholder="KCNTH-001"
                  onChange={v => setCForm(f => ({ ...f, mkh: v }))} />
              </Field>
              <Field label="Khu công nghiệp" hint="Không bắt buộc">
                <Select value={cForm.zone} onChange={v => setCForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chưa gắn" searchable />
              </Field>
            </div>
            <Field label="Tên khách hàng" required>
              <TextInput value={cForm.name} placeholder="CÔNG TY TNHH…"
                onChange={v => setCForm(f => ({ ...f, name: v }))} />
            </Field>
            <Field label="Địa chỉ">
              <TextInput value={cForm.address} onChange={v => setCForm(f => ({ ...f, address: v }))} />
            </Field>
          </>
        )}
      </FormModal>
    </div>
  );
}
