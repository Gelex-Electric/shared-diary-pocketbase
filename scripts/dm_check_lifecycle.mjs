#!/usr/bin/env node
/**
 * Kiểm chứng luật cắt chặng vòng đời vật tư trên DỮ LIỆU THẬT.
 *
 * Script này KHÔNG chép lại logic — nó bundle thẳng `src/lib/dm/lifecycle.ts`
 * (module thuần) bằng esbuild của chính dự án rồi gọi vào. Kiểm chứng mà chạy
 * code khác code sẽ ship thì vô nghĩa.
 *
 * CHỈ ĐỌC: gọi GET lên `invoice`, `dm_*`. Không ghi bất cứ thứ gì.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_lifecycle.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

/** Bundle module TS thuần ra .mjs tạm rồi import — luôn chạy đúng bản đang ship. */
async function loadLifecycle() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-lifecycle-'));
  const out = join(dir, 'lifecycle.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/lib/dm/lifecycle.ts')],
    outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
  }
  const { mod, cleanup } = await loadLifecycle();
  try {
    const { segmentsOf, segmentOf, overlaps, ymd } = mod;

    const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    if (!auth.ok) { console.error('Đăng nhập PB thất bại:', auth.status); process.exit(1); }
    const { token } = await auth.json();
    const get = async (path) => {
      const r = await fetch(`${PB_URL}${path}`, { headers: { Authorization: token } });
      if (!r.ok) { console.error(`HTTP ${r.status} ${path}`); process.exit(1); }
      return r.json();
    };

    // Tải hết hóa đơn (PocketBase tối đa 500/lần).
    let invoices = [];
    for (let page = 1; ; page++) {
      const r = await get(`/api/collections/invoice/records?perPage=500&page=${page}`
        + `&fields=SCT,MKHang,HSN,StartDate,EndDate,ThTien,LoaiHD`);
      invoices = invoices.concat(r.items);
      if (page >= r.totalPages) break;
    }
    const assets = (await get('/api/collections/dm_asset/records?perPage=500')).items;
    const points = (await get('/api/collections/dm_point/records?perPage=500')).items;
    const customers = (await get('/api/collections/dm_customer/records?perPage=500')).items;

    console.log(`PB ${PB_URL}`);
    console.log(`invoice ${invoices.length} · dm_asset ${assets.length} · dm_point ${points.length}\n`);

    const mkhOf = (pointId) => {
      const p = points.find(x => x.id === pointId);
      return customers.find(c => c.id === p?.customer)?.mkh;
    };
    const codeOf = (pointId) => points.find(x => x.id === pointId)?.code ?? '(không rõ điểm đo)';

    let lechNgay = 0, lechHsn = 0, chongLan = 0, khongHd = 0;

    for (const a of assets.filter(x => x.type === 'CONGTO').sort((x, y) => x.serial < y.serial ? -1 : 1)) {
      const mkh = mkhOf(a.point);
      const segs = segmentsOf(invoices.filter(i => i.SCT === a.serial));
      const mine = segmentOf(segs, mkh);
      const on = ymd(a.date_on), off = ymd(a.date_off);

      console.log(`${a.serial} @ ${codeOf(a.point)}  KH=${mkh ?? '(chưa gắn KH)'}`);
      console.log(`   khai tay : treo=${on || '-'}  tháo=${off || '-'}  active=${a.active}`);

      if (!segs.length) { console.log('   hóa đơn  : (không có)'); khongHd++; console.log(); continue; }

      for (const s of segs) {
        const mark = s.mkh === mkh ? '→' : ' ';
        console.log(`  ${mark}hóa đơn  : ${s.mkh}  ${s.from} → ${s.to}  (${s.count} HĐ, HSN ${s.hsnHistory.join('→')})`
          + `${s.isCurrent ? '  [còn phát sinh tháng này]' : ''}`);
      }

      // Cảnh báo 1+2: thứ tự treo/tháo so với quãng phát sinh tiền điện.
      if (mine) {
        if (on && on > mine.from) {
          console.log(`   ⚠ ngày treo ${on} SAU hóa đơn đầu ${mine.from} — treo sau khi đã dùng điện?`);
          lechNgay++;
        }
        if (off && off < mine.to) {
          console.log(`   ⚠ ngày tháo ${off} TRƯỚC hóa đơn cuối ${mine.to} — tháo rồi mà vẫn phát sinh?`);
          lechNgay++;
        }
      } else {
        console.log(`   ⚠ số công tơ này có hóa đơn nhưng KHÔNG của ${mkh ?? '(chưa gắn KH)'} — không dùng để đối chiếu`);
      }

      // Cảnh báo 3: HSN khai ra khác HSN hóa đơn.
      const p = points.find(x => x.id === a.point);
      if (mine?.hsn != null && p?.hsn != null && a.active && p.hsn !== mine.hsn) {
        console.log(`   ⚠ HSN khai ${p.hsn} ≠ HSN hóa đơn ${mine.hsn} — TI phải là ${mine.hsn * 5}/5`);
        lechHsn++;
      }

      for (const [x, y] of overlaps(segs)) {
        console.log(`   ⚠ CHỒNG LẤN: ${x.mkh} (${x.from}→${x.to}) và ${y.mkh} (${y.from}→${y.to})`);
        chongLan++;
      }
      console.log();
    }

    console.log('─'.repeat(60));
    console.log(`Lệch ngày treo/tháo : ${lechNgay}`);
    console.log(`Lệch HSN            : ${lechHsn}`);
    console.log(`Chặng chồng lấn     : ${chongLan}`);
    console.log(`Công tơ chưa có HĐ  : ${khongHd}`);
  } finally {
    cleanup();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
