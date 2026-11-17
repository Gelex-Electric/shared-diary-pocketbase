/**
 * Màn "Danh mục" (khối Văn phòng) — 4 bảng:
 *   Tab 1 Khu công nghiệp (dm_zone)
 *   Tab 2 Trạm            (dm_station)
 *   Tab 3 Khách hàng      (dm_customer)
 *   Tab 4 Điểm đo         (dm_point)
 *
 * Mã trạm và mã điểm đo do hệ thống sinh (xem `lib/dm/naming.ts`), không gõ tay.
 * Điểm đo phụ phải trỏ về một điểm đo chính cùng trạm và được thụt lề dưới nó.
 *
 * Khuôn giao diện bám mẫu `ElectricShiftManager`: tiêu đề + nút "Thêm …" ở đầu,
 * bảng full-width bên dưới, form nhập nằm trong MODAL nổi (không đặt cố định
 * đầu trang). Thêm và Sửa dùng chung một modal.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Cable, Factory, Users, Gauge, Package, PackageCheck,
  Plus, Trash2, Edit2, RefreshCw, CornerDownRight, FileText, History, ArrowLeftRight, Search,
  CaseLower, TriangleAlert, UserCheck, Zap,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { Toggle } from '../ui/Toggle';
import { Switch } from '../ui/Switch';
/* Luật chọn P0/Pk nằm ở `scripts/lib/lossParams.mjs` để pipeline (Node thuần,
   Actions không `npm ci` nên không có tsx) và app dùng CHUNG một bản. */
import { estimateLossParams } from '@/scripts/lib/lossParams.mjs';
import { DatePicker } from '../ui/DateTimePickers';
import { assets, borrows, customers, devices, isAbortError, lines, loadCatalog, pbErrorMessage, points, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { ASSET_LABEL, ROLE_LABEL } from '../../lib/dm/types';
import { isHeadPoint, pointZoneId } from '../../lib/dm/pointScope';
import type {
  AssetType, Customer, Line, Point, PointRole, Station,
  VoltageLevel, Zone,
} from '../../lib/dm/types';
import { connectionOfHsn, formatRatio, hsnFormula } from '../../lib/dm/hsn';
import { deviceRatio, freeDevices, type SetOption } from '../../lib/dm/tutiPick';
import { TI_PER_SET } from '../../lib/dm/pointStatus';
import type { Scope } from '../../lib/scope';
import {
  CellInput, DerivedValue, Field, FormModal, NumberInput, TableCard, TextInput, TH_CLS,
} from './entryUi';
import { PointBadgeChip, PointBadgeIcon, StatusTag } from './pointIcons';
import { invoicesOfMkh, invoicesOfSerial, loadCustomerFacts } from '../../lib/dm/invoiceRepo';
import { isEmptyPlan, latestByMkh, planCustomerSync } from '../../lib/dm/customerSync';
import { ISSUE_LABEL, autoFillable, checkLowName, planLowNameFix, toLowName } from '../../lib/dm/lowName';
import type { LowNameRow } from '../../lib/dm/lowName';
import { bySerial, dmy, dmyRange, segmentOf, segmentsOf } from '../../lib/dm/lifecycle';
import type { Segment } from '../../lib/dm/lifecycle';
import { CUSTOM, checkPointForm, type MkhMeter } from '../../lib/dm/pointCheck';
import { savePoint } from '../../lib/dm/pointSave';
import { groupByZone, sortByCode, sortByMkh } from './groupByZone';
import AssetLifecycle from './AssetLifecycle';
import StockEntry from './StockEntry';
import SupplyAllocate from './SupplyAllocate';
import { TransferOwner } from './TransferOwner';
import LineAssign from './LineAssign';
import PointNeedEditor, { needFromRows, rowsFromNeed, type NeedRow } from './PointNeedEditor';
import { HAS_RATIO, liveFirst } from '../../lib/dm/supply';
import {
  addRow as addRowIn, applyRowRules as applyRowRulesIn, applySet as applySetIn,
  hsnSig, liveElsewhere as liveElsewhereIn, lockedOn as lockedOnIn,
  newRowKey, ymdOf, type AssetRow, type RowCtx,
} from '../../lib/dm/pointForm';
import { runReconcile } from '../../lib/dm/reconcileRun';
import { ZoneTables } from './ZoneTables';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import {
  SHORT_NAME_HINT, SUB_PURPOSES, buildStationCode, isValidShortName,
  missingStationCodeParts, normalizeShortName,
} from '../../lib/dm/naming';

/**
 * `lifecycle` là tab TRA CỨU, không phải bảng khai báo: nó nhúng nguyên màn
 * "Vòng đời vật tư" vào cuối dãy tab (user chốt 25/08/2026) thay vì đứng riêng
 * ngoài menu — người dùng khai điểm đo xong là đối chiếu ngay tại chỗ.
 */
export type CatTab = 'zone' | 'line' | 'station' | 'customer' | 'point' | 'stock' | 'supply' | 'lifecycle';

const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'line', label: 'Lộ đường dây', icon: Cable, sub: 'dm_line' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
  { id: 'point', label: 'Điểm đo', icon: Gauge, sub: 'dm_point' },
  { id: 'stock', label: 'Kho vật tư', icon: Package, sub: 'Thiết bị · vòng đời' },
  { id: 'supply', label: 'Gắn vật tư dự kiến', icon: PackageCheck, sub: 'Gắn số No vào nhu cầu' },
  { id: 'lifecycle', label: 'Rà soát', icon: History, sub: 'Đối chiếu hóa đơn' },
];

/** Tiêu đề + nút Thêm của từng tab KHAI BÁO; tab `lifecycle` không có (chỉ tra cứu). */
/** Gợi ý trong ô tìm kiếm — nói đúng cột nào tìm được, kẻo gõ mò. */
const SEARCH_HINT: Record<Exclude<CatTab, 'lifecycle' | 'stock' | 'supply'>, string> = {
  zone: 'Tìm mã KCN, tên, địa chỉ...',
  line: 'Tìm mã lộ, tên lộ...',
  station: 'Tìm mã trạm, MKH, tên khách hàng...',
  customer: 'Tìm MKH, tên công ty, tên tắt, địa chỉ...',
  point: 'Tìm mã điểm đo, trạm, MKH, tên khách hàng...',
};

