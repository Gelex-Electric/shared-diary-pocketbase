/**
 * Một dòng công tơ theo hình dạng cũ của `metterinfo.csv`. App KHÔNG còn đọc file CSV đó
 * (`fetchMeterInfo` đã xoá 17/11/2026): các dòng này dựng từ Danh mục ở `lib/dm/meterRows.ts`.
 */
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
  ROLE: string;   // 'chinh' | 'phu' | 'dau_nguon'
  STATUS: string;
}
