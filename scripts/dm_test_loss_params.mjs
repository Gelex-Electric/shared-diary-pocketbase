/**
 * Bộ kiểm thử `scripts/lib/lossParams.mjs` — chạy: node scripts/dm_test_loss_params.mjs
 *
 * Module thuần nên test không cần mạng, không cần PocketBase. Chạy trước mỗi
 * lần commit: đây là chỗ quyết định trạm nào vào bảng tổn thất và con số P0/Pk
 * nào được dùng, sai ở đây thì mọi số phía sau sai theo.
 */
import {
  estimateLossParams, isLossParamSample, resolveLossParams,
  SKIP_KHONG_CO_MAU, SKIP_THIEU_THONG_SO, SKIP_TRUNG_THE,
} from './lib/lossParams.mjs';

let pass = 0, fail = 0;
const eq = (ten, thuc, mong) => {
  const a = JSON.stringify(thuc), b = JSON.stringify(mong);
  if (a === b) { pass++; console.log(`  ok   ${ten}`); }
  else { fail++; console.log(`  SAI  ${ten}\n       nhận : ${a}\n       mong : ${b}`); }
};

/* Ba trạm 2500 kVA có số thật, một trạm 2500 kVA bật cờ tự động (không được làm
   mẫu), một trạm 1250 kVA, một trạm trung thế có số thật. */
const stations = [
  { code: 'A.2500', sdm_kva: 2500, p0_w: 2000, pk_w: 16000 },
  { code: 'B.2500', sdm_kva: 2500, p0_w: 2400, pk_w: 17000 },
  { code: 'C.2500', sdm_kva: 2500, p0_w: 2200, pk_w: 18000 },
  { code: 'D.2500', sdm_kva: 2500, auto_loss_param: true },
  { code: 'E.1250', sdm_kva: 1250, p0_w: 1400, pk_w: 11000 },
  { code: 'F.2500.TT', sdm_kva: 2500, p0_w: 2100, pk_w: 15000, mv_metering: true },
  { code: 'G.560', sdm_kva: 560, p0_w: '', pk_w: '' },
];

console.log('\nisLossParamSample');
eq('trạm có đủ số thật → là mẫu', isLossParamSample(stations[0]), true);
eq('trạm bật cờ tự động → KHÔNG làm mẫu', isLossParamSample(stations[3]), false);
eq('trạm trung thế vẫn là mẫu (nhãn máy là thật)', isLossParamSample(stations[5]), true);
eq('trạm để trống P0/Pk → không phải mẫu', isLossParamSample(stations[6]), false);

console.log('\nestimateLossParams');
/* 4 mẫu 2500 kVA: A, B, C và F (trung thế nhưng có số thật).
   P0 = (2000+2400+2200+2100)/4 = 2175 ; Pk = (16000+17000+18000+15000)/4 = 16500 */
eq('trung bình đúng 4 mẫu cùng 2500 kVA',
  estimateLossParams(stations, 2500),
  { p0_w: 2175, pk_w: 16500, samples: 4, codes: ['A.2500', 'B.2500', 'C.2500', 'F.2500.TT'] });
eq('công suất chỉ có 1 mẫu → chính nó',
  estimateLossParams(stations, 1250),
  { p0_w: 1400, pk_w: 11000, samples: 1, codes: ['E.1250'] });
eq('công suất không có mẫu nào → null', estimateLossParams(stations, 560), null);
eq('công suất lạ → null', estimateLossParams(stations, 99999), null);
eq('sdm rỗng → null', estimateLossParams(stations, ''), null);

console.log('\nresolveLossParams');
eq('trung thế → bỏ, lý do TRUNG_THE',
  resolveLossParams(stations[5], stations), { ok: false, reason: SKIP_TRUNG_THE });
eq('có số thật → dùng số nhãn',
  resolveLossParams(stations[0], stations),
  { ok: true, sdmKva: 2500, p0W: 2000, pkW: 16000, src: 'nhan' });
eq('bật tự động, có mẫu → ước lượng',
  resolveLossParams(stations[3], stations),
  { ok: true, sdmKva: 2500, p0W: 2175, pkW: 16500, src: 'uoc_luong', samples: 4,
    codes: ['A.2500', 'B.2500', 'C.2500', 'F.2500.TT'] });
eq('bật tự động, không mẫu → KHONG_CO_MAU_CUNG_CONG_SUAT',
  resolveLossParams({ code: 'H.560', sdm_kva: 560, auto_loss_param: true }, stations),
  { ok: false, reason: SKIP_KHONG_CO_MAU, detail: 'không trạm nào 560 kVA có P0/Pk thật' });
eq('thiếu P0 → THIEU_THONG_SO kèm tên trường',
  resolveLossParams({ code: 'I', sdm_kva: 800, pk_w: 6000 }, stations),
  { ok: false, reason: SKIP_THIEU_THONG_SO, detail: 'chưa khai p0_w' });
eq('thiếu cả hai → nêu cả hai',
  resolveLossParams(stations[6], stations),
  { ok: false, reason: SKIP_THIEU_THONG_SO, detail: 'chưa khai p0_w, pk_w' });
eq('chưa khai Sdm → THIEU_THONG_SO',
  resolveLossParams({ code: 'J', p0_w: 100, pk_w: 900 }, stations),
  { ok: false, reason: SKIP_THIEU_THONG_SO, detail: 'chưa khai sdm_kva' });
eq('trung thế được xét TRƯỚC cả khi thiếu số',
  resolveLossParams({ code: 'K', mv_metering: true }, stations),
  { ok: false, reason: SKIP_TRUNG_THE });
eq('p0 = 0 coi như chưa khai, không phải 0 W',
  resolveLossParams({ code: 'L', sdm_kva: 400, p0_w: 0, pk_w: 3000 }, stations),
  { ok: false, reason: SKIP_THIEU_THONG_SO, detail: 'chưa khai p0_w' });

console.log(`\n${pass} ok · ${fail} sai\n`);
process.exit(fail ? 1 : 0);
