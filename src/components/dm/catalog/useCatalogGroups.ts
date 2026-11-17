/**
 * Gom nhóm theo KCN, lọc KCN và tìm kiếm cho 5 bảng của màn Danh mục (+ ô chọn lọc KCN).
 * Tách khỏi `useCatalog.ts` ngày 17/11/2026 (rà soát định kỳ, việc 5) — thân hook NGUYÊN VĂN;
 * những gì trước đây đọc qua closure của `useCatalog` nay là tham số.
 */
import { useMemo } from 'react';
import type { CatalogData } from '../../../lib/dm/repo';
import { pointZoneId } from '../../../lib/dm/pointScope';
import type {
  Point,
  Zone,
} from '../../../lib/dm/types';
import { groupByZone, sortByCode, sortByMkh } from '../groupByZone';
import { buildTerms, matchesTerms } from '../../../lib/dm/search';
import { CatTab } from './constants';

export function useCatalogGroups({
  d, search, filterZone, tab, zoneName, mkhOf, customerMkh, stationCodeOf,
}: UseCatalogGroupsDeps) {
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

  return {
    zoneRows, lineGroups, stationGroups, customerGroups, pointGroups, NO_ZONE, byFilterZone, terms, customerName, bySearch, pointGroupsShown, zoneRowsShown, lineGroupsShown, stationGroupsShown, customerGroupsShown, emptyText, zoneFilterOpts,
  };
}

type UseCatalogGroupsDeps = {
  d: CatalogData | null;
  /** Ô tìm kiếm dùng chung 4 tab danh mục. */
  search: string;
  /** Bộ lọc KCN của 3 bảng Trạm / Khách hàng / Điểm đo. `''` = tất cả. */
  filterZone: string;
  tab: CatTab;
  zoneName: (id?: string) => string;
  /** MKH thô để SẮP XẾP — chưa gắn khách hàng thì `undefined`. */
  mkhOf: (id?: string) => string | undefined;
  /** MKH để HIỂN THỊ (`'—'` khi chưa gắn). */
  customerMkh: (id?: string) => string;
  stationCodeOf: (id?: string) => string;
};
