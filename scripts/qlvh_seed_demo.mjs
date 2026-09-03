#!/usr/bin/env node
/**
 * Nạp 3 hợp đồng MẪU vào qlvh_* để xem thử giao diện.
 *   node scripts/qlvh_seed_demo.mjs           # dry-run
 *   node scripts/qlvh_seed_demo.mjs --commit  # nạp thật
 *   node scripts/qlvh_seed_demo.mjs --purge --commit   # xoá sạch dữ liệu mẫu
 *
 * Số hợp đồng đều mang tiền tố DEMO- để nhận ra và xoá lại được.
 * Chỉ đụng qlvh_contract / qlvh_payment; dm_* chỉ đọc.
 */
const U = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const COMMIT = process.argv.includes('--commit');
const PURGE = process.argv.includes('--purge');
const TAG = 'DEMO-';

let tok = '';
const api = async (p, i = {}) => {
  const r = await fetch(U + p, { ...i, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: tok } : {}), ...(i.headers || {}) } });
  const t = await r.text(); const b = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${i.method || 'GET'} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return b;
};

const day = (d) => d.toISOString().slice(0, 10);
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return day(d); };
const addYears = (s, n) => { const [y, m, d] = s.split('-'); return `${Number(y) + n}-${m}-${d}`; };

(async () => {
  tok = (await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
  })).token;

  const old = await api(`/api/collections/qlvh_contract/records?perPage=200&filter=(contract_no~"${TAG}")`);
  if (PURGE) {
    console.log(`Xoá ${old.totalItems} hợp đồng mẫu…`);
    if (COMMIT) for (const c of old.items) await api('/api/collections/qlvh_contract/records/' + c.id, { method: 'DELETE' });
    console.log(COMMIT ? 'Đã xoá (đợt thanh toán tự xoá theo cascade).' : '[dry-run] chưa xoá gì.');
    return;
  }
  if (old.totalItems > 0) { console.log(`Đã có ${old.totalItems} hợp đồng mẫu — chạy --purge --commit trước nếu muốn nạp lại.`); return; }

  const customers = (await api('/api/collections/dm_customer/records?perPage=50&filter=(active=true)')).items;
  const zones = (await api('/api/collections/dm_zone/records?perPage=10')).items;
  /** KCN của khách lấy từ chính dm_customer.zone (relation id), không đoán theo tên. */
  const zoneOf = (cus, i) => zones.find(z => z.id === cus.zone) || zones[i % zones.length];

  // 3 ca để nhìn thấy đủ màu trạng thái trên giao diện
  const specs = [
    { no: `${TAG}001/2026/QLVH`, from: shift(-400), months: 36, before: 300_000_000, paidSeq: 1, note: 'Đợt 1 đã thu, đợt 2 quá hạn' },
    { no: `${TAG}002/2026/QLVH`, from: shift(7),    months: 12, before: 120_000_000, paidSeq: 0, note: 'Vừa ký, đợt 1 còn 7 ngày nữa đến hạn' },
    { no: `${TAG}003/2025/QLVH`, from: shift(-700), months: 24, before: 200_000_000, paidSeq: 2, note: 'Đã thu xong' },
  ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const cus = customers[i % customers.length];
    const zone = zoneOf(cus, i);
    const vat = Math.round(s.before * 0.08);
    const total = s.before + vat;
    const to = addYears(s.from, s.months / 12);
    const n = s.months / 12;
    const base = Math.floor(total / n);

    console.log(`${COMMIT ? '+' : '+ [dry-run]'} ${s.no} — ${cus.name.slice(0, 35)} — ${n} đợt — ${s.note}`);
    if (!COMMIT) continue;

    const c = await api('/api/collections/qlvh_contract/records', {
      method: 'POST',
      body: JSON.stringify({
        contract_no: s.no, customer: cus.id, zone: zone.id,
        sign_date: s.from, effective_from: s.from, effective_to: to,
        value_before_vat: s.before, vat_rate: 8, value_vat: vat, value_total: total,
        payment_terms: 'Thanh toán mỗi năm một lần trong vòng 15 ngày kể từ ngày đến hạn.',
        status_manual: 'dang_hieu_luc', note: s.note,
      }),
    });

    for (let k = 1; k <= n; k++) {
      const amount = k === n ? total - base * (n - 1) : base;
      const paid = k <= s.paidSeq;
      await api('/api/collections/qlvh_payment/records', {
        method: 'POST',
        body: JSON.stringify({
          contract: c.id, seq: k, due_date: addYears(s.from, k - 1), amount_due: amount,
          ...(paid ? { paid_date: addYears(s.from, k - 1), amount_paid: amount, invoice_no: `HD${k}${String(i + 1).padStart(3, '0')}` } : {}),
        }),
      });
    }
  }
  console.log(COMMIT ? '\nXong. Xoá lại bằng: node scripts/qlvh_seed_demo.mjs --purge --commit' : '\n[dry-run] thêm --commit để nạp thật.');
})().catch(e => { console.error(e.message); process.exit(1); });
