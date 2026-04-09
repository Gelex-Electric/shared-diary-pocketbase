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
  isDuplicate?: boolean;
}
