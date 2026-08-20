#!/usr/bin/env node
/**
 * Nhập trạm từ `public/mba_info.csv` vào `dm_station`.
 *
 * TUÂN THEO QUY TẮC APP: mã trạm KHÔNG lấy nguyên chuỗi trong CSV mà được SINH
 * LẠI bằng chính `buildStationCode()` của app (bundle từ `src/lib/dm/naming.ts`
 * qua esbuild). CSV chỉ cung cấp 4 mảnh: hậu tố KCN, tên tắt KH, định danh,
 * công suất. Nhờ vậy mã trong danh mục luôn đúng quy tắc, và chênh lệch giữa
 * CSV với quy tắc sẽ lộ ra thay vì bị nhét lén vào cơ sở dữ liệu.
 *
 * Khách hàng ghép theo TÊN TẮT **trong cùng KCN** — tên tắt trùng nhau giữa các
 * KCN là chuyện thường (BQL, TITAN là ban quản lý / chủ nhà xưởng ở nhiều KCN).
 *
 * Quyết định của user 20/08/2026:
 * - Hậu tố KCN lấy trọn phần sau "KCN" (đã sửa trong `naming.ts`).
 * - Trạm không có định danh trong CSV ⇒ mặc định `T1`.
 * - Trường hợp không ghép được thì IN GỢI Ý, không tự đoán.
 *
 * CHỈ ghi vào `dm_station`. Không đụng collection nào khác, không đổi schema.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_import_stations.mjs
 *   … thêm --apply để ghi thật
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'public/mba_info.csv');
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const APPLY = process.argv.includes('--apply');

/** Định danh mặc định khi CSV không ghi (user chốt 20/08). */
const DEFAULT_IDENT = 'T1';

/**
 * Ghép tay cho các trạm không tự khớp được tên tắt — user duyệt 20/08/2026.
 * Khoá = mã trạm nguyên văn trong CSV, giá trị = mã khách hàng.
 *
 * Lưu ý: mã trạm vẫn do app SINH từ tên tắt của khách hàng được chọn, nên mã
 * lưu xuống khác chuỗi trong CSV (vd `03.LOGOS.T1…` → `03.LOGOI.T1…` vì khách
 * đã đổi tên từ "LOGOS VIỆT NAM HY 1" thành "LOGOI GROUP VIỆT NAM").
 */
const OVERRIDES = {
  '03.JPVN.T1.800kVA':       'KCN03-006',   // tắt JP — "JP VIỆT NHẬT"
  '03.LOGOS.T1.1000kVA':     'KCN03-005',   // tắt LOGOI — đã đổi tên từ LOGOS
  '03.LOGOS.T2.2500kVA':     'KCN03-005',
  '03.LOGOS.T3.1600kVA':     'KCN03-005',
  'TTI.JOHNSON.T1.3000kVA':  'KCNTTI-004',  // tắt JOHNSON1
  'TTI.JOHNSON.T2.2000kVA':  'KCNTTI-004',
  'TTI.JOHNSON 2.T1.3000kVA': 'KCNTTI-005', // tắt JOHNSON2
  'TH.BEBRIGHT.T1.2500kVA':  'KCNTH-003A',  // tắt BE-BRIGHT
  'TH.BEBRIGHT.T2.2000kVA':  'KCNTH-003A',
  'YM.ECOPIONEER.1250kVA':   'KCNYM-024',   // tắt PIONEER — "ECO PIONEER"
  'YM.MINHQUANG.T1.1500kVA': 'KCNYM-004',   // tắt MQ-IDS
  'YM.PACIFIC.T1.1000kVA':   'KCNYM-006',   // tắt BEST-PACIFIC
  'YM.PE_FOAMVH.T1.1000kVA': 'KCNYM-038',   // tắt FOAM-VIETHAN
  'YM.KIMTIN2.T1.1250kVA':   'KCNYM-014',   // hai trạm cùng một khách KIM-TIN
  'YM.KIMTIN.3000KVA':       'KCNYM-014',
};

/**
 * Đè định danh trạm. Cần khi hai trạm cùng khách hàng mà CSV phân biệt bằng
 * tên tắt chứ không bằng định danh — mã sinh ra sẽ trùng nhau nếu để nguyên.
 * User chốt: KIM-TIN 1250kVA là T1, 3000kVA là T2.
 */
const IDENT_OVERRIDES = {
  'YM.KIMTIN2.T1.1250kVA': 'T1',
  'YM.KIMTIN.3000KVA':     'T2',
};

