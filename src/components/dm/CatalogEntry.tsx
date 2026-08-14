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
import { Building2, Factory, Users, Gauge, Plus, Trash2, Edit2, RefreshCw, CornerDownRight } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { Toggle } from '../ui/Toggle';
import { customers, loadCatalog, pbErrorMessage, points, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { CONNECTION_LABEL, ROLE_LABEL, STATUS_LABEL } from '../../lib/dm/types';
import type { Connection, Customer, Point, PointRole, PointStatus, Station, Zone } from '../../lib/dm/types';
import type { Scope } from '../../lib/scope';
import { DerivedValue, Field, FormModal, NumberInput, TableCard, TextInput, TH_CLS } from './entryUi';
import {
  SHORT_NAME_HINT, SUB_PURPOSES, buildPointCode, buildStationCode, isValidShortName,
  missingPointCodeParts, missingStationCodeParts, normalizeShortName,
} from '../../lib/dm/naming';

type CatTab = 'zone' | 'station' | 'customer' | 'point';

const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
  { id: 'point', label: 'Điểm đo', icon: Gauge, sub: 'dm_point' },
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
  point: {
    title: 'Điểm đo',
    desc: 'Điểm đo phụ nằm trong phạm vi đo của một điểm đo chính',
    add: 'Thêm điểm đo',
  },
};

const EMPTY_Z = { code: '', name: '', address: '' };
/** `code` không có trong form trạm — hệ thống tự sinh từ 4 mảnh bên dưới. */
const EMPTY_S = {
  name: '', zone: '', customer: '', ident: '',
  sdm_kva: '', p0_w: '', pk_w: '', note: '',
};
const EMPTY_C = { mkh: '', name: '', short_name: '', address: '', zone: '' };
/** `code` cũng do hệ thống sinh; `customer` chỉ dùng khi là điểm đo phụ. */
const EMPTY_P = {
  station: '', role: 'chinh' as PointRole, connection: 'truc_tiep' as Connection,
  customer: '', parent_point: '', ident: '', hsn: '1',
  /** Chỉ dùng khi điểm phụ trùng KH với điểm chính: mã nhãn, hoặc CUSTOM. */
  purpose: '', purpose_custom: '',
  line_id: '', status: '' as PointStatus, note: '',
};

