#!/usr/bin/env node
/**
 * Sửa dữ liệu — `pk_w` của 2 trạm bị nhập sai đơn vị (user xác nhận 20/08/2026).
 *
 * Nguyên nhân gốc: form dùng `<input type="number">`, trên locale VN gõ
 * "1.963" được trình duyệt hiểu là 1,963 (dấu chấm = thập phân) chứ không phải
 * 1963 W. Hai trạm T1/T2 vì thế lưu tổn thất ngắn mạch bằng ~2 W, vô lý với
 * máy 180/160 kVA. Ô nhập đã được vá riêng ở `entryUi.tsx`; script này chỉ dọn
 * dữ liệu đã lỡ ghi.
 *
 * PHẠM VI: chỉ PATCH trường `pk_w` của đúng 2 bản ghi `dm_station` liệt kê
 * trong FIXES. KHÔNG đụng collection nào khác, KHÔNG đổi schema.
 *
 * CHỐT CHẶN: chỉ ghi khi giá trị hiện tại đúng bằng `from`. Lệch một chút là
 * DỪNG — nghĩa là dữ liệu đã đổi từ lúc khảo sát, phải xem lại bằng mắt.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_pk_w.mjs           # dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_pk_w.mjs --apply   # ghi thật
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const APPLY = process.argv.includes('--apply');

/** code trạm → { from: giá trị sai đang có, to: giá trị đúng } */
const FIXES = [
  { code: 'TH.BQL-TH.T1.180kVA', from: 1.963, to: 1963 },
  { code: 'TH.BQL-TH.T2.160kVA', from: 1.819, to: 1819 },
];

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
  }
  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  console.log(`PB: ${PB_URL}`);
  const { items } = await call('GET', '/api/collections/dm_station/records?perPage=500', token);

  const todo = [];
  for (const fix of FIXES) {
    const rec = items.find(r => r.code === fix.code);
    if (!rec) {
      console.error(`DỪNG: không thấy trạm ${fix.code}`);
      process.exit(1);
    }
    if (rec.pk_w === fix.to) {
      console.log(`= ${fix.code}: pk_w đã là ${fix.to}, bỏ qua.`);
      continue;
    }
    if (rec.pk_w !== fix.from) {
      console.error(`DỪNG: ${fix.code} có pk_w = ${rec.pk_w}, không phải ${fix.from} như khảo sát.`);
      process.exit(1);
    }
    console.log(`~ ${fix.code}: pk_w ${rec.pk_w} → ${fix.to}   (p0_w = ${rec.p0_w}, giữ nguyên)`);
    todo.push({ id: rec.id, ...fix });
  }

  if (!todo.length) { console.log('Không có gì phải sửa.'); return; }
  if (!APPLY) { console.log('\n[DRY-RUN] Không ghi gì. Chạy lại kèm --apply để ghi thật.'); return; }

  for (const t of todo) {
    await call('PATCH', `/api/collections/dm_station/records/${t.id}`, token, { pk_w: t.to });
    console.log(`  ✓ ${t.code}: pk_w = ${t.to}`);
  }

  // Kiểm chứng: đọc lại toàn bộ trạm.
  const after = await call('GET', '/api/collections/dm_station/records?perPage=500', token);
  console.log('\nSau khi sửa — toàn bộ dm_station:');
  for (const r of after.items) console.log(`  ${r.code.padEnd(24)} p0_w=${r.p0_w}  pk_w=${r.pk_w}`);
}

main().catch(e => { console.error(e); process.exit(1); });
