import OBR from "@owlbear-rodeo/sdk";

const container = document.getElementById("container") as HTMLDivElement;

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

interface Bubble {
  el: HTMLDivElement;
  tokenId: string;
}

let bubble: Bubble | null = null;
let tracking = false;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function createBubble(name: string, color: string, text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "bubble";
  el.innerHTML = `
    <div class="bubble-name" style="color:${escapeHtml(color)}">${escapeHtml(name)}</div>
    <div class="bubble-text">${escapeHtml(truncate(text, 50))}</div>
  `;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  return el;
}

async function updatePosition(b: Bubble): Promise<void> {
  try {
    const [items, vp, scale] = await Promise.all([
      OBR.scene.items.getItems([b.tokenId]),
      OBR.viewport.getPosition(),
      OBR.viewport.getScale(),
    ]);
    if (items.length === 0) return;
    const item = items[0];
    const dpi = await OBR.scene.grid.getDpi().catch(() => 150);
    let halfH = 75;
    try {
      const img = item.image;
      if (img?.height && dpi) {
        halfH = (img.height / dpi) * dpi * (item.scale.y) / 2;
      }
    } catch {}
    const wx = item.position.x;
    const wy = item.position.y - halfH;
    const sx = wx * scale + vp.x;
    const sy = wy * scale + vp.y;
    b.el.style.left = `${sx}px`;
    b.el.style.top = `${sy}px`;
  } catch {}
}

function startTracking(b: Bubble): void {
  tracking = true;
  function frame(): void {
    if (!tracking || !bubble) return;
    updatePosition(bubble);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function stopTracking(): void {
  tracking = false;
}

function dismiss(): void {
  stopTracking();
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  if (bubble) {
    bubble.el.classList.remove("visible");
    setTimeout(() => {
      if (bubble) {
        bubble.el.remove();
        bubble = null;
      }
    }, 300);
  }
}

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const tokenId = params.get("tokenId");
  const name = params.get("name") || "";
  const color = params.get("color") || "#5dade2";
  const text = params.get("text") || "";

  if (!tokenId || !name) return;

  const el = createBubble(name, color, text);
  bubble = { el, tokenId };
  startTracking(bubble);

  dismissTimer = setTimeout(() => {
    dismiss();
    try { OBR.modal.close(window.location.search.includes("bubble") ? "" : ""); } catch {}
  }, 5000);
}

init();