/** Giá trị đặc biệt của bộ chọn nhãn mục đích: cho gõ tay chuỗi bất kỳ. */
const CUSTOM = '__custom';

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
  const [pForm, setPForm] = useState(EMPTY_P);

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
  const customerOpts = useMemo(
    () => (d?.customers ?? []).map(c => ({
      value: c.id,
      label: c.short_name ? `${c.mkh} — ${c.name} (${c.short_name})` : `${c.mkh} — ${c.name}`,
    })), [d]);
  const stationOpts = useMemo(
    () => (d?.stations ?? []).map(s => ({ value: s.id, label: s.code })), [d]);
  const zoneName = (id?: string) => d?.zones.find(z => z.id === id)?.name ?? '—';
  const customerMkh = (id?: string) => d?.customers.find(c => c.id === id)?.mkh ?? '—';
  const stationsOfZone = (id: string) => d?.stations.filter(s => s.zone === id).length ?? 0;
  const pointsOfStation = (id: string) => d?.points.filter(p => p.station === id).length ?? 0;
  const pointsOfCustomer = (id: string) => d?.points.filter(p => p.customer === id).length ?? 0;

  /* ------------------------- mở modal ------------------------- */
  const openAdd = () => {
    setEditingId(null);
    if (tab === 'zone') setZForm(EMPTY_Z);
    if (tab === 'station') setSForm({ ...EMPTY_S, zone: sForm.zone });
    if (tab === 'customer') setCForm({ ...EMPTY_C, zone: cForm.zone });
    // Giữ trạm đang chọn để khai liên tiếp nhiều điểm đo trong cùng một trạm.
    if (tab === 'point') setPForm({ ...EMPTY_P, station: pForm.station });
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
      name: s.name ?? '', zone: s.zone, customer: s.customer ?? '', ident: s.ident ?? '',
      sdm_kva: str(s.sdm_kva), p0_w: str(s.p0_w), pk_w: str(s.pk_w), note: s.note ?? '',
    });
    setModal('station');
  };
  const editCustomer = (c: Customer) => {
    setEditingId(c.id);
    setCForm({
      mkh: c.mkh, name: c.name, short_name: c.short_name ?? '',
      address: c.address ?? '', zone: c.zone ?? '',
    });
    setModal('customer');
  };

  const editPoint = (p: Point) => {
    setEditingId(p.id);
    // Nhãn đuôi đã lưu: khớp một mục có sẵn thì chọn mục đó, không thì là tự nhập.
    const saved = p.sub_label ?? '';
    const isPreset = SUB_PURPOSES.some(x => x.code === saved);
    setPForm({
      station: p.station, role: p.role, connection: p.connection,
      customer: p.customer ?? '', parent_point: p.parent_point ?? '',
      ident: p.ident ?? '', hsn: str(p.hsn),
      purpose: isPreset ? saved : (saved ? CUSTOM : ''),
      purpose_custom: isPreset ? '' : saved,
      line_id: p.line_id ?? '', status: (p.status ?? '') as PointStatus, note: p.note ?? '',
    });
    setModal('point');
  };

  const closeModal = () => { setModal(null); setEditingId(null); };

  /* ------------------- mã trạm do hệ thống sinh ------------------- */
  const sZone = d?.zones.find(z => z.id === sForm.zone);
  const sCustomer = d?.customers.find(c => c.id === sForm.customer);
  const codeParts = {
    zoneCode: sZone?.code ?? '',
    customerShortName: sCustomer?.short_name ?? '',
    ident: sForm.ident,
    sdmKva: toNum(sForm.sdm_kva) ?? null,
  };
  const stationCode = buildStationCode(codeParts);
  const stationCodeMissing = missingStationCodeParts(codeParts);
  /** KH đã chọn nhưng chưa khai tên tắt → không ghép được mã, phải chỉ rõ. */
  const customerLacksShortName = !!sCustomer && !sCustomer.short_name;

  /* ------------------ mã điểm đo do hệ thống sinh ------------------ */
  const pStation = d?.stations.find(s => s.id === pForm.station);
  const pStationZone = d?.zones.find(z => z.id === pStation?.zone);
  const pStationCustomer = d?.customers.find(c => c.id === pStation?.customer);
  const pSubCustomer = d?.customers.find(c => c.id === pForm.customer);
  const isSub = pForm.role === 'phu';

  /** Điểm đo chính mà điểm phụ này thuộc về (nếu đã chọn). */
  const pParent = d?.points.find(p => p.id === pForm.parent_point);
  /**
   * Điểm phụ TRÙNG khách hàng với điểm chính → lấy tên tắt KH làm đuôi sẽ
   * lặp y hệt phần đầu mã, không phân biệt được. Khi đó dùng nhãn mục đích.
   * Chưa chọn điểm chính thì so với chủ trạm.
   */
  const parentCustomerId = pParent?.customer ?? pStation?.customer ?? '';
  const sameCustomer = isSub && !!pForm.customer && pForm.customer === parentCustomerId;

  const purposeLabel = pForm.purpose === CUSTOM
    ? normalizeShortName(pForm.purpose_custom)
    : pForm.purpose;
  /** Đuôi mã của điểm phụ: nhãn mục đích khi trùng KH, ngược lại là tên tắt KH phụ. */
  const subLabel = sameCustomer ? purposeLabel : (pSubCustomer?.short_name ?? '');

  const pointParts = {
    zoneCode: pStationZone?.code ?? '',
    customerShortName: pStationCustomer?.short_name ?? '',
    ident: pStation?.ident ?? '',
    sdmKva: pStation?.sdm_kva ?? null,   // công suất lấy theo trạm chứa nó
    isSub,
    subLabel,
    pointIdent: pForm.ident,
  };
  const pointCode = buildPointCode(pointParts);
  const pointCodeMissing = missingPointCodeParts(pointParts);

  /** Điểm đo chính trong cùng trạm — nguồn chọn cha cho điểm đo phụ. */
  const parentOpts = useMemo(
    () => (d?.points ?? [])
      .filter(p => p.role === 'chinh' && p.station === pForm.station && p.id !== editingId)
      .map(p => ({ value: p.id, label: p.code || p.line_name || p.id })),
    [d, pForm.station, editingId]);

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
      if (stationCodeMissing.length) {
        return toast.warning('Chưa sinh được mã trạm',
          `Còn thiếu: ${stationCodeMissing.join(', ')}.`);
      }
      const body = {
        code: stationCode, name: sForm.name.trim(), zone: sForm.zone,
        customer: sForm.customer, ident: sForm.ident.trim().toUpperCase(),
        sdm_kva: toNum(sForm.sdm_kva), p0_w: toNum(sForm.p0_w), pk_w: toNum(sForm.pk_w),
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
      const shortName = normalizeShortName(cForm.short_name);
      if (shortName && !isValidShortName(shortName)) {
        return toast.warning('Tên tắt không hợp lệ', SHORT_NAME_HINT);
      }
      const body = {
        mkh: cForm.mkh.trim(), name: cForm.name.trim(), short_name: shortName,
        address: cForm.address.trim(), zone: cForm.zone || undefined, active: true,
      };
      return void persist(
        () => (editingId ? customers.update(editingId, body) : customers.create(body)),
        `Khách hàng ${body.mkh}`);
    }

    if (modal === 'point') {
      if (!pForm.station) {
        return toast.warning('Thiếu thông tin', 'Phải chọn trạm chứa điểm đo.');
      }
      if (pointCodeMissing.length) {
        return toast.warning('Chưa sinh được mã điểm đo',
          `Còn thiếu: ${pointCodeMissing.join(', ')}.`);
      }
      if (isSub && !pForm.parent_point) {
        return toast.warning('Thiếu điểm đo chính',
          'Điểm đo phụ phải nằm trong phạm vi đo của một điểm đo chính.');
      }
      const body = {
        code: pointCode,
        // LINE_NAME bên HES chính là chuỗi mã này — điền luôn để khỏi lệch.
        line_name: pointCode,
        line_id: pForm.line_id.trim(),
        ident: pForm.ident.trim(),
        sub_label: isSub ? subLabel : '',
        station: pForm.station,
        zone: pStation?.zone || undefined,
        // Điểm đo chính thuộc về chủ trạm; điểm đo phụ mang khách hàng riêng.
        customer: isSub ? pForm.customer : (pStation?.customer || undefined),
        parent_point: isSub ? pForm.parent_point : '',
        role: pForm.role,
        connection: pForm.connection,
        hsn: pForm.connection === 'truc_tiep' ? 1 : toNum(pForm.hsn),
        status: pForm.status || undefined,
        note: pForm.note.trim(),
      };
      return void persist(
        () => (editingId ? points.update(editingId, body) : points.create(body)),
        `Điểm đo ${body.code}`);
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

  const stationCodeOf = (id?: string) => d?.stations.find(s => s.id === id)?.code ?? '—';
  const childrenOf = (id: string) => d?.points.filter(p => p.parent_point === id).length ?? 0;

  /**
   * Xếp bảng điểm đo theo phân cấp: mỗi điểm chính kéo theo các điểm phụ của
   * nó (thụt lề). Điểm phụ mất cha, hoặc điểm phụ chưa gán cha, xếp cuối bảng
   * để không biến mất khỏi danh sách.
   */
  const pointRows = useMemo(() => {
    const all = d?.points ?? [];
    const rows: { point: Point; isChild: boolean }[] = [];
    const placed = new Set<string>();

    for (const p of all.filter(x => x.role === 'chinh')) {
      rows.push({ point: p, isChild: false });
      placed.add(p.id);
      for (const child of all.filter(x => x.parent_point === p.id)) {
        rows.push({ point: child, isChild: true });
        placed.add(child.id);
      }
    }
    for (const p of all) {
      if (!placed.has(p.id)) rows.push({ point: p, isChild: false });
    }
    return rows;
  }, [d]);

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
              <th className={TH_CLS}>Khu công nghiệp</th>
              <th className={TH_CLS}>Khách hàng</th>
              <th className={`${TH_CLS} w-32`}>Sdm (kVA)</th>
              <th className={`${TH_CLS} w-40`}>P0 / Pk (W)</th>
              <th className={`${TH_CLS} w-28`}>Điểm đo</th>
              <th className={`${TH_CLS} w-32 pr-10 text-right`}>Thao tác</th>
            </>}>
            {d?.stations.map(s => (
              <tr key={s.id} className="transition-colors hover:bg-subtle/50">
                <td className="px-6 py-4 pl-10 font-mono text-sm font-bold text-ink">{s.code}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    {zoneName(s.zone)}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(s.customer)}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{s.sdm_kva ?? '—'}</td>
                <td className="px-6 py-4 text-sm text-soft">
                  {s.p0_w ?? '—'} / {s.pk_w ?? '—'}
                </td>
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
            <th className={`${TH_CLS} w-40`}>Tên tắt</th>
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
              <td className="px-6 py-4">
                {c.short_name
                  ? <span className="font-mono text-xs font-bold text-dim">{c.short_name}</span>
                  : <span className="text-[11px] italic text-warn">chưa khai</span>}
              </td>
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

      {/* ============================ Điểm đo ============================ */}
      {tab === 'point' && (
        <>
          {!d?.stations.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một trạm ở tab "Trạm" trước khi thêm điểm đo.
            </div>
          )}
          <TableCard loading={loading} isEmpty={(d?.points.length ?? 0) === 0}
            empty="Chưa có điểm đo nào được khai."
            columns={<>
              <th className={`${TH_CLS} pl-10`}>Mã điểm đo</th>
              <th className={TH_CLS}>Trạm</th>
              <th className={TH_CLS}>Khách hàng</th>
              <th className={`${TH_CLS} w-28`}>Loại</th>
              <th className={`${TH_CLS} w-32`}>Đấu nối</th>
              <th className={`${TH_CLS} w-24`}>HSN</th>
              <th className={`${TH_CLS} w-32 pr-10 text-right`}>Thao tác</th>
            </>}>
            {pointRows.map(({ point: p, isChild }) => (
              <tr key={p.id} className="transition-colors hover:bg-subtle/50">
                <td className={`px-6 py-4 ${isChild ? 'pl-16' : 'pl-10'}`}>
                  <span className="flex items-center gap-2">
                    {isChild && <CornerDownRight className="h-4 w-4 shrink-0 text-faint" />}
                    <span className={`font-mono text-sm ${isChild ? 'text-dim' : 'font-bold text-ink'}`}>
                      {p.code || p.line_name || '—'}
                    </span>
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-soft">{stationCodeOf(p.station)}</td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(p.customer)}</td>
                <td className="px-6 py-4">
                  <span className={p.role === 'chinh' ? 'vl-badge-primary' : 'vl-badge-info'}>
                    {ROLE_LABEL[p.role]}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={p.connection === 'gian_tiep' ? 'vl-badge-warning' : 'vl-badge-success'}>
                    {CONNECTION_LABEL[p.connection]}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-bold text-dim">{p.hsn ?? '—'}</td>
                <td className="px-6 py-4 pr-10 text-right">
                  <RowActions onEdit={() => editPoint(p)}
                    onDelete={() => void del(`điểm đo ${p.code || p.line_name}`, () => points.remove(p.id),
                      childrenOf(p.id) > 0
                        ? `Điểm đo này đang có ${childrenOf(p.id)} điểm đo phụ. Xóa nó KHÔNG xóa các điểm phụ — chúng sẽ mất điểm đo chính.`
                        : undefined)} />
                </td>
              </tr>
            ))}
          </TableCard>
        </>
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
            {/* 4 mảnh ghép nên mã trạm — đặt trước, để ô mã bên dưới cập nhật theo */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Khu công nghiệp" required hint={sZone ? `Hậu tố: ${sZone.code}` : undefined}>
                <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chọn KCN" searchable />
              </Field>
              <Field label="Khách hàng" required
                hint={sCustomer?.short_name ? `Tên tắt: ${sCustomer.short_name}` : undefined}>
                <Select value={sForm.customer} onChange={v => setSForm(f => ({ ...f, customer: v }))}
                  options={customerOpts} placeholder="Chọn khách hàng" searchable />
              </Field>
              <Field label="Định danh trạm" required hint="T1, T2, NX1…">
                <TextInput value={sForm.ident} mono placeholder="T1"
                  onChange={v => setSForm(f => ({ ...f, ident: v.toUpperCase() }))} />
              </Field>
              <Field label="Công suất trạm" required>
                <NumberInput value={sForm.sdm_kva} suffix="kVA" placeholder="2500"
                  onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
              </Field>
            </div>

            {customerLacksShortName && (
              <div className="vl-alert vl-alert-light-warning text-[13px]">
                Khách hàng "{sCustomer?.name}" chưa có tên tắt. Sang tab Khách hàng bổ sung tên tắt
                thì mới ghép được mã trạm.
              </div>
            )}

            <Field label="Mã trạm (hệ thống tự sinh)"
              hint="Ghép theo: hậu tố KCN . tên tắt KH . định danh . công suất — không sửa tay được.">
              <DerivedValue value={stationCodeMissing.length ? '' : stationCode}
                placeholder={stationCode || 'Chọn đủ 4 mục phía trên'} />
            </Field>
            {stationCodeMissing.length > 0 && (
              <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                Còn thiếu: {stationCodeMissing.join(', ')}.
              </p>
            )}

            <div className="grid gap-6 sm:grid-cols-3">
              <Field label="Tên trạm">
                <TextInput value={sForm.name} placeholder="Trạm Rico số 1"
                  onChange={v => setSForm(f => ({ ...f, name: v }))} />
              </Field>
              <Field label="Tổn hao không tải" hint="P0">
                <NumberInput value={sForm.p0_w} suffix="W"
                  onChange={v => setSForm(f => ({ ...f, p0_w: v }))} />
              </Field>
              <Field label="Tổn hao ngắn mạch" hint="Pk">
                <NumberInput value={sForm.pk_w} suffix="W"
                  onChange={v => setSForm(f => ({ ...f, pk_w: v }))} />
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
            <Field label="Tên tắt khách hàng" hint={`${SHORT_NAME_HINT} Dùng để sinh mã trạm.`}>
              {/* Chuẩn hoá ngay khi gõ: bỏ dấu, viết hoa, loại ký tự lạ. */}
              <TextInput value={cForm.short_name} mono placeholder="RICO"
                onChange={v => setCForm(f => ({ ...f, short_name: normalizeShortName(v) }))} />
            </Field>
            <Field label="Địa chỉ">
              <TextInput value={cForm.address} onChange={v => setCForm(f => ({ ...f, address: v }))} />
            </Field>
          </>
        )}

        {modal === 'point' && (
          <>
            <Field label="Trạm" required
              hint={pStation ? `KCN ${pStationZone?.code ?? '—'} · KH ${pStationCustomer?.short_name ?? '—'} · ${pStation.ident ?? '—'} · ${pStation.sdm_kva ?? '—'} kVA` : undefined}>
              <Select value={pForm.station} onChange={v => setPForm(f => ({ ...f, station: v, parent_point: '' }))}
                options={stationOpts} placeholder="Chọn trạm" searchable />
            </Field>

            {/* Hai thanh gạt — đúng yêu cầu user */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Đấu nối">
                <Toggle value={pForm.connection}
                  onChange={v => setPForm(f => ({ ...f, connection: v, hsn: v === 'truc_tiep' ? '1' : '' }))}
                  options={[
                    { value: 'truc_tiep', label: CONNECTION_LABEL.truc_tiep, hex: '#10b981' },
                    { value: 'gian_tiep', label: CONNECTION_LABEL.gian_tiep, hex: '#f97316' },
                  ]} />
              </Field>
              <Field label="Loại điểm đo">
                <Toggle value={pForm.role}
                  onChange={v => setPForm(f => ({ ...f, role: v, customer: '', parent_point: '' }))}
                  options={[
                    { value: 'chinh', label: ROLE_LABEL.chinh },
                    { value: 'phu', label: ROLE_LABEL.phu, hex: '#8b5cf6' },
                  ]} />
              </Field>
            </div>

            {/* Điểm đo phụ: cần KH phụ + điểm đo chính chứa nó */}
            {isSub && (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field label="Phụ của điểm đo chính" required
                    hint={pForm.station ? undefined : 'Chọn trạm trước'}>
                    <Select value={pForm.parent_point} onChange={v => setPForm(f => ({ ...f, parent_point: v }))}
                      options={parentOpts} placeholder={parentOpts.length ? 'Chọn điểm đo chính' : 'Trạm này chưa có điểm đo chính'}
                      disabled={!parentOpts.length} searchable />
                  </Field>
                  <Field label="Khách hàng phụ" required
                    hint={pSubCustomer && !pSubCustomer.short_name
                      ? 'KH này chưa khai tên tắt'
                      : 'Tên tắt của KH này thành đuôi mã'}>
                    <Select value={pForm.customer} onChange={v => setPForm(f => ({ ...f, customer: v }))}
                      options={customerOpts} placeholder="Chọn khách hàng phụ" searchable />
                  </Field>
                </div>

                {/* Trùng KH với điểm chính → tên tắt sẽ lặp, phải chọn nhãn mục đích */}
                {sameCustomer && (
                  <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
                    <p className="mb-3 text-[12px] text-soft">
                      Điểm đo phụ này <b className="text-dim">trùng khách hàng</b> với điểm đo chính,
                      nên tên tắt sẽ lặp lại phần đầu mã. Chọn nhãn mục đích để phân biệt.
                    </p>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <Field label="Mục đích điểm đo phụ" required>
                        <Select value={pForm.purpose} onChange={v => setPForm(f => ({ ...f, purpose: v }))}
                          options={[
                            ...SUB_PURPOSES.map(x => ({ value: x.code, label: `${x.label} (${x.code})` })),
                            { value: CUSTOM, label: 'Tự nhập ký tự…' },
                          ]}
                          placeholder="Chọn mục đích" />
                      </Field>
                      {pForm.purpose === CUSTOM && (
                        <Field label="Ký tự tự nhập" required hint={SHORT_NAME_HINT}>
                          <TextInput value={pForm.purpose_custom} mono placeholder="KHO-LANH-2"
                            onChange={v => setPForm(f => ({ ...f, purpose_custom: normalizeShortName(v) }))} />
                        </Field>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Định danh điểm đo" hint="Không bắt buộc. Gõ 0,4 → mã có đuôi (0,4)">
                <TextInput value={pForm.ident} mono placeholder="0,4"
                  onChange={v => setPForm(f => ({ ...f, ident: v }))} />
              </Field>
              <Field label="HSN"
                hint={pForm.connection === 'truc_tiep'
                  ? 'Đấu trực tiếp: HSN luôn = 1, không có TI để nhân.'
                  : 'Đấu gián tiếp: HSN = tỷ số TI (× TU nếu có).'}>
                <NumberInput value={pForm.connection === 'truc_tiep' ? '1' : pForm.hsn}
                  onChange={v => setPForm(f => ({ ...f, hsn: v }))} />
              </Field>
            </div>

            <Field label="Mã điểm đo (hệ thống tự sinh)"
              hint={isSub
                ? `Ghép: mã trạm . ${sameCustomer ? 'nhãn mục đích' : 'tên tắt KH phụ'}(định danh điểm đo)`
                : 'Ghép: mã trạm(định danh điểm đo)'}>
              <DerivedValue value={pointCodeMissing.length ? '' : pointCode}
                placeholder={pForm.station ? pointCode : 'Chọn trạm trước'} />
            </Field>
            {pointCodeMissing.length > 0 && (
              <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                Còn thiếu: {pointCodeMissing.join(', ')}. Các mảnh này lấy từ hồ sơ trạm và khách hàng.
              </p>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="LINE_ID (HES)" hint="Bỏ trống nếu chưa có mã bên HES">
                <TextInput value={pForm.line_id} mono
                  onChange={v => setPForm(f => ({ ...f, line_id: v }))} />
              </Field>
              <Field label="Trạng thái">
                <Select value={pForm.status}
                  onChange={v => setPForm(f => ({ ...f, status: v as PointStatus }))}
                  options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                  placeholder="Chưa xác định" />
              </Field>
            </div>

            <div className="vl-alert vl-alert-light-primary text-[12px]">
              Điểm đo còn cần <b>1 công tơ</b> + <b>1 đo xa GP-03</b>
              {pForm.connection === 'gian_tiep' && <> và <b>3 TI</b></>} — phần vật tư làm ở bước sau,
              hiện chưa kiểm tra được.
            </div>

            <Field label="Ghi chú">
              <TextInput value={pForm.note} onChange={v => setPForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
        )}
      </FormModal>
    </div>
  );
}
