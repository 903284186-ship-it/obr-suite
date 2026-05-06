# Backpack/Item System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible backpack section to the character card info panel with item chips, add/remove/transfer of SRD items stored in room metadata.

**Architecture:** Two new files (`src/modules/backpack/types.ts`, `src/modules/backpack/index.ts`) for data types and room-metadata read/write. Modify `info-page.ts` to render the backpack UI and handle interactions. Modify `cc-info.html` for backpack CSS. No new HTML entry, no new module registration in background/state — backpack is a sub-feature of the character card panel.

**Tech Stack:** TypeScript, OBR SDK v3.1.0, 5etools Chinese mirror (5e.kiwee.top)

---

### Task 1: Backpack data types

**Files:**
- Create: `src/modules/backpack/types.ts`

- [ ] **Step 1: Write types file**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/backpack/types.ts
git commit -m "feat: add backpack data types"
```

---

### Task 2: Backpack data read/write functions

**Files:**
- Create: `src/modules/backpack/index.ts`

- [ ] **Step 1: Write data access functions**

```ts
import OBR from "@owlbear-rodeo/sdk";
import { BACKPACK_KEY_PREFIX, BackpackData, BackpackEntry } from "./types";

export function backpackKey(cardId: string): string {
  return `${BACKPACK_KEY_PREFIX}${cardId}`;
}

export async function readBackpack(cardId: string): Promise<BackpackData> {
  try {
    const meta = await OBR.room.getMetadata();
    const raw = meta[backpackKey(cardId)];
    if (raw && typeof raw === "object" && Array.isArray((raw as any).items)) {
      return raw as BackpackData;
    }
  } catch {}
  return { items: [] };
}

export async function writeBackpack(cardId: string, data: BackpackData): Promise<void> {
  try {
    await OBR.room.setMetadata({ [backpackKey(cardId)]: data });
  } catch (e) {
    console.warn("[backpack] writeBackpack failed", e);
  }
}

export async function addItem(cardId: string, entry: BackpackEntry): Promise<BackpackData> {
  const bp = await readBackpack(cardId);
  const existing = bp.items.find((i) => i.srdName === entry.srdName);
  if (existing) {
    existing.qty += entry.qty;
  } else {
    bp.items.push(entry);
  }
  await writeBackpack(cardId, bp);
  return bp;
}

export async function removeItem(cardId: string, srdName: string, qty?: number): Promise<BackpackData> {
  const bp = await readBackpack(cardId);
  const idx = bp.items.findIndex((i) => i.srdName === srdName);
  if (idx === -1) return bp;
  if (qty == null || bp.items[idx].qty <= qty) {
    bp.items.splice(idx, 1);
  } else {
    bp.items[idx].qty -= qty;
  }
  await writeBackpack(cardId, bp);
  return bp;
}

export async function transferItem(
  fromCardId: string,
  toCardId: string,
  srdName: string,
  qty?: number,
): Promise<{ from: BackpackData; to: BackpackData }> {
  const [fromBp, toBp] = await Promise.all([
    readBackpack(fromCardId),
    readBackpack(toCardId),
  ]);
  const srcIdx = fromBp.items.findIndex((i) => i.srdName === srdName);
  if (srcIdx === -1) return { from: fromBp, to: toBp };
  const srcItem = fromBp.items[srcIdx];
  const transferQty = qty == null || srcItem.qty <= qty ? srcItem.qty : qty;

  if (srcItem.qty <= transferQty) {
    fromBp.items.splice(srcIdx, 1);
  } else {
    srcItem.qty -= transferQty;
  }

  const dstItem = toBp.items.find((i) => i.srdName === srdName);
  if (dstItem) {
    dstItem.qty += transferQty;
  } else {
    toBp.items.push({ ...srcItem, qty: transferQty });
  }

  await Promise.all([
    writeBackpack(fromCardId, fromBp),
    writeBackpack(toCardId, toBp),
  ]);
  return { from: fromBp, to: toBp };
}

