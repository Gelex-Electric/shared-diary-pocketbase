/**
 * Bộ kiểm thử đọc nhãn GELEX/EMIC — chạy: npx tsx scripts/dm_test_plate.ts
 * Chữ OCR là chữ THẬT Tesseract (vie+eng) đọc từ 6 ảnh user gửi 27/10/2026.
 */
import { fixDigits, parsePlate, serialFromDigitPass, serialIn, typeFromSerial } from '../src/lib/dm/plateParse';

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n     mong đợi: ${b}\n     nhận được: ${a}`);
}
const L = (s: string) => s.split('⏎').map(text => ({ text: text.trim() })).filter(l => l.text);

/* -------------------------------------------------------------- hàm nhỏ */
eq(fixDigits('26I0O26964'), '2610026964', 'fixDigits: I→1, O→0');
eq(serialIn('Số: 2 6 1 0 5 6 3 8 5 3'), '2610563853', 'serialIn: chữ số giãn cách');
eq(serialIn('IEC 61869-1,2'), '', 'serialIn: không nhận số chuẩn IEC');
eq(['2610026964', '2620014915', '2542200533', '869914061460764', '8984048000959435062', '123'].map(typeFromSerial),
   ['CONGTO', 'TI', 'GP03', 'GP03', 'SIM', ''], 'typeFromSerial: chữ số thứ 3 / độ dài');
eq(serialFromDigitPass('2610563853\n', 'CONGTO'), '2610563853', 'bước 2: dòng chỉ chữ số');

/* ------------------------------------------------- chữ OCR thật 27/10 */
const ti1 = parsePlate(L('^ Gấp 0,5] Icth.th: 2400A:25 “=~ “i ⏎ — il LY | ⏎ on. IIIIIIIIIIIII Of © ⏎ > | PDM 030-2007 | Số: 2620014915 45% ⏎ < Sản xuất ta Công ty Cỏ phảï\' Điện lýŒGELEX W:=i |'));
eq([ti1.serial, ti1.type], ['2620014915', 'TI'], 'TI ảnh 1: số No + loại theo chữ số thứ 3');

const ti2 = parsePlate(L('2EVPXEMIC BIẾN DONG HẠ THÉ- CT0.6 | ⏎ NS: 15VA |Cấp 0,5| lcth-Ith: 2400A-25kAVs | Scr ⏎ 20527 HII ẤN. ⏎ [Pom 030-2007 | Số: 2520177362 op'));
eq([ti2.serial, ti2.type, ti2.model], ['2520177362', 'TI', 'CT0.6'], 'TI ảnh 2: BIẾN DONG ⇒ TI');

const ti3 = parsePlate(L('xi ⏎ | GEIB{EMIC BIẾN DONG HẠ THE- CT0.6 ⏎ Tỷ số: 2000/5A[0,72/3kV]50Hz| 2028.45, ⏎ @ 59A Cấp 0| Ictholth; 2400A-25 425 a ⏎ 0 + NZ, A. | ⏎ ˆ \'Ecosseszz#-TJ[JJIIIIIIIIIÏ\\= -/ ⏎ 62959552007 | Sb: 2620014912" | ⏎ | Sản xuất tal Công ty Cổ phần Điện lực GELEX "W:=1'));
eq([ti3.serial, ti3.type, ti3.ratio], ['2620014912', 'TI', { primary: 2000, secondary: 5 }], 'TI ảnh 3: số No + tỷ số 2000/5');

const ct41 = parsePlate(L('KIỀU:ME-41 272/00 dirs 290-270 ⏎ LẠ X Ôang vuy cp “Á Sø thợ vợ pha ⏎ EC 6Z052.11 AL thon gan & Tứ vường ng ⏎ Số ⏎ ney] = 2610026984'));
eq([ct41.type, ct41.meterKind, ct41.model], ['CONGTO', 'gian_tiep', 'ME-41'], 'Công tơ ME-41 ⇒ gián tiếp');
eq(ct41.serialLine !== undefined, true, 'Công tơ: tìm được dòng số để OCR lại bước 2');

const gp = parsePlate(L('GELEXEMIc MODEM GPRS/3G/4G ⏎ GP-03 ._, ⏎ ie “oJ RHINO LHF ⏎ ICT 2542200533 ⏎ Sản xuất tại: Công ty Cỏ phần Điện lực GELEX-Việt Nam'));
eq([gp.serial, gp.type, gp.model], ['2542200533', 'GP03', 'GP-03'], 'GP-03: số No + loại');

const ct42 = parsePlate(L('KIỂU: ME-42 3x220/380V; 3x230/400V ⏎ Số sx: 2 6 1 0 5 6 3 8 5 3 ⏎ Sản xuất tại: Công ty cổ phần Điện lực GELEX-Việt Nam-2026'));
eq([ct42.serial, ct42.type, ct42.meterKind, ct42.year], ['2610563853', 'CONGTO', 'truc_tiep', 2026], 'Công tơ ME-42 ⇒ trực tiếp + năm');

if (fails.length) {
  console.error(`✗ ${fails.length} ca đỏ / ${pass + fails.length}`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} ca xanh`);
