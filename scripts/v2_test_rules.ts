/**
 * Kiểm thử luật v2 (điểm đo & vật tư). Chạy: `npx tsx scripts/v2_test_rules.ts`
 *
 * Không dùng test runner vì repo chưa có; đủ để mỗi luật có một ca chứng minh.
 * Sửa luật trong `src/lib/v2/rules.ts` thì phải chạy lại file này.
 */
import {
  hsnOf, pointViolations, canHang, canActivate, isLocked,
} from '../src/lib/v2/rules';
import type { V2Asset, V2AssetType, V2AssetStatus } from '../src/lib/v2/schema';

let pass = 0, fail = 0;

function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

let seq = 0;
function mk(type: V2AssetType, o: Partial<V2Asset> = {}): V2Asset {
  seq++;
  const ratio = o.ratio_primary && o.ratio_secondary
    ? o.ratio_primary / o.ratio_secondary : o.ratio;
  return {
    id: `a${seq}`, serial: o.serial ?? `${type}-${seq}`, type,
    current_status: (o.current_status ?? 'kho') as V2AssetStatus,
    ...o, ratio,
  };
}

console.log('R3 — công tơ trực tiếp: HSN = 1, cấm TI/TU');
{
  const me42 = mk('ME42'), gp = mk('GP03');
  check('ME42 + GP-03 → HSN = 1', hsnOf([me42, gp]).value === 1, hsnOf([me42, gp]).explain);
  check('ME42 đủ bộ → không vi phạm', pointViolations('active', [me42, gp]).length === 0);
  const ti = mk('TI', { ratio_primary: 2500, ratio_secondary: 5 });
  check('treo TI lên điểm đo ME42 → bị chặn', canHang(ti, 'active', [me42, gp]).ok === false,
    canHang(ti, 'active', [me42, gp]).reason);
  check('ME42 có sẵn TI → khoá ghi', isLocked('active', [me42, gp, ti]) === true);
}

console.log('R4/R6 — công tơ gián tiếp: bắt buộc TI, HSN = TU × TI');
{
  const me41 = mk('ME41'), gp = mk('GP03');
  check('ME41 chưa có TI → HSN chưa suy ra được', hsnOf([me41, gp]).value === null);
  check('ME41 chưa có TI → không cho vận hành', canActivate([me41, gp]).ok === false,
    canActivate([me41, gp]).reason);
  check('ME41 chưa có TI là mức "thiếu", không khoá ghi', isLocked('active', [me41, gp]) === false);

  const ti = () => mk('TI', { ratio_primary: 2500, ratio_secondary: 5 });
  const bo3 = [ti(), ti(), ti()];
  check('R5 — bộ 3 TI 2500/5 → HSN = 500 (không phải 500³)',
    hsnOf([me41, gp, ...bo3]).value === 500, hsnOf([me41, gp, ...bo3]).explain);
  check('R6 — không có TU → HSN = tỷ số TI', hsnOf([me41, ...bo3]).value === 500);
  check('ME41 đủ bộ → cho vận hành', canActivate([me41, gp, ...bo3]).ok === true,
    canActivate([me41, gp, ...bo3]).reason);

  const tu = mk('TU', { ratio_primary: 22000, ratio_secondary: 100 });
  const r = hsnOf([me41, gp, ...bo3, tu]);
  check('TU 22000/100 × TI 2500/5 = 110000', r.value === 110000, r.explain);

  const tiLech = mk('TI', { ratio_primary: 2000, ratio_secondary: 5 });
  check('TI lẫn tỷ số → bị chặn khi treo', canHang(tiLech, 'active', [me41, gp, ...bo3]).ok === false,
    canHang(tiLech, 'active', [me41, gp, ...bo3]).reason);
  check('TI lẫn tỷ số → HSN không đoán bừa', hsnOf([me41, gp, ...bo3, tiLech]).value === null);

  const tiTrong = mk('TI');
  check('TI chưa khai tỷ số → khoá ghi', isLocked('active', [me41, gp, tiTrong]) === true);
}

console.log('R1/R2 — đúng 1 công tơ và 1 GP-03');
{
  const me41 = mk('ME41'), gp = mk('GP03');
  check('treo công tơ thứ 2 → bị chặn', canHang(mk('ME42'), 'active', [me41, gp]).ok === false,
    canHang(mk('ME42'), 'active', [me41, gp]).reason);
  check('treo GP-03 thứ 2 → bị chặn', canHang(mk('GP03'), 'active', [me41, gp]).ok === false,
    canHang(mk('GP03'), 'active', [me41, gp]).reason);
  check('điểm đo trống → thiếu công tơ và GP-03',
    pointViolations('active', []).filter(v => v.level === 'thieu').length === 2);
  check('điểm đo dự kiến → không đòi thiết bị', pointViolations('du_kien', []).length === 0);
  check('treo cái đầu tiên lên điểm đo trống → cho phép', canHang(mk('ME41'), 'chua_van_hanh', []).ok === true);
}

console.log('R7 — quá hạn kiểm định');
{
  const cu = mk('TI', { ratio_primary: 2500, ratio_secondary: 5, next_calibration: '2020-01-01' });
  check('vật tư quá hạn → không treo được', canHang(cu, 'active', []).ok === false,
    canHang(cu, 'active', []).reason);
  const me41 = mk('ME41', { current_status: 'dang_treo' });
  check('quá hạn mà đang treo → khoá ghi', isLocked('active', [me41, cu]) === true);
  const gp = mk('GP03', { next_calibration: '2020-01-01' });
  check('GP-03 không kiểm định → hạn cũ vô hại', canHang(gp, 'active', []).ok === true);
}

console.log('Trạng thái vật tư');
{
  check('vật tư đang treo nơi khác → không treo được',
    canHang(mk('GP03', { current_status: 'dang_treo' }), 'active', []).ok === false);
  check('vật tư kiểm định đạt → treo được',
    canHang(mk('GP03', { current_status: 'dat' }), 'active', []).ok === true);
  check('điểm đo đã tháo → không nhận vật tư',
    canHang(mk('GP03'), 'dismounted', []).ok === false);
}

console.log(`\n${pass} đạt, ${fail} hỏng`);
process.exit(fail ? 1 : 0);
