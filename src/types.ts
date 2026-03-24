export interface Situation {
  time: string;
  content: string;
}

export interface Handover {
  id: string;
  created: string;
  updated: string;
  date: string;
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
