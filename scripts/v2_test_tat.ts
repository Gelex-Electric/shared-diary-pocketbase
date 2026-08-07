import { normalizeTat, isValidTat, suggestStationCode } from '../src/lib/v2/whWrite';
const ca: Array<[string, string]> = [
  ['Văn phòng KCN', 'VANPHONGKCN'],
  ['NHỰA VIỆT LONG', 'NHUAVIETLONG'],
  ['V-GREEN', 'VGREEN'],
  ['ĐÔNG DƯƠNG', 'DONGDUONG'],
  ['NHÔM VIỆT PHÁP', 'NHOMVIETPHAP'],
  ['ECOLAND', 'ECOLAND'],
];
let fail = 0;
for (const [vao, mong] of ca) {
  const ra = normalizeTat(vao);
  const ok = ra === mong;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} normalizeTat("${vao}") = "${ra}"${ok ? '' : ` (mong "${mong}")`}`);
}
console.log(`${isValidTat('ECOLAND') === true ? 'ok  ' : 'FAIL'} ECOLAND hop le`);
console.log(`${isValidTat('V-GREEN') === false ? 'ok  ' : 'FAIL'} V-GREEN khong hop le`);
console.log(`${isValidTat('Văn phòng') === false ? 'ok  ' : 'FAIL'} "Văn phòng" khong hop le`);
const ma = suggestStationCode({ zoneShort: 'TH', tat: 'ECOLAND', dinhDanh: 'T1', kva: 400 });
console.log(`${ma === 'TH.ECOLANDT1.400KVA' ? 'ok  ' : 'FAIL'} ma tram = ${ma}`);
const ma2 = suggestStationCode({ zoneShort: 'TTI', tat: 'NHỰA VIỆT LONG', dinhDanh: 'T2', kva: 1000 });
console.log(`${ma2 === 'TTI.NHUAVIETLONGT2.1000KVA' ? 'ok  ' : 'FAIL'} ma tram (ten tat con dau) = ${ma2}`);
process.exit(fail ? 1 : 0);