// Permission check: DM can manage all, players only their own card
export async function canManageBackpack(cardId: string): Promise<boolean> {
  try {
    const role = await OBR.player.getRole();
    if (role === "GM") return true;
    // Player: check if any selected token is bound to this cardId
    const sel = await OBR.player.getSelection();
    if (!sel || sel.length === 0) return false;
    const items = await OBR.scene.items.getItems(sel);
    return items.some(
      (it) => (it as any).metadata?.["com.character-cards/boundCardId"] === cardId,
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/backpack/index.ts
git commit -m "feat: add backpack data read/write with room metadata"
```

---

### Task 3: Backpack CSS

**Files:**
- Modify: `cc-info.html`

- [ ] **Step 1: Add backpack CSS after the `.srch-chip` styles (before `</style>`)**

```css
/* === Backpack section ==========================================
   Collapsible item grid at the bottom of the card. */
.bp-sect{margin-top:6px}
.bp-head{
  display:flex;align-items:center;justify-content:space-between;
  font-size:9.5px;font-weight:700;color:#9ab;
  letter-spacing:0.5px;
  padding:2px 6px;
  background:rgba(255,255,255,0.04);
  border-left:2px solid rgba(93,173,226,0.55);
  border-radius:0 4px 4px 0;
  margin-bottom:3px;
  cursor:pointer;
  user-select:none;
}
.bp-head .bp-count{color:#888;font-weight:400;margin-left:4px}
.bp-head .bp-toggle{margin-left:auto;font-size:8px;color:#888;padding:0 2px}
.bp-head .bp-add{
  margin-left:6px;font-size:14px;color:#5dade2;cursor:pointer;
  padding:0 4px;line-height:1;
  transition:color .12s;
}
.bp-head .bp-add:hover{color:#8ecaf5}
.bp-grid{
  display:flex;flex-wrap:wrap;gap:3px;
  padding:0 2px;
}
.bp-chip{
  display:inline-block;
  padding:1px 6px;
  font-size:10px;line-height:1.4;font-weight:600;
  border-radius:3px;
  border-left:2px solid transparent;
  cursor:pointer;
  white-space:nowrap;
  max-width:160px;
  overflow:hidden;text-overflow:ellipsis;
  transition:background .12s, color .12s, transform .08s;
}
.bp-chip:hover{filter:brightness(1.2)}
.bp-chip:active{transform:scale(0.96)}
/* Category colors (border-left + tinted background) */
.bp-chip.cat-potion{background:rgba(78,205,196,0.10);border-left-color:#4ecdc4;color:#8ee4de}
.bp-chip.cat-scroll{background:rgba(253,203,110,0.10);border-left-color:#fdcb6e;color:#fde2a8}
.bp-chip.cat-gear{background:rgba(162,155,254,0.10);border-left-color:#a29bfe;color:#c8c3ff}
.bp-chip.cat-weapon{background:rgba(231,76,60,0.10);border-left-color:#e74c3c;color:#f09088}
.bp-chip.cat-other{background:rgba(255,255,255,0.06);border-left-color:#888;color:#aaa}

/* Inline add-item search */
.bp-search{
  display:flex;flex-direction:column;gap:3px;
  padding:4px 2px;margin-top:2px;
}
.bp-search .bp-search-input{
  width:100%;box-sizing:border-box;
  background:rgba(255,255,255,0.06);
  border:1px solid rgba(93,173,226,0.35);
  border-radius:4px;
  padding:3px 6px;font-size:10px;color:#eee;
  outline:none;font-family:inherit;
}
.bp-search .bp-search-input:focus{border-color:rgba(93,173,226,0.7)}
.bp-search .bp-results{
  max-height:140px;overflow-y:auto;
  display:flex;flex-direction:column;gap:1px;
}
.bp-search .bp-result{
  padding:3px 6px;font-size:10px;color:#ccc;
  background:rgba(255,255,255,0.03);
  border-radius:3px;cursor:pointer;
  display:flex;align-items:center;justify-content:space-between;
}
.bp-search .bp-result:hover{background:rgba(93,173,226,0.18);color:#fff}
.bp-search .bp-result .bp-r-type{font-size:8px;color:#888;margin-left:6px;flex-shrink:0}

/* Transfer target list */
.bp-transfer-list{
  display:flex;flex-direction:column;gap:3px;
  padding:6px 2px;
}
.bp-transfer-list .bp-transfer-opt{
  padding:4px 8px;font-size:10px;color:#ccc;
  background:rgba(255,255,255,0.04);
  border-radius:4px;cursor:pointer;
  display:flex;align-items:center;gap:6px;
}
.bp-transfer-list .bp-transfer-opt:hover{background:rgba(93,173,226,0.18);color:#fff}
.bp-transfer-cancel{font-size:9px;color:#888;cursor:pointer;padding:2px 6px;margin-top:2px}
.bp-transfer-cancel:hover{color:#ccc}
```

- [ ] **Step 2: Commit**

```bash
git add cc-info.html
git commit -m "feat: add backpack CSS styles"
```

---

### Task 4: Item search helper (fetch from 5etools items index)

**Files:**
- Create: `src/modules/backpack/itemSearch.ts`

- [ ] **Step 1: Write item search using existing search index**

```ts
// Lightweight item search — loads the 5etools search index and filters
// to item category (c=4) entries. Used by the backpack's inline add-item
// search input. Reuses the same index fetch pattern as search/page.ts.

import { getState } from "../../state";

const CACHE_KEY = "obr-suite/backpack-item-index";
const CACHE_TTL = 24 * 60 * 60 * 1000;
const DEFAULT_BASE = "https://5e.kiwee.top";

interface IndexEntry {
  n: string;   // name
  c: number;   // category
  u: string;   // url
  s?: number | string;  // source
  p?: number;  // page
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

// Fetches and caches the merged search index, then extracts only
// category-4 (item) entries into a lightweight {name, source} map.
async function loadItemIndex(): Promise<Map<string, ItemResult>> {
  // Check cache
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
        // Category 4 = items (per 5etools convention)
        if (entry.c !== 4) continue;
        if (!entry.n || allItems.has(entry.n)) continue;
        allItems.set(entry.n, {
          name: entry.n,
          source: typeof entry.s === "string" ? entry.s : String(entry.s ?? ""),
        });
      }
    } catch {}
  }

  // Cache in sessionStorage
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

// Map SRD item type string to backpack chip CSS class
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/backpack/itemSearch.ts
git commit -m "feat: add item search from 5etools index"
```

---

### Task 5: Backpack UI in info-page.ts (core integration)

**Files:**
- Modify: `src/modules/characterCards/info-page.ts`

This is the main task — integrate backpack section into the character card info panel.

- [ ] **Step 1: Add imports**

After the existing import block (after line 14), add:

```ts
import {
  readBackpack,
  writeBackpack,
  addItem,
  removeItem,
  transferItem,
  canManageBackpack,
} from "../backpack/index";
import type { BackpackData, BackpackEntry } from "../backpack/types";
import {
  getItemIndex,
  searchItems,
  itemTypeToCssClass,
} from "../backpack/itemSearch";
import { getState } from "../../state";
```

- [ ] **Step 2: Add backpack state variables**

After `let currentCardId: string | null = null;` (~line 121), add:

```ts
let currentBackpack: BackpackData = { items: [] };
let backpackExpanded = true;
let showItemSearch = false;
let showTransferList = false;
let transferItemName: string | null = null;
let transferCandidates: Array<{ cardId: string; tokenId: string; name: string }> = [];
```

- [ ] **Step 3: Add renderBackpackHTML function**

Add this function before `render()` (before `function render(d: any, ...)`):

```ts
function renderBackpackHTML(): string {
  const n = currentBackpack.items.reduce((sum, i) => sum + i.qty, 0);
  const toggleIcon = backpackExpanded ? "▼" : "▶";

  let body = "";
  if (showItemSearch) {
    body = `<div class="bp-search">
      <input class="bp-search-input" id="bp-search-input" type="text" placeholder="搜索 SRD 装备...">
      <div class="bp-results" id="bp-results"></div>
    </div>`;
  } else if (showTransferList && transferItemName) {
    const opts = transferCandidates.length > 0
      ? transferCandidates.map((c) =>
          `<div class="bp-transfer-opt" data-card="${escapeHtml(c.cardId)}">${escapeHtml(c.name)}</div>`
        ).join("")
      : `<div class="empty">没有可转移的角色</div>`;
    body = `<div class="bp-transfer-list" id="bp-transfer-list">
      ${opts}
      <div class="bp-transfer-cancel" id="bp-transfer-cancel">取消</div>
    </div>`;
  } else if (backpackExpanded && currentBackpack.items.length > 0) {
    const chips = currentBackpack.items.map((entry, i) => {
      const cls = itemTypeToCssClass(entry.type);
      const label = entry.qty > 1 ? `${escapeHtml(entry.name)} ×${entry.qty}` : escapeHtml(entry.name);
      return `<span class="bp-chip ${cls}" data-idx="${i}" title="${escapeHtml(entry.name)}">${label}</span>`;
    }).join("");
    body = `<div class="bp-grid">${chips}</div>`;
  } else if (backpackExpanded && currentBackpack.items.length === 0) {
    body = `<div class="empty" style="padding:2px 6px;font-size:10px;">空</div>`;
  }

  return `<div class="bp-sect">
    <div class="bp-head" id="bp-head">
      <span>🎒 背包<span class="bp-count">(${n})</span></span>
      <span class="bp-toggle">${toggleIcon}</span>
      <span class="bp-add" id="bp-add" title="添加道具">＋</span>
    </div>
    ${body}
  </div>`;
}
```

- [ ] **Step 4: Add backpack HTML to the render() template**

In `render()`, add `const bpHtml = renderBackpackHTML();` right before the `root.innerHTML = ...` line. Then append `${bpHtml}` after `${featuresHtml}` in the template string.

- [ ] **Step 5: Wire backpack interactions**

Define these functions AFTER `render()` and AFTER `bindStatRowInputs()`:

```ts
async function loadTransferCandidates(excludeCardId: string): Promise<void> {
  transferCandidates = [];
  try {
    const items = await OBR.scene.items.getItems();
    for (const it of items) {
      const cardId = (it as any).metadata?.["com.character-cards/boundCardId"];
      if (typeof cardId === "string" && cardId !== excludeCardId) {
        transferCandidates.push({
          cardId,
          tokenId: it.id,
          name: (it as any).text?.plainText ?? (it as any).text ?? it.id,
        });
      }
    }
  } catch {}
}

let currentBpCleanup: (() => void) | null = null;

function bindBackpackInteractions(): void {
  // Cleanup previous listeners (DOM elements are recreated on each render())
  if (currentBpCleanup) currentBpCleanup();
  const cleanups: Array<() => void> = [];

  const head = document.getElementById("bp-head");
  const addBtn = document.getElementById("bp-add");
  const searchInput = document.getElementById("bp-search-input") as HTMLInputElement | null;
  const resultsEl = document.getElementById("bp-results");
  const transferList = document.getElementById("bp-transfer-list");
  const transferCancel = document.getElementById("bp-transfer-cancel");

  // Collapse/expand toggle
  if (head) {
    const onHeadClick = async (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest("#bp-add")) return;
      backpackExpanded = !backpackExpanded;
      showItemSearch = false;
      showTransferList = false;
      if (currentCardId) doRerender();
    };
    head.addEventListener("click", onHeadClick);
    cleanups.push(() => head.removeEventListener("click", onHeadClick));
  }

  // Add item button
  if (addBtn) {
    const onAddClick = async (e: Event) => {
      e.stopPropagation();
      showItemSearch = !showItemSearch;
      showTransferList = false;
      if (currentCardId) {
        doRerender();
        if (showItemSearch) {
          requestAnimationFrame(() => {
            document.getElementById("bp-search-input")?.focus();
          });
        }
      }
    };
    addBtn.addEventListener("click", onAddClick);
    cleanups.push(() => addBtn.removeEventListener("click", onAddClick));
  }

  // Search input
  if (searchInput) {
    let timer: ReturnType<typeof setTimeout>;
    const onSearchInput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = searchInput.value.trim();
        if (!q) { if (resultsEl) resultsEl.innerHTML = ""; return; }
        const idx = await getItemIndex();
        const results = searchItems(idx, q, 15);
        if (resultsEl) {
          resultsEl.innerHTML = results.map((r) =>
            `<div class="bp-result" data-name="${escapeHtml(r.name)}">
              <span>${escapeHtml(r.name)}</span>
              <span class="bp-r-type">物品</span>
            </div>`
          ).join("");
        }
      }, 150);
    };
    searchInput.addEventListener("input", onSearchInput);
    cleanups.push(() => searchInput.removeEventListener("input", onSearchInput));
  }

  // Click search result → add item
  if (resultsEl) {
    const onResultClick = async (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".bp-result");
      if (!el || !currentCardId) return;
      const name = el.dataset.name;
      if (!name) return;
      const entry: BackpackEntry = { srdName: name, name, type: "", qty: 1 };
      // Try to get item type for chip coloring
      try {
        const libs = getState().libraries || [];
        const base = libs.length > 0 ? libs[0].baseUrl : "https://5e.kiwee.top";
        const res = await fetch(`${base}/data/items.json`, { cache: "force-cache" });
        if (res.ok) {
          const data = await res.json();
          const arr = Array.isArray(data) ? data : (data.item ?? []);
          const found = arr.find((it: any) => it.name === name);
          if (found?.type) entry.type = String(found.type);
        }
      } catch {}
      currentBackpack = await addItem(currentCardId, entry);
      showItemSearch = false;
      doRerender();
    };
    resultsEl.addEventListener("click", onResultClick);
    cleanups.push(() => resultsEl.removeEventListener("click", onResultClick));
  }

  // Chip left-click → search query
  document.querySelectorAll<HTMLElement>(".bp-chip").forEach((chip) => {
    const idx = parseInt(chip.dataset.idx ?? "", 10);
    if (isNaN(idx)) return;
    const onClick = async () => {
      const item = currentBackpack.items[idx];
      if (!item) return;
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q: item.srdName, autoPin: true },
          { destination: "LOCAL" },
        );
      } catch {}
    };
    const onCtx = async (e: Event) => {
      e.preventDefault();
      const item = currentBackpack.items[idx];
      if (!item || !currentCardId) return;
      if (!(await canManageBackpack(currentCardId))) return;
      showContextMenu(e as MouseEvent, item.srdName, item.name, item.qty, idx);
    };
    chip.addEventListener("click", onClick);
    chip.addEventListener("contextmenu", onCtx);
    cleanups.push(() => {
      chip.removeEventListener("click", onClick);
      chip.removeEventListener("contextmenu", onCtx);
    });
  });

  // Transfer target selection
  if (transferList) {
    transferList.querySelectorAll<HTMLElement>(".bp-transfer-opt").forEach((opt) => {
      const onOptClick = async () => {
        const targetCardId = opt.dataset.card;
        if (!targetCardId || !currentCardId || !transferItemName) return;
        await transferItem(currentCardId, targetCardId, transferItemName);
        currentBackpack = await readBackpack(currentCardId);
        showTransferList = false;
        transferItemName = null;
        doRerender();
      };
      opt.addEventListener("click", onOptClick);
      cleanups.push(() => opt.removeEventListener("click", onOptClick));
    });
  }

  // Cancel transfer
  if (transferCancel) {
    const onCancel = () => {
      showTransferList = false;
      transferItemName = null;
      doRerender();
    };
    transferCancel.addEventListener("click", onCancel);
    cleanups.push(() => transferCancel.removeEventListener("click", onCancel));
  }

  currentBpCleanup = () => cleanups.forEach((f) => f());
}

async function doRerender(): Promise<void> {
  if (!currentCardId) return;
  const d = cardCache.get(currentCardId);
  if (!d) return;
  const live = await readLiveBubbles();
  render(d, currentCardId, OBR.room.id || "default", live);
}

async function doRemoveItem(idx: number): Promise<void> {
  if (!currentCardId) return;
  const item = currentBackpack.items[idx];
  if (!item) return;
  currentBackpack = await removeItem(currentCardId, item.srdName);
  doRerender();
}

async function doUpdateItemQty(idx: number, qty: number): Promise<void> {
  if (!currentCardId) return;
  const item = currentBackpack.items[idx];
  if (!item) return;
  if (qty <= 0) {
    currentBackpack = await removeItem(currentCardId, item.srdName);
  } else {
    item.qty = qty;
    await writeBackpack(currentCardId, currentBackpack);
  }
  doRerender();
}

function showContextMenu(e: MouseEvent, srdName: string, name: string, qty: number, idx: number): void {
  const menu = document.createElement("div");
  menu.style.cssText =
    "position:fixed;z-index:9999;background:#1e1e3a;border:1px solid #444;border-radius:6px;" +
    "padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-size:11px;";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  const addRow = (label: string, action: () => void) => {
    const row = document.createElement("div");
    row.textContent = label;
    row.style.cssText =
      "padding:5px 12px;color:#ccc;cursor:pointer;white-space:nowrap;";
    row.addEventListener("mouseenter", () => { row.style.background = "rgba(93,173,226,0.18)"; row.style.color = "#fff"; });
    row.addEventListener("mouseleave", () => { row.style.background = ""; row.style.color = "#ccc"; });
    row.addEventListener("click", () => { cleanup(); action(); });
    menu.appendChild(row);
  };

  addRow("📋 查看详情", () => {
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/search-query",
        { q: srdName, autoPin: true },
        { destination: "LOCAL" },
      );
    } catch {}
  });
  addRow("➡️ 转移给...", async () => {
    transferItemName = srdName;
    if (currentCardId) await loadTransferCandidates(currentCardId);
    showTransferList = true;
    doRerender();
  });
  addRow("🔢 修改数量", () => {
    const newQty = prompt(`修改 ${name} 数量:`, String(qty));
    if (newQty !== null && !isNaN(Number(newQty)) && Number(newQty) > 0) {
      doUpdateItemQty(idx, Number(newQty));
    }
  });
  addRow("🗑️ 丢弃", () => {
    if (confirm(`确定丢弃 ${name}？`)) {
      doRemoveItem(idx);
    }
  });

  document.body.appendChild(menu);
  const cleanup = () => {
    menu.remove();
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("contextmenu", onOutside, true);
  };
  const onOutside = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) cleanup();
  };
  requestAnimationFrame(() => {
    document.addEventListener("click", onOutside, true);
    document.addEventListener("contextmenu", onOutside, true);
  });
}
```

- [ ] **Step 6: Call bindBackpackInteractions() in render()**

In `render()`, after `bindStatRowInputs();` (~line 409), add:

```ts
bindBackpackInteractions();
```

- [ ] **Step 7: Load backpack data in showCard()**

In `showCard()`, change the cache hit block to load backpack in parallel:

```ts
if (cached) {
  const [live, bp] = await Promise.all([readLiveBubbles(), readBackpack(cardId)]);
  currentBackpack = bp;
  render(cached, cardId, roomId, live);
  return;
}
```

Change the fetch block to also load backpack in parallel:

```ts
const [res, live, bp] = await Promise.all([
  fetch(`https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`),
  readLiveBubbles(),
  readBackpack(cardId),
]);
// After res.ok check...
currentBackpack = bp;
cardCache.set(cardId, d);
render(d, cardId, roomId, live);
```

- [ ] **Step 8: Reset transfer state when card changes**

In the `SHOW_MSG` broadcast handler (~line 774), before the `showCard` call, reset:

```ts
showItemSearch = false;
showTransferList = false;
transferItemName = null;
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/characterCards/info-page.ts
git commit -m "feat: add backpack UI and interactions to character card panel"
```

---

### Task 6: Build and verify

- [ ] **Step 1: Build**

```bash
npx vite build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 2: Check for unused imports or variables**

Fix any linter warnings.

- [ ] **Step 3: Commit any fixes**

```bash
git add -u
git commit -m "fix: resolve build issues for backpack integration"
```