const HEAD: Record<Exclude<CatTab, 'lifecycle' | 'stock' | 'supply'>, { title: string; desc: string; add: string }> = {
  zone: {
    title: 'Khu công nghiệp',
    desc: 'Gốc của cây đơn vị — khai trước trạm và điểm đo',
    add: 'Thêm KCN',
  },
  line: {
    title: 'Lộ đường dây',
    desc: 'Một KCN có nhiều lộ; một lộ không vắt sang KCN khác',
    add: 'Thêm lộ',
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
/*
  Mã lộ NHẬP TAY, không sinh tự động như mã trạm/điểm đo: mã lộ là tên ngoài
  đời do ngành điện đặt ("471-E27.1"), không suy ra được từ dữ liệu trong app.
*/
const EMPTY_L = {
  code: '', name: '', zone: '', note: '', active: true,
  voltage_level: 'MV' as VoltageLevel,
};
/** `code` không có trong form trạm — hệ thống tự sinh từ 4 mảnh bên dưới. */
const EMPTY_S = {
  line: '',
  zone: '', customer: '', ident: '',
  sdm_kva: '', p0_w: '', pk_w: '', note: '',
  /* Hai cờ tổn thất — xem `scripts/lib/lossParams.mjs`. Chỉ lưu CỜ, giá trị P0/Pk
     ước lượng được suy lại mỗi lần tính chứ không ghi vào `p0_w`/`pk_w`. */
  auto_loss_param: false, mv_metering: false,
};
const EMPTY_C = { mkh: '', name: '', low_name: '', short_name: '', address: '', zone: '' };
/** `code` cũng do hệ thống sinh; `customer` chỉ dùng khi là điểm đo phụ. */
const EMPTY_P = {
  station: '', role: 'chinh' as PointRole,
  /** Chỉ cho điểm ĐẦU NGUỒN (schema v17): lộ nó đo + mã nhập tay (khớp LINE_NAME HES). */
  line: '', head_code: '',
  customer: '', parent_point: '', ident: '', hsn: '',
  /** Chỉ dùng khi điểm phụ trùng KH với điểm chính: mã nhãn, hoặc CUSTOM. */
  purpose: '', purpose_custom: '',
  note: '',
  /** Vật tư khai luôn cùng điểm đo — mỗi dòng một thiết bị (ghi vào dm_asset). */
  assetRows: [] as AssetRow[],
  /**
   * Nhu cầu vật tư (quy cách) — KINH DOANH khai ở form này (user chốt lại 27/10/2026);
   * Nhóm Vật Tư chỉ GẮN số No dự kiến, KD + VH ghi treo tháo. Xem `PointNeedEditor`.
   */
  need: [] as NeedRow[],
};

/*
  Dòng vật tư (`AssetRow`) và các luật sửa bảng vật tư nằm ở `lib/dm/pointForm.ts`
  (tách 17/11/2026 để test được — `scripts/dm_test_point_form.ts`).
*/

/** Trạng thái thiết bị trong ô chọn Số No — icon thay cho nhãn dài (28/09/2026). */
type SerialState = 'kho' | 'du_kien' | 'dang_treo';
const SERIAL_STATE: Record<SerialState, { icon: typeof Package; cls: string; label: string }> = {
  kho: { icon: Package, cls: 'text-emerald-500', label: 'Trong kho' },
  du_kien: { icon: UserCheck, cls: 'text-amber-500', label: 'Đã gắn khách hàng dự kiến' },
  dang_treo: { icon: Zap, cls: 'text-red-500', label: 'Đang treo, hoạt động' },
};



/**
 * Khoảng giá trị thường gặp của thông số trạm — chỉ dùng để CẢNH BÁO khi nhập
 * lệch, không chặn lưu. Ngưỡng do user chốt 20/08/2026.
 * P0/Pk tính bằng W (không phải kW): MBA 180 kVA có Pk cỡ 1963 W.
 */
const SDM_RANGE: [number, number] = [10, 10_000];
const P0_RANGE: [number, number] = [50, 20_000];
const PK_RANGE: [number, number] = [200, 100_000];

const toNum = (s: string): number | undefined => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};
const str = (n?: number) => (n == null ? '' : String(n));

export default function CatalogEntry({ scope: _scope = 'vanphong', tabs, initialTab }: {
  scope?: Scope;
  /**
   * Chỉ hiện các tab này (mặc định: tất cả). Tab Khách hàng nằm ở Hồ sơ kinh doanh
   * (user chốt 01/10/2026) nên màn Danh mục truyền danh sách KHÔNG có `customer`,
   * còn mục Khách hàng truyền `['customer']`. Một tab thì ẩn thanh tab.
   */
  tabs?: CatTab[];
  /** Tab mở đầu (vd Việc cần làm → Gắn vật tư dự kiến); mặc định tab đầu tiên. */
  initialTab?: CatTab;
}) {
  // Gắn vật tư dự kiến chỉ hiện khi được xin đích danh (Nhóm Vật Tư).
  const shownTabs = tabs ? TABS.filter(t => tabs.includes(t.id)) : TABS.filter(t => t.id !== 'supply');
  const [tab, setTab] = useState<CatTab>(initialTab ?? shownTabs[0]?.id ?? 'zone');
  /** Ô tìm kiếm dùng chung 4 tab danh mục. Đổi tab thì xóa — xem `setTab` dưới. */
  const [search, setSearch] = useState('');
  /** Bộ lọc KCN của 3 bảng Trạm / Khách hàng / Điểm đo. `''` = tất cả. */
  const [filterZone, setFilterZone] = useState('');
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  /** Modal đang mở cho bảng nào; `editingId` rỗng = thêm mới. */
  const [modal, setModal] = useState<CatTab | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Điểm đo đang mở hộp "Chuyển chủ thể"; `null` = đóng. */
  const [transferring, setTransferring] = useState<Point | null>(null);
  /** Lộ đang mở hộp "Gắn trạm" hàng loạt; `null` = đóng. */
  const [assigning, setAssigning] = useState<Line | null>(null);
  /** Người dùng đã bấm "Sinh lại mã" cho điểm đo đang sửa. */
  const [regenCode, setRegenCode] = useState(false);

  const [zForm, setZForm] = useState(EMPTY_Z);
  const [lForm, setLForm] = useState(EMPTY_L);
  const [sForm, setSForm] = useState(EMPTY_S);
  const [cForm, setCForm] = useState(EMPTY_C);
  /** Soát ngay trong form: hiện lý do lệch dưới ô, và bật/tắt nút "Lấy từ tên". */
  const lowNameCheck = useMemo(
    () => checkLowName({ name: cForm.name, low_name: cForm.low_name }),
    [cForm.name, cForm.low_name],
  );
  const [pForm, setPForm] = useState(EMPTY_P);
  /**
   * Chữ ký HSN + vật tư lúc MỞ form sửa điểm đo — để chỉ chặn "TI×TU lệch HSN"
   * khi người dùng thực sự đụng vào phần đó (user chốt 28/09: dữ liệu cũ giữ
   * nguyên, mở ra sửa ghi chú không bị chặn). Điểm đo mới: rỗng ⇒ luôn chặn.
   */
  const [pSnap, setPSnap] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setData(await loadCatalog());
    } catch (e) {
      if (isAbortError(e)) return;
      toast.error('Không nạp được danh mục', pbErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const d = data;
  const zoneOpts = useMemo(
    () => (d?.zones ?? []).map(z => ({ value: z.id, label: `${z.code} — ${z.name}` })), [d]);
  /*
    Lộ để chọn cho TRẠM — chỉ lộ CÙNG KCN với trạm đang khai.
    Một lộ không vắt sang KCN khác (user xác nhận 22/09), nên hiện cả danh sách
    thì người khai phải tự lọc bằng mắt và rất dễ chọn nhầm lộ của khu bên cạnh.
    Lộ đã ngưng vẫn hiện nhưng ghi rõ, vì trạm cũ có thể vẫn đang treo ở đó.
  */
  const lineOptsOfZone = (zoneId: string) => (d?.lines ?? [])
    .filter(l => l.zone === zoneId)
    .map(l => ({
      value: l.id,
      label: `${l.code}${l.name ? ` — ${l.name}` : ''}${l.active === false ? ' (đã ngưng)' : ''}`,
    }));
  const customerOpts = useMemo(
    () => (d?.customers ?? []).map(c => ({
      value: c.id,
      label: c.short_name ? `${c.mkh} — ${c.name} (${c.short_name})` : `${c.mkh} — ${c.name}`,
    })), [d]);
  const stationOpts = useMemo(
    () => (d?.stations ?? []).map(s => ({ value: s.id, label: s.code })), [d]);
  const zoneName = (id?: string) => d?.zones.find(z => z.id === id)?.name ?? '—';
  /** MKH thô để SẮP XẾP — chưa gắn khách hàng thì trả undefined (xuống cuối bảng). */
  const mkhOf = (id?: string) => d?.customers.find(c => c.id === id)?.mkh;
  /** MKH để HIỂN THỊ trong ô bảng. */
  const customerMkh = (id?: string) => mkhOf(id) ?? '—';
  /** Mã điểm đo để nêu trong cảnh báo trùng số chế tạo. */
  const pointCodeOf = (id?: string) => {
    const p = d?.points.find(x => x.id === id);
    return p?.code || p?.line_name || '(không rõ)';
  };
  const stationsOfZone = (id: string) => d?.stations.filter(s => s.zone === id).length ?? 0;

  /** Dữ liệu mà luật bảng vật tư (`lib/dm/pointForm`) cần đọc. */
  const rowCtx: RowCtx = { devices: d?.devices ?? [], assets: d?.assets ?? [], editingId };
  const pointsOfStation = (id: string) => d?.points.filter(p => p.station === id).length ?? 0;
  const pointsOfCustomer = (id: string) => d?.points.filter(p => p.customer === id).length ?? 0;

  /* ------------------------- mở modal ------------------------- */
  const openAdd = () => {
    setEditingId(null);
    if (tab === 'zone') setZForm(EMPTY_Z);
    /* Giữ KCN đang chọn để khai liên tiếp nhiều lộ trong cùng một KCN. */
    if (tab === 'line') setLForm({ ...EMPTY_L, zone: lForm.zone });
    if (tab === 'station') setSForm({ ...EMPTY_S, zone: sForm.zone });
    if (tab === 'customer') setCForm({ ...EMPTY_C, zone: cForm.zone });
    // Giữ trạm đang chọn để khai liên tiếp nhiều điểm đo trong cùng một trạm.
    if (tab === 'point') { setPForm({ ...EMPTY_P, station: pForm.station }); setPSnap(''); }
    setModal(tab);
  };

  const editZone = (z: Zone) => {
    setEditingId(z.id);
    setZForm({ code: z.code, name: z.name, address: z.address ?? '' });
    setModal('zone');
  };
  const editLine = (l: Line) => {
    setEditingId(l.id);
    setLForm({
      code: l.code, name: l.name ?? '', zone: l.zone,
      voltage_level: (l.voltage_level || 'MV') as VoltageLevel, note: l.note ?? '',
      active: l.active !== false,
    });
    setModal('line');
  };
  const editStation = (s: Station) => {
    setEditingId(s.id);
    setSForm({
      zone: s.zone, line: s.line ?? '', customer: s.customer ?? '', ident: s.ident ?? '',
      sdm_kva: str(s.sdm_kva), p0_w: str(s.p0_w), pk_w: str(s.pk_w), note: s.note ?? '',
      auto_loss_param: !!s.auto_loss_param, mv_metering: !!s.mv_metering,
    });
    setModal('station');
  };
  const editCustomer = (c: Customer) => {
    setEditingId(c.id);
    setCForm({
      mkh: c.mkh, name: c.name, low_name: c.low_name ?? '',
      short_name: c.short_name ?? '',
      address: c.address ?? '', zone: c.zone ?? '',
    });
    setModal('customer');
  };

  const editPoint = (p: Point) => {
    setEditingId(p.id);
    setRegenCode(false);
    // Nhãn đuôi đã lưu: khớp một mục có sẵn thì chọn mục đó, không thì là tự nhập.
    const saved = p.sub_label ?? '';
    const isPreset = SUB_PURPOSES.some(x => x.code === saved);
    // Vật tư đang gắn ở điểm đo này → dựng lại thành các dòng của bảng.
    const rows: AssetRow[] = (d?.assets ?? [])
      .filter(a => a.point === p.id)
      .map(a => ({
        key: newRowKey(), id: a.id, type: a.type, serial: a.serial,
        ratio: formatRatio(a.ratio_primary, a.ratio_secondary),
        dateOn: (a.date_on ?? '').slice(0, 10),
        dateOff: (a.date_off ?? '').slice(0, 10),
        // `active` SUY từ ngày tháo ngay khi nạp, để form không mở ra ở trạng
        // thái mâu thuẫn với chính luật của nó (xem `normalizeActive`).
        active: !(a.date_off ?? '').slice(0, 10),
      }));
    setPForm({
      ...EMPTY_P,
      assetRows: rows,
      station: p.station, role: p.role,
      line: p.line ?? '', head_code: p.role === 'dau_nguon' ? (p.code ?? '') : '',
      customer: p.customer ?? '', parent_point: p.parent_point ?? '',
      ident: p.ident ?? '', hsn: str(p.hsn),
      purpose: isPreset ? saved : (saved ? CUSTOM : ''),
      purpose_custom: isPreset ? '' : saved,
      note: p.note ?? '',
      need: rowsFromNeed(p.need),
    });
    setPSnap(hsnSig(str(p.hsn), rows));
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

  /* ---- Hai cờ tổn thất ----
     Chỉ khi cả hai cờ TẮT thì P0/Pk mới nhập tay được. Bật "tự động" thì giá trị
     suy từ các trạm cùng công suất; bật "trung thế" thì trạm nằm ngoài bảng tổn
     thất nên hai ô này vô nghĩa. Dùng CHUNG `estimateLossParams` với script tính
     thật — xem trước bằng hàm khác thì sớm muộn hai bên lệch nhau. */
  const lossParamEditable = !sForm.auto_loss_param && !sForm.mv_metering;
  const lossEstimate = useMemo(() => {
    if (!sForm.auto_loss_param) return null;
    /* Loại chính trạm đang sửa khỏi tập mẫu: nó đang bật cờ tự động nên không
       phải mẫu, nhưng bản trong `d.stations` có thể là bản CŨ chưa bật cờ. */
    const pool = (d?.stations ?? []).filter(s => s.id !== editingId);
    return estimateLossParams(pool, toNum(sForm.sdm_kva));
  }, [d?.stations, editingId, sForm.auto_loss_param, sForm.sdm_kva]);

  /* ------------ Đối chiếu công tơ với hóa đơn (chỉ tham chiếu) ------------ */
  /**
   * Hóa đơn là nguồn CHUẨN NHẤT cho HSN (đối chiếu 8 điểm đo: 7 khớp tuyệt
   * đối, 1 lệch do khai sai tỷ số TI). Nhưng hóa đơn KHÔNG cho biết ngày treo /
   * ngày tháo — công tơ treo trước rồi mới dùng điện — nên ở đây chỉ HIỂN THỊ
   * để đối chiếu, tuyệt đối không tự điền vào ô nào.
   */
  const [invSegs, setInvSegs] = useState<Record<string, Segment[]>>({});
  const [invLoading, setInvLoading] = useState(false);

  /** MKH của điểm đo: điểm phụ mang KH riêng, điểm chính theo chủ trạm. */
  const pointMkh = mkhOf(pForm.customer || d?.stations.find(s => s.id === pForm.station)?.customer);

  /** Số chế tạo của các dòng công tơ — ngắn quá thì chưa gõ xong, đừng tra vội. */
  const meterSerials = useMemo(
    () => pForm.assetRows
      .filter(r => r.type === 'CONGTO' && r.serial.trim().length >= 6)
      .map(r => r.serial.trim()),
    [pForm.assetRows]);
  const serialKey = meterSerials.join('|');

  useEffect(() => {
    if (modal !== 'point') return;
    const missing = meterSerials.filter(s => !(s in invSegs));
    if (!missing.length) return;
    // Chờ người dùng gõ xong rồi mới tra, khỏi bắn một request mỗi ký tự.
    const timer = setTimeout(async () => {
      setInvLoading(true);
      try {
        const got: Record<string, Segment[]> = {};
        for (const s of missing) got[s] = segmentsOf(await invoicesOfSerial(s));
        setInvSegs(prev => ({ ...prev, ...got }));
      } catch {
        // Tra cứu hỏng thì thôi, không được chặn việc nhập liệu.
      } finally {
        setInvLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialKey, modal, invSegs]);

  /* ---- Đối chiếu NGƯỢC: khách hàng này trong hóa đơn dùng công tơ nào ---- */
  /**
   * Tra theo số công tơ chỉ trả lời được "số đang khai có thuộc khách này
   * không". Gõ nhầm sang một số không tồn tại thì không có hóa đơn nào và câu
   * hỏi đó im lặng. Hỏi từ phía khách hàng mới chỉ ra được số ĐÚNG là số nào.
   */
  const [mkhSerials, setMkhSerials] = useState<Record<string, MkhMeter[]>>({});

  useEffect(() => {
    if (modal !== 'point' || !pointMkh || pointMkh in mkhSerials) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await invoicesOfMkh(pointMkh);
        const out: MkhMeter[] = [];
        for (const [serial, list] of bySerial(rows)) {
          const seg = segmentOf(segmentsOf(list), pointMkh);
          if (seg) out.push({ serial, from: seg.from, to: seg.to, isCurrent: seg.isCurrent });
        }
        out.sort((a, b) => (a.to < b.to ? 1 : -1));
        if (!cancelled) setMkhSerials(prev => ({ ...prev, [pointMkh]: out }));
      } catch {
        // Tra cứu hỏng thì thôi — đối chiếu là tham chiếu, không được chặn nhập.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointMkh, modal, mkhSerials]);

  /* Kiểm tra form điểm đo: `lib/dm/pointCheck.ts` (thuần, có test). */
  const {
    pStation, pStationZone, pStationCustomer, pSubCustomer, isSub, isHead, pLine, lineHeadTaken,
    allLineOpts, sameCustomer, purposeLabel, mainTenant, subLabel, generatedCode, pointCodeMissing,
    codeLocked, pointCode, hsnFromPlan, ratioRowOf, hasTi, hsnInput, derivedHsn, activeSeg,
    invoiceHsn, tuRow, canFillTi, suggestedTi, meterRefs, invoiceNotes, refHsn, manualHsn,
    effectiveHsn, serialInForm, reclaim, hsnMismatch, setSuggestions, isNeedRow, treoRows, needRows,
    saveBlocks, assetWarnings, derivedStatus, statusReason,
  } = checkPointForm({ d, pForm, editingId, regenCode, pSnap, pointMkh, invSegs, mkhSerials });

  /** Điền tỷ số suy từ HSN hóa đơn cho CẢ BỘ TI đang hoạt động. */
  const fillTiFromInvoice = () =>
    setPForm(f => ({
      ...f,
      assetRows: f.assetRows.map(r =>
        r.type === 'TI' && r.active ? { ...r, ratio: suggestedTi } : r),
    }));

  /** Điền một ngày lấy từ hóa đơn vào đúng dòng công tơ đó. */
  const fillDate = (key: string, field: 'dateOn' | 'dateOff', value: string) =>
    setRow(key, { [field]: value });

  /**
   * Ô Số No CHỌN TỪ KHO (user chốt 28/09/2026 — plan
   * `2026-09-28-diem-do-chon-vat-tu-tu-kho-theo-hsn`, task 3): vật tư phải khai ở
   * tab Kho vật tư trước, form điểm đo không còn tạo thiết bị.
   *
   * - Bỏ thiết bị ĐÃ THANH LÝ và số No đã nằm ở dòng khác của form.
   * - Thiết bị rảnh xếp trước. Thiết bị đang treo ở điểm đo KHÁC vẫn hiện (xếp
   *   cuối, ghi rõ nơi treo) chứ không ẩn: khai lần lắp CŨ của nó và đổi chỗ
   *   giữa hai điểm đo dự kiến là hai luồng hợp lệ đã có — luật (4) và
   *   `reclaim`/`busyElsewhere` vẫn lo phần chặn.
   * - Số No hiện tại của dòng mà không có trong kho vẫn giữ trong danh sách,
   *   kèm nhãn, để ô không hiện trống với dữ liệu cũ.
   */
  const serialOptions = (r: AssetRow) => {
    const taken = new Set(pForm.assetRows.filter(x => x.key !== r.key).map(x => x.serial.trim()));
    const pool = (d?.devices ?? []).filter(dev => {
      const sn = dev.serial.trim();
      return !!sn && !taken.has(sn) && (!r.type || dev.type === r.type) && !ymdOf(dev.liquidated_at)
        // Dòng thêm từ bộ gợi ý theo HSN: chỉ đúng tỷ số của bộ đó.
        && (!r.want || r.id || deviceRatio(dev) === r.want);
    });
    const free = new Set(freeDevices(pool, d?.assets ?? [], { pointId: editingId }).map(x => x.id));
    /*
      Nhãn CHỈ là Số No + ICON trạng thái (user chốt 28/09/2026): nhãn dài
      "tỷ số · dành cho …" bị cắt trong ô hẹp của bảng. Chi tiết nằm ở `title`
      (rê chuột). Ba trạng thái — xem `SERIAL_STATE`:
        kho      — rảnh, chưa dành cho ai
        du_kien  — đã gắn khách hàng / điểm đo dự kiến
        dang_treo — đang treo, hoạt động ở điểm đo khác
    */
    const opts = pool
      .map(dev => {
        const sn = dev.serial.trim();
        const detail = [ASSET_LABEL[dev.type] ?? dev.type, deviceRatio(dev), dev.model_desc?.trim()];
        let state: SerialState = 'kho';
        if (!free.has(dev.id)) {
          const at = (d?.assets ?? []).find(a =>
            (a.device === dev.id || a.serial.trim() === sn) && a.date_on && !a.date_off
            && a.point !== editingId);
          state = 'dang_treo';
          detail.push(`đang treo ở ${pointCodeOf(at?.point)}`);
        } else if (dev.hold_point && dev.hold_point !== editingId) {
          state = 'du_kien';
          detail.push(`dành cho ${pointCodeOf(dev.hold_point)}`);
        } else if (dev.hold_for_customer || dev.hold_for_note?.trim()) {
          state = 'du_kien';
          detail.push(`dành cho ${[customerMkh(dev.hold_for_customer), dev.hold_for_note?.trim()]
            .filter(x => x && x !== '—').join(' · ')}`);
        }
        const s = SERIAL_STATE[state];
        return {
          value: sn, label: sn, icon: s.icon, iconClass: s.cls,
          title: `${s.label} — ${detail.filter(Boolean).join(' · ')}`,
          rank: state === 'kho' ? 0 : state === 'du_kien' ? 1 : 2,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.value.localeCompare(b.value))
      .map(({ rank: _r, ...o }) => o);
    const cur = r.serial.trim();
    if (cur && !opts.some(o => o.value === cur)) {
      opts.unshift({ value: cur, label: cur, icon: TriangleAlert, iconClass: 'text-bad',
        title: 'Không có trong Kho vật tư' });
    }
    return opts;
  };


  /** Điểm đo chính trong cùng trạm — nguồn chọn cha cho điểm đo phụ. */
  const parentOpts = useMemo(
    () => (d?.points ?? [])
      .filter(p => p.role === 'chinh' && p.station === pForm.station && p.id !== editingId)
      .map(p => ({ value: p.id, label: p.code || p.line_name || p.id })),
    [d, pForm.station, editingId]);

  /* --------------------------- lưu --------------------------- */
  /**
   * PocketBase báo vi phạm unique bằng đúng một câu "Value must be unique",
   * không nói giá trị nào và ai đang giữ nó. Ở đây tra ngược ra bản ghi đang
   * chiếm chỗ để người dùng biết phải đi sửa ở đâu.
   */
  const explainSaveError = (e: unknown): string => {
    const base = pbErrorMessage(e);
    if (!/unique/i.test(base)) return base;
    // Phần tra ngược bên dưới chỉ đúng với form điểm đo.
    if (modal !== 'point') return `${base} — giá trị này đã tồn tại ở một bản ghi khác.`;

    // Vật tư: tìm bản ghi cùng số No đang gắn ở điểm đo khác.
    const clashes = [...serialInForm.keys()]
      .map(serial => {
        const a = (d?.assets ?? []).find(x => x.serial === serial && x.point !== editingId);
        return a ? `${serial} đang ${a.active ? 'HOẠT ĐỘNG' : 'ngưng'} ở điểm đo ${pointCodeOf(a.point)}` : null;
      })
      .filter(Boolean);
    if (clashes.length) {
      return `Trùng số chế tạo: ${clashes.join('; ')}. `
        + 'Mở điểm đo đó khai NGÀY THÁO cho vật tư này rồi lưu, sau đó mới lắp sang đây.';
    }

    const dupPoint = d?.points.find(p => p.code === pointCode && p.id !== editingId);
    if (dupPoint) {
      return `Mã điểm đo ${pointCode} đã thuộc về một điểm đo khác `
        + `(khách ${customerMkh(dupPoint.customer)}). Đổi định danh điểm đo hoặc khách hàng.`;
    }
    return `${base} — một giá trị bạn vừa nhập đã tồn tại (mã KCN / mã khách hàng / mã trạm / mã điểm đo / số chế tạo).`;
  };

  /**
   * Sau mỗi lần ghi treo tháo: đối chiếu nhu cầu ↔ treo thực tế (TỰ ĐỘNG — user chốt
   * 27/10/2026). Dòng nhu cầu chưa treo đã thừa thì về kho; còn thiếu thì nhắc treo bổ sung.
   */
  const reportReconcile = async (pointId: string) => {
    const rc = await runReconcile(pointId);
    const parts: string[] = [];
    if (rc.release.length) parts.push(`trả kho ${rc.release.map(a => a.serial).join(', ')} (treo thực tế đã thay)`);
    if (rc.shortages.length) {
      parts.push('cần treo bổ sung ' + rc.shortages.map(l => `${l.missing} × ${ASSET_LABEL[l.line.type]}`).join(', ')
        + ' — Nhóm Vật Tư sẽ thấy ở Gắn vật tư dự kiến');
    }
    if (parts.length) toast.info('Đối chiếu nhu cầu', parts.join('; ') + '.');
  };

  /**
   * Lưu điểm đo + vật tư (`lib/dm/pointSave` — một bản cho cả điểm đầu nguồn lẫn
   * điểm thường) rồi đối chiếu nhu cầu.
   */
  const saveCurrentPoint = async (body: Partial<Point>) => {
    const id = await savePoint({
      repo: { points, assets, devices, borrows }, d, editingId, body,
      assetRows: pForm.assetRows, reclaim, today: new Date().toISOString().slice(0, 10),
    });
    await reportReconcile(id);
  };

  const persist = async (fn: () => Promise<unknown>, okMsg: string) => {
    setSaving(true);
    try {
      await fn();
      toast.success(editingId ? 'Đã cập nhật' : 'Đã lưu', okMsg);
      closeModal();
      await load();
    } catch (e) {
      toast.error('Lưu thất bại', explainSaveError(e));
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

    if (modal === 'line') {
      if (!lForm.code.trim() || !lForm.zone) {
        return toast.warning('Thiếu thông tin', 'Mã lộ và KCN là bắt buộc.');
      }
      const body = {
        code: lForm.code.trim(), name: lForm.name.trim(), zone: lForm.zone,
        voltage_level: lForm.voltage_level, note: lForm.note.trim(),
        active: lForm.active,
      };
      return void persist(
        () => (editingId ? lines.update(editingId, body) : lines.create(body)),
        `lộ ${body.code}`);
    }

    if (modal === 'station') {
      if (stationCodeMissing.length) {
        return toast.warning('Chưa sinh được mã trạm',
          `Còn thiếu: ${stationCodeMissing.join(', ')}.`);
      }
      const body = {
        code: stationCode, zone: sForm.zone, line: sForm.line,
        customer: sForm.customer, ident: sForm.ident.trim().toUpperCase(),
        sdm_kva: toNum(sForm.sdm_kva),
        /* Trung thế hoặc tự động ⇒ KHÔNG ghi P0/Pk: số ước lượng không được nằm
           trong ô số đo, còn trạm trung thế thì hai ô này vô nghĩa. */
        p0_w: lossParamEditable ? toNum(sForm.p0_w) : null,
        pk_w: lossParamEditable ? toNum(sForm.pk_w) : null,
        auto_loss_param: sForm.auto_loss_param,
        mv_metering: sForm.mv_metering,
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
      const name = cForm.name.trim();
      const body = {
        mkh: cForm.mkh.trim(), name, short_name: shortName,
        // Bỏ trống ô viết thường thì suy ra từ tên, không lưu rỗng để bộ soát
        // khỏi báo `missing` ngay sau khi vừa khai xong.
        low_name: cForm.low_name.trim() || toLowName(name),
        address: cForm.address.trim(), zone: cForm.zone || undefined, active: true,
      };
      return void persist(
        () => (editingId ? customers.update(editingId, body) : customers.create(body)),
        `Khách hàng ${body.mkh}`);
    }

    if (modal === 'point' && isHead) {
      const code = pForm.head_code.trim().toUpperCase();
      if (!pForm.line) return toast.warning('Thiếu thông tin', 'Điểm đo đầu nguồn phải chọn lộ nó đo.');
      if (!code) return toast.warning('Thiếu mã', 'Nhập mã điểm đo đầu nguồn (khớp LINE_NAME bên HES).');
      if (lineHeadTaken) return toast.error('Chưa lưu được', 'Lộ này đã có điểm đo đầu nguồn.');
      /* Mã nhập tay nên kiểm trùng ở đây — để PB báo thì chỉ ra "Value must be unique". */
      const clash = d?.points.find(p => (p.code ?? '').toUpperCase() === code && p.id !== editingId);
      if (clash) return toast.error('Chưa lưu được', `Mã ${code} đã thuộc về một điểm đo khác.`);
      if (saveBlocks.length) return toast.error('Chưa lưu được', `${saveBlocks.join('. ')}.`);
      const body = {
        code, line_name: code, ident: '', sub_label: '',
        /* Không trạm, không khách, không điểm cha — đo TỔNG lộ. */
        station: '', customer: '', parent_point: '',
        line: pForm.line, zone: pLine?.zone || undefined,
        role: 'dau_nguon' as PointRole,
        connection: connectionOfHsn(effectiveHsn),
        hsn: effectiveHsn ?? undefined,
        status: derivedStatus || undefined,
        note: pForm.note.trim(),
        need: needFromRows(pForm.need),
      };
      return void persist(() => saveCurrentPoint(body), `Điểm đo đầu nguồn ${code}`);
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
      // Đụng độ số chế tạo và thiếu tỷ số là lỗi thật, không phải nhắc — chặn lưu.
      if (saveBlocks.length) {
        return toast.error('Chưa lưu được', `${saveBlocks.join('. ')}.`);
      }
      const body = {
        code: pointCode,
        // LINE_NAME bên HES chính là chuỗi mã này — điền luôn để khỏi lệch.
        line_name: pointCode,
        ident: pForm.ident.trim(),
        sub_label: subLabel,
        station: pForm.station,
        zone: pStation?.zone || undefined,
        // Điểm đo chính thuộc về chủ trạm; điểm đo phụ mang khách hàng riêng.
        // Diem chinh mac dinh theo chu tram nhung doi duoc (tram cho thue).
        customer: pForm.customer || pStation?.customer || undefined,
        parent_point: isSub ? pForm.parent_point : '',
        role: pForm.role,
        // `connection` không còn hỏi người dùng — suy ngược từ HSN. Vẫn ghi vì
        // PocketBase đang để trường này bắt buộc.
        connection: connectionOfHsn(effectiveHsn),
        // KHÔNG BAO GIỜ ghi HSN = 0 hay bỏ trống: sai HSN là sai toàn bộ sản
        // lượng. Suy từ TI trước, không suy được thì lấy HSN hóa đơn.
        hsn: effectiveHsn ?? undefined,
        status: derivedStatus || undefined,
        note: pForm.note.trim(),
        need: needFromRows(pForm.need),
      };
      return void persist(() => saveCurrentPoint(body), `Điểm đo ${body.code}`);
    }
  };

  /* ---------------- Đồng bộ khách hàng từ hóa đơn ---------------- */
  /**
   * `MKHang` là khoá không đổi, còn tên/địa chỉ khách hàng thì đổi theo thời
   * gian ⇒ lấy theo hóa đơn có ngày chốt mới nhất.
   *
   * Ghi thẳng vào dữ liệu thật nên: xem trước → hỏi → mới ghi; chỉ tạo và cập
   * nhật, KHÔNG BAO GIỜ xoá; chạy lại không nhân bản.
   */
  const [syncing, setSyncing] = useState(false);

  /* ---------- Soát tên viết thường (`low_name`) ----------
   *
   * `low_name` là cột LƯU SẴN bản viết thường của `name` (PocketBase không có
   * `lower()` trong filter). Lưu sẵn thì lệch được: sửa `name` ở nơi khác, gõ
   * tay thiếu chữ, hoặc bản ghi cũ có trước khi cột ra đời.
   *
   * `null` = chưa soát lần nào; `[]` = đã soát và không có gì lệch.
   */
  const [lowNameRows, setLowNameRows] = useState<LowNameRow[] | null>(null);
  const [lowNameOpen, setLowNameOpen] = useState(false);
  const [fixingLowName, setFixingLowName] = useState(false);

  const auditLowName = () => {
    if (!d) return;
    const rows = planLowNameFix(d.customers);
    if (!rows.length) {
      toast.success('Khớp hết',
        `Đã soát ${d.customers.length} khách hàng — tên viết thường khớp đủ chữ với tên gốc.`);
      return;
    }
    setLowNameRows(rows);
    setLowNameOpen(true);
  };

  /**
   * CHỈ điền các ô đang TRỐNG, bằng tên gốc hạ chữ hoa.
   *
   * KHÔNG ghi đè ô đã có: `low_name` do người dùng soạn (danh từ riêng giữ hoa),
   * hạ hoa tất cả là phá dữ liệu — đã suýt xảy ra ngày 15/09/2026 khi 88/101 bản
   * ghi bị luật cũ coi là "lệch". Các dòng sai CHỮ thì phải người đọc quyết bên
   * nào đúng, máy không tự sửa được.
   *
   * Ghi thẳng vào dữ liệu THẬT (staging dùng chung PocketBase với production)
   * ⇒ đã xem trước ở bảng, còn hỏi thêm một lần nữa. Chỉ `update`, không xóa.
   */
  const fixAllLowName = async () => {
    const rows = autoFillable(lowNameRows ?? []);
    if (!rows.length) return;

    const ok = await confirm({
      title: `Sửa tên viết thường cho ${rows.length} khách hàng?`,
      message: `Ghi cột "Đề nghị" vào ${rows.length} bản ghi: lấy ký tự của tên gốc, `
        + `giữ kiểu viết hoa đang có. Không đụng tên gốc, không xóa bản ghi nào. `
        + `Ghi thẳng vào dữ liệu thật.`,
      confirmLabel: 'Sửa', variant: 'warning',
    });
    if (!ok) return;

    setFixingLowName(true);
    let done = 0;
    try {
      for (const r of rows) {
        await customers.update(r.id, { low_name: r.expected });
        done++;
      }
      setLowNameOpen(false);
      setLowNameRows(null);
      toast.success('Đã sửa', `Cập nhật tên viết thường cho ${done} khách hàng.`);
      await load();
    } catch (err) {
      // Dừng giữa chừng thì nói rõ đã ghi được bao nhiêu — bấm soát lại là ra
      // phần còn lại, không sợ ghi trùng.
      toast.error(`Dừng sau ${done}/${rows.length} bản ghi`, pbErrorMessage(err));
      await load();
    } finally {
      setFixingLowName(false);
    }
  };

  const syncCustomers = async () => {
    if (!d) return;
    setSyncing(true);
    try {
      const plan = planCustomerSync(latestByMkh(await loadCustomerFacts()), d.zones, d.customers);

      if (isEmptyPlan(plan)) {
        toast.info('Không có gì thay đổi', 'Danh mục khách hàng đã khớp hóa đơn.');
        return;
      }

      const lines = [
        plan.zonesToCreate.length && `• Tạo ${plan.zonesToCreate.length} KCN: ${plan.zonesToCreate.map(z => z.code).join(', ')}`,
        plan.customersToCreate.length && `• Tạo ${plan.customersToCreate.length} khách hàng mới`,
        plan.customersToUpdate.length && `• Cập nhật ${plan.customersToUpdate.length} khách hàng (tên / địa chỉ / KCN)`,
        plan.unknownZoneCodes.length && `• Bỏ qua mã KCN lạ: ${plan.unknownZoneCodes.join(', ')}`,
      ].filter(Boolean).join('\n');

      const ok = await confirm({
        title: 'Đồng bộ khách hàng từ hóa đơn?',
        message: `${lines}\n\nKhông xóa bản ghi nào, không đụng tên tắt đã khai. `
          + `Ghi thẳng vào dữ liệu thật.`,
        confirmLabel: 'Đồng bộ', variant: 'warning',
      });
      if (!ok) return;

      // Tạo KCN trước để còn lấy id gắn cho khách hàng.
      const zoneIdByCode = new Map(d.zones.map(z => [z.code, z.id]));
      for (const z of plan.zonesToCreate) {
        const rec = await zones.create({ code: z.code, name: z.name, active: true });
        zoneIdByCode.set(z.code, (rec as unknown as Zone).id);
      }

      for (const c of plan.customersToCreate) {
        await customers.create({
          mkh: c.mkh, name: c.name, address: c.address,
          zone: zoneIdByCode.get(c.zoneCode) || undefined, active: true,
        });
      }

      for (const u of plan.customersToUpdate) {
        const body: Partial<Customer> = {};
        for (const ch of u.changes) {
          if (ch.field === 'name') body.name = ch.to;
          if (ch.field === 'address') body.address = ch.to;
          if (ch.field === 'zone') body.zone = zoneIdByCode.get(ch.to) || undefined;
        }
        await customers.update(u.id, body);
      }

      toast.success('Đã đồng bộ',
        `${plan.zonesToCreate.length} KCN, ${plan.customersToCreate.length} khách mới, `
        + `${plan.customersToUpdate.length} khách cập nhật.`);
      if (plan.customersToCreate.length) {
        toast.warning('Chưa có tên tắt',
          `${plan.customersToCreate.length} khách hàng mới chưa có tên tắt — `
          + 'phải khai thì mới sinh được mã trạm.');
      }
      await load();
    } catch (e) {
      toast.error('Đồng bộ thất bại', pbErrorMessage(e));
    } finally {
      setSyncing(false);
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
  const RowActions = ({ onEdit, onDelete, extra }: {
    onEdit: () => void; onDelete: () => void;
    /** Nút phụ đứng trước Sửa — hiện chỉ bảng Điểm đo dùng (chuyển chủ thể). */
    extra?: { icon: typeof Edit2; title: string; onClick: () => void };
  }) => (
    <div className="flex justify-end gap-2">
      {extra && (
        <button onClick={extra.onClick} title={extra.title}
          className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
          <extra.icon className="h-5 w-5" />
        </button>
      )}
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


  /* ------------- thao tác trên bảng vật tư của form điểm đo ------------- */

  /* Luật nằm ở `lib/dm/pointForm.ts` (thuần, có test) — đây chỉ nối với state của form. */
  const liveElsewhere = (serial: string) => liveElsewhereIn(rowCtx, serial);
  const lockedOn = (r: AssetRow) => lockedOnIn(rowCtx, r);

  const setRow = (key: string, patch: Partial<AssetRow>) =>
    setPForm(f => ({ ...f, assetRows: applyRowRulesIn(rowCtx, f.assetRows, key, patch) }));

  const applySet = (s: SetOption) =>
    setPForm(f => ({ ...f, assetRows: applySetIn(f.assetRows, s) }));

  const addRow = (type: AssetType | '' = '') =>
    setPForm(f => ({ ...f, assetRows: addRowIn(rowCtx, f.assetRows, type) }));
  const removeRow = (key: string) =>
    setPForm(f => ({ ...f, assetRows: f.assetRows.filter(r => r.key !== key) }));

  const stationsOfLine = (id: string) => d?.stations.filter(s => s.line === id).length ?? 0;
  const lineCodeOf = (id?: string) => d?.lines.find(l => l.id === id)?.code;
  const stationCodeOf = (id?: string) => d?.stations.find(s => s.id === id)?.code ?? '—';
  /** Cột "Trạm": điểm đầu nguồn không có trạm — hiện lộ nó đo. */
  const placeOf = (p: Point) => isHeadPoint(p)
    ? `Lộ ${d?.lines.find(l => l.id === p.line)?.code ?? '—'}`
    : stationCodeOf(p.station);
  const childrenOf = (id: string) => d?.points.filter(p => p.parent_point === id).length ?? 0;

  /* ---------------------------------------------------------------------
   * Ba bảng Trạm / Khách hàng / Điểm đo đều: xếp theo MKH → gom theo KCN.
   * Mỗi KCN một dòng tiêu đề màu, giống bảng lấy chỉ số HES.
   * ------------------------------------------------------------------- */


  /** KCN xếp theo mã, để bảng KCN cũng có thứ tự ổn định. */
  const zoneRows = useMemo(
    () => [...(d?.zones ?? [])].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true })),
    [d]);

  /* Lộ xếp theo MÃ, không theo MKH — lộ không có khách hàng. */
  const lineGroups = useMemo(
    () => groupByZone(sortByCode(d?.lines ?? [], l => l.code), l => l.zone, d?.zones ?? []),
    [d]);

  const stationGroups = useMemo(
    () => groupByZone(sortByMkh(d?.stations ?? [], s => mkhOf(s.customer)), s => s.zone, d?.zones ?? []),
    [d]);

  const customerGroups = useMemo(
    () => groupByZone(sortByMkh(d?.customers ?? [], c => c.mkh), c => c.zone, d?.zones ?? []),
    [d]);

  /**
   * Điểm đo giữ nguyên phân cấp: mỗi điểm chính kéo theo đàn điểm phụ của nó
   * (thụt lề). Vì vậy phải sắp xếp theo CỤM — xếp các điểm chính theo MÃ ĐIỂM ĐO
   * rồi mới trải phẳng, chứ không xếp từng dòng, kẻo điểm phụ bị tách khỏi cha.
   *
   * Điểm phụ mất cha, hoặc chưa gán cha, thành cụm một dòng xếp cuối để không
   * biến mất khỏi danh sách.
   */
  const pointGroups = useMemo(() => {
    const all = d?.points ?? [];
    /** Mã để xếp: điểm đo cũ chưa có `code` thì lấy tạm `line_name` bên HES. */
    const codeOfPoint = (p: Point) => p.code || p.line_name || '';
    const placed = new Set<string>();
    const clusters: { head: Point; rows: { point: Point; isChild: boolean }[] }[] = [];

    // Điểm đo chính xếp theo mã điểm đo (user chốt 22/08/2026) — cột đầu của
    // bảng chính là cột này, xếp theo nó thì mắt dò xuôi được.
    const mains = sortByCode(all.filter(x => x.role === 'chinh'), codeOfPoint);

    for (const p of mains) {
      const rows = [{ point: p, isChild: false }];
      placed.add(p.id);
      // Điểm phụ trong cùng cụm cũng xếp theo mã của chính nó.
      for (const child of sortByCode(all.filter(x => x.parent_point === p.id), codeOfPoint)) {
        rows.push({ point: child, isChild: true });
        placed.add(child.id);
      }
      clusters.push({ head: p, rows });
    }
    for (const p of sortByCode(all.filter(x => !placed.has(x.id)), codeOfPoint)) {
      clusters.push({ head: p, rows: [{ point: p, isChild: false }] });
    }

    // Cụm giữ nguyên thứ tự đã xếp ở trên; `sortByCode` ổn định nên không đảo lại.
    const sorted = sortByCode(clusters, c => codeOfPoint(c.head));
    // KCN của cụm lấy theo trạm của điểm chính (điểm đo không giữ KCN riêng).
    const zoneOfCluster = (c: (typeof clusters)[number]) =>
      d ? pointZoneId(c.head, d.stations, d.lines) : undefined;

    return groupByZone(sorted, zoneOfCluster, d?.zones ?? [])
      .map(g => ({ zone: g.zone, rows: g.rows.flatMap(c => c.rows) }));
  }, [d]);

  /**
   * Bộ lọc KCN: giữ nguyên cách gom nhóm, chỉ bỏ bớt nhóm không được chọn. Nhờ
   * vậy dòng tiêu đề nhóm và số đếm vẫn đúng khi lọc.
   */
  const NO_ZONE = '__no_zone';
  const byFilterZone = <T,>(groups: { zone: Zone | null; rows: T[] }[]) =>
    filterZone
      ? groups.filter(g => (filterZone === NO_ZONE ? g.zone === null : g.zone?.id === filterZone))
      : groups;

  /* ------------------------- Lọc theo tìm kiếm ------------------------- */
  const terms = useMemo(() => buildTerms(search), [search]);

  /** Tên khách hàng — tìm theo tên công ty chứ không chỉ mã. */
  const customerName = (id?: string) => d?.customers.find(c => c.id === id)?.name;

  /**
   * Lọc trong TỪNG nhóm KCN rồi bỏ nhóm rỗng: giữ được thẻ KCN và số đếm trên
   * đầu thẻ đúng với những gì đang hiện, thay vì đếm toàn bộ danh mục.
   */
  const bySearch = <T,>(
    groups: { zone: Zone | null; rows: T[] }[],
    textOf: (row: T) => (string | number | null | undefined)[],
  ) => terms.length
    ? groups
      .map(g => ({ ...g, rows: g.rows.filter(r => matchesTerms(textOf(r), terms)) }))
      .filter(g => g.rows.length)
    : groups;

  /**
   * Điểm đo lọc riêng: bảng này THỤT LỀ điểm phụ dưới điểm chính, nên cắt rời
   * một dòng khỏi cụm là mất luôn ngữ cảnh. Vì vậy giữ cả cụm quanh dòng khớp:
   * điểm chính khớp thì kéo theo đàn con; điểm phụ khớp thì kéo theo cha.
   */
  const pointGroupsShown = useMemo(() => {
    const groups = byFilterZone(pointGroups);
    if (!terms.length) return groups;

    return groups
      .map(g => {
        const hit = new Set(g.rows
          .filter(r => matchesTerms([
            r.point.code, r.point.line_name, r.point.sub_label, r.point.hsn,
            stationCodeOf(r.point.station), customerMkh(r.point.customer),
            customerName(r.point.customer),
          ], terms))
          .map(r => r.point.id));

        const kept = g.rows.filter(r =>
          hit.has(r.point.id)
          // cha của một điểm phụ đang khớp
          || g.rows.some(x => hit.has(x.point.id) && x.point.parent_point === r.point.id)
          // con của một điểm chính đang khớp
          || (r.point.parent_point ? hit.has(r.point.parent_point) : false));

        return { ...g, rows: kept };
      })
      .filter(g => g.rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointGroups, filterZone, terms, d]);

  const zoneRowsShown = useMemo(
    () => zoneRows.filter(z => matchesTerms([z.code, z.name, z.address], terms)),
    [zoneRows, terms]);

  const lineGroupsShown = useMemo(
    () => bySearch(byFilterZone(lineGroups), l => [l.code, l.name, zoneName(l.zone)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineGroups, filterZone, terms, d]);

  const stationGroupsShown = useMemo(
    () => bySearch(byFilterZone(stationGroups), s => [
      s.code, s.sdm_kva, customerMkh(s.customer), customerName(s.customer), zoneName(s.zone),
    ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stationGroups, filterZone, terms, d]);

  const customerGroupsShown = useMemo(
    () => bySearch(byFilterZone(customerGroups), c => [
      c.mkh, c.name, c.short_name, c.address, zoneName(c.zone),
    ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customerGroups, filterZone, terms, d]);

  /**
   * Câu báo bảng rỗng: phải phân biệt "lọc ra không có gì" với "chưa khai gì
   * cả" — không thì người dùng tưởng mất dữ liệu.
   */
  const emptyText = (unit: string, none: string) =>
    terms.length ? `Không có ${unit} nào khớp "${search.trim()}".`
      : filterZone ? `Không có ${unit} nào trong KCN đang lọc.`
        : none;

  /**
   * Liệt kê ĐỦ các KCN kèm số bản ghi ở tab hiện tại, kể cả KCN đang có 0 bản
   * ghi. Nếu chỉ liệt kê KCN có dữ liệu thì đổi tab xong lựa chọn cũ biến mất
   * khỏi danh sách: ô hiện "Tất cả KCN" trong khi bộ lọc vẫn đang chạy.
   */
  const zoneFilterOpts = useMemo(() => {
    const groups = tab === 'station' ? stationGroups
      : tab === 'customer' ? customerGroups
        : tab === 'point' ? pointGroups : [];
    const countOf = (id: string | null) =>
      groups.find(g => (g.zone?.id ?? null) === id)?.rows.length ?? 0;
    const orphans = countOf(null);

    return [
      { value: '', label: `Tất cả KCN — ${groups.reduce((n, g) => n + g.rows.length, 0)}` },
      ...zoneRows.map(z => ({ value: z.id, label: `${z.name} (${z.code}) — ${countOf(z.id)}` })),
      ...(orphans ? [{ value: NO_ZONE, label: `Chưa gắn KCN — ${orphans}` }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, zoneRows, stationGroups, customerGroups, pointGroups]);
  /**
   * Tab `lifecycle` không có mục trong `HEAD` (nó chỉ tra cứu, không khai báo),
   * mà dòng này chạy ở MỌI lần render — lấy thẳng `HEAD[tab]` là `undefined` rồi
   * vỡ ngay khi đọc `.title`. Rơi về tab KCN cho an toàn; thanh tiêu đề dùng
   * `head` vốn đã bị ẩn ở tab này nên người dùng không thấy gì khác.
   */
  const headOf = (t: CatTab) => HEAD[t === 'lifecycle' || t === 'stock' || t === 'supply' ? 'zone' : t];
  const head = headOf(tab);
  const modalTitle = editingId
    ? `Chỉnh sửa ${headOf(modal ?? tab).title.toLowerCase()}`
    : headOf(modal ?? tab).add;

  return (
    <div className="relative space-y-6">
      {dialog}

      {/* ---------- Đầu trang: tiêu đề + hành động ---------- */}
      {/* Tab Vòng đời tự mang tiêu đề và nút Nạp lại riêng, và không có gì để
          "Thêm" — nên ẩn hẳn thanh này thay vì hiện một thanh nửa vời. */}
      {tab !== 'lifecycle' && tab !== 'stock' && tab !== 'supply' && (
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">{head.title}</h2>
          <p className="mt-1 text-sm text-soft">{head.desc}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          {/* Ô tìm kiếm — khuôn lấy nguyên từ màn "Công nợ khách hàng". */}
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={SEARCH_HINT[tab]}
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-4
                text-sm text-dim focus:outline-none focus:ring-1 focus:ring-accent sm:w-[260px]" />
          </div>
          {tab !== 'zone' && (
            <div className="w-full min-w-56 md:w-64">
              <Select value={filterZone} onChange={setFilterZone}
                options={zoneFilterOpts} placeholder="Tất cả KCN" icon={Building2} searchable />
            </div>
          )}
          <button onClick={() => void load()} disabled={loading} className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Nạp lại
          </button>
          {tab === 'customer' && (
            <button onClick={auditLowName} disabled={loading || !d}
              title="Đối chiếu tên viết thường với tên gốc — đúng và đủ chữ chưa"
              className="vl-btn vl-btn-secondary flex items-center gap-2">
              <CaseLower className="h-4 w-4" />
              Soát tên viết thường
            </button>
          )}
          {tab === 'customer' && (
            <button onClick={() => void syncCustomers()} disabled={syncing || loading}
              title="Lấy tên và địa chỉ theo hóa đơn có ngày chốt mới nhất"
              className="vl-btn vl-btn-secondary flex items-center gap-2">
              <FileText className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Đang đồng bộ…' : 'Đồng bộ từ hóa đơn'}
            </button>
          )}
          <button onClick={openAdd} className="flex flex-1 items-center justify-center gap-2 vl-btn vl-btn-primary md:flex-none">
            <Plus className="h-5 w-5" />
            {head.add}
          </button>
        </div>
      </div>
      )}

      {shownTabs.length > 1 && (
        <Tabs tabs={shownTabs} value={tab} onChange={t => {
          // Rời tab Kho vật tư ⇒ NẠP LẠI danh mục: `StockEntry` nạp/ghi dữ liệu
          // riêng, nên thiết bị vừa khai ở Kho không có trong `d.devices` của
          // màn này — ô chọn Số No ở form điểm đo không thấy (sự cố SIM
          // 8984048000962310906, 12/10/2026).
          if (tab === 'stock' && t !== 'stock') void load();
          setTab(t); setSearch('');
        }} />
      )}

      {/* ======================= Vòng đời vật tư ======================= */}
      {tab === 'lifecycle' && <AssetLifecycle scope={_scope} />}

      {/* ======================== Kho vật tư ======================== */}
      {tab === 'stock' && <StockEntry />}

      {/* ============== Gắn vật tư dự kiến (Nhóm Vật Tư, 02/11/2026) ============== */}
      {tab === 'supply' && <SupplyAllocate />}


      {/* ============================ KCN ============================ */}
      {tab === 'zone' && (
        <TableCard fixed loading={loading} isEmpty={zoneRowsShown.length === 0}
          empty={terms.length
            ? `Không có khu công nghiệp nào khớp "${search.trim()}".`
            : 'Chưa có khu công nghiệp nào được khai.'}
          columns={<>
            <th className={`${TH_CLS} w-[14%] pl-10`}>Mã KCN</th>
            <th className={`${TH_CLS} w-[26%]`}>Tên khu công nghiệp</th>
            <th className={`${TH_CLS} w-[42%]`}>Địa chỉ</th>
            <th className={`${TH_CLS} w-[10%]`}>Số trạm</th>
            <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
          </>}>
          {zoneRowsShown.map(z => (
            <tr key={z.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{z.code}</span>
              </td>
              <td className="truncate px-6 py-4 font-bold text-ink" title={z.name}>{z.name}</td>
              <td className="truncate px-6 py-4 text-sm text-soft" title={z.address || ''}>{z.address || '—'}</td>
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

      {/* ======================= Lộ đường dây ======================= */}
      {tab === 'line' && (
        <>
          {!d?.zones.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm lộ.
            </div>
          )}
          <ZoneTables groups={lineGroupsShown} unit="lộ" loading={loading}
            empty={emptyText('lộ', 'Chưa có lộ đường dây nào được khai.')}
            rowKey={l => l.id}
            columns={<>
              <th className={`${TH_CLS} w-[18%] pl-10`}>Mã lộ</th>
              <th className={`${TH_CLS} w-[32%]`}>Tên lộ</th>
              <th className={`${TH_CLS} w-[10%]`}>Cấp điện áp</th>
              <th className={`${TH_CLS} w-[10%]`}>Số trạm</th>
              <th className={`${TH_CLS} w-[14%]`}>Tình trạng</th>
              <th className={`${TH_CLS} w-[16%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={l => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className="px-6 py-4 pl-10">
                  <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{l.code}</span>
                </td>
                <td className="truncate px-6 py-4 font-bold text-ink" title={l.name || ''}>{l.name || '—'}</td>
                <td className="px-6 py-4 text-sm text-soft">{l.voltage_level || '—'}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{stationsOfLine(l.id)}</td>
                <td className="px-6 py-4 text-sm">
                  {l.active === false
                    ? <span className="text-[11px] font-bold uppercase text-faint">Đã ngưng</span>
                    : <span className="text-[11px] font-bold uppercase text-[var(--success)]">Đang dùng</span>}
                </td>
                <td className="px-6 py-4 pr-10 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/*
                      Gắn HÀNG LOẠT — mở từ đây chứ không phải form Trạm: gắn 133
                      trạm mà mỗi trạm mở form một lần thì không ai làm nổi.
                    */}
                    <button type="button" onClick={() => setAssigning(l)}
                      className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5"
                      title="Chọn nhiều trạm để gắn vào lộ này">
                      <Factory className="h-3.5 w-3.5" /> Gắn trạm
                    </button>
                    <RowActions onEdit={() => editLine(l)}
                      onDelete={() => void del(`lộ ${l.code}`, () => lines.remove(l.id),
                        stationsOfLine(l.id) > 0
                          ? `Lộ này đang có ${stationsOfLine(l.id)} trạm. Xóa lộ KHÔNG xóa trạm — các trạm đó về nhánh "Chưa gắn lộ".`
                          : undefined)} />
                  </div>
                </td>
              </tr>
            )} />
        </>
      )}

      {/* ============================ Trạm ============================ */}
      {tab === 'station' && (
        <>
          {!d?.zones.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một KCN ở tab "Khu công nghiệp" trước khi thêm trạm.
            </div>
          )}
          <ZoneTables groups={stationGroupsShown} unit="trạm" loading={loading}
            empty={emptyText('trạm', 'Chưa có trạm nào được khai.')}
            rowKey={s => s.id}
            columns={<>
              <th className={`${TH_CLS} w-[24%] pl-10`}>Mã trạm</th>
              <th className={`${TH_CLS} w-[16%]`}>Khu công nghiệp</th>
              <th className={`${TH_CLS} w-[12%]`}>Lộ đường dây</th>
              <th className={`${TH_CLS} w-[13%]`}>Khách hàng</th>
              <th className={`${TH_CLS} w-[9%]`}>Sdm (kVA)</th>
              <th className={`${TH_CLS} w-[11%]`}>P0 / Pk (W)</th>
              <th className={`${TH_CLS} w-[7%]`}>Điểm đo</th>
              <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={s => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className="truncate px-6 py-4 pl-10 font-mono text-sm font-bold text-ink" title={s.code}>{s.code}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    {zoneName(s.zone)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {/* Chưa gắn lộ là BÌNH THƯỜNG, không tô đỏ — chỉ để nhạt. */}
                  {lineCodeOf(s.line)
                    ? <span className="font-mono text-xs font-bold text-dim">{lineCodeOf(s.line)}</span>
                    : <span className="text-[11px] italic text-faint">chưa gắn</span>}
                </td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(s.customer)}</td>
                <td className="px-6 py-4 text-sm font-semibold text-dim">{s.sdm_kva ?? '—'}</td>
                {/* Nhìn bảng phải biết ngay số nào là ĐO, số nào là ƯỚC LƯỢNG, trạm nào
                    cố ý nằm ngoài bảng tổn thất — nếu không thì ba thứ trông như một. */}
                <td className="px-6 py-4 text-sm text-soft">
                  {s.mv_metering
                    ? <span className="vl-badge-info text-[10px]">Trung thế</span>
                    : s.auto_loss_param
                      ? <span className="vl-badge-warning text-[10px]">Tự tính</span>
                      : <>{s.p0_w ?? '—'} / {s.pk_w ?? '—'}</>}
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
            )} />
        </>
      )}

      {/* ========================= Khách hàng ========================= */}
      {tab === 'customer' && (
        <ZoneTables groups={customerGroupsShown} unit="khách hàng" loading={loading}
          empty={emptyText('khách hàng', 'Chưa có khách hàng nào được khai.')}
          rowKey={c => c.id}
          columns={<>
            <th className={`${TH_CLS} w-[12%] pl-10`}>Mã KH</th>
            <th className={`${TH_CLS} w-[27%]`}>Tên khách hàng</th>
            <th className={`${TH_CLS} w-[11%]`}>Tên tắt</th>
            <th className={`${TH_CLS} w-[14%]`}>Khu công nghiệp</th>
            <th className={`${TH_CLS} w-[20%]`}>Địa chỉ</th>
            <th className={`${TH_CLS} w-[8%]`}>Điểm đo</th>
            <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
          </>}
          renderRow={c => (
            <tr className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-10">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{c.mkh}</span>
              </td>
              <td className="truncate px-6 py-4 font-bold text-ink" title={c.name}>{c.name}</td>
              <td className="px-6 py-4">
                {c.short_name
                  ? <span className="font-mono text-xs font-bold text-dim">{c.short_name}</span>
                  : <span className="text-[11px] italic text-warn">chưa khai</span>}
              </td>
              <td className="px-6 py-4 text-sm text-soft">{c.zone ? zoneName(c.zone) : '—'}</td>
              <td className="truncate px-6 py-4 text-sm text-soft" title={c.address || ''}>{c.address || '—'}</td>
              <td className="px-6 py-4 text-sm font-semibold text-dim">{pointsOfCustomer(c.id)}</td>
              <td className="px-6 py-4 pr-10 text-right">
                <RowActions onEdit={() => editCustomer(c)}
                  onDelete={() => void del(`khách hàng ${c.mkh}`, () => customers.remove(c.id),
                    pointsOfCustomer(c.id) > 0
                      ? `Khách hàng này đang gắn ${pointsOfCustomer(c.id)} điểm đo. Xóa KH KHÔNG xóa điểm đo — chúng sẽ không còn chủ.`
                      : undefined)} />
              </td>
            </tr>
          )} />
      )}

      {/* ============================ Điểm đo ============================ */}
      {tab === 'point' && (
        <>
          {!d?.stations.length && !loading && (
            <div className="vl-alert vl-alert-light-warning">
              Phải khai ít nhất một trạm ở tab "Trạm" trước khi thêm điểm đo.
            </div>
          )}
          <ZoneTables groups={pointGroupsShown} unit="điểm đo" loading={loading}
            empty={emptyText('điểm đo', 'Chưa có điểm đo nào được khai.')}
            rowKey={r => r.point.id}
            columns={<>
              <th className={`${TH_CLS} w-[28%] pl-10`}>Mã điểm đo</th>
              <th className={`${TH_CLS} w-[22%]`}>Trạm</th>
              <th className={`${TH_CLS} w-[13%]`}>Khách hàng</th>
              <th className={`${TH_CLS} w-[10%]`}>Loại</th>
              <th className={`${TH_CLS} w-[13%]`}>Trạng thái</th>
              <th className={`${TH_CLS} w-[6%]`}>HSN</th>
              <th className={`${TH_CLS} w-[8%] pr-10 text-right`}>Thao tác</th>
            </>}
            renderRow={({ point: p, isChild }) => (
              <tr className="transition-colors hover:bg-subtle/50">
                <td className={`px-6 py-4 ${isChild ? 'pl-16' : 'pl-10'}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {isChild && <CornerDownRight className="h-4 w-4 shrink-0 text-faint" />}
                    <PointBadgeIcon point={p} />
                    <span className={`truncate font-mono text-sm ${isChild ? 'text-dim' : 'font-bold text-ink'}`}
                      title={p.code || p.line_name || ''}>
                      {p.code || p.line_name || '—'}
                    </span>
                  </span>
                </td>
                <td className="truncate px-6 py-4 font-mono text-xs text-soft" title={placeOf(p)}>{placeOf(p)}</td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(p.customer)}</td>
                <td className="px-6 py-4"><PointBadgeChip point={p} /></td>
                <td className="px-6 py-4"><StatusTag status={p.status} /></td>
                <td className="px-6 py-4 text-sm font-bold text-dim">{p.hsn ?? '—'}</td>
                <td className="px-6 py-4 pr-10 text-right">
                  <RowActions onEdit={() => editPoint(p)}
                    extra={{
                      icon: ArrowLeftRight,
                      title: 'Chuyển chủ thể (giữ nguyên mã điểm đo)',
                      onClick: () => setTransferring(p),
                    }}
                    onDelete={() => void del(`điểm đo ${p.code || p.line_name}`, () => points.remove(p.id),
                      childrenOf(p.id) > 0
                        ? `Điểm đo này đang có ${childrenOf(p.id)} điểm đo phụ. Xóa nó KHÔNG xóa các điểm phụ — chúng sẽ mất điểm đo chính.`
                        : undefined)} />
                </td>
              </tr>
            )} />
        </>
      )}

      {/* Chuyển chủ thể — hộp riêng, KHÔNG đụng vào mã điểm đo. */}
      <TransferOwner point={transferring} d={d}
        onClose={() => setTransferring(null)} onDone={() => void load()} />

      {/* Gắn hàng loạt trạm vào một lộ — mở từ nút "Gắn trạm" ở bảng Lộ. */}
      <LineAssign line={assigning} d={d}
        onClose={() => setAssigning(null)} onDone={() => void load()} />

      {/* ============================ Modal ============================ */}
      <FormModal open={modal !== null} title={modalTitle} onClose={closeModal} onSubmit={submit}
        saving={saving} wide>
        {modal === 'zone' && (
          <>
            {/* Modal đã rộng: màn lớn xếp cả 3 ô một hàng cho đỡ cuộn. */}
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
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
            </div>
          </>
        )}

        {modal === 'line' && (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Khu công nghiệp" required>
              <Select value={lForm.zone} onChange={v => setLForm(f => ({ ...f, zone: v }))}
                options={zoneOpts} placeholder="Chọn KCN" searchable />
            </Field>
            <Field label="Mã lộ" required hint="Tên ngoài đời, gõ tay">
              <TextInput value={lForm.code} mono placeholder="471-E27.1"
                onChange={v => setLForm(f => ({ ...f, code: v }))} />
            </Field>
            <Field label="Cấp điện áp">
              <Select value={lForm.voltage_level}
                onChange={v => setLForm(f => ({ ...f, voltage_level: v as VoltageLevel }))}
                options={[{ value: 'MV', label: 'Trung áp (MV)' }, { value: 'LV', label: 'Hạ áp (LV)' }]} />
            </Field>
            <Field label="Tên lộ">
              <TextInput value={lForm.name} placeholder="Lộ 471 trạm 110kV Tiền Hải"
                onChange={v => setLForm(f => ({ ...f, name: v }))} />
            </Field>
            <Field label="Ghi chú">
              <TextInput value={lForm.note} placeholder="…"
                onChange={v => setLForm(f => ({ ...f, note: v }))} />
            </Field>
            {/* TẮT thay vì xoá: trạm từng gắn vào lộ vẫn phải tra lại được. */}
            <Field label="Tình trạng" hint="Lộ cắt/bỏ thì tắt, đừng xóa">
              <Select value={lForm.active ? '1' : '0'}
                onChange={v => setLForm(f => ({ ...f, active: v === '1' }))}
                options={[{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Đã ngưng' }]} />
            </Field>
          </div>
        )}

        {modal === 'station' && (
          <>
            {/*
              4 mảnh ghép nên mã trạm — đặt trước, để ô mã bên dưới cập nhật theo.
              Khách hàng chiếm TRỌN MỘT HÀNG: nhãn là "MKH — tên đầy đủ (tên tắt)",
              tên công ty dài mấy chục ký tự, nhét chung hàng với 3 ô kia là bị
              cắt cụt không đọc nổi.
            */}
            <Field label="Khách hàng" required
              hint={sCustomer?.short_name ? `Tên tắt: ${sCustomer.short_name}` : undefined}>
              <Select value={sForm.customer} onChange={v => setSForm(f => ({ ...f, customer: v }))}
                options={customerOpts} placeholder="Chọn khách hàng" searchable />
            </Field>

            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Khu công nghiệp" required hint={sZone ? `Hậu tố: ${sZone.code}` : undefined}>
                <Select value={sForm.zone} onChange={v => setSForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chọn KCN" searchable />
              </Field>
              {/* Lộ KHÔNG bắt buộc: 133 trạm hiện chưa khai lộ, bắt buộc là
                  chặn mọi thao tác sửa trạm cho tới khi khai xong hết lộ. */}
              <Field label="Lộ đường dây"
                hint={!sForm.zone ? 'Chọn KCN trước'
                  : lineOptsOfZone(sForm.zone).length ? 'Không bắt buộc'
                    : 'KCN này chưa khai lộ nào'}>
                <Select value={sForm.line} onChange={v => setSForm(f => ({ ...f, line: v }))}
                  options={lineOptsOfZone(sForm.zone)} placeholder="Chưa gắn lộ" searchable
                  disabled={!sForm.zone || lineOptsOfZone(sForm.zone).length === 0} />
              </Field>
              <Field label="Định danh trạm" required hint="T1, T2, NX1…">
                <TextInput value={sForm.ident} mono placeholder="T1"
                  onChange={v => setSForm(f => ({ ...f, ident: v.toUpperCase() }))} />
              </Field>
              <Field label="Công suất trạm" required>
                <NumberInput value={sForm.sdm_kva} suffix="kVA" placeholder="2500"
                  min={SDM_RANGE[0]} max={SDM_RANGE[1]}
                  onChange={v => setSForm(f => ({ ...f, sdm_kva: v }))} />
              </Field>
            </div>

            {customerLacksShortName && (
              <div className="vl-alert vl-alert-light-warning text-[13px]">
                Khách hàng "{sCustomer?.name}" chưa có tên tắt. Vào Hồ sơ kinh doanh → Khách hàng bổ sung tên tắt
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

            {/* ---- Thông số tổn hao: hai cờ quyết định ô P0/Pk có nhập tay được không ---- */}
            {/* `Switch` là inline-flex nên phải xếp cột tường minh, `space-y` không ăn. */}
            <div className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-subtle p-4">
              <Switch
                checked={sForm.auto_loss_param}
                onChange={v => setSForm(f => ({
                  /* Hai cờ loại trừ nhau: trạm trung thế thì không tính tổn thất,
                     bật thêm "tự động" là vô nghĩa. */
                  ...f, auto_loss_param: v, mv_metering: v ? false : f.mv_metering,
                }))}
                label="Tính tự động P0, Pk"
                title="Lấy trung bình của các trạm cùng công suất đã có số thật"
              />
              <Switch
                checked={sForm.mv_metering}
                onChange={v => setSForm(f => ({
                  ...f, mv_metering: v, auto_loss_param: v ? false : f.auto_loss_param,
                }))}
                label="Điểm đo trung thế — không tính tổn thất trạm này"
                title="Mua bán điện phía trung thế: tổn hao máy biến áp là của khách hàng"
              />
            </div>

            {sForm.mv_metering ? (
              <div className="vl-alert vl-alert-light-primary text-[13px]">
                Trạm mua bán điện phía trung thế nên tổn hao máy biến áp là của khách hàng.
                Trạm này <strong>nằm ngoài bảng tổn thất</strong>, không cần khai P0/Pk.
              </div>
            ) : sForm.auto_loss_param ? (
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Tổn hao không tải" hint="P0 — ước lượng, không phải số đo.">
                  <DerivedValue value={lossEstimate ? `${lossEstimate.p0_w} W` : ''}
                    placeholder="Chưa có trạm nào cùng công suất để lấy mẫu" />
                </Field>
                <Field label="Tổn hao ngắn mạch" hint="Pk — ước lượng, không phải số đo.">
                  <DerivedValue value={lossEstimate ? `${lossEstimate.pk_w} W` : ''}
                    placeholder="Chưa có trạm nào cùng công suất để lấy mẫu" />
                </Field>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Tổn hao không tải" hint="P0 — đơn vị W, không phải kW.">
                  <NumberInput value={sForm.p0_w} suffix="W"
                    min={P0_RANGE[0]} max={P0_RANGE[1]}
                    onChange={v => setSForm(f => ({ ...f, p0_w: v }))} />
                </Field>
                <Field label="Tổn hao ngắn mạch" hint="Pk — đơn vị W, không phải kW.">
                  <NumberInput value={sForm.pk_w} suffix="W"
                    min={PK_RANGE[0]} max={PK_RANGE[1]}
                    onChange={v => setSForm(f => ({ ...f, pk_w: v }))} />
                </Field>
              </div>
            )}

            {sForm.auto_loss_param && (
              lossEstimate ? (
                <p className="-mt-3 ml-1 text-[11px] font-semibold text-soft">
                  Trung bình của {lossEstimate.samples} trạm cùng {toNum(sForm.sdm_kva)} kVA:{' '}
                  {lossEstimate.codes.slice(0, 4).join(', ')}
                  {lossEstimate.codes.length > 4 && ` và ${lossEstimate.codes.length - 4} trạm nữa`}.
                  Số này <strong>không lưu vào trạm</strong> — khai thêm trạm có số thật thì nó tự cập nhật.
                </p>
              ) : (
                <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                  {toNum(sForm.sdm_kva)
                    ? `Chưa trạm nào ${toNum(sForm.sdm_kva)} kVA có P0/Pk thật để lấy mẫu — trạm này sẽ nằm ngoài bảng tổn thất cho tới khi có.`
                    : 'Khai công suất trạm trước thì mới tìm được trạm cùng công suất để lấy mẫu.'}
                </p>
              )
            )}
            <Field label="Ghi chú">
              <TextInput value={sForm.note} onChange={v => setSForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
        )}

        {modal === 'customer' && (
          <>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Mã khách hàng" required>
                <TextInput value={cForm.mkh} mono placeholder="KCNTH-001"
                  onChange={v => setCForm(f => ({ ...f, mkh: v }))} />
              </Field>
              <Field label="Khu công nghiệp" hint="Không bắt buộc">
                <Select value={cForm.zone} onChange={v => setCForm(f => ({ ...f, zone: v }))}
                  options={zoneOpts} placeholder="Chưa gắn" searchable />
              </Field>
              <Field label="Tên tắt khách hàng" hint={`${SHORT_NAME_HINT} Dùng để sinh mã trạm.`}>
                {/* Chuẩn hoá ngay khi gõ: bỏ dấu, viết hoa, loại ký tự lạ. */}
                <TextInput value={cForm.short_name} mono placeholder="RICO"
                  onChange={v => setCForm(f => ({ ...f, short_name: normalizeShortName(v) }))} />
              </Field>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Tên khách hàng" required>
                {/* Chỉ mồi ô viết thường khi nó đang TRỐNG. Đã có nội dung thì
                    không đụng: đó là bản người dùng soạn, hạ hoa là phá. */}
                <TextInput value={cForm.name} placeholder="CÔNG TY TNHH…"
                  onChange={v => setCForm(f => ({
                    ...f, name: v,
                    low_name: f.low_name.trim() ? f.low_name : toLowName(v),
                  }))} />
              </Field>
              <Field label="Địa chỉ">
                <TextInput value={cForm.address} onChange={v => setCForm(f => ({ ...f, address: v }))} />
              </Field>
            </div>
            <Field label="Tên viết thường"
              hint={lowNameCheck.issue === 'ok'
                ? 'Cùng chữ với tên khách hàng. Viết hoa thế nào là tùy bạn — không xét hoa/thường.'
                : `${ISSUE_LABEL[lowNameCheck.issue]} — ${lowNameCheck.detail}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput value={cForm.low_name} placeholder="công ty tnhh…"
                    onChange={v => setCForm(f => ({ ...f, low_name: v }))} />
                </div>
                {/* Ghi đè bản đã soạn, nên chỉ mở khi đang sai CHỮ hoặc còn trống. */}
                <button type="button" title="Thay bằng tên gốc hạ chữ hoa"
                  disabled={lowNameCheck.issue === 'ok' || lowNameCheck.issue === 'space'}
                  onClick={() => setCForm(f => ({ ...f, low_name: toLowName(f.name) }))}
                  className="vl-btn vl-btn-secondary flex shrink-0 items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Lấy từ tên
                </button>
              </div>
            </Field>
          </>
        )}

        {modal === 'point' && (
          <>
            {/* Mã điểm đo đứng ĐẦU form: nó là kết quả của mọi ô bên dưới, để
                trên cùng thì vừa gõ vừa thấy mã đổi theo, khỏi cuộn xuống. */}
            {isHead ? (
              <Field label="Mã điểm đo đầu nguồn" required
                hint="Nhập tay, khớp LINE_NAME bên HES (vd TTI.DIEMDOPHU). Đầu nguồn không thuộc trạm nên không sinh mã theo trạm được.">
                <TextInput value={pForm.head_code} mono placeholder="TTI.DIEMDOPHU"
                  onChange={v => setPForm(f => ({ ...f, head_code: v }))} />
              </Field>
            ) : (<>
            <Field label={codeLocked ? 'Mã điểm đo (đang giữ nguyên)' : 'Mã điểm đo (hệ thống tự sinh)'}
              hint={codeLocked
                ? 'Điểm đo đã chuyển chủ thể nên mã được giữ nguyên để khớp LINE_NAME bên HES.'
                : isSub
                ? `Ghép: mã trạm . ${sameCustomer ? 'nhãn mục đích' : 'tên tắt KH phụ'}(định danh điểm đo)`
                : mainTenant
                  ? 'Ghép: mã trạm . tên tắt khách thuê(định danh điểm đo) — điểm đo khác chủ trạm'
                  : 'Ghép: mã trạm(định danh điểm đo)'}>
              <DerivedValue value={pointCodeMissing.length ? '' : pointCode}
                placeholder={pForm.station ? pointCode : 'Chọn trạm trước'} />
            </Field>

            {/*
              Mã đang bị giữ mà dữ liệu hiện tại sinh ra mã khác ⇒ nói rõ hai mã,
              và cho đổi nhưng phải bấm — không âm thầm đổi định danh của điểm đo.
            */}
            {codeLocked && generatedCode !== pointCode && (
              <div className="-mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-subtle px-4 py-3">
                <span className="text-[12px] text-soft">
                  Theo dữ liệu hiện tại, mã sẽ là{' '}
                  <b className="font-mono text-dim">{generatedCode}</b>. Đang giữ mã cũ.
                </span>
                <button type="button" onClick={() => setRegenCode(true)}
                  className="vl-btn vl-btn-secondary vl-btn-sm">
                  Sinh lại mã
                </button>
              </div>
            )}
            {pointCodeMissing.length > 0 && (
              <p className="-mt-3 ml-1 text-[11px] font-semibold text-warn">
                Còn thiếu: {pointCodeMissing.join(', ')}. Các mảnh này lấy từ hồ sơ trạm và khách hàng.
              </p>
            )}
            </>)}

            {isHead ? (
              <Field label="Lộ đường dây" required
                hint={lineHeadTaken ? 'Lộ này đã có điểm đo đầu nguồn — mỗi lộ một điểm.'
                  : pLine ? `KCN ${d?.zones.find(z => z.id === pLine.zone)?.name ?? '—'} · đo TỔNG mọi trạm của lộ` : undefined}>
                <Select value={pForm.line} onChange={v => setPForm(f => ({ ...f, line: v }))}
                  options={allLineOpts} placeholder="Chọn lộ" searchable />
              </Field>
            ) : (
            <Field label="Trạm" required
              hint={pStation ? `KCN ${pStationZone?.code ?? '—'} · KH ${pStationCustomer?.short_name ?? '—'} · ${pStation.ident ?? '—'} · ${pStation.sdm_kva ?? '—'} kVA` : undefined}>
              <Select value={pForm.station}
                onChange={v => setPForm(f => {
                  // Doi tram thi KH mac dinh theo chu tram moi, tru khi dang sua
                  // mot diem do da khai KH rieng.
                  const st = d?.stations.find(x => x.id === v);
                  const keep = f.customer && f.customer !== pStation?.customer;
                  return { ...f, station: v, parent_point: '',
                    customer: keep ? f.customer : (st?.customer ?? '') };
                })}
                options={stationOpts} placeholder="Chọn trạm" searchable />
            </Field>
            )}

            {/*
              Không còn ô "Đấu nối": HSN = 1 đã là đấu trực tiếp rồi, hỏi thêm
              chỉ tạo cơ hội khai mâu thuẫn với bảng vật tư (user chốt 20/08).
            */}
            <Field label="Loại điểm đo">
              <Toggle value={pForm.role}
                onChange={v => setPForm(f => ({ ...f, role: v, parent_point: '' }))}
                options={[
                  { value: 'chinh', label: ROLE_LABEL.chinh },
                  { value: 'phu', label: ROLE_LABEL.phu, hex: '#8b5cf6' },
                  { value: 'dau_nguon', label: ROLE_LABEL.dau_nguon, hex: '#f59e0b' },
                ]} />
            </Field>

            {/* Đầu nguồn: không khách, không điểm cha, không đuôi mã — bỏ cả cụm. */}
            {!isHead && (<>
            {/*
              Khách hàng của điểm đo — cho CẢ điểm chính. Mặc định là chủ trạm,
              nhưng trạm cho thuê thì điểm đo thuộc khách thuê, khác chủ trạm.
            */}
            <Field label={isSub ? 'Khách hàng phụ' : 'Khách hàng của điểm đo'} required
              hint={pSubCustomer && !pSubCustomer.short_name
                ? 'KH này chưa khai tên tắt — chưa ghép được đuôi mã'
                : mainTenant
                  ? `Khác chủ trạm (${pStationCustomer?.short_name ?? '—'}) → mã thêm đuôi ${normalizeShortName(pSubCustomer?.short_name ?? '')}`
                  : isSub ? 'Tên tắt của KH này thành đuôi mã' : 'Mặc định là chủ trạm; đổi được nếu trạm cho thuê'}>
              <Select value={pForm.customer} onChange={v => setPForm(f => ({ ...f, customer: v }))}
                options={customerOpts} placeholder="Chọn khách hàng" searchable />
            </Field>

            {/* Điểm đo phụ: cần thêm điểm đo chính chứa nó */}
            {isSub && (
              <>
                <Field label="Phụ của điểm đo chính" required
                  hint={pForm.station ? undefined : 'Chọn trạm trước'}>
                  <Select value={pForm.parent_point} onChange={v => setPForm(f => ({ ...f, parent_point: v }))}
                    options={parentOpts} placeholder={parentOpts.length ? 'Chọn điểm đo chính' : 'Trạm này chưa có điểm đo chính'}
                    disabled={!parentOpts.length} searchable />
                </Field>

              </>
            )}

            {/*
              Nhãn mục đích + định danh: hai mảnh đuôi của mã điểm đo, để cạnh
              nhau cho thấy ngay mã sẽ ra thế nào. Nhãn LUÔN hiện, không còn chỉ
              bật khi điểm phụ trùng khách hàng (user chốt 25/08/2026).
            */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Nhãn mục đích (đuôi mã)"
                required={isSub && sameCustomer}
                hint={isSub && sameCustomer
                  ? 'Trùng khách hàng với điểm đo chính nên phải có nhãn để phân biệt.'
                  : 'Không bắt buộc. Bỏ trống thì đuôi mã lấy theo tên tắt khách hàng.'}>
                <Select value={pForm.purpose} onChange={v => setPForm(f => ({ ...f, purpose: v }))}
                  options={[
                    { value: '', label: 'Không có nhãn' },
                    ...SUB_PURPOSES.map(x => ({ value: x.code, label: `${x.label} (${x.code})` })),
                    { value: CUSTOM, label: 'Tự nhập ký tự…' },
                  ]}
                  placeholder="Không có nhãn" searchable />
              </Field>

              <Field label="Định danh điểm đo" hint="Không bắt buộc. Gõ 0,4 → mã có đuôi (0,4)">
                <TextInput value={pForm.ident} mono placeholder="0,4"
                  onChange={v => setPForm(f => ({ ...f, ident: v }))} />
              </Field>

              {/*
                Ô tự nhập nằm NGAY DƯỚI bộ chọn nhãn (ô thứ 3 của lưới 2 cột), để
                chọn "Tự nhập ký tự…" xong là thấy ngay chỗ gõ.

                KHÔNG chuẩn hoá lúc gõ nữa: `normalizeShortName` viết hoa và xoá
                mọi ký tự ngoài [A-Z0-9-] ngay từng phím một, nên gõ dấu tiếng
                Việt hay khoảng trắng là chữ biến mất trước mắt — cảm giác "gõ
                không ăn gì". Giữ nguyên chữ người dùng gõ, chỉ chuẩn hoá khi
                GHÉP MÃ, và hiện luôn kết quả bên dưới cho thấy mã sẽ ra sao.
              */}
              {pForm.purpose === CUSTOM && (
                <Field label="Ký tự tự nhập" required
                  hint={purposeLabel
                    ? `Đuôi mã sẽ là: ${purposeLabel}`
                    : SHORT_NAME_HINT}>
                  <TextInput value={pForm.purpose_custom} mono placeholder="KHO-LANH-2"
                    onChange={v => setPForm(f => ({ ...f, purpose_custom: v }))} />
                </Field>
              )}
            </div>
            </>)}

            {/*
              HSN NHẬP TAY, đặt TRÊN bảng vật tư (user chốt 28/09/2026): khai HSN
              trước rồi mới chọn bộ TI/TU cho khớp. HSN suy từ vật tư và HSN hóa
              đơn chỉ hiện để tham chiếu, bấm mới điền — không tự điền ngầm.
            */}
            <Field label="HSN điểm đo" required
              hint={`Vật tư đang khai: ${hsnFormula(hsnInput)}`
                + (hsnFromPlan ? ' (theo vật tư dự kiến)' : '')
                + (refHsn != null ? ` · Hóa đơn: HSN ${refHsn}` : '')}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[10rem] flex-1">
                  <TextInput value={pForm.hsn} mono placeholder="vd 40 (TI 200/5) · 1 = đo thẳng"
                    onChange={v => setPForm(f => ({ ...f, hsn: v }))} />
                </div>
                {derivedHsn != null && derivedHsn > 0 && derivedHsn !== manualHsn && (
                  <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary"
                    onClick={() => setPForm(f => ({ ...f, hsn: String(derivedHsn) }))}>
                    Dùng {derivedHsn} theo vật tư
                  </button>
                )}
                {refHsn != null && refHsn !== manualHsn && refHsn !== derivedHsn && (
                  <button type="button" className="vl-btn vl-btn-sm vl-btn-outline-primary"
                    onClick={() => setPForm(f => ({ ...f, hsn: String(refHsn) }))}>
                    Dùng {refHsn} theo hóa đơn
                  </button>
                )}
              </div>
            </Field>

            {/* Phần NHU CẦU (quy cách) — Kinh Doanh khai; Vật Tư gắn số No dự kiến (điểm đo hai phần, 27/10/2026). */}
            <PointNeedEditor
              rows={pForm.need} onChange={need => setPForm(f => ({ ...f, need }))}
              hsn={manualHsn} connection={connectionOfHsn(manualHsn)}
              allocated={editingId ? liveFirst(d?.assets ?? [], editingId) : undefined}
              devices={d?.devices ?? []} />
            {/* Số No Vật Tư đã gắn dự kiến — thuộc phần NHU CẦU, chưa treo (treo ở màn Treo tháo). */}
            {needRows.length > 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-subtle px-4 py-3 text-[12px]">
                <p className="mb-2 font-bold uppercase tracking-wide text-dim">
                  Vật tư dự kiến đã gắn ({needRows.length}) — chưa treo
                </p>
                <div className="flex flex-wrap gap-2">
                  {needRows.map(r => (
                    <span key={r.key} className="rounded-md border border-[var(--border)] bg-surface px-2 py-1">
                      {r.type ? ASSET_LABEL[r.type as AssetType] : '—'}{' '}
                      <b className="font-mono text-ink">{r.serial}</b>{r.ratio ? ` · ${r.ratio}` : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-faint">Treo thực tế thì ghi ở màn Treo tháo — số No khác đề xuất sẽ tự trả kho.</p>
              </div>
            )}

            {/* Gợi ý bộ TI/TU trong kho khớp HSN — chỉ khi đo gián tiếp (HSN > 1). */}
            {manualHsn != null && manualHsn > 1 && (hsnMismatch || !hasTi) && (
              setSuggestions.length ? (
                <div className="vl-alert vl-alert-light-primary space-y-2 text-[12px]">
                  <p className="font-bold">Bộ TI còn trong Kho khớp HSN {manualHsn}:</p>
                  <div className="flex flex-wrap gap-2">
                    {setSuggestions.map(s => (
                      <button key={`${s.ti}|${s.tu ?? ''}`} type="button"
                        className="vl-btn vl-btn-sm vl-btn-outline-primary"
                        onClick={() => applySet(s)}>
                        TI {s.ti} ({s.tiFree} rảnh)
                        {s.tu && <> × TU {s.tu} ({s.tuFree} rảnh)</>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] opacity-80">
                    Bấm một bộ để thêm sẵn {TI_PER_SET} dòng TI rồi chọn Số No.
                  </p>
                </div>
              ) : (
                <div className="vl-alert vl-alert-light-warning text-[12px]">
                  Kho chưa có bộ TI nào (đủ {TI_PER_SET} cái rảnh) khớp HSN {manualHsn}
                  — khai thiết bị ở tab Kho vật tư trước.
                </div>
              )
            )}

            {/* ---------------- Bảng vật tư gắn ở điểm đo ---------------- */}
            <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
                  <Package className="h-4 w-4" /> Treo tháo — vật tư thực tế ở điểm đo
                </p>
                <span className="text-[11px] text-faint">
                  {treoRows.length} thiết bị · bắt buộc ngày treo
                  {treoRows.some(r => !r.active) &&
                    ` · ${treoRows.filter(r => r.active).length} đang hoạt động`}
                </span>
              </div>
              {/* Chú giải icon ở ô chọn Số No. */}
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
                {Object.values(SERIAL_STATE).map(s => (
                  <span key={s.label} className="flex items-center gap-1">
                    <s.icon className={`h-3.5 w-3.5 ${s.cls}`} /> {s.label}
                  </span>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-surface">
                {/* table-fixed + colgroup: khoá tỷ lệ cột, không để nội dung
                    trong ô tự kéo co làm cột "Số No" teo lại. */}
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '6%' }} />
                  </colgroup>
                  <thead className="border-b border-[var(--border)] bg-subtle">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-soft">Thiết bị</th>
                      <th className="px-4 py-3 text-left font-bold text-soft">Số No</th>
                      <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
                      <th className="px-2 py-3 text-left font-bold text-soft">Ngày treo</th>
                      <th className="px-2 py-3 text-left font-bold text-soft">Ngày tháo</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {treoRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-[13px] italic text-faint">
                          Chưa treo thiết bị nào — treo thực tế thì bấm "Thêm dòng" và khai ngày treo.
                        </td>
                      </tr>
                    ) : treoRows.map(r => (
                      // Dòng đã ngưng hoạt động làm mờ đi — vẫn sửa được, chỉ
                      // để mắt nhận ra ngay đâu là thiết bị đang treo.
                      <tr key={r.key} className={r.active ? '' : 'opacity-60'}>
                        <td className="p-2">
                          {isNeedRow(r) ? (
                            <span className="block p-2 text-soft">{r.type ? ASSET_LABEL[r.type as AssetType] : '—'}</span>
                          ) : (
                            <Select value={r.type} variant="bare"
                              onChange={v => setRow(r.key, { type: v as AssetType })}
                              options={Object.entries(ASSET_LABEL).map(([value, label]) => ({ value, label }))}
                              placeholder="Chọn thiết bị" />
                          )}
                          {/* Dòng NHU CẦU chưa treo (Vật Tư gắn) — khai ngày treo là treo nó. */}
                          {r.type && r.serial.trim() && !r.dateOn.trim() && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-faint"
                              title="Nhóm Vật Tư gắn cho điểm đo — khai ngày treo khi đã treo thực tế">
                              nhu cầu
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {isNeedRow(r) ? (
                            <span className="block p-2 font-mono font-semibold text-soft">{r.serial}</span>
                          ) : (() => {
                            const opts = serialOptions(r);
                            return (<>
                              <Select value={r.serial.trim()} variant="bare" searchable
                                onChange={v => setRow(r.key, { serial: v })}
                                options={opts} placeholder="Chọn từ Kho" />
                              {opts.length === 0 && (
                                <span className="mt-1 block text-[11px] leading-snug text-bad">
                                  Kho chưa có {r.type ? ASSET_LABEL[r.type as AssetType] : 'vật tư'} nào
                                  — khai ở tab Kho vật tư trước
                                </span>
                              )}
                            </>);
                          })()}
                        </td>
                        <td className="p-2">
                          {/* Dòng MỚI: tỷ số theo thiết bị trong kho, chỉ đọc.
                              Dòng đã lưu giữ ô nhập như cũ. */}
                          {!r.id && HAS_RATIO.includes(r.type as AssetType) ? (
                            <span className={`block p-2 font-mono ${r.ratio ? 'text-ink' : 'text-faint'}`}
                              title="Tỷ số lấy theo thiết bị trong Kho — sửa ở tab Kho vật tư">
                              {r.ratio || '—'}
                            </span>
                          ) : HAS_RATIO.includes(r.type as AssetType) ? (
                            <CellInput value={r.ratio} mono
                              placeholder={r.type === 'TU' ? '22000/100' : '200/5'}
                              onChange={v => setRow(r.key, { ratio: v })} />
                          ) : <span className="block p-2 text-faint">—</span>}
                        </td>
                        <td className="p-2">
                          {/* usePortal: bảng nằm trong khung overflow-hidden,
                              không có portal thì lịch bị cắt mất. */}
                          {lockedOn(r) ? (
                            // Thiết bị còn treo ở điểm đo cũ — khoá ngày treo.
                            <span className="flex items-center gap-1 p-2 text-[11px] leading-snug text-faint"
                              title={`Đang treo ở ${pointCodeOf(liveElsewhere(r.serial)?.point)} — `
                                + 'khai ngày tháo ở điểm đo đó trước rồi mới khai ngày treo ở đây'}>
                              <Zap className="h-3.5 w-3.5 shrink-0 text-red-500" />
                              Chờ tháo ở {pointCodeOf(liveElsewhere(r.serial)?.point)}
                            </span>
                          ) : (
                            <DatePicker value={r.dateOn} usePortal
                              onChange={v => setRow(r.key, { dateOn: v })} />
                          )}
                        </td>
                        <td className="p-2">
                          <DatePicker value={r.dateOff} usePortal
                            onChange={v => setRow(r.key, { dateOff: v })} />
                        </td>
                        <td className="p-2 text-center">
                          {!isNeedRow(r) && (
                            <button type="button" onClick={() => removeRow(r.key)} title="Bỏ dòng"
                              className="p-1 text-faint transition-colors hover:text-red-500">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={() => addRow()}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                <Plus className="h-4 w-4" /> Thêm dòng
              </button>
            </div>


            {/*
              Đối chiếu hóa đơn — THAM CHIẾU, không tự điền gì cả.
              Hóa đơn chuẩn cho HSN, nhưng không nói được ngày treo/tháo.
            */}
            {(invLoading || activeSeg || invoiceNotes.length > 0) && (
              <div className="rounded-lg border border-dashed border-[var(--border)] bg-subtle/40 p-4 text-[12px] space-y-2">
                <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-faint">
                  <FileText className="h-3.5 w-3.5" />
                  Đối chiếu hóa đơn
                  {invLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
                </div>

                {meterRefs.filter(m => m.mine).length ? (
                  <div className="space-y-2">
                    {meterRefs.filter(m => m.mine).map(({ row, mine }) => (
                      <div key={row.key} className={`space-y-1 ${row.active ? '' : 'opacity-70'}`}>
                        <p className="text-soft">
                          Công tơ <span className="font-mono font-bold text-ink">{row.serial.trim()}</span>
                          {!row.active && <span className="ml-1 text-[10px] font-bold uppercase text-faint">đã tháo</span>}
                          {' '}· khách <span className="font-mono font-bold text-ink">{mine!.mkh}</span>
                          {' '}· phát sinh tiền điện{' '}
                          <b className="text-ink">{dmyRange(mine!.from, mine!.to)}</b>
                          {' '}({mine!.count} HĐ){mine!.isCurrent && ' — còn phát sinh gần đây'}
                          {mine!.hsn != null && <> · HSN hóa đơn <b className="text-ink">{mine!.hsn}</b></>}
                        </p>
                        {/*
                          Nút điền nhanh cho trường hợp ngày treo/tháo trùng đúng
                          mốc hóa đơn. Chỉ hiện khi ô đang khác giá trị đó — điền
                          rồi thì nút biến mất, khỏi bấm nhầm lần nữa.
                        */}
                        <div className="flex flex-wrap gap-2">
                          {row.dateOn !== mine!.from && (
                            <button type="button" onClick={() => fillDate(row.key, 'dateOn', mine!.from)}
                              className="vl-btn vl-btn-secondary vl-btn-sm">
                              Ngày treo = {dmy(mine!.from)}
                            </button>
                          )}
                          {row.dateOff !== mine!.to && (
                            <button type="button" onClick={() => fillDate(row.key, 'dateOff', mine!.to)}
                              className="vl-btn vl-btn-secondary vl-btn-sm">
                              Ngày tháo = {dmy(mine!.to)}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !invLoading && (
                  <p className="italic text-faint">
                    Chưa tra được hóa đơn nào cho các công tơ của điểm đo này.
                  </p>
                )}

                {canFillTi && suggestedTi !== ratioRowOf('TI')?.ratio && (
                  <button type="button" onClick={fillTiFromInvoice}
                    className="vl-btn vl-btn-secondary vl-btn-sm">
                    Điền tỷ số TI theo hóa đơn: {suggestedTi} (HSN {invoiceHsn})
                  </button>
                )}
                {hasTi && invoiceHsn != null && tuRow && (
                  <p className="text-faint">
                    Có TU nên không suy ngược được tỷ số — nhập cả TI và TU sao cho
                    tích hai tỷ số bằng <b className="text-ink">{invoiceHsn}</b>.
                  </p>
                )}

                {invoiceNotes.length > 0 && (
                  <div className="vl-alert vl-alert-light-warning text-[12px]">
                    <b>Nhắc:</b> {invoiceNotes.join('; ')}. Vẫn lưu được.
                  </div>
                )}
              </div>
            )}

            {/* Trạng thái do hệ thống suy — xem `lib/dm/pointStatus.ts`. */}
            <Field label="Trạng thái (hệ thống tự gắn)"
              hint="Chưa gắn công tơ, hoặc công tơ chưa khai ngày treo → Dự kiến · đã treo nhưng chưa có hóa đơn → Chưa vận hành · đã có hóa đơn → Đang vận hành · mọi vật tư đã ngưng → Đã tháo gỡ.">
              <div className="rounded border border-dashed border-[var(--border)] bg-subtle px-4 py-3">
                <StatusTag status={derivedStatus} />
                {statusReason && (
                  <div className="mt-2 text-[12px] text-muted">{statusReason}</div>
                )}
              </div>
            </Field>

            {/* Màu đỏ = thứ CHẶN lưu (đụng số chế tạo, thiếu/sai tỷ số). */}
            {saveBlocks.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[12px]">
                <b>Không lưu được:</b> {saveBlocks.join('; ')}.
              </div>
            )}

            {assetWarnings.length > 0 && (
              <div className="vl-alert vl-alert-light-warning text-[12px]">
                <b>Nhắc:</b> {assetWarnings.join('; ')}. Vẫn lưu được — điểm đo khai dở
                sẽ hiện nhãn thiếu vật tư.
              </div>
            )}

            <Field label="Ghi chú">
              <TextInput value={pForm.note} onChange={v => setPForm(f => ({ ...f, note: v }))} />
            </Field>
          </>
        )}
      </FormModal>

      {/* ============ Kết quả soát tên viết thường ============ */}
      {/* Dùng lại FormModal: nút xác nhận của nó chính là "Sửa tất cả". */}
      <FormModal wide open={lowNameOpen}
        title={`Soát tên viết thường — ${lowNameRows?.length ?? 0} khách hàng lệch`}
        onClose={() => setLowNameOpen(false)}
        onSubmit={() => void fixAllLowName()}
        saving={fixingLowName}
        submitLabel={`Sửa theo tên gốc (${autoFillable(lowNameRows ?? []).length})`}>
        <p className="text-sm text-soft">
          So <b>tên viết thường</b> với <b>tên khách hàng</b> — chỉ xét số ký tự và ký tự,
          <b> không phân biệt hoa/thường</b>. Viết hoa khác nhau không phải lỗi.
        </p>
        <div className="vl-alert vl-alert-light-warning">
          Tên gốc tải từ hóa đơn nên luôn đúng về chữ. Nút bên dưới lấy <b>ký tự</b> của tên
          gốc nhưng <b>giữ kiểu viết hoa</b> bạn đã soạn — xem cột "Đề nghị" trước khi bấm.
        </div>
        <TableCard fixed loading={false} isEmpty={!lowNameRows?.length} empty="Không có dòng nào lệch."
          columns={<>
            <th className={`${TH_CLS} w-[12%] pl-6`}>Mã KH</th>
            <th className={`${TH_CLS} w-[16%]`}>Lý do</th>
            <th className={`${TH_CLS} w-[24%]`}>Tên khách hàng</th>
            <th className={`${TH_CLS} w-[24%]`}>Đang lưu</th>
            <th className={`${TH_CLS} w-[24%] pr-6`}>Đề nghị</th>
          </>}>
          {(lowNameRows ?? []).map(r => (
            <tr key={r.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-3 pl-6">
                <span className="rounded-md bg-subtle px-2.5 py-1 font-mono text-xs font-bold text-soft">{r.mkh}</span>
              </td>
              <td className="px-6 py-3">
                <span className={`text-xs font-bold ${r.issue === 'chars' ? 'text-bad' : 'text-warn'}`}>
                  {ISSUE_LABEL[r.issue]}
                </span>
                <p className="mt-0.5 text-[11px] leading-snug text-faint">{r.detail}</p>
              </td>
              <td className="truncate px-6 py-3 text-sm font-bold text-ink" title={r.name}>{r.name}</td>
              <td className="truncate px-6 py-3 text-sm text-soft" title={r.current}>
                {r.current || <span className="text-[11px] italic text-warn">chưa có</span>}
              </td>
              <td className="truncate px-6 py-3 pr-6 text-sm text-dim" title={r.expected}>{r.expected}</td>
            </tr>
          ))}
        </TableCard>
      </FormModal>
    </div>
  );
}
