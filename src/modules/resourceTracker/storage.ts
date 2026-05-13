import OBR, { Item } from "@owlbear-rodeo/sdk";
import { Resource, RESOURCES_KEY } from "./types";

export function readResources(item: Item | null | undefined): Resource[] {
  if (!item) return [];
  const raw = (item.metadata as any)?.[RESOURCES_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normaliseResource)
    .filter((r): r is Resource => r !== null);
}

function normaliseResource(raw: unknown): Resource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string") return null;
  if (r.type !== "count" && r.type !== "bar" && r.type !== "number") return null;
  const cur = Number(r.current);
  const max = Number(r.max);
  if (!Number.isFinite(cur) || !Number.isFinite(max)) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    current: cur,
    max: max,
    icon: typeof r.icon === "string" ? r.icon : "gem",
    order: typeof r.order === "number" ? r.order : undefined,
  };
}

export async function writeResources(itemId: string, next: Resource[]): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      (d.metadata as any)[RESOURCES_KEY] = next;
    });
  } catch (e) {
    console.error("[obr-suite/resources] writeResources failed", e);
  }
}

export async function updateResource(
  itemId: string,
  resourceId: string,
  reducer: (cur: Resource) => Resource,
): Promise<Resource | null> {
  let next: Resource | null = null;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      if (!Array.isArray(arr)) return;
      const i = arr.findIndex((r: any) => r?.id === resourceId);
      if (i < 0) return;
      const cur = normaliseResource(arr[i]);
      if (!cur) return;
      const upd = reducer(cur);
      arr[i] = upd;
      next = upd;
    });
  } catch (e) {
    console.error("[obr-suite/resources] updateResource failed", e);
  }
  return next;
}

export async function addResource(itemId: string, resource: Resource): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      const next = Array.isArray(arr) ? [...arr] : [];
      next.push(resource);
      (d.metadata as any)[RESOURCES_KEY] = next;
    });
  } catch (e) {
    console.error("[obr-suite/resources] addResource failed", e);
  }
}

export async function deleteResource(itemId: string, resourceId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      if (!Array.isArray(arr)) return;
      (d.metadata as any)[RESOURCES_KEY] = arr.filter((r: any) => r?.id !== resourceId);
    });
  } catch (e) {
    console.error("[obr-suite/resources] deleteResource failed", e);
  }
}
