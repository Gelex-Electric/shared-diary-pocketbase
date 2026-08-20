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
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Building2, Factory, Users, Gauge, Package,
  Plus, Trash2, Edit2, RefreshCw, CornerDownRight, FileText,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import { Toggle } from '../ui/Toggle';
import { Switch } from '../ui/Switch';
import { DatePicker } from '../ui/DateTimePickers';
import { assets, customers, loadCatalog, pbErrorMessage, points, stations, zones } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import { ASSET_LABEL, CONNECTION_LABEL, ROLE_LABEL, STATUS_LABEL } from '../../lib/dm/types';
import type {
  AssetStatus, AssetType, Connection, Customer, Point, PointRole, PointStatus, Station, Zone,
} from '../../lib/dm/types';
import { deriveHsn, formatRatio, hsnFormula, parseRatio } from '../../lib/dm/hsn';
import type { Scope } from '../../lib/scope';
import {
  CellInput, DerivedValue, Field, FormModal, NumberInput, TableCard, TextInput, TH_CLS,
} from './entryUi';
import { PointBadgeChip, PointBadgeIcon } from './pointIcons';
import { invoicesOfSerial } from '../../lib/dm/invoiceRepo';
import { segmentOf, segmentsOf } from '../../lib/dm/lifecycle';
import type { Segment } from '../../lib/dm/lifecycle';
import { groupByZone, sortByMkh } from './groupByZone';
import { ZoneGroupRow } from './ZoneGroupRow';
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
  zone: '', customer: '', ident: '',
  sdm_kva: '', p0_w: '', pk_w: '', note: '',
};
const EMPTY_C = { mkh: '', name: '', short_name: '', address: '', zone: '' };
/** `code` cũng do hệ thống sinh; `customer` chỉ dùng khi là điểm đo phụ. */
const EMPTY_P = {
  station: '', role: 'chinh' as PointRole, connection: 'truc_tiep' as Connection,
  customer: '', parent_point: '', ident: '', hsn: '1',
  /** Chỉ dùng khi điểm phụ trùng KH với điểm chính: mã nhãn, hoặc CUSTOM. */
  purpose: '', purpose_custom: '',
  status: '' as PointStatus, note: '',
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
const ONE_ACTIVE: AssetType[] = ['CONGTO', 'GP03'];

/** Ngày hôm nay dạng `YYYY-MM-DD` — điền sẵn ngày tháo khi gạt tắt hoạt động. */
const today = () => new Date().toISOString().slice(0, 10);

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
  /** MKH thô để SẮP XẾP — chưa gắn khách hàng thì trả undefined (xuống cuối bảng). */
  const mkhOf = (id?: string) => d?.customers.find(c => c.id === id)?.mkh;
  /** MKH để HIỂN THỊ trong ô bảng. */
  const customerMkh = (id?: string) => mkhOf(id) ?? '—';
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
    // Nhãn đuôi đã lưu: khớp một mục có sẵn thì chọn mục đó, không thì là tự nhập.
    const saved = p.sub_label ?? '';
    const isPreset = SUB_PURPOSES.some(x => x.code === saved);
    // Vật tư đang gắn ở điểm đo này → dựng lại thành các dòng của bảng.
    const rows: AssetRow[] = (d?.assets ?? [])
      .filter(a => a.point === p.id)
      .map(a => ({
        key: `r${++rowSeq}`, id: a.id, type: a.type, serial: a.serial,
        ratio: formatRatio(a.ratio_primary, a.ratio_secondary),
        // Bản ghi tạo trước đợt 7 chưa có 3 cột này: `active` mặc định TRUE vì
        // hồi đó mọi vật tư khai ở điểm đo đều là đang treo.
        dateOn: (a.date_on ?? '').slice(0, 10),
        dateOff: (a.date_off ?? '').slice(0, 10),
        active: a.active ?? true,
      }));
    setPForm({
      ...EMPTY_P,
      assetRows: rows,
      station: p.station, role: p.role, connection: p.connection,
      customer: p.customer ?? '', parent_point: p.parent_point ?? '',
      ident: p.ident ?? '', hsn: str(p.hsn),
      purpose: isPreset ? saved : (saved ? CUSTOM : ''),
      purpose_custom: isPreset ? '' : saved,
      status: (p.status ?? '') as PointStatus, note: p.note ?? '',
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

  /* ------------- HSN suy từ tỷ số TI / TU trong bảng vật tư ------------- */
  /**
   * Lấy dòng đầu tiên của một loại có nhập tỷ số — 3 TI cùng bộ luôn cùng tỷ số.
   * Chỉ xét thiết bị ĐANG HOẠT ĐỘNG: TI cũ đã tháo không được kéo HSN theo.
   */
  const ratioRowOf = (type: AssetType) =>
    pForm.assetRows.find(r => r.active && r.type === type && r.ratio.trim() !== '');

  const hsnInput = {
    connection: pForm.connection,
    ti: parseRatio(ratioRowOf('TI')?.ratio ?? ''),
    tu: parseRatio(ratioRowOf('TU')?.ratio ?? ''),
  };
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
  const pointMkh = mkhOf(isSub ? pForm.customer : pStation?.customer);

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

  /** Công tơ ĐANG hoạt động — HSN của điểm đo phải khớp hóa đơn của cái này. */
  const activeMeter = pForm.assetRows.find(r => r.type === 'CONGTO' && r.active && r.serial.trim());
  const activeSeg = segmentOf(invSegs[activeMeter?.serial.trim() ?? ''] ?? [], pointMkh);
  const invoiceHsn = activeSeg?.hsn;

  /**
   * Chỉ suy ngược được tỷ số TI khi KHÔNG có TU: khi đó HSN = TI sơ/TI thứ.
   * Có cả TU thì một HSN ứng với vô số cặp tỷ số — phải nhập tay cả hai, app
   * chỉ kiểm tích số (user chốt 20/08).
   */
  const tuRow = ratioRowOf('TU');
  const tiSecondary = parseRatio(ratioRowOf('TI')?.ratio ?? '').secondary ?? 5;
  const canFillTi = pForm.connection === 'gian_tiep' && invoiceHsn != null && !tuRow
    && pForm.assetRows.some(r => r.type === 'TI' && r.active);
  const suggestedTi = invoiceHsn != null ? `${invoiceHsn * tiSecondary}/${tiSecondary}` : '';

  /** Điền tỷ số suy từ HSN hóa đơn cho CẢ BỘ TI đang hoạt động. */
  const fillTiFromInvoice = () =>
    setPForm(f => ({
      ...f,
      assetRows: f.assetRows.map(r =>
        r.type === 'TI' && r.active ? { ...r, ratio: suggestedTi } : r),
    }));

  /** Nhắc đối chiếu hóa đơn — tách khỏi `assetWarnings` vì đây là tham chiếu. */
  const invoiceNotes: string[] = [];
  for (const r of pForm.assetRows) {
    const serial = r.serial.trim();
    const segs = r.type === 'CONGTO' ? invSegs[serial] : undefined;
    if (!segs) continue;
    const mine = segmentOf(segs, pointMkh);
    if (!mine) {
      if (segs.length) {
        invoiceNotes.push(`công tơ ${serial} có hóa đơn nhưng của khách khác `
          + `(${segs.map(s => `${s.mkh}: ${s.from}→${s.to}`).join(', ')})`);
      }
      continue;
    }
    if (r.dateOn && r.dateOn > mine.from) {
      invoiceNotes.push(`công tơ ${serial} khai treo ${r.dateOn} nhưng đã phát sinh tiền điện từ ${mine.from}`);
    }
    if (r.dateOff && r.dateOff < mine.to) {
      invoiceNotes.push(`công tơ ${serial} khai tháo ${r.dateOff} nhưng còn phát sinh tiền điện đến ${mine.to}`);
    }
    if (mine.hsnHistory.length > 1) {
      invoiceNotes.push(`công tơ ${serial} từng đổi HSN: ${mine.hsnHistory.join(' → ')}`);
    }
  }
  if (invoiceHsn != null && derivedHsn != null && derivedHsn !== invoiceHsn) {
    invoiceNotes.push(tuRow
      ? `TI × TU đang ra HSN ${derivedHsn}, hóa đơn ghi ${invoiceHsn} — tích hai tỷ số phải bằng ${invoiceHsn}`
      : `HSN khai ra ${derivedHsn} nhưng hóa đơn ghi ${invoiceHsn} — kiểm tra lại tỷ số TI`);
  }

  /**
   * Cảnh báo vật tư — CHỈ nhắc, không chặn lưu (user chốt 14/08). Điểm đo đang
   * khai dở vẫn phải lưu được.
   */
  const filledRows = pForm.assetRows.filter(r => r.type && r.serial.trim());
  /** Chỉ đếm thiết bị đang hoạt động — cái đã tháo vẫn nằm bảng để giữ lịch sử. */
  const countType = (t: AssetType) =>
    filledRows.filter(r => r.type === t && r.active).length;
  const assetWarnings: string[] = [];
  if (countType('CONGTO') === 0) assetWarnings.push('chưa có công tơ đang hoạt động');
  else if (countType('CONGTO') > 1) assetWarnings.push('có nhiều hơn 1 công tơ đang hoạt động');
  // Không nhắc "thiếu GP-03" nữa: user bỏ ràng buộc bắt buộc có đo xa
  // (20/08/2026). Luật ONE_ACTIVE vẫn giữ — vẫn chỉ được 1 GP-03 hoạt động.

  // Lệch tỷ số trong cùng một bộ TI (hoặc TU): 3 TI phải cùng tỷ số, khác nhau
  // là khai nhầm — HSN đang lấy theo dòng đầu nên phải nói rõ.
  for (const t of HAS_RATIO) {
    const kinds = new Set(
      pForm.assetRows.filter(r => r.active && r.type === t && r.ratio.trim())
        .map(r => r.ratio.trim()));
    if (kinds.size > 1) {
      assetWarnings.push(`các ${t} không cùng tỷ số (${[...kinds].join(' ≠ ')}) — HSN đang lấy theo cái đầu`);
    }
  }

  // Đã tháo mà chưa khai ngày, hoặc còn hoạt động mà đã có ngày tháo.
  if (filledRows.some(r => !r.active && !r.dateOff)) {
    assetWarnings.push('có thiết bị đã ngưng hoạt động nhưng chưa khai ngày tháo');
  }
  if (filledRows.some(r => r.active && r.dateOff)) {
    assetWarnings.push('có thiết bị đang hoạt động nhưng đã khai ngày tháo');
  }
  if (filledRows.some(r => r.dateOn && r.dateOff && r.dateOff < r.dateOn)) {
    assetWarnings.push('có thiết bị khai ngày tháo trước ngày treo');
  }
  if (pForm.connection === 'gian_tiep' && countType('TI') !== 3) {
    assetWarnings.push(`đấu gián tiếp thường đủ 3 TI (đang có ${countType('TI')})`);
  }
  if (pForm.connection === 'truc_tiep' && countType('TI') > 0) {
    assetWarnings.push('đấu trực tiếp thì không cần TI');
  }

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
      const body = {
        code: pointCode,
        // LINE_NAME bên HES chính là chuỗi mã này — điền luôn để khỏi lệch.
        line_name: pointCode,
        ident: pForm.ident.trim(),
        sub_label: isSub ? subLabel : '',
        station: pForm.station,
        zone: pStation?.zone || undefined,
        // Điểm đo chính thuộc về chủ trạm; điểm đo phụ mang khách hàng riêng.
        customer: isSub ? pForm.customer : (pStation?.customer || undefined),
        parent_point: isSub ? pForm.parent_point : '',
        role: pForm.role,
        connection: pForm.connection,
        hsn: derivedHsn ?? undefined,
        status: pForm.status || undefined,
        note: pForm.note.trim(),
      };
      return void persist(async () => {
        const rec = editingId
          ? await points.update(editingId, body)
          : await points.create(body);
        // Vật tư lưu sau vì cần id điểm đo; lỗi ở đây sẽ báo nguyên văn từ PB
        // (thường là trùng số No với vật tư đang gắn ở điểm đo khác).
        await syncAssets((rec as { id: string }).id);
      }, `Điểm đo ${body.code}`);
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
      if (!keptIds.has(old.id)) await assets.remove(old.id);
    }

    for (const r of rows) {
      const hasRatio = HAS_RATIO.includes(r.type as AssetType);
      const { primary, secondary } = parseRatio(r.ratio);
      const body = {
        serial: r.serial.trim(),
        type: r.type as AssetType,
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
   * Sửa một dòng rồi áp 2 luật nghiệp vụ lên các dòng còn lại:
   *
   * 1. **Tỷ số dùng chung theo loại** — 3 TI của một bộ luôn cùng tỷ số, TU
   *    cũng vậy. Nhập tỷ số cho một cái thì các dòng cùng loại CÒN TRỐNG tự
   *    điền theo; dòng đã có tỷ số khác thì KHÔNG đè, chỉ cảnh báo lệch.
   * 2. **Một cái hoạt động mỗi loại** (công tơ, GP-03) — bật cái mới thì cái
   *    cũ tự tắt và điền sẵn ngày tháo là hôm nay.
   */
  const applyRowRules = (rows: AssetRow[], key: string, patch: Partial<AssetRow>): AssetRow[] => {
    const next = rows.map(r => (r.key === key ? { ...r, ...patch } : r));
    const me = next.find(r => r.key === key);
    if (!me || !me.type) return next;
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

    // Bật hoạt động (hoặc chuyển sang loại độc nhất) → tắt các cái cùng loại cũ.
    const turnsOn = patch.active === true || (patch.type !== undefined && me.active);
    if (turnsOn && ONE_ACTIVE.includes(type)) {
      return spread.map(r =>
        r.key !== key && r.type === type && r.active
          ? { ...r, active: false, dateOff: r.dateOff || today() }
          : r);
    }
    return spread;
  };

  const setRow = (key: string, patch: Partial<AssetRow>) =>
    setPForm(f => {
      // Gạt TẮT một dòng: điền sẵn ngày tháo, nhưng không đè ngày đã khai.
      const cur = f.assetRows.find(r => r.key === key);
      const p = patch.active === false && cur && !cur.dateOff
        ? { ...patch, dateOff: today() } : patch;
      return { ...f, assetRows: applyRowRules(f.assetRows, key, p) };
    });

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
   * (thụt lề). Vì vậy phải sắp xếp theo CỤM — xếp các điểm chính theo MKH rồi
   * mới trải phẳng, chứ không xếp từng dòng, kẻo điểm phụ bị tách khỏi cha.
   *
   * Điểm phụ mất cha, hoặc chưa gán cha, thành cụm một dòng xếp cuối để không
   * biến mất khỏi danh sách.
   */
  const pointGroups = useMemo(() => {
    const all = d?.points ?? [];
    const placed = new Set<string>();
    const clusters: { head: Point; rows: { point: Point; isChild: boolean }[] }[] = [];

    for (const p of all.filter(x => x.role === 'chinh')) {
      const rows = [{ point: p, isChild: false }];
      placed.add(p.id);
      for (const child of all.filter(x => x.parent_point === p.id)) {
        rows.push({ point: child, isChild: true });
        placed.add(child.id);
      }
      clusters.push({ head: p, rows });
    }
    for (const p of all) {
      if (!placed.has(p.id)) clusters.push({ head: p, rows: [{ point: p, isChild: false }] });
    }

    const sorted = sortByMkh(clusters, c => mkhOf(c.head.customer));
    // KCN của cụm lấy theo trạm của điểm chính (điểm đo không giữ KCN riêng).
    const zoneOfCluster = (c: (typeof clusters)[number]) =>
      d?.stations.find(s => s.id === c.head.station)?.zone;

    return groupByZone(sorted, zoneOfCluster, d?.zones ?? [])
      .map(g => ({ zone: g.zone, rows: g.rows.flatMap(c => c.rows) }));
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
          {zoneRows.map(z => (
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
            {stationGroups.map(g => (
              <Fragment key={g.zone?.id ?? '__no_zone'}>
                <ZoneGroupRow zone={g.zone} count={g.rows.length} unit="trạm" colSpan={7} />
                {g.rows.map(s => (
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
              </Fragment>
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
          {customerGroups.map(g => (
            <Fragment key={g.zone?.id ?? '__no_zone'}>
              <ZoneGroupRow zone={g.zone} count={g.rows.length} unit="khách hàng" colSpan={7} />
              {g.rows.map(c => (
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
            </Fragment>
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
            {pointGroups.map(g => (
              <Fragment key={g.zone?.id ?? '__no_zone'}>
                <ZoneGroupRow zone={g.zone} count={g.rows.length} unit="điểm đo" colSpan={7} />
                {g.rows.map(({ point: p, isChild }) => (
              <tr key={p.id} className="transition-colors hover:bg-subtle/50">
                <td className={`px-6 py-4 ${isChild ? 'pl-16' : 'pl-10'}`}>
                  <span className="flex items-center gap-2">
                    {isChild && <CornerDownRight className="h-4 w-4 shrink-0 text-faint" />}
                    <PointBadgeIcon point={p} />
                    <span className={`font-mono text-sm ${isChild ? 'text-dim' : 'font-bold text-ink'}`}>
                      {p.code || p.line_name || '—'}
                    </span>
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-soft">{stationCodeOf(p.station)}</td>
                <td className="px-6 py-4 font-mono text-xs font-bold text-soft">{customerMkh(p.customer)}</td>
                <td className="px-6 py-4"><PointBadgeChip point={p} /></td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    p.connection === 'gian_tiep'
                      ? 'bg-[var(--warning-soft)] text-warn'
                      : 'bg-[var(--success-soft)] text-good'
                  }`}>
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
              </Fragment>
            ))}
          </TableCard>
        </>
      )}

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

            <Field label="Định danh điểm đo" hint="Không bắt buộc. Gõ 0,4 → mã có đuôi (0,4)">
              <TextInput value={pForm.ident} mono placeholder="0,4"
                onChange={v => setPForm(f => ({ ...f, ident: v }))} />
            </Field>

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
                      <th className="px-2 py-3 text-left font-bold text-soft">Hoạt động</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pForm.assetRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-[13px] italic text-faint">
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
                        <td className="p-2">
                          <Switch checked={r.active} label={r.active ? 'Có' : 'Ngưng'}
                            title={r.active ? 'Đang đo tại điểm đo này' : 'Đã ngưng — giữ lại làm lịch sử'}
                            onChange={v => setRow(r.key, { active: v })} />
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

            {/* HSN: chỉ đọc, suy từ tỷ số vừa nhập */}
            <Field label="HSN (suy từ tỷ số TI / TU)" hint={hsnFormula(hsnInput)}>
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

                {activeSeg ? (
                  <p className="text-soft">
                    Công tơ <span className="font-mono font-bold text-ink">{activeMeter?.serial.trim()}</span>
                    {' '}· khách <span className="font-mono font-bold text-ink">{activeSeg.mkh}</span>
                    {' '}· phát sinh tiền điện{' '}
                    <b className="text-ink">{activeSeg.from} → {activeSeg.to}</b>
                    {' '}({activeSeg.count} HĐ){activeSeg.isCurrent && ' — còn phát sinh tháng này'}
                    {activeSeg.hsn != null && <> · HSN hóa đơn <b className="text-ink">{activeSeg.hsn}</b></>}
                  </p>
                ) : !invLoading && (
                  <p className="italic text-faint">
                    Chưa tra được hóa đơn cho công tơ đang hoạt động của điểm đo này.
                  </p>
                )}

                {canFillTi && suggestedTi !== ratioRowOf('TI')?.ratio && (
                  <button type="button" onClick={fillTiFromInvoice}
                    className="vl-btn vl-btn-secondary vl-btn-sm">
                    Điền tỷ số TI theo hóa đơn: {suggestedTi} (HSN {invoiceHsn})
                  </button>
                )}
                {pForm.connection === 'gian_tiep' && invoiceHsn != null && tuRow && (
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

            <Field label="Trạng thái">
              <Select value={pForm.status}
                onChange={v => setPForm(f => ({ ...f, status: v as PointStatus }))}
                options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                placeholder="Chưa xác định" />
            </Field>

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
