#!/usr/bin/env node
/**
 * Điền TẠM ngày thanh toán cho các đợt đã thu nhưng chưa có ngày.
 *
 *   node scripts/qlvh_backfill_paid_date.mjs            # dry-run
 *   node scripts/qlvh_backfill_paid_date.mjs --commit   # ghi thật
 *   node scripts/qlvh_backfill_paid_date.mjs --undo --commit   # gỡ lại
 *
 * Bối cảnh: file theo dõi Excel chỉ ghi "đã thu", KHÔNG ghi ngày thu, nên lúc
 * nhập đã cố ý để trống. Từ 21/08/2026 trạng thái tính theo NGÀY thanh toán nên
 * các đợt đó bị coi là chưa thu. User chốt lấy tạm **ngày đến hạn + 5 ngày**.
 *
 * Chỉ đụng `qlvh_payment`, và chỉ những dòng:
 *   - chưa có `paid_date`, VÀ
 *   - `amount_paid` ≥ `amount_due` > 0  (tức đã thu đủ theo số liệu nhập từ Excel)
 * Đợt chưa thu hoặc đã có ngày thật đều KHÔNG bị chạm tới.
 *
 * Mỗi dòng được đánh dấu trong `note` để sau này còn phân biệt ngày tạm với
 * ngày thật, và để `--undo` gỡ lại đúng những dòng script này đã ghi.
 */

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const COMMIT = process.argv.includes('--commit');
const UNDO = process.argv.includes('--undo');

/** Số ngày cộng thêm vào hạn thanh toán (user chốt 21/08/2026). */
const OFFSET_DAYS = 5;
const MARK = '[ngày tạm +5 từ hạn TT, file theo dõi không ghi ngày thu]';

let tok = '';
const api = async (p, i = {}) => {
  const r = await fetch(PB_URL + p, {
    ...i,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: tok } : {}), ...(i.headers || {}) },
  });
  const t = await r.text();
  const b = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${i.method || 'GET'} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return b;
};

const day = v => String(v || '').slice(0, 10);
const addDays = (d, n) => {
  const t = Date.parse(`${day(d)}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
};

(async () => {
  console.log(`PB   : ${PB_URL}`);
  console.log(UNDO ? 'CHẾ ĐỘ: GỠ ngày tạm' : `CHẾ ĐỘ: ĐIỀN ngày tạm = hạn thanh toán + ${OFFSET_DAYS} ngày`);
  console.log(COMMIT ? '        GHI THẬT (--commit)\n' : '        DRY-RUN (thêm --commit để ghi thật)\n');

  tok = (await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
  })).token;

  const all = (await api('/api/collections/qlvh_payment/records?perPage=500&sort=seq')).items;

  if (UNDO) {
    const marked = all.filter(p => String(p.note || '').includes(MARK));
    console.log(`Tìm thấy ${marked.length} đợt mang dấu ngày tạm.`);
    if (COMMIT) {
      for (const p of marked) {
        await api('/api/collections/qlvh_payment/records/' + p.id, {
          method: 'PATCH',
          body: JSON.stringify({ paid_date: '', note: String(p.note).replace(MARK, '').trim() }),
        });
      }
      console.log('Đã gỡ ngày tạm.');
    }
    return;
  }

  const target = all.filter(p =>
    !day(p.paid_date) && (p.amount_paid || 0) > 0 && (p.amount_paid || 0) >= (p.amount_due || 0));

  const skipHasDate = all.filter(p => day(p.paid_date)).length;
  const skipUnpaid = all.length - target.length - skipHasDate;

  console.log(`Tổng số đợt        : ${all.length}`);
  console.log(`Sẽ điền ngày tạm   : ${target.length}`);
  console.log(`Bỏ qua (đã có ngày): ${skipHasDate}`);
  console.log(`Bỏ qua (chưa thu)  : ${skipUnpaid}\n`);

  target.slice(0, 5).forEach(p => {
    console.log(`  ví dụ: đợt ${p.seq} hạn ${day(p.due_date)} → ngày tạm ${addDays(p.due_date, OFFSET_DAYS)}`);
  });
  if (target.length > 5) console.log(`  … và ${target.length - 5} đợt nữa`);

  if (!COMMIT) { console.log('\n[dry-run] chưa ghi gì.'); return; }

  let done = 0;
  for (const p of target) {
    const paidDate = addDays(p.due_date, OFFSET_DAYS);
    if (!paidDate) continue;
    await api('/api/collections/qlvh_payment/records/' + p.id, {
      method: 'PATCH',
      body: JSON.stringify({ paid_date: paidDate, note: `${String(p.note || '').trim()} ${MARK}`.trim() }),
    });
    done++;
  }
  console.log(`\nĐã điền ngày tạm cho ${done} đợt. Gỡ lại bằng: --undo --commit`);
})().catch(e => { console.error('\nLỖI:', e.message); process.exit(1); });