async function loadNaming() {
  const dir = mkdtempSync(join(tmpdir(), 'dm-naming-'));
  const out = join(dir, 'naming.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/lib/dm/naming.ts')],
    outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return { mod: await import(pathToFileURL(out).href), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** `"5450,3"` → 5450. App lưu số nguyên (W), CSV dùng dấu phẩy thập phân. */
const toInt = (s) => {
  const v = parseFloat(String(s ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v) : undefined;
};

/** Bỏ dấu + bỏ mọi ký tự không phải chữ số — để dò gần đúng tên công ty. */
const squash = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  const { mod, cleanup } = await loadNaming();
  try {
    const { buildStationCode, normalizeShortName, zoneSuffix } = mod;

    const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    if (!auth.ok) { console.error('Đăng nhập PB thất bại:', auth.status); process.exit(1); }
    const { token } = await auth.json();
    const api = async (method, path, body) => {
      const r = await fetch(`${PB_URL}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) { console.error(`HTTP ${r.status} ${method} ${path}\n${text.slice(0, 300)}`); process.exit(1); }
      return text ? JSON.parse(text) : {};
    };

    const zones = (await api('GET', '/api/collections/dm_zone/records?perPage=500')).items;
    const customers = (await api('GET', '/api/collections/dm_customer/records?perPage=500')).items;
    const stations = (await api('GET', '/api/collections/dm_station/records?perPage=500')).items;

    const zoneBySuffix = new Map(zones.map(z => [zoneSuffix(z.code), z]));
    const existingCodes = new Set(stations.map(s => s.code));
    const customerByMkh = new Map(customers.map(c => [c.mkh, c]));

    console.log(`PB ${PB_URL}`);
    console.log(`dm_zone ${zones.length} · dm_customer ${customers.length} · dm_station ${stations.length}`);
    console.log(`hậu tố KCN: ${[...zoneBySuffix.keys()].join(', ')}\n`);

    const rows = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean).slice(1)
      .map(l => l.split(';')).filter(r => r[0] && r[0].trim());

    const toCreate = [], skipExisting = [], needHelp = [], noZone = [];

    for (const r of rows) {
      const raw = r[0].trim();
      const parts = raw.split('.');
      // 3 phần = CSV không ghi định danh trạm.
      const [suffix, shortName, csvIdent, power] = parts.length === 4
        ? parts
        : [parts[0], parts[1], DEFAULT_IDENT, parts[2]];
      const ident = IDENT_OVERRIDES[raw] ?? csvIdent;

      const zone = zoneBySuffix.get((suffix ?? '').trim().toUpperCase());
      if (!zone) { noZone.push(`${raw}  (hậu tố "${suffix}")`); continue; }

      const sdm = toInt(r[1]) ?? toInt((power ?? '').replace(/kVA/i, ''));

      // Ghép tay trước, tự động sau.
      const forced = OVERRIDES[raw];
      const wanted = normalizeShortName(shortName ?? '');
      const inZone = customers.filter(c => c.mkh.split('-')[0] === zone.code);
      const hits = forced
        ? [customerByMkh.get(forced)].filter(Boolean)
        : inZone.filter(c => normalizeShortName(c.short_name ?? '') === wanted);

      if (hits.length !== 1) {
        // Gợi ý: khách trong cùng KCN có tên công ty chứa tên tắt (hoặc ngược lại).
        const guess = inZone.filter(c => {
          const n = squash(c.name), s = squash(shortName);
          return s.length >= 3 && (n.includes(s) || squash(c.short_name ?? '').includes(s));
        });
        needHelp.push({
          raw, zone: zone.code, wanted,
          reason: hits.length === 0 ? 'không khớp tên tắt nào' : `khớp ${hits.length} khách hàng`,
          candidates: (hits.length > 1 ? hits : guess).map(c => `${c.mkh} — ${c.name.slice(0, 52)}`),
        });
        continue;
      }

      const customer = hits[0];
      // ĐÂY là chỗ tuân thủ quy tắc: mã do app sinh, không lấy chuỗi CSV.
      const code = buildStationCode({
        zoneCode: zone.code,
        customerShortName: customer.short_name ?? '',
        ident: ident ?? '',
        sdmKva: sdm,
      });

      if (existingCodes.has(code)) { skipExisting.push(code); continue; }
      toCreate.push({
        raw, code, zone: zone.id, zoneCode: zone.code, customer: customer.id, mkh: customer.mkh,
        ident: (ident ?? '').toUpperCase(), sdm_kva: sdm, p0_w: toInt(r[2]), pk_w: toInt(r[3]),
      });
    }

    console.log(`── SẼ TẠO ${toCreate.length} TRẠM`);
    for (const s of toCreate) {
      const note = s.code !== s.raw ? `   (CSV ghi "${s.raw}")` : '';
      console.log(`   + ${s.code.padEnd(28)} KH=${s.mkh.padEnd(11)} Sdm=${String(s.sdm_kva).padEnd(5)}`
        + ` P0=${String(s.p0_w).padEnd(5)} Pk=${s.pk_w}${note}`);
    }

    if (skipExisting.length) console.log(`\n── ĐÃ CÓ, BỎ QUA (${skipExisting.length}): ${skipExisting.join(', ')}`);
    if (noZone.length) {
      console.log(`\n── KHÔNG CÓ KCN TƯƠNG ỨNG (${noZone.length})`);
      for (const x of noZone) console.log(`   ! ${x}`);
    }

    if (needHelp.length) {
      console.log(`\n── CẦN GHÉP TAY (${needHelp.length}) — thêm vào OVERRIDES trong script rồi chạy lại`);
      for (const h of needHelp) {
        console.log(`   ? ${h.raw}   [${h.zone}] tên tắt "${h.wanted}" — ${h.reason}`);
        if (h.candidates.length) for (const c of h.candidates) console.log(`        gợi ý: ${c}`);
        else console.log('        (không tìm được khách hàng nào giống)');
      }
    }

    if (!APPLY) { console.log('\n[DRY-RUN] Không ghi gì. Thêm --apply để ghi thật.'); return; }
    if (!toCreate.length) { console.log('\nKhông có trạm nào để tạo.'); return; }

    console.log('');
    for (const s of toCreate) {
      await api('POST', '/api/collections/dm_station/records', {
        code: s.code, zone: s.zone, customer: s.customer, ident: s.ident,
        sdm_kva: s.sdm_kva, p0_w: s.p0_w, pk_w: s.pk_w,
      });
      console.log(`  ✓ ${s.code}`);
    }
    const after = (await api('GET', '/api/collections/dm_station/records?perPage=1')).totalItems;
    console.log(`\ndm_station: ${stations.length} → ${after} bản ghi.`);
  } finally { cleanup(); }
}

main().catch(e => { console.error(e); process.exit(1); });
