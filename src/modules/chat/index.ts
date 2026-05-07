import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import {
  PANEL_IDS,
  getPanelOffset,
  getPanelSize,
  setPanelSize,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";
import { BROADCAST_DICE_ROLL, type DiceRollPayload } from "../dice/index";

export interface ChatMessage {
  id: string;
  type: "dm" | "player" | "roll" | "system";
  content: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  ts: number;
  rollPayload?: DiceRollPayload;
  bubble?: boolean;
  senderTokenId?: string;
  searchEntryId?: string;
  searchEntrySrc?: string;
  searchCategory?: number;
}

const CHAT_KEY = "com.obr-suite/chat-messages";

const CHAT_PANEL_ID = "com.obr-suite/chat";
const CHAT_BUBBLE_MODAL_ID = "com.obr-suite/chat-bubble";
const CHAT_URL = assetUrl("chat.html");
const CHAT_BUBBLE_URL = assetUrl("chat-bubble.html");

const DEFAULT_W = 360;
const DEFAULT_H = 480;
const MIN_W = 200;
const MIN_H = 200;

export const BC_CHAT_ADD_MESSAGE = "com.obr-suite/chat-add-message";
export const BC_CHAT_TOGGLE = "com.obr-suite/chat-toggle";
export const BC_CHAT_STATE = "com.obr-suite/chat-state";
export const BC_CHAT_RESIZE_END = "com.obr-suite/chat-resize-end";
export const BC_CHAT_FOCUS_SENDER = "com.obr-suite/chat-focus-sender";
export const BC_CHAT_BUBBLE_SHOW = "com.obr-suite/chat-bubble-show";
export const BC_CHAT_CLEAR = "com.obr-suite/chat-clear";

async function getMessages(): Promise<ChatMessage[]> {
  try {
    const meta = await OBR.room.getMetadata();
    const msgs = meta[CHAT_KEY];
    if (Array.isArray(msgs)) return msgs;
  } catch {}
  return [];
}

async function setMessages(msgs: ChatMessage[]): Promise<void> {
  try {
    await OBR.room.setMetadata({ [CHAT_KEY]: msgs });
    OBR.broadcast.sendMessage(BC_CHAT_ADD_MESSAGE, {}, { destination: "LOCAL" });
  } catch {}
}

const MAX_METADATA_BYTES = 15500;

export async function addChatMessage(msg: ChatMessage, tokenId?: string): Promise<void> {
  const msgs = await getMessages();
  const { rollPayload: _, bubble: __, ...clean } = msg;
  msgs.push(clean as ChatMessage);
  while (msgs.length > 1 && JSON.stringify(msgs).length > MAX_METADATA_BYTES) {
    msgs.shift();
  }
  await OBR.room.setMetadata({ [CHAT_KEY]: msgs });
  OBR.broadcast.sendMessage(BC_CHAT_ADD_MESSAGE, {}, { destination: "LOCAL" });

  if (msg.bubble && msg.senderId) {
    const bid = tokenId || await findSenderToken(msg.senderId);
    if (bid) {
      await showBubble(msg, bid);
      await focusToken(bid);
    }
  }
}

async function showBubble(msg: ChatMessage, tokenId: string): Promise<void> {
  try {
    await OBR.modal.open({
      id: `${CHAT_BUBBLE_MODAL_ID}-${msg.id}`,
      url: `${CHAT_BUBBLE_URL}?tokenId=${encodeURIComponent(tokenId)}&name=${encodeURIComponent(msg.senderName)}&color=${encodeURIComponent(msg.senderColor)}&text=${encodeURIComponent(msg.content)}`,
      fullScreen: true,
      hideBackdrop: true,
      hidePaper: true,
      disablePointerEvents: true,
    });
    setTimeout(async () => {
      try { await OBR.modal.close(`${CHAT_BUBBLE_MODAL_ID}-${msg.id}`); } catch {}
    }, 5000);
  } catch {}
}

async function findSenderToken(senderId: string): Promise<string | null> {
  try {
    const items = await OBR.scene.items.getItems((it: any) =>
      it.type === "IMAGE" &&
      (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
      it.visible &&
      it.createdUserId === senderId
    );
    if (items.length > 0) return items[0].id;
  } catch {}
  return null;
}

async function focusToken(tokenId: string): Promise<void> {
  try {
    const [items, vw, vh] = await Promise.all([
      OBR.scene.items.getItems([tokenId]),
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    if (items.length === 0) return;
    const item = items[0];
    const scale = await OBR.viewport.getScale();
    const x = item.position.x;
    const y = item.position.y;
    await OBR.viewport.animateTo({
      position: { x: -x * scale + vw / 2, y: -y * scale + vh / 2 },
      scale,
    });
  } catch {}
}

async function chatAnchor(): Promise<{ left: number; top: number }> {
  const [vw, vh] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  const off = getPanelOffset(PANEL_IDS.chatMessages);
  const size = getPanelSize(PANEL_IDS.chatMessages);
  const w = size?.width ?? DEFAULT_W;
  const h = size?.height ?? DEFAULT_H;
  const left = Math.min(Math.max(8, vw - w - 5 + off.dx), vw - MIN_W);
  const top = Math.min(Math.max(8, vh - h - 5 + off.dy), vh - MIN_H);
  return { left, top };
}

async function openChatPanel(): Promise<void> {
  const anchor = await chatAnchor();
  const size = getPanelSize(PANEL_IDS.chatMessages);
  await OBR.popover.open({
    id: CHAT_PANEL_ID,
    url: CHAT_URL,
    width: size?.width ?? DEFAULT_W,
    height: size?.height ?? DEFAULT_H,
    anchorReference: "POSITION",
    anchorPosition: anchor,
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    hidePaper: true,
    disableClickAway: true,
  });
}

async function closeChatPanel(): Promise<void> {
  try { await OBR.popover.close(CHAT_PANEL_ID); } catch {}
}

function broadcastChatState(open: boolean): void {
  try {
    OBR.broadcast.sendMessage(BC_CHAT_STATE, { open }, { destination: "LOCAL" });
  } catch {}
}

const unsubs: Array<() => void> = [];

export async function setupChat(): Promise<void> {
  registerPanelBbox(PANEL_IDS.chatMessages, async () => {
    try {
      const anchor = await chatAnchor();
      const size = getPanelSize(PANEL_IDS.chatMessages);
      return {
        left: anchor.left,
        top: anchor.top,
        width: size?.width ?? DEFAULT_W,
        height: size?.height ?? DEFAULT_H,
      };
    } catch { return null; }
  });

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_TOGGLE, async (event) => {
      const data = event.data as { v?: number } | undefined;
      if (data?.v === 1) {
        await openChatPanel();
      } else {
        await closeChatPanel();
      }
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_RESIZE_END, async (event) => {
      const data = event.data as { width?: number; height?: number } | undefined;
      if (!data?.width || !data?.height) return;
      setPanelSize(PANEL_IDS.chatMessages, { width: data.width, height: data.height });
      await openChatPanel();
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.chatMessages) return;
      if (payload.size) setPanelSize(PANEL_IDS.chatMessages, payload.size);
      await openChatPanel();
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      await openChatPanel();
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_DICE_ROLL, async (event) => {
      const payload = event.data as DiceRollPayload | undefined;
      if (!payload?.rollId) return;
      let myId = "";
      try { myId = await OBR.player.getId(); } catch {}
      if (payload.rollerId !== myId) return;

      // Resolve sender token: selected token > name-matched > roller info fallback
      let rollSenderName = payload.rollerName;
      let rollTokenId = "";
      try {
        const sel = await OBR.player.getSelection();
        if (sel && sel.length === 1) {
          const items = await OBR.scene.items.getItems(sel);
          if (items.length === 1) {
            const token = items[0] as any;
            if (token.type === "IMAGE" && (token.layer === "CHARACTER" || token.layer === "MOUNT")) {
              rollSenderName = token.text?.plainText ?? token.name ?? payload.rollerName;
              rollTokenId = token.id ?? "";
            }
          }
        }
        if (!rollTokenId) {
          const pName = await OBR.player.getName();
          if (pName) {
            const nameItems = await OBR.scene.items.getItems((it: any) =>
              it.type === "IMAGE" &&
              (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
              it.visible &&
              ((it.text?.plainText || "") === pName || it.name === pName)
            );
            if (nameItems.length > 0) rollTokenId = nameItems[0].id;
          }
        }
      } catch {}

      const lines: string[] = [];
      if (payload.label) lines.push(payload.label);
      const diceStr = payload.dice.map(d => `d${d.type}=${d.value}`).join(" + ");
      lines.push(`${diceStr}${payload.modifier ? ` + ${payload.modifier}` : ""} = ${payload.total}`);
      if (payload.hidden) lines.push("[暗骰]");

      const msg: ChatMessage = {
        id: `roll-${payload.rollId}`,
        type: "roll",
        content: lines.join("\n"),
        senderId: payload.rollerId,
        senderName: rollSenderName,
        senderColor: payload.rollerColor,
        ts: payload.ts,
        rollPayload: payload,
        senderTokenId: rollTokenId || undefined,
      };
      try { await addChatMessage(msg, rollTokenId || undefined); } catch {}
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_ADD_MESSAGE, async (event) => {
      const raw = event.data as (Partial<ChatMessage> & { tokenId?: string }) | undefined;
      if (!raw?.id || !raw?.content) return;
      const msg: ChatMessage = {
        id: raw.id,
        type: raw.type ?? "player",
        content: raw.content,
        senderId: raw.senderId ?? "",
        senderName: raw.senderName ?? "",
        senderColor: raw.senderColor ?? "#5dade2",
        ts: raw.ts ?? Date.now(),
        bubble: raw.bubble,
        searchEntryId: raw.searchEntryId,
        searchEntrySrc: raw.searchEntrySrc,
        searchCategory: raw.searchCategory,
      };
      const tokenId: string | undefined = raw.tokenId;
      try {
        const [name, color, role, playerId] = await Promise.all([
          OBR.player.getName(),
          OBR.player.getColor(),
          OBR.player.getRole(),
          OBR.player.getId(),
        ]);
        if (name && !msg.senderName) msg.senderName = name;
        if (color) msg.senderColor = color;
        if (role === "GM") msg.type = "dm";
        if (!msg.senderId) msg.senderId = playerId;
        if (!msg.senderTokenId) {
          let selTokenId: string | null = tokenId || null;
          if (!selTokenId) {
            try {
              const pName = await OBR.player.getName();
              if (pName) {
                const items = await OBR.scene.items.getItems((it: any) =>
                  it.type === "IMAGE" &&
                  (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
                  it.visible &&
                  ((it.text?.plainText || "") === pName || it.name === pName)
                );
                if (items.length > 0) selTokenId = items[0].id;
              }
            } catch {}
          }
          if (selTokenId) msg.senderTokenId = selTokenId;
        }
      } catch {}
      try { await addChatMessage(msg, tokenId); } catch {}
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_FOCUS_SENDER, async (event) => {
      const data = event.data as { senderId?: string } | undefined;
      if (!data?.senderId) return;
      const tokenId = await findSenderToken(data.senderId);
      if (tokenId) await focusToken(tokenId);
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_CLEAR, async () => {
      try { await OBR.room.setMetadata({ [CHAT_KEY]: [] }); } catch {}
    })
  );
}

export async function teardownChat(): Promise<void> {
  await closeChatPanel();
  for (const u of unsubs.splice(0)) u();
}
