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
  Building2, Factory, Users, Gauge, Package,
  Plus, Trash2, Edit2, RefreshCw, CornerDownRight, FileText, History, ArrowLeftRight, Search,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { Toggle } from '../ui/Toggle';
import { DatePicker } from '../ui/DateTimePickers';
import { assets, customers, devices, isAbortError, loadCatalog, pbErrorMessage, points, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { ASSET_LABEL, ROLE_LABEL } from '../../lib/dm/types';
import type {
  AssetStatus, AssetType, Customer, Device, Point, PointRole, Station, Zone,
} from '../../lib/dm/types';
import { connectionOfHsn, deriveHsn, formatRatio, hsnFormula, parseRatio, pickRatio } from '../../lib/dm/hsn';
import { REMOTE_LABEL, TI_PER_SET, countAssets, derivePointStatus, missingRemote } from '../../lib/dm/pointStatus';
import type { Scope } from '../../lib/scope';
import {
  CellInput, DerivedValue, Field, FormModal, NumberInput, TableCard, TextInput, TH_CLS,
} from './entryUi';
import { PointBadgeChip, PointBadgeIcon, StatusTag } from './pointIcons';
import { invoicesOfMkh, invoicesOfSerial, loadCustomerFacts } from '../../lib/dm/invoiceRepo';
import { isEmptyPlan, latestByMkh, planCustomerSync } from '../../lib/dm/customerSync';
import { bySerial, dmy, dmyRange, segmentFor, segmentOf, segmentsOf } from '../../lib/dm/lifecycle';
import type { Segment } from '../../lib/dm/lifecycle';

/** Một số công tơ mà hóa đơn ghi cho một mã khách hàng, kèm quãng phát sinh. */
interface MkhMeter { serial: string; from: string; to: string; isCurrent: boolean; }
import { groupByZone, sortByCode, sortByMkh } from './groupByZone';
import AssetLifecycle from './AssetLifecycle';
import StockEntry from './StockEntry';
import { TransferOwner } from './TransferOwner';
import { ZoneTables } from './ZoneTables';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import {
  SHORT_NAME_HINT, SUB_PURPOSES, buildPointCode, buildStationCode, isValidShortName,
  missingPointCodeParts, missingStationCodeParts, normalizeShortName,
} from '../../lib/dm/naming';

/**
 * `lifecycle` là tab TRA CỨU, không phải bảng khai báo: nó nhúng nguyên màn
 * "Vòng đời vật tư" vào cuối dãy tab (user chốt 25/08/2026) thay vì đứng riêng
 * ngoài menu — người dùng khai điểm đo xong là đối chiếu ngay tại chỗ.
 */
type CatTab = 'zone' | 'station' | 'customer' | 'point' | 'stock' | 'lifecycle';

const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
  { id: 'point', label: 'Điểm đo', icon: Gauge, sub: 'dm_point' },
  { id: 'stock', label: 'Kho vật tư', icon: Package, sub: 'Thiết bị · vòng đời' },
  { id: 'lifecycle', label: 'Rà soát', icon: History, sub: 'Đối chiếu hóa đơn' },
];

/** Tiêu đề + nút Thêm của từng tab KHAI BÁO; tab `lifecycle` không có (chỉ tra cứu). */
/** Gợi ý trong ô tìm kiếm — nói đúng cột nào tìm được, kẻo gõ mò. */
const SEARCH_HINT: Record<Exclude<CatTab, 'lifecycle' | 'stock'>, string> = {
  zone: 'Tìm mã KCN, tên, địa chỉ...',
  station: 'Tìm mã trạm, MKH, tên khách hàng...',
  customer: 'Tìm MKH, tên công ty, tên tắt, địa chỉ...',
  point: 'Tìm mã điểm đo, trạm, MKH, tên khách hàng...',
};

const HEAD: Record<Exclude<CatTab, 'lifecycle' | 'stock'>, { title: string; desc: string; add: string }> = {
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
  zone: '', customer: '', ident: '',
  sdm_kva: '', p0_w: '', pk_w: '', note: '',
};
const EMPTY_C = { mkh: '', name: '', short_name: '', address: '', zone: '' };
/** `code` cũng do hệ thống sinh; `customer` chỉ dùng khi là điểm đo phụ. */
const EMPTY_P = {
  station: '', role: 'chinh' as PointRole,
  customer: '', parent_point: '', ident: '', hsn: '1',
  /** Chỉ dùng khi điểm phụ trùng KH với điểm chính: mã nhãn, hoặc CUSTOM. */
  purpose: '', purpose_custom: '',
  note: '',
  /** Vật tư khai luôn cùng điểm đo — mỗi dòng một thiết bị (ghi vào dm_asset). */
  assetRows: [] as AssetRow[],
};

/**
 * Một dòng vật tư trong bảng của form điểm đo.
 * `id` có giá trị = bản ghi `dm_asset` đã tồn tại (đang sửa); rỗng = dòng mới.
 * `key` chỉ để React phân biệt dòng, không lưu xuống PB.
 */
interface AssetRow {
  key: string;
  id?: string;
  type: AssetType | '';
  serial: string;
  /** Gõ nguyên chuỗi `200/5`; tách ra 2 số khi lưu (`parseRatio`). */
  ratio: string;
  /** `YYYY-MM-DD`, khớp định dạng của `ui/DatePicker`. */
  dateOn: string;
  dateOff: string;
  /** Đang đo ở điểm đo này hay không — thiết bị cũ đã thay vẫn giữ trong bảng. */
  active: boolean;
}

let rowSeq = 0;
const newRow = (type: AssetType | '' = ''): AssetRow =>
  ({ key: `r${++rowSeq}`, type, serial: '', ratio: '', dateOn: '', dateOff: '', active: true });

/** Loại có tỷ số biến đổi — chỉ 2 loại này mới hiện ô tỷ số. */
const HAS_RATIO: AssetType[] = ['TI', 'TU'];

/**
 * Loại chỉ được có ĐÚNG MỘT cái đang hoạt động ở mỗi điểm đo. Khai thêm cái
 * mới cùng loại thì cái cũ tự tắt hoạt động (thay thiết bị), không xoá đi để
 * còn giữ lịch sử treo/tháo.
 *
 * TI/TU không nằm ở đây: một bộ gồm 3 TI cùng hoạt động song song.
 */

/** `"2026-02-07 00:00:00.000Z"` → `"2026-02-07"`. */
const ymdOf = (v?: string) => (v ?? '').slice(0, 10);

/**
 * "Đang hoạt động" KHÔNG còn là ô người dùng gạt (user chốt 25/08/2026): có
 * ngày tháo tức là đã tháo, chưa có tức là còn treo. Hai nguồn sự thật cho cùng
 * một việc chỉ đẻ ra mâu thuẫn — cảnh báo "đang hoạt động nhưng đã khai ngày
 * tháo" từng phải tồn tại chính vì thế.
 */
const normalizeActive = (rows: AssetRow[]): AssetRow[] =>
  rows.map(r => ({ ...r, active: !r.dateOff.trim() }));


/** Giá trị đặc biệt của bộ chọn nhãn mục đích: cho gõ tay chuỗi bất kỳ. */
const CUSTOM = '__custom';

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

