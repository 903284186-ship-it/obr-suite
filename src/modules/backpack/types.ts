export const BACKPACK_KEY_PREFIX = "com.obr-suite/backpack/";

export interface BackpackEntry {
  srdName: string;
  name: string;
  type: string;
  qty: number;
}

export type BackpackData = BackpackEntry[];
