/**
 * Dòng phụ của ô KPI: số SAU THUẾ in nhỏ dưới số trước thuế, kèm chú thích cũ.
 *
 * Số to trên ô KPI là TRƯỚC THUẾ (user chốt 17/09/2026) — khớp giá trị ghi trên
 * hợp đồng và sổ kế toán. Số sau thuế là thứ khách thực trả nên vẫn phải thấy,
 * chỉ lùi xuống hàng dưới.
 *
 * Dùng qua prop `sub` của `StatTile` (nhận ReactNode) — KHÔNG sửa StatTile và
 * không dựng ô KPI riêng cho module này.
 */

import React from 'react';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));

const FAINT = 'text-faint font-normal mt-0.5';

export function VatSub({ lead, gross, note }: {
  /**
   * Dòng tiền TRƯỚC THUẾ đặt lên đầu — chỉ dùng cho ô KPI mà số to không phải
   * tiền (ô "Quá hạn" đếm đợt). Bỏ trống thì dòng sau thuế lên làm dòng chính.
   */
  lead?: React.ReactNode;
  gross: number;
  note?: React.ReactNode;
}) {
  return (
    <>
      {lead != null && <div>{lead}</div>}
      <div className={lead != null ? FAINT : undefined}>sau thuế {money(gross)}đ</div>
      {/* Chú thích cũ ("69 hợp đồng", "…% giá trị") lùi xuống và nhạt đi chứ
          không bị bỏ — nó vẫn là thông tin người dùng đang quen nhìn.
          `text-faint` đè màu tone mà StatTile đặt inline trên thẻ cha. */}
      {note != null && <div className={FAINT}>{note}</div>}
    </>
  );
}
