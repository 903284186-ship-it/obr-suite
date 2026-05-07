import OBR from "@owlbear-rodeo/sdk";
import { t, applyI18nDom } from "../../i18n";
import { bindPanelDrag, watchDragSide } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import type { Language } from "../../state";
import type { ChatMessage } from "./index";
import {
  findEntryData,
  chipsFor,
  renderMonster,
  renderSpell,
  renderItem,
  renderAdventure,
  renderBook,
  renderEntries,
  type Entry,
  type DataEntry,
} from "../search/data";

const BC_CHAT_ADD_MESSAGE = "com.obr-suite/chat-add-message";
const BC_CHAT_TOGGLE = "com.obr-suite/chat-toggle";
const BC_CHAT_RESIZE_END = "com.obr-suite/chat-resize-end";
const BC_CHAT_FOCUS_SENDER = "com.obr-suite/chat-focus-sender";
const CHAT_KEY = "com.obr-suite/chat-messages";

const boxEl = document.getElementById("box") as HTMLDivElement;
const msgsEl = document.getElementById("msgs") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLInputElement;
const sendBtn = document.getElementById("btn-send") as HTMLButtonElement;
const closeBtn = document.getElementById("btn-close") as HTMLButtonElement;
const dragHandle = document.getElementById("drag-handle") as HTMLElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLElement;
const emptyEl = msgsEl.querySelector(".empty") as HTMLElement;

let lang: Language = "zh";
let myColor = "#5dade2";
let isGM = false;

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function avatarLetter(name: string): string {
  return (name || "?").charAt(0).toUpperCase();
}

const searchRenderCache = new Map<string, string>();

