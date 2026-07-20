import { useState } from 'react';
import VoltagePowerDashboard from '../VoltagePowerDashboard';

// ===================================================================
// Đồ thị điện áp & công suất — bản khối Văn phòng.
// Tái dùng VoltagePowerDashboard với bộ chọn KCN ('' = tất cả).
// ===================================================================
export default function OfficeVoltagePowerDashboard() {
  const [zone, setZone] = useState('');
  return <VoltagePowerDashboard zoneFilter={zone} onZoneFilterChange={setZone} />;
}