export default function CatalogEntry({ scope: _scope = 'vanphong' }: { scope?: Scope }) {
  const [tab, setTab] = useState<CatTab>('zone');
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
  /** Người dùng đã bấm "Sinh lại mã" cho điểm đo đang sửa. */
  const [regenCode, setRegenCode] = useState(false);

  const [zForm, setZForm] = useState(EMPTY_Z);
  const [sForm, setSForm] = useState(EMPTY_S);
  const [cForm, setCForm] = useState(EMPTY_C);
  const [pForm, setPForm] = useState(EMPTY_P);

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

  /** Thiết bị trong kho mang số No này — nguồn của loại và tỷ số. */
  const deviceOf = (serial: string) => {
    const sn = serial.trim();
    return sn ? (d?.devices ?? []).find(x => x.serial.trim() === sn) : undefined;
  };
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
      zone: s.zone, customer: s.customer ?? '', ident: s.ident ?? '',
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
    setRegenCode(false);
    // Nhãn đuôi đã lưu: khớp một mục có sẵn thì chọn mục đó, không thì là tự nhập.
    const saved = p.sub_label ?? '';
    const isPreset = SUB_PURPOSES.some(x => x.code === saved);
    // Vật tư đang gắn ở điểm đo này → dựng lại thành các dòng của bảng.
    const rows: AssetRow[] = (d?.assets ?? [])
      .filter(a => a.point === p.id)
      .map(a => ({
        key: `r${++rowSeq}`, id: a.id, type: a.type, serial: a.serial,
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
      customer: p.customer ?? '', parent_point: p.parent_point ?? '',
      ident: p.ident ?? '', hsn: str(p.hsn),
      purpose: isPreset ? saved : (saved ? CUSTOM : ''),
      purpose_custom: isPreset ? '' : saved,
      note: p.note ?? '',
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

  /**
   * Điểm đo chính có thể thuộc khách hàng KHÁC chủ trạm — chủ nhà xưởng cho
   * thuê là mô hình phổ biến (`YM.TITAN.NX9.750kVA` của TITAN nhưng điểm đo là
   * của ANGSTROM). Lúc đó mã cần đuôi tên tắt khách thuê để phân biệt các điểm
   * đo chính trong cùng một trạm, và để khớp `LINE_NAME` bên HES.
   */
  const mainTenant = !isSub && !!pForm.customer && pForm.customer !== pStation?.customer;

  /**
   * Đuôi mã, theo thứ tự ưu tiên:
   *
   *  1. **Nhãn mục đích** nếu người dùng có chọn — ô này nay LUÔN hiện, cho mọi
   *     điểm đo (user chốt 25/08/2026). Người khai chủ động đặt tên thì tôn
   *     trọng, không đoán hộ.
   *  2. Không chọn nhãn thì suy như cũ:
   *     - điểm phụ  : tên tắt KH phụ (bỏ trống nếu trùng KH với điểm chính, vì
   *                   lấy tên tắt sẽ lặp y hệt phần đầu mã)
   *     - điểm chính: tên tắt khách thuê khi khác chủ trạm
   */
  const subLabel = purposeLabel
    ? purposeLabel
    : isSub
      ? (sameCustomer ? '' : (pSubCustomer?.short_name ?? ''))
      : (mainTenant ? (pSubCustomer?.short_name ?? '') : '');

  const pointParts = {
    zoneCode: pStationZone?.code ?? '',
    customerShortName: pStationCustomer?.short_name ?? '',
    ident: pStation?.ident ?? '',
    sdmKva: pStation?.sdm_kva ?? null,   // công suất lấy theo trạm chứa nó
    isSub,
    subLabel,
    pointIdent: pForm.ident,
  };
  const generatedCode = buildPointCode(pointParts);
  const pointCodeMissing = missingPointCodeParts(pointParts);

  /**
   * Điểm đo ĐÃ TỪNG CHUYỂN CHỦ THỂ thì GIỮ NGUYÊN mã đã lưu (user chốt
   * 27/08/2026).
   *
   * Mã nhúng tên tắt khách hàng, nên sau khi chuyển chủ mà mở form sửa rồi lưu
   * là mã tự mọc thêm đuôi tên tắt chủ mới — đúng thứ vừa cố tránh. Mã điểm đo
   * chính là `LINE_NAME` bên HES: đổi là lệch với dữ liệu đo đếm.
   *
   * Vẫn đổi được, nhưng phải bấm nút "Sinh lại mã" — cố ý, không âm thầm.
   */
  const savedPoint = editingId ? d?.points.find(p => p.id === editingId) : undefined;
  const codeLocked = !!savedPoint?.owner_history?.length && !regenCode;
  const lockedCode = savedPoint?.code ?? '';
  const pointCode = codeLocked && lockedCode ? lockedCode : generatedCode;

  /* ------------- HSN suy từ tỷ số TI / TU trong bảng vật tư ------------- */
  /**
   * VẬT TƯ DỰ KIẾN = dòng đã khai nhưng CHƯA CÓ NGÀY TREO (user chốt
   * 25/08/2026). Đó là cách khai kế hoạch ngay tại điểm đo, không cần màn riêng:
   * mua sẵn bộ TI 1500/5 để thay cho bộ 1000/5 đang chạy thì cứ thêm 3 dòng, để
   * trống ngày treo. Chừng nào chưa có ngày treo thì dòng đó KHÔNG được:
   *   - kéo HSN theo tỷ số của nó,
   *   - biến điểm đo đo thẳng thành đo gián tiếp,
   *   - lấy gì từ hóa đơn.
   * Ngày treo là mốc duy nhất chứng minh vật tư đã ra hiện trường.
   */
  const isHung = (r: AssetRow) => !!r.dateOn.trim();

  /**
   * BỘ DÒNG DÙNG ĐỂ SUY HSN.
   *
   * Mặc định chỉ xét vật tư ĐÃ TREO — đó mới là cái đang đo thật. Nhưng khi
   * CHƯA CÓ DÒNG NÀO ĐƯỢC TREO (điểm đo dự kiến), lấy chính các dòng dự kiến
   * để suy HSN (user chốt 27/08/2026): khai bộ TI 200/5 cho điểm đo sắp lắp mà
   * ô HSN vẫn trống thì không kiểm tra được gì trước khi ra hiện trường, và
   * điểm đo dự kiến hiện HSN rỗng khắp nơi trong danh mục.
   *
   * KHÔNG trộn hai loại: có dù chỉ một dòng đã treo thì dòng dự kiến lại đứng
   * ngoài như cũ — bộ TI mua sẵn 1500/5 không được kéo HSN của bộ 1000/5 đang
   * chạy.
   */
  const hungRows = pForm.assetRows.filter(isHung);
  const hsnRows = hungRows.length ? hungRows : pForm.assetRows;
  /** HSN đang suy từ vật tư DỰ KIẾN — cần nói rõ, kẻo tưởng đã lắp xong. */
  const hsnFromPlan = hungRows.length === 0
    && pForm.assetRows.some(r => r.type && r.serial.trim());

  /**
   * Lấy dòng đầu tiên của một loại có nhập tỷ số — 3 TI cùng bộ luôn cùng tỷ số.
   */
  const ratioRowOf = (type: AssetType) =>
    hsnRows.find(r => r.active && r.type === type && r.ratio.trim() !== '');

  /**
   * Tỷ số đại diện của một bộ: ưu tiên cái đang hoạt động, cả bộ đã tháo thì
   * lấy cái tháo sau cùng — xem `pickRatio`. Không làm vậy thì điểm đo đã tháo
   * mất sạch HSN.
   */
  const ratioOfSet = (type: AssetType) =>
    pickRatio(hsnRows
      .filter(r => r.type === type && r.ratio.trim() !== '')
      .map(r => ({ ...parseRatio(r.ratio), active: r.active })));

  /**
   * Có khai TI hay không thay cho câu hỏi "đấu nối" đã bỏ khỏi form. Xét CẢ TI
   * đã tháo: điểm đo từng đo gián tiếp thì vẫn là gián tiếp, tháo TI ra không
   * biến nó thành đo thẳng. Nhưng KHÔNG xét TI dự kiến (chưa có ngày treo) —
   * bộ TI mua sẵn không biến điểm đo đang đo thẳng thành đo gián tiếp — trừ khi
   * CẢ điểm đo còn dự kiến, lúc đó không có gì khác để dựa vào.
   */
  const hasTi = hsnRows.some(r => r.type === 'TI');
  const hsnInput = { hasTi, ti: ratioOfSet('TI'), tu: ratioOfSet('TU') };
  const derivedHsn = deriveHsn(hsnInput);

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
  const pointMkh = mkhOf(pForm.customer || pStation?.customer);

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

  /**
   * Công tơ ĐANG hoạt động — HSN của điểm đo phải khớp hóa đơn của cái này.
   *
   * KHÔNG lọc theo `isHung` ở đây: lúc vừa gõ số công tơ thì chưa có ngày treo,
   * mà đó chính là lúc người dùng cần khối đối chiếu để biết điền ngày nào.
   */
  const activeMeter = pForm.assetRows.find(r =>
    r.type === 'CONGTO' && r.active && r.serial.trim());
  const activeSegs = invSegs[activeMeter?.serial.trim() ?? ''] ?? [];
  /**
   * Ưu tiên chặng GIAO với quãng treo đã khai; chưa khai ngày, hoặc khai lệch
   * quãng, thì vẫn lấy chặng của đúng khách hàng để hiển thị — chỗ lệch sẽ được
   * nói riêng ở `invoiceNotes`, im lặng thì người dùng không biết đường nào mà lần.
   */
  const activeSeg = segmentFor(activeSegs, pointMkh, activeMeter?.dateOn, activeMeter?.dateOff)
    ?? segmentOf(activeSegs, pointMkh);
  const invoiceHsn = activeSeg?.hsn;

  /**
   * Chỉ suy ngược được tỷ số TI khi KHÔNG có TU: khi đó HSN = TI sơ/TI thứ.
   * Có cả TU thì một HSN ứng với vô số cặp tỷ số — phải nhập tay cả hai, app
   * chỉ kiểm tích số (user chốt 20/08).
   */
  const tuRow = ratioRowOf('TU');
  const tiSecondary = parseRatio(ratioRowOf('TI')?.ratio ?? '').secondary ?? 5;
  const canFillTi = hasTi && invoiceHsn != null && !tuRow
    && pForm.assetRows.some(r => r.type === 'TI' && r.active);
  const suggestedTi = invoiceHsn != null ? `${invoiceHsn * tiSecondary}/${tiSecondary}` : '';

  /** Điền tỷ số suy từ HSN hóa đơn cho CẢ BỘ TI đang hoạt động. */
  const fillTiFromInvoice = () =>
    setPForm(f => ({
      ...f,
      assetRows: f.assetRows.map(r =>
        r.type === 'TI' && r.active ? { ...r, ratio: suggestedTi } : r),
    }));

  /**
   * Mỗi dòng công tơ kèm chặng hóa đơn của đúng khách hàng của điểm đo. Liệt kê
   * CẢ công tơ đã tháo — điểm đo ngưng hoạt động vẫn phải khớp HSN hóa đơn.
   */
  const meterRefs = pForm.assetRows
    .filter(r => r.type === 'CONGTO' && r.serial.trim())
    .map(r => {
      const segs = invSegs[r.serial.trim()];
      if (!segs) return null;
      // Hai mức ghép: `mine` = chặng của đúng khách hàng (MKH + số công tơ),
      // `inWindow` = chặng đó có GIAO với quãng treo đã khai hay không. Tách ra
      // vì "sai khách" và "sai ngày" là hai lỗi khác nhau, phải nhắc khác nhau.
      const mine = segmentOf(segs, pointMkh);
      const inWindow = segmentFor(segs, pointMkh, r.dateOn, r.dateOff);
      return { row: r, segs, mine, inWindow };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  /** Điền một ngày lấy từ hóa đơn vào đúng dòng công tơ đó. */
  const fillDate = (key: string, field: 'dateOn' | 'dateOff', value: string) =>
    setRow(key, { [field]: value });

  /** Nhắc đối chiếu hóa đơn — tách khỏi `assetWarnings` vì đây là tham chiếu. */
  /**
   * Các số công tơ mà hóa đơn ghi cho ĐÚNG khách hàng này — dùng để gợi ý số
   * đúng khi số đang khai chưa từng phát sinh hóa đơn.
   */
  const mkhMeters = (pointMkh ? mkhSerials[pointMkh] : undefined) ?? [];

  const invoiceNotes: string[] = [];
  for (const { row: r, segs, mine, inWindow } of meterRefs) {
    const serial = r.serial.trim();

    /*
      CẶP (MKH + số công tơ + ngày đã khai) MÀ CÓ HÓA ĐƠN ⇒ IM LẶNG HOÀN TOÀN
      (user chốt 27/08/2026). `inWindow` chính là phép kiểm đó: chặng của đúng
      khách hàng, và giao với quãng treo đang khai. Khớp rồi thì không còn gì
      để nhắc về chuyện "có hóa đơn hay chưa".
    */
    if (!mine) {
      if (segs.length) {
        // Có hóa đơn nhưng mang tên khách khác ⇒ nhiều khả năng gõ nhầm số.
        invoiceNotes.push(`công tơ ${serial} có hóa đơn nhưng KHÔNG có chặng nào của ${pointMkh} `
          + `(${segs.map(x => `${x.mkh}: ${dmyRange(x.from, x.to)}`).join(', ')})`);
      } else if (isHung(r)) {
        // Chưa có hóa đơn nào. Nói đúng bản chất — "chưa phát sinh", không phải
        // "không có" — vì công tơ vừa treo thì đương nhiên chưa có.
        const current = mkhMeters.filter(m => m.isCurrent).map(m => m.serial);
        const list = (current.length ? current : mkhMeters.slice(0, 4).map(m => m.serial)).join(', ');
        invoiceNotes.push(
          `số công tơ ${serial} chưa phát sinh hóa đơn của ${pointMkh}`
          + (list ? ` — khách này đang phát sinh trên ${list}` : ''));
      }
      continue;
    }

    // Có chặng của đúng khách này, nhưng ngày khai không giao với nó. Đây là
    // LỖI NGÀY, không phải lỗi khách — nói nhầm thành "của khách khác" thì người
    // dùng đi kiểm tra sai chỗ.
    if (isHung(r) && !inWindow) {
      invoiceNotes.push(
        `công tơ ${serial} có hóa đơn của ${pointMkh} ở quãng ${dmyRange(mine.from, mine.to)}, `
        + `không giao với ngày treo/tháo đang khai (${dmyRange(r.dateOn, r.dateOff)}) `
        + '— kiểm tra lại hai ngày này');
    }

    // Cùng số công tơ nhưng có chặng của khách khác ⇒ vật tư dùng lại, nói cho
    // biết để không nhầm HSN của quãng này với quãng kia.
    const others = segs.filter(x => x.mkh !== pointMkh);
    if (others.length) {
      invoiceNotes.push(`công tơ ${serial} còn được dùng cho `
        + `${others.map(x => `${x.mkh} (${dmyRange(x.from, x.to)})`).join(', ')}`);
    }
    if (r.dateOn && r.dateOn > mine.from) {
      invoiceNotes.push(`công tơ ${serial} khai treo ${dmy(r.dateOn)} nhưng đã phát sinh tiền điện từ ${dmy(mine.from)}`);
    }
    if (r.dateOff && r.dateOff < mine.to) {
      invoiceNotes.push(`công tơ ${serial} khai tháo ${dmy(r.dateOff)} nhưng còn phát sinh tiền điện đến ${dmy(mine.to)}`);
    }
    if (mine.hsnHistory.length > 1) {
      invoiceNotes.push(`công tơ ${serial} từng đổi HSN: ${mine.hsnHistory.join(' → ')}`);
    }
  }

  /**
   * HSN phải khớp hóa đơn — áp cho MỌI điểm đo, kể cả đã ngưng hoạt động
   * (user chốt 20/08). Điểm đo tháo rồi mà HSN sai thì sản lượng lịch sử vẫn sai.
   * Lấy HSN của hóa đơn theo công tơ đang hoạt động; không có thì lấy công tơ
   * cuối cùng từng gắn.
   */
  const refHsn = invoiceHsn
    ?? meterRefs.map(m => m.mine?.hsn).filter((h): h is number => h != null).pop();
  /**
   * HSN thực sự ghi xuống: suy từ TI/TU trước; suy không ra (hoặc ra 0 vì tỷ số
   * khai sai) thì lấy HSN hóa đơn. Thà lấy hóa đơn còn hơn để 0.
   */
  const effectiveHsn = derivedHsn != null && derivedHsn > 0 ? derivedHsn : refHsn;

  if (refHsn != null && derivedHsn != null && derivedHsn !== refHsn) {
    invoiceNotes.push(tuRow
      ? `TI × TU đang ra HSN ${derivedHsn}, hóa đơn ghi ${refHsn} — tích hai tỷ số phải bằng ${refHsn}`
      : `HSN khai ra ${derivedHsn} nhưng hóa đơn ghi ${refHsn} — kiểm tra lại tỷ số TI`);
  }

  /* ---------------- Trùng số chế tạo (số No) ---------------- */
  /**
   * Hai loại đụng độ, đều CHẶN LƯU (khác với các cảnh báo mềm khác của màn này):
   *
   * 1. Trùng ngay trong bảng vật tư của điểm đo đang khai — PocketBase cũng
   *    chặn (unique `serial` + `point`), báo trước cho rõ ràng thay vì để PB
   *    trả lỗi khó hiểu lúc bấm Lưu.
   * 2. Số đó đang CÒN HOẠT ĐỘNG ở điểm đo khác — một công tơ không thể đang đo
   *    ở hai nơi cùng lúc. Muốn lắp sang đây thì phải cho ngưng ở điểm đo cũ
   *    trước (user chốt 20/08/2026).
   */
  const serialInForm = new Map<string, AssetRow[]>();
  for (const r of pForm.assetRows) {
    const s = r.serial.trim();
    if (!s) continue;
    serialInForm.set(s, [...(serialInForm.get(s) ?? []), r]);
  }
  const dupInForm = [...serialInForm.entries()].filter(([, rows]) => rows.length > 1);

  /**
   * Cùng số chế tạo mà HAI NƠI CÙNG ĐANG TREO — chỉ thế mới chặn.
   *
   * Khai một vật tư vào điểm đo CŨ trong khi nó đang chạy ở nơi khác là hợp lệ:
   * đó là ghi lại lần lắp trước đó. Luật (4) trong `applyRowRules` đã tự điền
   * ngày tháo ở đây = ngày treo bên kia, nên dòng này không còn "đang treo" và
   * không có gì phải chặn (user chốt 25/08/2026).
   */
  /**
   * Điểm đo đó còn HOÀN TOÀN DỰ KIẾN hay không: không vật tư nào của nó có
   * ngày treo.
   *
   * Ngày treo là mốc duy nhất chứng minh vật tư đã ra hiện trường, nên chưa
   * dòng nào có ngày treo tức là cả điểm đo mới nằm trên giấy.
   */
  const isPlannedPoint = (pointId?: string) => {
    if (!pointId) return false;
    const rows = (d?.assets ?? []).filter(a => a.point === pointId);
    return rows.length > 0 && !rows.some(a => (a.date_on ?? '').trim());
  };

  /** Điểm đo ĐANG KHAI còn dự kiến: không dòng nào trên form có ngày treo. */
  const thisPlanned = hungRows.length === 0;

  const serialConflicts = [...serialInForm.entries()]
    .map(([serial, rows]) => {
      // Ở form này số No đó còn đang treo (chưa khai ngày tháo) hay không.
      if (!rows.some(r => !r.dateOff.trim())) return null;
      const other = (d?.assets ?? []).find(a =>
        a.serial === serial && a.active && a.point && a.point !== editingId);
      return other ? { serial, asset: other, code: pointCodeOf(other.point) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  /**
   * HAI ĐIỂM ĐO CÙNG DỰ KIẾN thì ĐỔI CHỖ số No cho nhau (user chốt 28/08/2026,
   * sửa lại chiều tối cùng ngày: đổi chỗ chứ không xoá bên kia).
   *
   * Vật tư dự kiến mới là dự định phân bổ, chưa có gì ngoài hiện trường. Tình
   * huống thật gần như luôn là GÁN NHẦM CHÉO: định cho A số S2 và cho B số S1,
   * nhưng lỡ gõ ngược. Người dùng vào A sửa thành S2 — thứ họ muốn là B nhận
   * lại S1, chứ không phải B mất trắng vật tư.
   *
   * Vì vậy lấy SỐ CŨ CỦA CHÍNH DÒNG ĐANG SỬA làm vế đối ứng. Không có số cũ
   * (dòng vừa thêm mới) thì không có gì để đổi — lúc đó là CHUYỂN, bên kia mất
   * dòng đó; câu nhắc nói rõ hai trường hợp khác nhau.
   *
   * Điều kiện vẫn NGẶT: cả hai điểm đo đều chưa vật tư nào được treo. Chỉ cần
   * một bên đã lắp thật thì chặn như cũ, vì số No lúc đó chỉ một thiết bị có
   * thật ngoài lưới.
   */
  const reclaim = serialConflicts
    .filter(b => thisPlanned && isPlannedPoint(b.asset.point))
    .map(b => {
      // Dòng trên form đang mang số No này, và số No nó giữ TRƯỚC khi sửa.
      const row = pForm.assetRows.find(r => r.serial.trim() === b.serial);
      const saved = row?.id ? (d?.assets ?? []).find(a => a.id === row.id) : undefined;
      const swapTo = (saved?.serial ?? '').trim();
      // Chỉ đổi chỗ khi số cũ thật sự khác và không đang nằm ở đâu khác.
      const canSwap = !!swapTo && swapTo !== b.serial
        && !(d?.assets ?? []).some(a => a.serial.trim() === swapTo && a.id !== saved?.id && a.point);
      return { ...b, swapTo: canSwap ? swapTo : '' };
    });
  const busyElsewhere = serialConflicts.filter(b => !reclaim.some(r => r.serial === b.serial));

  /**
   * Mã điểm đo trùng một điểm đo khác. `dm_point.code` là UNIQUE nên PocketBase
   * sẽ trả "Value must be unique" — một câu chẳng nói được gì. Bắt trước ở đây
   * và nói rõ đang đụng vào điểm đo nào.
   *
   * Rất dễ gặp: điểm đo chính cùng khách với chủ trạm sinh mã ĐÚNG BẰNG mã
   * trạm, nên khai điểm đo chính thứ hai cho cùng một trạm là trùng ngay.
   */
  const codeClash = pointCode && !pointCodeMissing.length
    ? d?.points.find(p => p.code === pointCode && p.id !== editingId)
    : undefined;

  const serialBlocks: string[] = [
    ...dupInForm.map(([serial, rows]) =>
      `số No ${serial} bị khai ${rows.length} lần trong cùng điểm đo `
      + `(${rows.map(r => ASSET_LABEL[r.type as AssetType] ?? '—').join(', ')})`),
    ...busyElsewhere.map(b =>
      `số No ${b.serial} đang treo ở ${ASSET_LABEL[b.asset.type as AssetType] ?? 'vật tư'} `
      + `của điểm đo ${b.code} — khai NGÀY THÁO cho nó ở điểm đo đó, `
      + 'hoặc khai ngày tháo ngay tại dòng này nếu đây là lần lắp trước đó'),
    ...(codeClash ? [
      `mã điểm đo ${pointCode} đã thuộc về một điểm đo khác `
      + `(khách ${customerMkh(codeClash.customer)}) — đổi định danh điểm đo, `
      + 'hoặc chọn khách hàng khác để mã có đuôi phân biệt',
    ] : []),
  ];

  /**
   * TỶ SỐ TI / TU LÀ BẮT BUỘC — CHẶN LƯU (user chốt 27/08/2026).
   *
   * HSN = (TI sơ/thứ) × (TU sơ/thứ), và HSN nhân thẳng vào chỉ số đọc từ HES:
   * thiếu tỷ số thì điểm đo lưu xuống với HSN rỗng, mọi sản lượng tính từ nó
   * đều sai. Trước đây chỉ NHẮC, nên đã có điểm đo lọt xuống PB không HSN.
   *
   * Áp cho CẢ dòng dự kiến: điểm đo dự kiến nay cũng suy HSN từ chính các dòng
   * đó, nên bỏ trống tỷ số là bỏ trống HSN.
   *
   * Dòng trắng hoàn toàn (chưa gõ số No, chưa gõ tỷ số) không tính — đó là dòng
   * người dùng vừa thêm ra chứ chưa khai gì.
   */
  const ratioRows = pForm.assetRows.filter(r =>
    HAS_RATIO.includes(r.type as AssetType) && (r.serial.trim() !== '' || r.ratio.trim() !== ''));
  const missingRatioRows = ratioRows.filter(r => r.ratio.trim() === '');
  const badRatioRows = ratioRows.filter(r => {
    if (!r.ratio.trim()) return false;
    const { primary, secondary } = parseRatio(r.ratio);
    return primary === 0 || secondary === 0 || primary == null || secondary == null;
  });

  const ratioBlocks: string[] = [
    ...(missingRatioRows.length ? [
      `chưa nhập tỷ số cho ${missingRatioRows.length} `
      + `${missingRatioRows.map(r => `${r.type} ${r.serial.trim() || '—'}`).join(', ')} `
      + '— không có tỷ số thì không suy được HSN, mà HSN sai là sản lượng sai',
    ] : []),
    ...(badRatioRows.length ? [
      `tỷ số không hợp lệ ở ${badRatioRows.length} dòng `
      + `(${badRatioRows.map(r => `${r.type} ${r.serial.trim() || '—'}: "${r.ratio}"`).join(', ')})`
      + ' — sơ cấp và thứ cấp đều phải khác 0, dạng 200/5',
    ] : []),
    // Có TI mà công thức vẫn không ra số: tỷ số gõ dở kiểu "200/" chẳng hạn.
    ...(hasTi && derivedHsn == null ? [
      'chưa suy được HSN từ tỷ số đang khai — kiểm tra lại ô tỷ số của TI / TU',
    ] : []),
  ];

  /** Mọi thứ CHẶN lưu điểm đo: đụng độ số chế tạo + thiếu/sai tỷ số. */
  const saveBlocks = [...serialBlocks, ...ratioBlocks];

  /**
   * Cảnh báo vật tư — CHỈ nhắc, không chặn lưu (user chốt 14/08). Điểm đo đang
   * khai dở vẫn phải lưu được.
   */
  const filledRows = pForm.assetRows.filter(r => r.type && r.serial.trim());
  /**
   * Chỉ đếm thiết bị ĐÃ TREO và đang hoạt động — cái đã tháo vẫn nằm bảng để
   * giữ lịch sử, còn dòng chưa có ngày treo là vật tư DỰ KIẾN, chưa ra hiện
   * trường nên không được tính vào bất cứ điều kiện nào.
   */
  const countType = (t: AssetType) =>
    filledRows.filter(r => r.type === t && r.active && isHung(r)).length;

  /** Các dòng dự kiến — khai rồi nhưng chưa có ngày treo. */
  const plannedRows = filledRows.filter(r => !isHung(r));
  const assetWarnings: string[] = [];
  if (countType('CONGTO') === 0) assetWarnings.push('chưa có công tơ đang hoạt động');
  else if (countType('CONGTO') > 1) assetWarnings.push('có nhiều hơn 1 công tơ đang hoạt động');
  // Không nhắc "thiếu GP-03" nữa: user bỏ ràng buộc bắt buộc có đo xa (20/08/2026).

  // Lệch tỷ số trong cùng một bộ TI (hoặc TU): 3 TI phải cùng tỷ số, khác nhau
  // là khai nhầm — HSN đang lấy theo dòng đầu nên phải nói rõ.
  for (const t of HAS_RATIO) {
    const kinds = new Set(
      pForm.assetRows.filter(r => r.active && isHung(r) && r.type === t && r.ratio.trim())
        .map(r => r.ratio.trim()));
    if (kinds.size > 1) {
      assetWarnings.push(`các ${t} không cùng tỷ số (${[...kinds].join(' ≠ ')}) — HSN đang lấy theo cái đầu`);
    }
  }

  // Hai cảnh báo "ngưng mà chưa khai ngày tháo" / "còn chạy mà đã có ngày tháo"
  // đã bỏ (25/08/2026): `active` nay SUY TỪ ngày tháo nên không thể mâu thuẫn.
  if (filledRows.some(r => r.dateOn && r.dateOff && r.dateOff < r.dateOn)) {
    assetWarnings.push('có thiết bị khai ngày tháo trước ngày treo');
  }
  // Có TI = đo gián tiếp ⇒ phải đủ bộ 3. Không có TI = đo thẳng, HSN = 1.
  if (hasTi && countType('TI') > 0 && countType('TI') !== TI_PER_SET) {
    assetWarnings.push(`đo gián tiếp phải đủ ${TI_PER_SET} TI (đang có ${countType('TI')} cái hoạt động)`);
  }
  /*
    Số No lấy từ KHO — nói rõ để người dùng biết nó không phải thiết bị mới, và
    biết mình có đang lấy nhầm cái đang dành cho nơi khác không.

    Chỉ nhắc khi thiết bị đang RẢNH (chưa treo ở đâu); còn đang treo nơi khác
    thì đã có `busyElsewhere` / `reclaim` lo, nói thêm chỉ nhiễu.
  */
  for (const r of pForm.assetRows) {
    const dev = deviceOf(r.serial);
    if (!dev) continue;
    const live = (d?.assets ?? []).some(a =>
      a.serial.trim() === r.serial.trim() && a.date_on && !a.date_off && a.point !== editingId);
    if (live) continue;
    const holdFor = dev.hold_point && dev.hold_point !== editingId
      ? pointCodeOf(dev.hold_point)
      : [customerMkh(dev.hold_for_customer), dev.hold_for_note].filter(x => x && x !== '—').join(' · ');
    assetWarnings.push(`số No ${r.serial.trim()} lấy từ kho`
      + (holdFor ? ` — đang dành cho ${holdFor}` : ''));
  }

  /*
    Nói TRƯỚC khi lưu rằng số No sẽ bị gỡ khỏi điểm đo kia. Đây là thao tác
    XOÁ dữ liệu ở một bản ghi người dùng không mở ra — im lặng làm là không
    được, dù cả hai bên đều mới chỉ là dự kiến.
  */
  for (const b of reclaim) {
    assetWarnings.push(b.swapTo
      // Đổi chỗ: nói rõ bên kia nhận lại số nào, kẻo tưởng họ mất vật tư.
      ? `số No ${b.serial} đang được ${b.code} giữ chỗ — khi lưu sẽ ĐỔI CHỖ: `
        + `${b.serial} về đây, còn ${b.code} nhận ${b.swapTo}`
      : `số No ${b.serial} đang được ${b.code} giữ chỗ — khi lưu sẽ CHUYỂN về đây `
        + `và ${b.code} mất dòng đó (dòng này chưa có số No cũ nào để đổi lại)`);
  }

  if (plannedRows.length) {
    assetWarnings.push(hsnFromPlan
      // Cả bộ còn dự kiến ⇒ HSN đang lấy từ chính mấy dòng này.
      ? `${plannedRows.length} dòng chưa khai ngày treo — điểm đo còn DỰ KIẾN, `
        + 'HSN đang suy từ tỷ số dự kiến và sẽ tính lại theo vật tư thực khi khai ngày treo'
      : `${plannedRows.length} dòng chưa khai ngày treo — đang coi là VẬT TƯ DỰ KIẾN, `
        + 'không tính vào HSN và không đối chiếu hóa đơn');
  }

  /**
   * Trạng thái điểm đo do hệ thống suy, không cho chọn tay nữa (user chốt
   * 20/08). Tính ngay trên form để người dùng thấy tag đổi theo lúc khai.
   */
  const assetCounts = countAssets(filledRows);
  const derivedStatus = derivePointStatus({
    ...assetCounts,
    // Dùng `inWindow`: chỉ chặng ĐÚNG quãng treo mới chứng minh điểm đo này
    // đang phát sinh tiền điện — chặng ở quãng khác là của lần lắp khác.
    hasRecentInvoice: meterRefs.some(m => m.row.active && m.inWindow?.isCurrent),
  });

  /**
   * Vì sao đang là trạng thái đó — nói ngay dưới tag, vì "Dự kiến" trong khi đã
   * khai đủ vật tư trông như lỗi nếu không nói rõ còn thiếu ngày treo.
   */
  /**
   * Đang vận hành mà thiếu GP-03 hoặc SIM ⇒ mất đo xa, phải đọc chỉ số bằng tay.
   * Đặt SAU `derivedStatus` vì luật chỉ áp cho điểm đo đang vận hành.
   */
  const remoteMissing = derivedStatus === 'active' ? missingRemote(filledRows) : [];
  if (remoteMissing.length) {
    assetWarnings.push(
      `điểm đo đang vận hành nhưng thiếu ${remoteMissing.map(t => REMOTE_LABEL[t]).join(' và ')} `
      + '— không đẩy được chỉ số về HES, phải đọc tay');
  }

  const statusReason =
    derivedStatus !== 'du_kien' ? ''
      : assetCounts.meters === 0 ? 'Chưa khai công tơ nào.'
      : assetCounts.metersWithoutDateOn > 0
        ? `Còn ${assetCounts.metersWithoutDateOn} công tơ đang hoạt động chưa khai ngày treo.`
        : '';

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

    if (modal === 'station') {
      if (stationCodeMissing.length) {
        return toast.warning('Chưa sinh được mã trạm',
          `Còn thiếu: ${stationCodeMissing.join(', ')}.`);
      }
      const body = {
        code: stationCode, zone: sForm.zone,
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
      };
      return void persist(async () => {
        /*
          ĐỔI CHỖ (hoặc chuyển) SỐ NO VỚI ĐIỂM ĐO DỰ KIẾN KIA — LÀM TRƯỚC.

          Phải trước `syncAssets`: cặp `(serial, point)` là UNIQUE, để nguyên
          bản ghi cũ thì PocketBase từ chối ngay khi ghi dòng mới ở đây.

          Có số cũ để đưa lại ⇒ ĐỔI CHỖ: bên kia nhận số cũ của dòng này, kèm
          đúng thiết bị tương ứng (loại và tỷ số nằm trên `dm_device`, không
          phải trên lần lắp).
          Không có ⇒ CHUYỂN: gỡ dòng bên kia, vì không còn gì để trả lại.
        */
        for (const b of reclaim) {
          if (!b.swapTo) { await assets.remove(b.asset.id); continue; }
          const dev = (d?.devices ?? []).find(x => x.serial.trim() === b.swapTo);
          await assets.update(b.asset.id, {
            serial: b.swapTo,
            ...(dev ? {
              device: dev.id, type: dev.type,
              ratio_primary: dev.ratio_primary, ratio_secondary: dev.ratio_secondary,
            } : {}),
          });
          // Giữ chỗ đi theo thiết bị: số cũ nay dành cho điểm đo bên kia.
          if (dev) await devices.update(dev.id, { hold_point: b.asset.point ?? '' });
        }

        const rec = editingId
          ? await points.update(editingId, body)
          : await points.create(body);
        // Vật tư lưu sau vì cần id điểm đo; lỗi ở đây sẽ báo nguyên văn từ PB
        // (thường là trùng số No với vật tư đang gắn ở điểm đo khác).
        await syncAssets((rec as { id: string }).id);
      }, `Điểm đo ${body.code}`);
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

  /**
   * Đồng bộ vật tư của một điểm đo theo những gì đang khai trên form.
   * Khớp bản ghi cũ theo (loại, pha): còn số No thì cập nhật, bỏ trống thì gỡ
   * bản ghi cũ đi — nhờ vậy sửa điểm đo không đẻ ra vật tư trùng.
   */
  const syncAssets = async (pointId: string) => {
    const rows = pForm.assetRows.filter(r => r.type && r.serial.trim());
    const keptIds = new Set(rows.map(r => r.id).filter(Boolean));

    // Dòng bị xoá khỏi bảng → gỡ bản ghi tương ứng.
    for (const old of d?.assets.filter(a => a.point === pointId) ?? []) {
      if (keptIds.has(old.id)) continue;
      await assets.remove(old.id);
      /*
        Gỡ luôn giữ chỗ nếu thiết bị đang dành cho chính điểm đo này. Bỏ sót
        thì thiết bị quay về kho mà vẫn mang nhãn "đang giữ cho <điểm đo>" của
        một dòng không còn tồn tại.
      */
      const dev = (d?.devices ?? []).find(x => x.serial.trim() === old.serial.trim());
      if (dev?.hold_point === pointId) await devices.update(dev.id, { hold_point: '' });
    }

    for (const r of rows) {
      const hasRatio = HAS_RATIO.includes(r.type as AssetType);
      const { primary, secondary } = parseRatio(r.ratio);
      const serial = r.serial.trim();

      /*
        MỖI SỐ NO PHẢI CÓ ĐÚNG MỘT THIẾT BỊ trong `dm_device`.

        Có sẵn trong kho thì DÙNG LẠI bản ghi đó — đây là chỗ dễ đẻ dữ liệu rác
        nhất: gõ lại số No ở form điểm đo mà tạo thiết bị thứ hai thì kho có hai
        dòng cùng số, `serial` UNIQUE sẽ chặn và người dùng nhận một câu lỗi
        không hiểu gì. Chưa có thì tạo mới ngay tại đây, không bắt phải vào màn
        Kho khai trước.

        Tỷ số ghi lên thiết bị chứ không chỉ lên lần lắp: đó là thuộc tính của
        thiết bị (schema v13).
      */
      const dev = (d?.devices ?? []).find(x => x.serial.trim() === serial)
        ?? await devices.create({
          serial, type: r.type as AssetType,
          ratio_primary: hasRatio ? (primary ?? undefined) : undefined,
          ratio_secondary: hasRatio ? (secondary ?? undefined) : undefined,
        }) as unknown as Device;

      /*
        GIỮ CHỖ đồng bộ ngay: dòng chưa có ngày treo nghĩa là thiết bị mới chỉ
        được dành cho điểm đo này, chưa lắp. Khai ngày treo thì bỏ giữ chỗ —
        nó đã có chỗ thật rồi, để cả hai là hai thông tin đá nhau.

        Trạng thái kho/đang treo KHÔNG ghi ở đây: `deriveDeviceStatus` tính lại
        từ các lần lắp, nên tháo xuống là tự về kho, không cần thao tác nào.
      */
      const hold = r.dateOn.trim() ? '' : pointId;
      if ((dev.hold_point ?? '') !== hold) await devices.update(dev.id, { hold_point: hold });

      const body = {
        serial,
        type: r.type as AssetType,
        device: dev.id,
        point: pointId,
        ratio_primary: hasRatio ? (primary ?? undefined) : undefined,
        ratio_secondary: hasRatio ? (secondary ?? undefined) : undefined,
        date_on: r.dateOn || '',
        date_off: r.dateOff || '',
        active: r.active,
        // `status` là vòng đời trong kho, `active` là "đang đo ở điểm đo này":
        // thiết bị tắt hoạt động coi như đã tháo khỏi điểm đo.
        status: (r.active ? 'dang_treo' : 'thao_go') as AssetStatus,
      };
      if (r.id) await assets.update(r.id, body);
      else await assets.create(body);
    }
  };

  /* ------------- thao tác trên bảng vật tư của form điểm đo ------------- */

  /**
   * Vật tư CÙNG SỐ NO đang hoạt động ở điểm đo KHÁC — dùng để suy ngày tháo.
   *
   * Một số chế tạo chỉ có thể đang đo ở đúng một chỗ. Nếu nó đang treo ở nơi
   * khác mà giờ được khai vào điểm đo này, thì lần lắp ở đây phải đã KẾT THÚC
   * đúng vào ngày nó được treo ở nơi kia (user chốt 25/08/2026).
   */
  const liveElsewhere = (serial: string) => {
    const sn = serial.trim();
    if (!sn) return undefined;
    return (d?.assets ?? []).find(a =>
      a.serial === sn && a.active && a.point && a.point !== editingId && a.date_on);
  };

  /**
   * Sửa một dòng rồi áp các luật nghiệp vụ lên những dòng còn lại.
   *
   * 1. **Tỷ số dùng chung theo loại** — 3 TI của một bộ luôn cùng tỷ số, TU
   *    cũng vậy. Nhập tỷ số cho một cái thì các dòng cùng loại CÒN TRỐNG tự
   *    điền theo; dòng đã có tỷ số khác thì KHÔNG đè, chỉ cảnh báo lệch.
   * 2. **Ngày treo lan cho cả bộ** — khai điểm đo lần đầu thì công tơ, 3 TI và
   *    đo xa đều lên cùng một ngày. Chỉ điền vào dòng CÒN TRỐNG ngày treo, nên
   *    vật tư lắp bổ sung sau này không bị đè.
   * 3. **Vật tư mới thay vật tư cũ** — dòng cùng loại đang treo từ TRƯỚC ngày
   *    treo của cái mới thì tự nhận ngày tháo = ngày treo của cái mới. Không
   *    đụng dòng cùng ngày (cả bộ lắp một lượt) và không đè ngày tháo đã khai.
   * 4. **Số No đang treo ở nơi khác** — điền sẵn ngày tháo = ngày treo bên đó.
   *
   * Cuối cùng CHUẨN HOÁ active = chưa có ngày tháo — xem ghi chú ở cột bảng.
   */
  const applyRowRules = (rows: AssetRow[], key: string, patch: Partial<AssetRow>): AssetRow[] => {
    const next = rows.map(r => (r.key === key ? { ...r, ...patch } : r));
    const me = next.find(r => r.key === key);
    if (!me || !me.type) return normalizeActive(next);
    const type = me.type as AssetType;

    // Đổi loại sang TI/TU mà chưa có tỷ số → thừa hưởng tỷ số của bộ cùng loại.
    let inherited = next;
    if (patch.type !== undefined && HAS_RATIO.includes(type) && !me.ratio.trim()) {
      const src = next.find(r => r.key !== key && r.type === type && r.ratio.trim());
      if (src) inherited = next.map(r => (r.key === key ? { ...r, ratio: src.ratio } : r));
    }

    // Nhập tỷ số → lan sang các dòng cùng loại đang bỏ trống.
    const spread = patch.ratio !== undefined && HAS_RATIO.includes(type) && patch.ratio.trim()
      ? inherited.map(r =>
          r.key !== key && r.type === type && !r.ratio.trim() ? { ...r, ratio: patch.ratio! } : r)
      : inherited;

    const on = me.dateOn.trim();

    // Vừa khai ngày treo → lan cho các dòng chưa có ngày treo nào (lắp cùng đợt),
    // rồi đóng các dòng cùng loại đang treo từ trước đó (thay thế vật tư).
    let dated = spread;
    if (patch.dateOn !== undefined && on) {
      dated = spread.map(r => {
        if (r.key === key) return r;
        // Dòng trắng tinh thì bỏ qua; dòng đã bắt đầu khai (có loại hoặc có số No)
        // thì coi là cùng đợt lắp.
        if (!r.type && !r.serial.trim()) return r;
        // (2) cả bộ lên cùng ngày
        if (!r.dateOn.trim() && !r.dateOff.trim()) return { ...r, dateOn: on };
        // (3) cái cũ cùng loại nhường chỗ cho cái mới
        if (r.type === type && r.dateOn.trim() && r.dateOn.trim() < on && !r.dateOff.trim()) {
          return { ...r, dateOff: on };
        }
        return r;
      });
    }

    // (4) Số No này đang treo ở điểm đo khác ⇒ lần lắp ở đây đã kết thúc từ ngày
    // nó sang bên kia. Chỉ điền khi ô ngày tháo còn trống.
    const busy = liveElsewhere(me.serial);
    const withOff = busy && !me.dateOff.trim()
      ? dated.map(r => (r.key === key ? { ...r, dateOff: ymdOf(busy.date_on) } : r))
      : dated;

    /*
      (5) SỐ NO CÓ SẴN TRONG KHO ⇒ LẤY LOẠI VÀ TỶ SỐ TỪ THIẾT BỊ.

      Thiết bị đã khai một lần trong kho thì không việc gì phải gõ lại loại và
      tỷ số — vừa mất công vừa là cơ hội gõ lệch với bản ghi gốc.

      Chỉ điền vào ô CÒN TRỐNG: người dùng đã tự chọn khác thì tôn trọng, và
      chênh lệch tỷ số đã có cảnh báo riêng lo.
    */
    const fromStock = patch.serial !== undefined ? deviceOf(me.serial) : undefined;
    const filled = fromStock
      ? withOff.map(r => (r.key === key ? {
        ...r,
        type: r.type || fromStock.type,
        ratio: r.ratio.trim() || (fromStock.ratio_primary != null
          ? `${fromStock.ratio_primary}/${fromStock.ratio_secondary ?? ''}` : ''),
      } : r))
      : withOff;

    return normalizeActive(filled);
  };

  const setRow = (key: string, patch: Partial<AssetRow>) =>
    setPForm(f => ({ ...f, assetRows: applyRowRules(f.assetRows, key, patch) }));

  const addRow = (type: AssetType | '' = '') =>
    setPForm(f => {
      const row = newRow(type);
      return { ...f, assetRows: applyRowRules([...f.assetRows, row], row.key, { type }) };
    });
  const removeRow = (key: string) =>
    setPForm(f => ({ ...f, assetRows: f.assetRows.filter(r => r.key !== key) }));

  const stationCodeOf = (id?: string) => d?.stations.find(s => s.id === id)?.code ?? '—';
  const childrenOf = (id: string) => d?.points.filter(p => p.parent_point === id).length ?? 0;

  /* ---------------------------------------------------------------------
   * Ba bảng Trạm / Khách hàng / Điểm đo đều: xếp theo MKH → gom theo KCN.
   * Mỗi KCN một dòng tiêu đề màu, giống bảng lấy chỉ số HES.
   * ------------------------------------------------------------------- */


  /** KCN xếp theo mã, để bảng KCN cũng có thứ tự ổn định. */
  const zoneRows = useMemo(
    () => [...(d?.zones ?? [])].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true })),
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
      d?.stations.find(s => s.id === c.head.station)?.zone;

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
  const headOf = (t: CatTab) => HEAD[t === 'lifecycle' || t === 'stock' ? 'zone' : t];
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
      {tab !== 'lifecycle' && tab !== 'stock' && (
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

      <Tabs tabs={TABS} value={tab} onChange={t => { setTab(t); setSearch(''); }} />

      {/* ======================= Vòng đời vật tư ======================= */}
      {tab === 'lifecycle' && <AssetLifecycle scope={_scope} />}

      {/* ======================== Kho vật tư ======================== */}
      {tab === 'stock' && <StockEntry />}


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
              <th className={`${TH_CLS} w-[27%] pl-10`}>Mã trạm</th>
              <th className={`${TH_CLS} w-[20%]`}>Khu công nghiệp</th>
              <th className={`${TH_CLS} w-[15%]`}>Khách hàng</th>
              <th className={`${TH_CLS} w-[10%]`}>Sdm (kVA)</th>
              <th className={`${TH_CLS} w-[12%]`}>P0 / Pk (W)</th>
              <th className={`${TH_CLS} w-[8%]`}>Điểm đo</th>
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
                <td className="truncate px-6 py-4 font-mono text-xs text-soft" title={stationCodeOf(p.station)}>{stationCodeOf(p.station)}</td>
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
                <TextInput value={cForm.name} placeholder="CÔNG TY TNHH…"
                  onChange={v => setCForm(f => ({ ...f, name: v }))} />
              </Field>
              <Field label="Địa chỉ">
                <TextInput value={cForm.address} onChange={v => setCForm(f => ({ ...f, address: v }))} />
              </Field>
            </div>
          </>
        )}

        {modal === 'point' && (
          <>
            {/* Mã điểm đo đứng ĐẦU form: nó là kết quả của mọi ô bên dưới, để
                trên cùng thì vừa gõ vừa thấy mã đổi theo, khỏi cuộn xuống. */}
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
                ]} />
            </Field>

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

            {/* ---------------- Bảng vật tư gắn ở điểm đo ---------------- */}
            <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
                  <Package className="h-4 w-4" /> Vật tư gắn ở điểm đo
                </p>
                <span className="text-[11px] text-faint">
                  {pForm.assetRows.length} thiết bị
                  {pForm.assetRows.some(r => !r.active) &&
                    ` · ${pForm.assetRows.filter(r => r.active).length} đang hoạt động`}
                </span>
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
                    {pForm.assetRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-[13px] italic text-faint">
                          Chưa khai thiết bị nào — bấm "Thêm dòng" bên dưới.
                        </td>
                      </tr>
                    ) : pForm.assetRows.map(r => (
                      // Dòng đã ngưng hoạt động làm mờ đi — vẫn sửa được, chỉ
                      // để mắt nhận ra ngay đâu là thiết bị đang treo.
                      <tr key={r.key} className={r.active ? '' : 'opacity-60'}>
                        <td className="p-2">
                          <Select value={r.type} variant="bare"
                            onChange={v => setRow(r.key, { type: v as AssetType })}
                            options={Object.entries(ASSET_LABEL).map(([value, label]) => ({ value, label }))}
                            placeholder="Chọn thiết bị" />
                          {/* Chưa có ngày treo = vật tư dự kiến. Nói ngay tại dòng,
                              vì đây là thứ quyết định nó có kéo HSN hay không. */}
                          {r.type && r.serial.trim() && !r.dateOn.trim() && (
                            <span className="mt-1 inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-faint">
                              dự kiến
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          <CellInput value={r.serial} mono placeholder="Nhập số chế tạo"
                            onChange={v => setRow(r.key, { serial: v })} />
                        </td>
                        <td className="p-2">
                          {HAS_RATIO.includes(r.type as AssetType) ? (
                            <CellInput value={r.ratio} mono
                              placeholder={r.type === 'TU' ? '22000/100' : '200/5'}
                              onChange={v => setRow(r.key, { ratio: v })} />
                          ) : <span className="block p-2 text-faint">—</span>}
                        </td>
                        <td className="p-2">
                          {/* usePortal: bảng nằm trong khung overflow-hidden,
                              không có portal thì lịch bị cắt mất. */}
                          <DatePicker value={r.dateOn} usePortal
                            onChange={v => setRow(r.key, { dateOn: v })} />
                        </td>
                        <td className="p-2">
                          <DatePicker value={r.dateOff} usePortal
                            onChange={v => setRow(r.key, { dateOff: v })} />
                        </td>
                        <td className="p-2 text-center">
                          <button type="button" onClick={() => removeRow(r.key)} title="Bỏ dòng"
                            className="p-1 text-faint transition-colors hover:text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </button>
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

            {/* HSN: chỉ đọc, suy từ tỷ số vừa nhập. Điểm đo dự kiến cũng có HSN. */}
            <Field label={hsnFromPlan ? 'HSN dự kiến (suy từ tỷ số TI / TU)' : 'HSN (suy từ tỷ số TI / TU)'}
              required
              hint={hsnFromPlan
                ? `${hsnFormula(hsnInput)} — theo vật tư DỰ KIẾN, tính lại khi khai ngày treo`
                : hsnFormula(hsnInput)}>
              <DerivedValue value={derivedHsn == null ? '' : String(derivedHsn)}
                placeholder="Nhập tỷ số TI ở phần vật tư" />
            </Field>

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
    </div>
  );
}