function renderMessage(msg: ChatMessage): string {
  const time = formatTime(msg.ts);
  const name = escapeHtml(msg.senderName || "系统");
  const avatarUrl = (msg as any).senderAvatarUrl as string | undefined;
  const avatarHtml = avatarUrl
    ? `<img class="msg-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
    : `<div class="msg-avatar" style="background:${msg.senderColor}">${avatarLetter(msg.senderName)}</div>`;
  const senderAttr = msg.senderId ? ` data-sender-id="${escapeHtml(msg.senderId)}"` : "";
  const searchAttr = msg.searchEntryId
    ? ` data-search-id="${escapeHtml(msg.searchEntryId)}" data-search-src="${escapeHtml(msg.searchEntrySrc ?? "")}"`
    : "";
  const rendered = (msg as any)._searchHtml as string | undefined;
  const content = rendered
    ? `<div class="search-header">${escapeHtml(msg.content)}</div>\n<div class="search-body">${rendered}</div>`
    : escapeHtml(msg.content).replace(/\n/g, "<br>");

  return `<div class="msg ${msg.type}"${senderAttr}${searchAttr}>
    ${avatarHtml}
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-name" style="color:${msg.senderColor}">${name}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-content">${content}</div>
    </div>
  </div>`;
}

async function loadMessages(): Promise<void> {
  try {
    const meta = await OBR.room.getMetadata();
    const msgs: ChatMessage[] = (meta[CHAT_KEY] as ChatMessage[]) ?? [];
    if (msgs.length === 0) {
      msgsEl.innerHTML = "";
      msgsEl.appendChild(emptyEl);
      return;
    }
    for (const msg of msgs) {
      if (!(msg as any).senderAvatarUrl) {
        const tokenId = (msg as any).senderTokenId as string | undefined;
        if (tokenId) {
          try {
            const items = await OBR.scene.items.getItems([tokenId]);
            if (items.length > 0) {
              const img = (items[0] as any).image;
              if (img?.url) (msg as any).senderAvatarUrl = img.url;
            }
          } catch {}
        }
      }
      if (msg.searchEntryId && msg.searchCategory != null && !(msg as any)._searchHtml) {
        const cacheKey = `${msg.searchEntryId}|${msg.searchEntrySrc}|${msg.searchCategory}`;
        let html = searchRenderCache.get(cacheKey);
        if (!html) {
          try {
            const entry: Entry = {
              id: 0, c: msg.searchCategory, u: "", s: msg.searchEntrySrc ?? "", n: msg.searchEntryId,
            };
            const data = await findEntryData(entry);
            if (data) {
              let body = "";
              if (msg.searchCategory === 1 || msg.searchCategory === 46) {
                body = renderMonster(entry, data);
              } else if (msg.searchCategory === 2) {
                body = chipsFor(entry, data) + renderSpell(entry, data);
              } else if (msg.searchCategory === 4 || msg.searchCategory === 31 || msg.searchCategory === 47 || msg.searchCategory === 56 || msg.searchCategory === 57) {
                body = chipsFor(entry, data) + renderItem(entry, data);
              } else if (msg.searchCategory === 13) {
                body = chipsFor(entry, data) + renderAdventure(entry, data);
              } else if (msg.searchCategory === 18 || msg.searchCategory === 44) {
                body = chipsFor(entry, data) + renderBook(entry, data);
              } else {
                body = data.entries ? renderEntries(data.entries) : "";
              }
              html = body;
            }
          } catch {}
          if (html) searchRenderCache.set(cacheKey, html);
          else html = "";
        }
        (msg as any)._searchHtml = html;
      }
    }
    msgsEl.innerHTML = msgs.map(renderMessage).join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch {
    msgsEl.innerHTML = "";
    msgsEl.appendChild(emptyEl);
  }
}

async function sendMessage(): Promise<void> {
  const content = inputEl.value.trim();
  if (!content) return;
  inputEl.value = "";

  let selName = "";
  let selTokenId = "";
  try {
    const myId = await OBR.player.getId();
    const sel = await OBR.player.getSelection();
    if (sel && sel.length === 1) {
      const items = await OBR.scene.items.getItems(sel);
      if (items.length === 1) {
        const token = items[0] as any;
        if (token.type === "IMAGE" && (token.layer === "CHARACTER" || token.layer === "MOUNT")) {
          if (isGM || token.createdUserId === myId) {
            selName = token.text?.plainText ?? token.name ?? "";
            selTokenId = token.id ?? "";
          }
        }
      }
    }
    if (!selTokenId) {
      const pName = await OBR.player.getName();
      if (pName) {
        const nameItems = await OBR.scene.items.getItems((it: any) =>
          it.type === "IMAGE" &&
          (it.layer === "CHARACTER" || it.layer === "MOUNT") &&
          it.visible &&
          ((it.text?.plainText || "") === pName || it.name === pName)
        );
        if (nameItems.length > 0) {
          selName = pName;
          selTokenId = nameItems[0].id;
        }
      }
    }
  } catch {}

  const msg: Partial<ChatMessage> & { tokenId?: string } = {
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    type: "player",
    content,
    senderId: "",
    senderName: selName,
    senderColor: myColor,
    ts: Date.now(),
    bubble: !!selName,
    tokenId: selTokenId || undefined,
  };

  try {
    await OBR.broadcast.sendMessage(
      BC_CHAT_ADD_MESSAGE,
      msg,
      { destination: "LOCAL" },
    );
  } catch {}
}

let resizeSession: { startW: number; startH: number; startX: number; startY: number } | null = null;
const MIN_W = 200;
const MIN_H = 200;

resizeHandle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizeHandle.setPointerCapture(e.pointerId);
  resizeSession = {
    startW: boxEl.offsetWidth,
    startH: boxEl.offsetHeight,
    startX: e.screenX,
    startY: e.screenY,
  };
});

window.addEventListener("pointermove", (e) => {
  if (!resizeSession) return;
  const dx = e.screenX - resizeSession.startX;
  const dy = e.screenY - resizeSession.startY;
  const w = Math.max(MIN_W, resizeSession.startW + dx);
  const h = Math.max(MIN_H, resizeSession.startH + dy);
  boxEl.style.width = `${w}px`;
  boxEl.style.height = `${h}px`;
});

window.addEventListener("pointerup", () => {
  if (!resizeSession) return;
  const w = parseInt(boxEl.style.width) || resizeSession.startW;
  const h = parseInt(boxEl.style.height) || resizeSession.startH;
  resizeHandle.releasePointerCapture(1);
  resizeSession = null;
  boxEl.style.width = "";
  boxEl.style.height = "";
  try {
    OBR.broadcast.sendMessage(
      BC_CHAT_RESIZE_END,
      { width: Math.max(MIN_W, w), height: Math.max(MIN_H, h) },
      { destination: "LOCAL" },
    );
  } catch {}
});

msgsEl.addEventListener("click", (e) => {
  const msgEl = (e.target as HTMLElement).closest<HTMLElement>(".msg");
  if (!msgEl) return;
  const searchId = msgEl.dataset.searchId;
  if (searchId) {
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/search-query",
        { q: searchId },
        { destination: "LOCAL" },
      );
    } catch {}
    return;
  }
  const senderId = msgEl.dataset.senderId;
  if (!senderId) return;
  try {
    OBR.broadcast.sendMessage(
      BC_CHAT_FOCUS_SENDER,
      { senderId },
      { destination: "LOCAL" },
    );
  } catch {}
});

async function init(): Promise<void> {
  try {
    const [role, color, getLang] = await Promise.all([
      OBR.player.getRole(),
      OBR.player.getColor(),
      import("../../state").then(m => m.getLocalLang),
    ]);
    myColor = color;
    isGM = role === "GM";
    lang = getLang();
    applyI18nDom(lang);
  } catch {}

  await loadMessages();

  try {
    OBR.broadcast.onMessage(BC_CHAT_ADD_MESSAGE, async () => {
      await loadMessages();
    });
    OBR.room.onMetadataChange(async (meta) => {
      if (CHAT_KEY in meta) await loadMessages();
    });
  } catch {}

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
  sendBtn.addEventListener("click", sendMessage);

  closeBtn.addEventListener("click", () => {
    try {
      OBR.broadcast.sendMessage(BC_CHAT_TOGGLE, {}, { destination: "LOCAL" });
    } catch {}
  });

  bindPanelDrag(dragHandle, PANEL_IDS.chatMessages);
  watchDragSide(PANEL_IDS.chatMessages, (side) => {
    dragHandle.setAttribute("data-side", side);
  });
}

OBR.onReady(init);
