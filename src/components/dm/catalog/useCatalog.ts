/**
 * State + logic của màn Danh mục (`CatalogEntry`): nạp danh mục, tab, tìm kiếm,
 * lọc KCN, form KCN/Lộ/Trạm/Khách hàng, lưu, xoá, đồng bộ khách hàng, soát tên
 * viết thường, gom/lọc 5 bảng. Tách ngày 17/11/2026 (plan
 * `2026-11-17-tach-catalog-entry.md`, đợt 5) — thân hook là NGUYÊN VĂN đoạn cũ.
 * Form điểm đo có hook riêng: `usePointForm.ts` (gọi từ trong hook này).
 */
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../../lib/toast';
import { estimateLossParams } from '@/scripts/lib/lossParams.mjs';
import { assets, borrows, customers, devices, isAbortError, lines, loadCatalog, pbErrorMessage, points, stations, zones } from '../../../lib/dm/repo';
import type { CatalogData } from '../../../lib/dm/repo';
import { ASSET_LABEL } from '../../../lib/dm/types';
import { isHeadPoint, pointZoneId } from '../../../lib/dm/pointScope';
import type {
  Customer, Line, Point, PointRole, Station,
  VoltageLevel, Zone,
} from '../../../lib/dm/types';
import { connectionOfHsn, formatRatio } from '../../../lib/dm/hsn';
import type { Scope } from '../../../lib/scope';
import { loadCustomerFacts } from '../../../lib/dm/invoiceRepo';
import { isEmptyPlan, latestByMkh, planCustomerSync } from '../../../lib/dm/customerSync';
import { autoFillable, checkLowName, planLowNameFix, toLowName } from '../../../lib/dm/lowName';
import type { LowNameRow } from '../../../lib/dm/lowName';
import { CUSTOM } from '../../../lib/dm/pointCheck';
import { savePoint } from '../../../lib/dm/pointSave';
import { EMPTY_P, usePointForm } from './usePointForm';
import { groupByZone, sortByCode, sortByMkh } from '../groupByZone';
import { needFromRows, rowsFromNeed } from '../PointNeedEditor';
import {
  hsnSig,
  newRowKey, type AssetRow,
} from '../../../lib/dm/pointForm';
import { runReconcile } from '../../../lib/dm/reconcileRun';
import { buildTerms, matchesTerms } from '../../../lib/dm/search';
import {
  SHORT_NAME_HINT, SUB_PURPOSES, buildStationCode, isValidShortName,
  missingStationCodeParts, normalizeShortName,
} from '../../../lib/dm/naming';
import { CatTab, TABS, HEAD, EMPTY_Z, EMPTY_L, EMPTY_S, EMPTY_C, toNum, str } from './constants';

export function useCatalog({ scope: _scope = 'vanphong', tabs, initialTab }: {
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

  const [zForm, setZForm] = useState(EMPTY_Z);
  const [lForm, setLForm] = useState(EMPTY_L);
  const [sForm, setSForm] = useState(EMPTY_S);
  const [cForm, setCForm] = useState(EMPTY_C);
  /** Soát ngay trong form: hiện lý do lệch dưới ô, và bật/tắt nút "Lấy từ tên". */
  const lowNameCheck = useMemo(
    () => checkLowName({ name: cForm.name, low_name: cForm.low_name }),
    [cForm.name, cForm.low_name],
  );
  /* Form điểm đo: state + logic ở `catalog/usePointForm.ts`. */
  const pf = usePointForm({ d: data, editingId, modal });
  const {
    setRegenCode, pForm, setPForm, setPSnap, pStation, isSub, isHead, pLine, lineHeadTaken,
    subLabel, pointCodeMissing, pointCode, effectiveHsn, serialInForm, reclaim, saveBlocks,
    derivedStatus,
  } = pf;

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

  return {
    _scope, shownTabs, lowNameCheck, pf, load, d, zoneOpts, lineOptsOfZone, customerOpts, stationOpts, zoneName, mkhOf, customerMkh, pointCodeOf, stationsOfZone, pointsOfStation, pointsOfCustomer, openAdd, editZone, editLine, editStation, editCustomer, editPoint, closeModal, sZone, sCustomer, codeParts, stationCode, stationCodeMissing, customerLacksShortName, lossParamEditable, lossEstimate, explainSaveError, reportReconcile, saveCurrentPoint, persist, submit, auditLowName, fixAllLowName, syncCustomers, del, stationsOfLine, lineCodeOf, stationCodeOf, placeOf, childrenOf, zoneRows, lineGroups, stationGroups, customerGroups, pointGroups, NO_ZONE, byFilterZone, terms, customerName, bySearch, pointGroupsShown, zoneRowsShown, lineGroupsShown, stationGroupsShown, customerGroupsShown, emptyText, zoneFilterOpts, headOf, head, modalTitle, tab, setTab, search, setSearch, filterZone, setFilterZone, data, setData, loading, setLoading, saving, setSaving, modal, setModal, editingId, setEditingId, transferring, setTransferring, assigning, setAssigning, zForm, setZForm, lForm, setLForm, sForm, setSForm, cForm, setCForm, syncing, setSyncing, lowNameRows, setLowNameRows, lowNameOpen, setLowNameOpen, fixingLowName, setFixingLowName, confirm, dialog, setRegenCode, pForm, setPForm, setPSnap, pStation, isSub, isHead, pLine, lineHeadTaken, subLabel, pointCodeMissing, pointCode, effectiveHsn, serialInForm, reclaim, saveBlocks, derivedStatus,
  };
}

export type CatalogState = ReturnType<typeof useCatalog>;
