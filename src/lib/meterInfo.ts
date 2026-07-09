export interface MeterInfoRow {
  METER_NO: string;
  METER_NAME: string;
  METER_MODEL_DESC: string;
  CUSTOMER_CODE: string;
  CUSTOMER_NAME: string;
  ADDRESS: string;
  LINE_NAME: string;
  LINE_ID: string;
  CODE: string;
  ROLE: string;   // 'chinh' | 'phu'
  STATUS: string;
}

/** Simple CSV line parser supporting quoted fields with commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function fetchMeterInfo(): Promise<MeterInfoRow[]> {
  const res = await fetch('/metterinfo.csv');
  if (!res.ok) throw new Error('Không tải được metterinfo.csv');
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const row: any = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row as MeterInfoRow;
  });
}
