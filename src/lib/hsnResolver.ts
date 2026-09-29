/**
 * Lấy Danh mục về để tra HSN theo (công tơ, thời điểm) cho màn hình.
 *
 * Tách khỏi `thongso.ts` có chủ ý: file kia phải KHÔNG có import chạy được, để
 * `scripts/check_thongso_parity.mjs` nạp nó độc lập mà đối chiếu với bản Node.
 * Thêm một `import { pb }` vào đó là phép đối chiếu hai bản gãy ngay.
 *
 * Chỉ lấy đúng các cột cần: `dm_asset` hàng nghìn bản ghi, kéo cả bản ghi về chỉ
 * để lấy 4 trường là phí băng thông mỗi lần mở màn hình.
 */
import { useEffect, useState } from 'react';
import { pb } from './pocketbase';
import { buildHsnResolver, type HsnResult } from './thongso';
import type { Asset, Point } from './dm/types';

export type HsnAt = (serial: string, dateTime: string) => HsnResult;

/** Không tra được thì nói KHÔNG BIẾT, đừng lẳng lặng coi HSN = 1. */
const UNKNOWN: HsnAt = () => ({ reason: 'KHONG_CO_TRONG_DANH_MUC' });

let _cache: Promise<HsnAt> | null = null;

/** Hàm tra HSN — nạp Danh mục MỘT lần mỗi phiên (danh mục ít đổi). */
export function loadHsnResolver(): Promise<HsnAt> {
  if (_cache) return _cache;
  _cache = (async () => {
    const [assets, points] = await Promise.all([
      pb.collection('dm_asset').getFullList({
        filter: 'type = "CONGTO"',
        fields: 'id,type,serial,point,date_on,date_off',
        requestKey: null,
      }),
      pb.collection('dm_point').getFullList({ fields: 'id,hsn,code', requestKey: null }),
    ]);
    return buildHsnResolver(assets as unknown as Asset[], points as unknown as Point[]);
  })().catch(err => {
    /* Lỗi mạng: lần sau thử lại. Lần này KHÔNG nhân bừa — màn hình sẽ báo thiếu
       HSN thay vì hiện công suất nhỏ đi vài trăm lần mà trông vẫn như thật. */
    _cache = null;
    console.error('Không tải được Danh mục để tra HSN:', err);
    return UNKNOWN;
  });
  return _cache;
}

/** Hook: hàm tra HSN, và cờ báo đã nạp xong Danh mục hay chưa. */
export function useHsnResolver(): { hsnAt: HsnAt; ready: boolean } {
  const [state, setState] = useState<{ hsnAt: HsnAt; ready: boolean }>({ hsnAt: UNKNOWN, ready: false });
  useEffect(() => {
    let alive = true;
    loadHsnResolver().then(fn => { if (alive) setState({ hsnAt: fn, ready: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}
