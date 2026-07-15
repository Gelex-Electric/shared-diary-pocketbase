export interface Situation {
  time: string;
  content: string;
}

export interface Handover {
  id: string;
  created: string;
  updated: string;
  startdate: string;
  enddate: string;
  area: string;
  shift: string;
  main_duty: string;
  sub_duty: string;
  main_power: string;
  sub_power: string;
  notes: string;
  equipment: string;
  opinions: string;
  situations: Situation[];
  type_shift: string[];
}

export interface ElectricShift {
  id: string;
  IDnum: number;
  Name: string;
  area: string;
  created: string;
  updated: string;
}

export interface Customer {
  id: string;
  Name: string;
  MKH: string;
  area: string;
  email?: string;
  created: string;
  updated: string;
}

export interface Meter {
  id: string;
  MeterNo: string;
  HSN: string;
  Type: string;
  CreatedHES: string;
  Line: string;
  Customer: string; // ID of Customer
  area: string;
  Activate: boolean;
  created: string;
  updated: string;
  expand?: {
    Customer?: Customer;
  };
}

export interface AccountHes {
  id: string;
  Account: string;
  Password: string;
  Token: string;
  area: string;
  HesID: number;
  created: string;
  updated: string;
}

export interface HesReading {
  id: string;
  meterNo: string;
  date: string;
  pg: string;
  bt: string;
  cd: string;
  td: string;
  vc: string;
  area: string;
  created: string;
  updated: string;
}

export interface OutageCustomer {
  id: string;
  MKH: string;
  Name: string;
}

export interface OutageSlot {
  startTime: string;      // 'YYYY-MM-DD HH:mm:ss'
  endTime: string;
  scope: string;
  appendixIndex: number;  // index vào appendices[]
  area?: string;          // Khu vực/địa chỉ hiển thị ở cột "Khu vực" (nhập tay, mặc định theo KCN)
}

export interface OutageAppendix {
  customers: OutageCustomer[];
}

export interface PowerOutage {
  id: string;
  noticeDate: string;       // text "Ngày D tháng M năm YYYY"
  type: 'emergency' | 'planned';
  area: string;
  reason: string;
  addLegal?: string;
  slots: OutageSlot[];       // khung giờ ngừng điện
  appendices: OutageAppendix[]; // danh sách phụ lục (nhóm khách hàng)
  created: string;
  updated: string;
}

export interface NewUpdate {
  id: string;
  area: string;
  status: boolean;
  created: string;
  updated: string;
}

export interface DataMetter {
  id?: string;
  METER_NO: string;
  DATE_TIME: string;
  ACTIVE_KW_INDICATE_TOTAL: string;    // API trả về string "2006.970"
  ACTIVE_KW_INDICATE_RATE1: string;
  ACTIVE_KW_INDICATE_RATE2: string;
  ACTIVE_KW_INDICATE_RATE3: string;
  REACTIVE_KVAR_INDICATE_TOTAL: string;
}

export interface HesItem {
  METER_NO: string;
  METER_NAME: string;
  METER_MODEL_DESC: string;
  CUSTOMER_CODE: string;
  CUSTOMER_NAME: string;
  ADDRESS: string;
  PHONE: string;
  EMAIL: string;
  CREATED: string;
  LINE_NAME: string;
  COORDINATE: string | null;
  LINE_ID: string | null;
  METER_MODEL_ID: string | null;
  // sync metadata
  isDuplicate?: boolean;
  syncStatus?: 'new' | 'update' | 'unchanged';
  existingMeterId?: string;
  existingCustomerId?: string;
}
