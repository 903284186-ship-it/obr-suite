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
}

const CHAT_KEY = "com.obr-suite/chat-messages";
const MAX_MESSAGES = 200;

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
    OBR.broadcast.sendMessage(BC_CHAT_ADD_MESSAGE, null, { destination: "LOCAL" });
  } catch {}
}

export async function addChatMessage(msg: ChatMessage): Promise<void> {
  const msgs = await getMessages();
  msgs.push(msg);
  if (msgs.length > MAX_MESSAGES) {
    msgs.splice(0, msgs.length - MAX_MESSAGES);
  }
  await OBR.room.setMetadata({ [CHAT_KEY]: msgs });
  OBR.broadcast.sendMessage(BC_CHAT_ADD_MESSAGE, {}, { destination: "LOCAL" });

  if (msg.type === "dm" || msg.type === "player") {
    showBubble(msg);
  }
}

async function showBubble(msg: ChatMessage): Promise<void> {
  if (!msg.senderId) return;
  try {
    const items = await OBR.scene.items.getItems((it: any) =>
      it.type === "IMAGE" &&
      (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
      it.visible &&
      it.createdUserId === msg.senderId
    );
    if (items.length === 0) return;
    const tokenId = items[0].id;

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
        senderName: payload.rollerName,
        senderColor: payload.rollerColor,
        ts: payload.ts,
        rollPayload: payload,
      };
      await addChatMessage(msg);
    })
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CHAT_ADD_MESSAGE, async (event) => {
      const raw = event.data as Partial<ChatMessage> | undefined;
      if (!raw?.id || !raw?.content) return;
      const msg: ChatMessage = {
        id: raw.id,
        type: raw.type ?? "player",
        content: raw.content,
        senderId: raw.senderId ?? "",
        senderName: raw.senderName ?? "",
        senderColor: raw.senderColor ?? "#5dade2",
        ts: raw.ts ?? Date.now(),
      };
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
      } catch {}
      await addChatMessage(msg);
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
}

export async function teardownChat(): Promise<void> {
  await closeChatPanel();
  for (const u of unsubs.splice(0)) u();
}
