import OBR from "@owlbear-rodeo/sdk";
import { BACKPACK_KEY_PREFIX, BackpackData, BackpackEntry } from "./types";

export function backpackKey(cardId: string): string {
  return `${BACKPACK_KEY_PREFIX}${cardId}`;
}

export async function readBackpack(cardId: string): Promise<BackpackData> {
  try {
    const meta = await OBR.room.getMetadata();
    const raw = meta[backpackKey(cardId)];
    if (Array.isArray(raw)) return raw as BackpackData;
  } catch {}
  return [];
}

export async function writeBackpack(cardId: string, data: BackpackData): Promise<void> {
  try {
    const key = backpackKey(cardId);
    await OBR.room.setMetadata({ [key]: data });
  } catch (e) {
    console.warn("[backpack] writeBackpack failed", e);
  }
}

export async function addItem(cardId: string, entry: BackpackEntry): Promise<BackpackData> {
  if (entry.qty <= 0) return readBackpack(cardId);
  const bp = await readBackpack(cardId);
  const existing = bp.find((i) => i.srdName === entry.srdName);
  if (existing) {
    existing.qty += entry.qty;
  } else {
    bp.push(entry);
  }
  await writeBackpack(cardId, bp);
  return bp;
}

export async function removeItem(cardId: string, srdName: string, qty?: number): Promise<BackpackData> {
  const bp = await readBackpack(cardId);
  const idx = bp.findIndex((i) => i.srdName === srdName);
  if (idx === -1) return bp;
  if (qty != null && qty <= 0) return bp;
  if (qty == null || bp[idx].qty <= qty) {
    bp.splice(idx, 1);
  } else {
    bp[idx].qty -= qty;
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
  const srcIdx = fromBp.findIndex((i) => i.srdName === srdName);
  if (srcIdx === -1) return { from: fromBp, to: toBp };
  const srcItem = fromBp[srcIdx];
  const transferQty = qty == null || srcItem.qty <= qty ? srcItem.qty : qty;

  if (srcItem.qty <= transferQty) {
    fromBp.splice(srcIdx, 1);
  } else {
    srcItem.qty -= transferQty;
  }

  const dstItem = toBp.find((i) => i.srdName === srdName);
  if (dstItem) {
    dstItem.qty += transferQty;
  } else {
    toBp.push({ ...srcItem, qty: transferQty });
  }

  await writeBackpack(fromCardId, fromBp);
  await writeBackpack(toCardId, toBp);
  return { from: fromBp, to: toBp };
}

export async function canManageBackpack(cardId: string): Promise<boolean> {
  try {
    const role = await OBR.player.getRole();
    if (role === "GM") return true;
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

export const BC_BACKPACK_ADD_ITEM = "com.obr-suite/backpack-add-item";

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
