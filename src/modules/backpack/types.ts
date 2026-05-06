// Backpack data model — stored in room metadata under
// `com.obr-suite/backpack/{cardId}`.
export const BACKPACK_KEY_PREFIX = "com.obr-suite/backpack/";

export interface BackpackEntry {
  /** 5etools item name — the natural key in items.json */
  srdName: string;
  /** Display name (redundant, avoids SRD fetch for chip rendering) */
  name: string;
  /** Item type from SRD (e.g. "Potion", "Weapon", "Scroll") for chip coloring */
  type: string;
  /** Quantity */
  qty: number;
}

export interface BackpackData {
  items: BackpackEntry[];
}
