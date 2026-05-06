import { getState } from "../../state";

const CACHE_KEY = "obr-suite/backpack-item-index";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const DEFAULT_BASE = "https://5e.kiwee.top";

interface IndexEntry {
  n: string;
  c: number;
  u: string;
  s?: number | string;
  p?: number;
}

interface IndexFile {
  x: IndexEntry[];
}

export interface ItemResult {
  name: string;
  source: string;
}

function getBases(): string[] {
  try {
    const libs = getState().libraries || [];
    const bases = libs
      .filter((l) => l.enabled && l.baseUrl)
      .map((l) => l.baseUrl.replace(/\/+$/, ""));
    return bases.length > 0 ? bases : [DEFAULT_BASE];
  } catch {
    return [DEFAULT_BASE];
  }
}

async function loadItemIndex(): Promise<Map<string, ItemResult>> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Array.isArray(data) && Date.now() - ts < CACHE_TTL) {
        return new Map(data);
      }
    }
  } catch {}

  const bases = getBases();
  const allItems = new Map<string, ItemResult>();

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/search/index.json`, { cache: "no-cache" });
      if (!res.ok) continue;
      const idx: IndexFile = await res.json();
      if (!Array.isArray(idx.x)) continue;
      for (const entry of idx.x) {
        if (entry.c !== 4) continue;
        if (!entry.n || allItems.has(entry.n)) continue;
        allItems.set(entry.n, {
          name: entry.n,
          source: typeof entry.s === "string" ? entry.s : String(entry.s ?? ""),
        });
      }
    } catch {}
  }

  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data: [...allItems] }),
    );
  } catch {}

  return allItems;
}

let indexPromise: Promise<Map<string, ItemResult>> | null = null;

export function getItemIndex(): Promise<Map<string, ItemResult>> {
  if (!indexPromise) {
    indexPromise = loadItemIndex();
  }
  return indexPromise;
}

export function searchItems(
  index: Map<string, ItemResult>,
  query: string,
  maxResults = 20,
): ItemResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: ItemResult[] = [];
  for (const [name, item] of index) {
    if (name.toLowerCase().includes(q)) {
      results.push(item);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

export function itemTypeToCssClass(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("potion") || t.includes("poison")) return "cat-potion";
  if (t.includes("scroll") || t.includes("wondrous") || t.includes("rod")
    || t.includes("wand") || t.includes("ring")) return "cat-scroll";
  if (t.includes("tool") || t.includes("gear") || t.includes("kit")
    || t.includes("ammunition")) return "cat-gear";
  if (t.includes("weapon") || t.includes("armor") || t.includes("shield")) return "cat-weapon";
  return "cat-other";
}
