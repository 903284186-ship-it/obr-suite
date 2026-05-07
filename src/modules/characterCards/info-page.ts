import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { fireQuickRoll, resolveClickRollTarget } from "../dice/tags";
import { bindRollableContextMenu } from "../dice/context-menu";
import { subscribeToSfx } from "../dice/sfx-broadcast";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import {
  parseStatInput,
  readBubbles,
  patchBubbles,
  clampStat,
  type BubblesData,
} from "../../utils/statEdit";
import {
  readBackpack,
  writeBackpack,
  removeItem,
  transferItem,
  canManageBackpack,
  BC_BACKPACK_ADD_ITEM,
  itemTypeToCssClass,
} from "../backpack/index";
import type { BackpackData } from "../backpack/types";

const SHOW_MSG = "com.character-cards/info-show";

const root = document.getElementById("root") as HTMLDivElement;

// The token id this card is currently bound to. Updated whenever the
// info popover is shown for a different character. Quick-rolls fire
// on this token (for camera focus + dice anchoring above the head).
let boundItemId: string | null = null;

const ABBR: Record<string, string> = {
  str: "力", dex: "敏", con: "体", int: "智", wis: "感", cha: "魅",
};
// Full Chinese names for the dice-roll label (e.g. "敏捷检定" rather
// than "敏检定"). Used for the panel-page formula label / history
// display — the chip itself still shows the single-char ABBR.
const FULL: Record<string, string> = {
  str: "力量", dex: "敏捷", con: "体质", int: "智力", wis: "感知", cha: "魅力",
};
const ORDER = ["str", "dex", "con", "int", "wis", "cha"];

function escapeHtml(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function fmtMod(n: unknown): string {
  if (typeof n !== "number") return "?";
  return n >= 0 ? `+${n}` : `${n}`;
}

// Backpack weapon helpers — same DMGTYPE/WPROP mapping as fullscreen-page
const DMGTYPE_ZH: Record<string, string> = {
  A: "酸", B: "钝击", C: "冷冻", F: "火焰", FORCE: "力场", "F_": "力场",
  L: "闪电", N: "死灵", P: "穿刺", POISON: "毒素", PSY: "心灵",
  RAD: "光耀", S: "挥砍", T: "雷鸣",
};
const WPROP_ZH: Record<string, string> = {
  V: "多用", F: "灵巧", L: "轻型", H: "重型", "2H": "双手",
  T: "投掷", RLD: "装填", AF: "弹药", BF: "连射", S: "特殊", R: "触及",
};
let weaponDetailCache: any[] | null = null;
let weaponDetailPending: Promise<any[]> | null = null;

async function loadWeaponDetails(): Promise<any[]> {
  if (weaponDetailCache) return weaponDetailCache;
  if (weaponDetailPending) return weaponDetailPending;
  weaponDetailPending = (async () => {
    const base = "https://5e.kiwee.top";
    const [itemsRes, baseRes] = await Promise.all([
      fetch(`${base}/data/items.json`, { cache: "force-cache" }),
      fetch(`${base}/data/items-base.json`, { cache: "force-cache" }),
    ]);
    const pool: any[] = [];
    if (itemsRes.ok) {
      const j = await itemsRes.json();
      pool.push(...(Array.isArray(j) ? j : (j.item || [])));
    }
    if (baseRes.ok) {
      const j = await baseRes.json();
      pool.push(...(j.baseitem || []));
    }
    weaponDetailCache = pool;
    return pool;
  })();
  return weaponDetailPending;
}

const MONEY_KEY_PREFIX = "com.obr-suite/money/";

function moneyKey(cardId: string): string {
  return `${MONEY_KEY_PREFIX}${cardId}`;
}

async function readMoney(cardId: string): Promise<number | null> {
  try {
    const meta = await OBR.room.getMetadata();
    const raw = meta[moneyKey(cardId)];
    if (typeof raw === "number" && isFinite(raw)) return raw;
  } catch {}
  return null;
}

async function writeMoney(cardId: string, value: number): Promise<void> {
  try {
    await OBR.room.setMetadata({ [moneyKey(cardId)]: value });
  } catch (e) {
    console.warn("[cc-info] writeMoney failed", e);
  }
}

function computeGpFromCard(d: any): number {
  const w = d?.inventory?.currency?.wallet;
  if (!w) return 0;
  return (Number(w.pp) || 0) * 10
    + (Number(w.gp) || 0)
    + (Number(w.ep) || 0) * 0.5
    + (Number(w.sp) || 0) * 0.1
    + (Number(w.cp) || 0) * 0.01;
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function computeBackpackWeapons(bp: BackpackData, d: any): Promise<any[]> {
  if (bp.length === 0) return [];

  const pool = await loadWeaponDetails();
  const abilities = d.abilities || {};
  const str = Number(abilities.str?.total ?? 10);
  const dex = Number(abilities.dex?.total ?? 10);
  const lvl = d.total_level ?? 1;
  const pBonus = Math.ceil(lvl / 4) + 1;

  return bp.map((entry) => {
    const detail = pool.find((it: any) =>
      it.name === entry.name || it.ENG_name === entry.srdName || it.name === entry.srdName,
    );
    if (!detail) return null;
    const detailType = (detail.type || "").toUpperCase().split("|")[0];
    if (detailType !== "M" && detailType !== "R") return null;
    const propsArr: string[] = Array.isArray(detail.property) ? detail.property.map((p: any) => String(p)) : [];
    let isFinesse = false, isRanged = false;
    const propLabels: string[] = [];
    for (const p of propsArr) {
      const base = p.split("|")[0];
      if (base === "F") isFinesse = true;
      if (base === "AF" || base === "RLD" || base === "T") isRanged = true;
      const zh = WPROP_ZH[base];
      if (zh && !propLabels.includes(zh)) propLabels.push(zh);
    }
    const rawType = (detail.type || "").toUpperCase().split("|")[0];
    const tIsMelee = rawType === "M";
    const tIsRanged = rawType === "R" || isRanged || !!detail.range;
    const strMod = Math.floor((str - 10) / 2);
    const dexMod = Math.floor((dex - 10) / 2);
    let abilityMod: number;
    if (isFinesse) {
      abilityMod = Math.max(strMod, dexMod);
    } else if (tIsRanged && !tIsMelee) {
      abilityMod = dexMod;
    } else {
      abilityMod = strMod;
    }
    const atkMod = abilityMod + pBonus;
    const baseDmg = String(detail.dmg1 || "");
    const damage = abilityMod !== 0 ? `${baseDmg}+${abilityMod}` : baseDmg;
    return {
      name: detail.name || entry.name,
      atkMod,
      damage,
      damage_type: DMGTYPE_ZH[String(detail.dmgType || "").toUpperCase()] || "",
      extra_damage: detail.dmg2 ? String(detail.dmg2) : null,
      properties: propLabels.join(" · "),
      weight: detail.weight ?? null,
    };
  }).filter(Boolean);
}

// attack_bonus is either "+3" (weapons) or "D20+7" (spells). Normalise to
// just the signed bonus like "+7".
function extractBonus(s: unknown): string {
  const str = String(s ?? "");
  const m = /([+-]\s*\d+)\s*$/.exec(str);
  if (!m) return str || "?";
  return m[1].replace(/\s+/g, "");
}

// Split a weapon's `properties` string into individual chips, each
// clickable to search the property name in the suite's global search.
//
// Delimiter handling is paren-aware: commas / slashes inside `(…)`
// or `（…）` belong to the same tag and don't trigger a split — that
// way "投掷(射程20，60)" stays one chip instead of getting torn into
// "投掷(射程20" and "60)". Supports CN+ASCII commas, slashes, and
// the explicit "精通：xxx" 2024-mastery prefix.
function renderWeaponPropertyChips(raw: string): string {
  if (!raw.trim()) return "";
  const out: string[] = [];
  // Split mastery from the rest first — "精通：xxx" or "精通: xxx"
  // is a single mastery label, even if the rest is comma-separated.
  let masteryPart = "";
  let restPart = raw;
  const mastM = /精通\s*[：:]\s*([^,，、/\s]+)/.exec(raw);
  if (mastM) {
    masteryPart = mastM[1];
    restPart = raw.replace(mastM[0], "").replace(/[,，、]\s*$/, "");
  }
  const tags: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of restPart) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "，" || ch === "、" || ch === "/")) {
      const t = buf.trim();
      if (t) tags.push(t);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) tags.push(tail);
  for (const t of tags) {
    // For search, strip any "(...)" parenthetical so a chip labelled
    // "投掷(射程20，60)" looks up just "投掷" in the index. The
    // visible label keeps the full text.
    const searchKey = t.replace(/[(（][^)）]*[)）]\s*/g, "").trim() || t;
    out.push(
      `<span class="prop prop-chip" data-search="${escapeHtml(searchKey)}" title="搜索：${escapeHtml(searchKey)}">${escapeHtml(t)}</span>`,
    );
  }
  if (masteryPart) {
    out.push(
      `<span class="prop prop-chip prop-mastery" data-search="${escapeHtml(masteryPart)}" title="搜索精通词条：${escapeHtml(masteryPart)}"><em>精通</em>${escapeHtml(masteryPart)}</span>`,
    );
  }
  return out.length ? `<span class="prop-row">${out.join("")}</span>` : "";
}

function classesStr(d: any): string {
  if (!Array.isArray(d.classes)) return "";
  return d.classes
    .map((c: any) => {
      const nm = c.name || c.class_name || c.cls || "";
      const lv = c.level ?? c.lvl ?? "";
      return `${nm}${lv}`;
    })
    .filter(Boolean)
    .join("/");
}

let currentCardId: string | null = null;
const cardCache = new Map<string, any>();

let currentBackpack: BackpackData = [];
let currentMoney: number | null = null;
let backpackExpanded = true;
let showTransferList = false;
let transferItemName: string | null = null;
let transferCandidates: Array<{ cardId: string; tokenId: string; name: string }> = [];

// Cached role lookup. The DM-only lock button at the right end of the
// stat banner reads this. OBR.onReady below populates it before any
// showCard runs, so the very first render already has the right value.
let cachedIsGM = false;

async function showCard(cardId: string, roomId: string) {
  currentCardId = cardId;

  // Cache hit: render instantly, 0 network wait, 0 intermediate frame.
  const cached = cardCache.get(cardId);
  if (cached) {
    const [live, bp, moneyOverride] = await Promise.all([readLiveBubbles(), readBackpack(cardId), readMoney(cardId)]);
    currentBackpack = bp;
    currentMoney = moneyOverride;
    const bpWeapons = await computeBackpackWeapons(bp, cached);
    render(cached, cardId, roomId, live, bpWeapons);
    return;
  }

  // Cold load: only show "loading" if nothing's rendered yet (first open).
  // When switching between bound characters, keep the previous card's content
  // on screen until the new data arrives — single atomic A→B swap, no flash.
  const isEmpty = root.childElementCount === 0;
  if (isEmpty) {
    root.innerHTML = '<div class="loading">加载中…</div>';
  }

  try {
    const [res, live, bp, moneyOverride] = await Promise.all([
      fetch(
        `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`
      ),
      readLiveBubbles(),
      readBackpack(cardId),
      readMoney(cardId),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    // If user switched cards between fetch start and end, ignore.
    if (currentCardId !== cardId) return;
    cardCache.set(cardId, d);
    currentBackpack = bp;
    currentMoney = moneyOverride;
    const bpWeapons = await computeBackpackWeapons(bp, d);
    render(d, cardId, roomId, live, bpWeapons);
  } catch (e: any) {
    if (currentCardId !== cardId) return;
    root.innerHTML = `<div class="err">加载失败：${escapeHtml(e?.message ?? e)}</div>`;
  }
}

// Read the bound token's live bubbles metadata so the panel reflects
// the canonical HP/AC state (which the bubbles bar above the token
// also draws from). Falls back to {} when no token is bound — render()
// then uses the static card data values.
async function readLiveBubbles(): Promise<BubblesData> {
  if (!boundItemId) return {};
  return readBubbles(boundItemId);
}

function renderBackpackHTML(money: number): string {
  const n = currentBackpack.reduce((sum, i) => sum + i.qty, 0);
  const toggleIcon = backpackExpanded ? "▼" : "▶";

  let body = "";
  if (showTransferList && transferItemName) {
    const opts = transferCandidates.length > 0
      ? transferCandidates.map((c) =>
          `<div class="bp-transfer-opt" data-card="${escapeHtml(c.cardId)}">${escapeHtml(c.name)}</div>`
        ).join("")
      : `<div class="empty">没有可转移的角色</div>`;
    body = `<div class="bp-transfer-list" id="bp-transfer-list">
      ${opts}
      <div class="bp-transfer-cancel" id="bp-transfer-cancel">取消</div>
    </div>`;
  } else if (backpackExpanded && currentBackpack.length > 0) {
    const chips = currentBackpack.map((entry, i) => {
      const cls = itemTypeToCssClass(entry.type);
      const label = entry.qty > 1 ? `${escapeHtml(entry.name)} ×${entry.qty}` : escapeHtml(entry.name);
      return `<span class="bp-chip ${cls}" data-idx="${i}" title="${escapeHtml(entry.name)}">${label}</span>`;
    }).join("");
    body = `<div class="bp-grid">${chips}</div>`;
  } else if (backpackExpanded && currentBackpack.length === 0) {
    body = `<div class="empty" style="padding:2px 6px;font-size:10px;">空</div>`;
  }

  return `<div class="bp-sect">
    <div class="bp-head" id="bp-head">
      <span>🎒 背包<span class="bp-count">(${n})</span></span>
      <span class="bp-money" id="bp-money"><span class="bp-money-icon">💰</span> <span class="bp-money-val">${formatMoney(money)} GP</span></span>
      <span class="bp-toggle">${toggleIcon}</span>
    </div>
    ${body}
  </div>`;
}

function render(d: any, cardId: string, roomId: string, live: BubblesData = {}, bpWeapons: any[] = []) {
  const id = d.identity || {};
  const cs = d.core_stats || {};
  const ab = d.abilities || {};
  const cb = d.combat || {};
  const sp = d.spellcasting || {};

  const name = id.display_name || id.character_name || "未命名";
  const race = [id.race?.name, id.race?.subrace].filter(Boolean).join("·");
  const cls = classesStr(d);
  const lvl = d.total_level != null ? `Lv${d.total_level}` : "";
  const sub = [race, cls, lvl].filter(Boolean).join(" ");

  const rawUrl = `https://obr.dnd.center/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/`;

  // Merged stat values: prefer the bound token's bubbles metadata
  // (live state, what the HP bar draws from) and fall back to the
  // card data when bubbles metadata isn't set yet.
  const hp = cs.hp || {};
  const liveHp = typeof live.health === "number" ? live.health : hp.current ?? 0;
  const liveMaxHp = typeof live["max health"] === "number" ? live["max health"] : hp.max ?? 0;
  const liveTempHp = typeof live["temporary health"] === "number" ? live["temporary health"] : hp.temp ?? 0;
  const liveAc = typeof live["armor class"] === "number" ? live["armor class"] : (cs.ac ?? 10);

  const speedStr = cs.speed != null ? `${cs.speed}尺` : "?";
  const castAbility = sp.spellcasting_ability || "—";

  // Stat banner — single horizontal row with HP red pill + temp pink
  // circle + AC shield. Each editable number is wrapped in a .stat-cell
  // so the "previous value hint" can pop above on focus without
  // shifting layout. Inputs accept absolute / +N / -N / A+B syntax;
  // commit writes patch the bound token's bubbles metadata which the
  // bubbles module re-reads to redraw the HP bar + heater shield over
  // the token in real time.
  // HP fill ratio for the pill mask. 1 = full, 0 = empty. Defaults
  // to 1 when maxHp is 0 (no HP info yet) so the pill reads as the
  // legacy solid red instead of an empty dark slot.
  const hpRatio = liveMaxHp > 0
    ? Math.max(0, Math.min(1, liveHp / liveMaxHp))
    : 1;
  const statBanner = `
    <div class="stat-banner">
      <div class="hp-pill" style="--hp-ratio: ${hpRatio.toFixed(3)}">
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="health" value="${escapeHtml(String(liveHp))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
        <span class="slash">/</span>
        <span class="stat-cell">
          <span class="prev-hint" data-prev></span>
          <input class="stat-input" type="text" inputmode="numeric"
                 data-field="max health" value="${escapeHtml(String(liveMaxHp))}"
                 title="支持 20 / +5 / -3 / 15+5">
        </span>
      </div>
      <div class="temp-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="temporary health" value="${escapeHtml(String(liveTempHp))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      <div class="ac-pill stat-cell">
        <span class="prev-hint" data-prev></span>
        <input class="stat-input" type="text" inputmode="numeric"
               data-field="armor class" value="${escapeHtml(String(liveAc))}"
               title="支持 20 / +5 / -3 / 15+5">
      </div>
      ${cachedIsGM ? renderLockButton(live.locked !== false) : ""}
    </div>
  `;

  // The remaining read-only chips (HP/AC moved to stat-rows above).
  const chips = `
    <div class="chip init"><span class="k">先攻</span><span class="v">${fmtMod(cs.initiative)}</span></div>
    <div class="chip"><span class="k">速度</span><span class="v">${escapeHtml(speedStr)}</span></div>
    <div class="chip"><span class="k">被动察觉</span><span class="v">${escapeHtml(cs.passive_perception)}</span></div>
    <div class="chip"><span class="k">熟练</span><span class="v">${fmtMod(cs.proficiency_bonus)}</span></div>
    <div class="chip"><span class="k">豁免DC</span><span class="v">${escapeHtml(cs.dc)}</span></div>
    <div class="chip"><span class="k">施法关键属性</span><span class="v">${escapeHtml(castAbility)}</span></div>
  `;

  // Group skills by their ability key — each ability card embeds its own
  // list of associated skills (e.g. DEX card shows 特技/巧手/隐匿).
  const skills = Array.isArray(d.skills) ? d.skills : [];
  const skillsByAbil: Record<string, any[]> = {};
  for (const s of skills) {
    const k = String(s?.ability ?? "").toLowerCase();
    if (!k) continue;
    (skillsByAbil[k] ??= []).push(s);
  }

  const renderSkillRow = (s: any) => {
    const cls = s.proficiency === "expertise"
      ? "sk sk-exp"
      : s.proficiency === "proficient"
        ? "sk sk-prof"
        : "sk";
    const total = typeof s.total === "number" ? s.total : 0;
    const expr = `1d20${total >= 0 ? `+${total}` : total}`;
    const lbl = `${s.name ?? "?"}`;
    return `<div class="${cls} rollable" data-expr="${expr}" data-label="${escapeHtml(lbl)}" title="${escapeHtml(lbl)} ${expr}">
      <span class="sk-n">${escapeHtml(s.name ?? "?")}</span>
      <span class="sk-v">${fmtMod(s.total)}</span>
    </div>`;
  };

  const abl = ORDER
    .map((k) => {
      const a = ab[k] || {};
      const prof = !!a.save?.proficient;
      const skList = skillsByAbil[k] ?? [];
      const skHtml = skList.map(renderSkillRow).join("");
      // Ability check: 1d20+modifier. Saving-throw uses the same
      // modifier unless the save has its own bonus stored separately.
      const aMod = typeof a.modifier === "number" ? a.modifier : 0;
      const aExpr = `1d20${aMod >= 0 ? `+${aMod}` : aMod}`;
      const aLbl = `${FULL[k] ?? ABBR[k] ?? k}检定`;
      // Saving throw — different label, may have its own bonus.
      const saveBonus = typeof a.save?.bonus === "number"
        ? a.save.bonus
        : (a.save?.proficient ? aMod + (cs.proficiency_bonus ?? 0) : aMod);
      const saveExpr = `1d20${saveBonus >= 0 ? `+${saveBonus}` : saveBonus}`;
      const saveLbl = `${FULL[k] ?? ABBR[k] ?? k}豁免`;
      return `<div class="abl${prof ? " prof" : ""}">
        <div class="abl-head">
          <span class="a rollable" data-expr="${saveExpr}" data-label="${escapeHtml(saveLbl)}" title="${escapeHtml(saveLbl)} ${saveExpr}">${ABBR[k]}</span>
          <span class="t">${escapeHtml(a.total)}</span>
          <span class="m rollable" data-expr="${aExpr}" data-label="${escapeHtml(aLbl)}" title="${escapeHtml(aLbl)} ${aExpr}">${fmtMod(a.modifier)}</span>
        </div>
        ${skHtml ? `<div class="abl-skills">${skHtml}</div>` : ""}
      </div>`;
    })
    .join("");

  const weaponRows: string[] = [];

  // Spell attack row (first so it's easy to find). Only if character casts.
  if (sp.attack_bonus) {
    const bonus = extractBonus(sp.attack_bonus);
    const bn = parseInt(bonus.replace(/[^\d-]/g, ""), 10) || 0;
    const atkExpr = `1d20${bn >= 0 ? `+${bn}` : bn}`;
    const atkLbl = `法术攻击`;
    weaponRows.push(`<div class="wp spell">
      <span class="n">近战/远程法术攻击</span>
      <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(bonus)}</span>
      <span class="dmg">DC ${escapeHtml(sp.save_dc ?? cs.dc ?? "?")}</span>
    </div>`);
  }

  if (Array.isArray(cb.weapons)) {
    for (const w of cb.weapons) {
      // Weapon properties (e.g. "灵巧, 轻型, 精通：缓速") render as
      // individual clickable chips. Splits on the most common
      // delimiters (Chinese / ASCII commas, slash, and the explicit
      // "精通：" prefix) so each tag becomes its own search query.
      const prop = w.properties ? renderWeaponPropertyChips(String(w.properties)) : "";
      const dmgRaw = [w.damage, w.damage_type].filter(Boolean).join(" ");
      const wpName = w.name ?? "?";
      // Attack roll: parse the leading sign+number from attack_bonus.
      const atkBonusStr = String(w.attack_bonus ?? "").trim();
      const atkM = /([+-]?\s*\d+)/.exec(atkBonusStr);
      const atkBn = atkM ? parseInt(atkM[1].replace(/\s+/g, ""), 10) : 0;
      const atkExpr = `1d20${atkBn >= 0 ? `+${atkBn}` : atkBn}`;
      const atkLbl = `${wpName} 命中`;
      // Damage: extract the raw dice expression from `w.damage`. Most
      // entries are like "1d8+3" or "2d6+4" — pass through directly.
      const dmgExprRaw = String(w.damage ?? "").replace(/\s+/g, "");
      const dmgExprMatch = /\d*d\d+([+-]\d+)?/.exec(dmgExprRaw);
      const dmgExpr = dmgExprMatch ? dmgExprMatch[0] : dmgExprRaw;
      const dmgLbl = `${wpName} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`;
      const dmgClickable = dmgExpr
        ? `<span class="rollable" data-expr="${escapeHtml(dmgExpr)}" data-label="${escapeHtml(dmgLbl)}" title="${escapeHtml(dmgLbl)} ${escapeHtml(dmgExpr)}">${escapeHtml(dmgRaw || "?")}</span>`
        : escapeHtml(dmgRaw || "?");
      // 附加伤害骰 — bonus dice (sneak attack, divine smite, etc.).
      // Server attaches `extra_damage` (e.g. "1d8") and
      // `extra_damage_type` (e.g. "辐光"). Render as a separate
      // clickable chunk after the base damage so different damage
      // types don't get folded into the same expression.
      let extraHtml = "";
      const extraExpr = w.extra_damage
        ? String(w.extra_damage).replace(/\s+/g, "")
        : "";
      if (extraExpr) {
        const extraLbl = `${wpName} 附加伤害${w.extra_damage_type ? `(${w.extra_damage_type})` : ""}`;
        const extraDisplay = [w.extra_damage, w.extra_damage_type]
          .filter(Boolean)
          .join(" ");
        extraHtml =
          ` <span class="dmg-extra rollable" data-expr="${escapeHtml(extraExpr)}" data-label="${escapeHtml(extraLbl)}" title="${escapeHtml(extraLbl)} ${escapeHtml(extraExpr)}">+${escapeHtml(extraDisplay)}</span>`;
      }
      weaponRows.push(`<div class="wp">
        <span class="n">${escapeHtml(wpName)}</span>
        <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${escapeHtml(w.attack_bonus ?? "?")}</span>
        <span class="dmg">${dmgClickable}${extraHtml}</span>
        ${prop}
      </div>`);
    }
  }

  // Backpack weapons — auto-resolved from backpack items with type M/R
  if (bpWeapons.length > 0) {
    weaponRows.push(`<div class="bp-weps-sep">背包武器</div>`);
    for (const w of bpWeapons) {
      const atkExpr = `1d20${w.atkMod >= 0 ? "+" : ""}${w.atkMod}`;
      const atkLbl = `${w.name} 命中`;
      const dmgLbl = `${w.name} 伤害${w.damage_type ? `(${w.damage_type})` : ""}`;
      let extraHtml = "";
      if (w.extra_damage) {
        const extraLbl = `${w.name} 双手伤害`;
        extraHtml = ` <span class="dmg-extra rollable" data-expr="${escapeHtml(w.extra_damage)}" data-label="${escapeHtml(extraLbl)}" title="${escapeHtml(extraLbl)} ${escapeHtml(w.extra_damage)}">+${escapeHtml(w.extra_damage)} 双手</span>`;
      }
      weaponRows.push(`<div class="wp bp-wep">
        <span class="n">${escapeHtml(w.name)}</span>
        <span class="atk rollable" data-expr="${atkExpr}" data-label="${escapeHtml(atkLbl)}" title="${escapeHtml(atkLbl)} ${atkExpr}">${fmtMod(w.atkMod)}</span>
        <span class="dmg"><span class="rollable" data-expr="${escapeHtml(w.damage)}" data-label="${escapeHtml(dmgLbl)}" title="${dmgLbl} ${escapeHtml(w.damage)}">${escapeHtml(w.damage)}${w.damage_type ? ` ${escapeHtml(w.damage_type)}` : ""}</span>${extraHtml}</span>
        ${w.properties ? `<span class="prop-row">${escapeHtml(w.properties)}${w.weight != null ? ` · ${w.weight}磅` : ""}</span>` : ""}
      </div>`);
    }
  }

  const weps = weaponRows.length ? weaponRows.join("") : '<div class="empty">无</div>';

  // ── Searchable chips: features / feats / spells ────────────────
  // Each chip is a tiny compact name-only box. Clicking fills the
  // cluster's search input with that name (BC_SEARCH_QUERY) so the
  // 5etools search popover opens with matching results — letting
  // the player look up a feature definition without leaving OBR.
  const featuresHtml = renderSearchChips(d);

  const bpHtml = renderBackpackHTML(currentMoney ?? computeGpFromCard(d));

  root.innerHTML = `
    <div class="hdr">
      <div class="drag-handle" id="drag-handle" title="拖动 / Drag" aria-label="拖动面板">
        <svg viewBox="0 0 12 18" aria-hidden="true">
          <circle cx="3" cy="3" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="3" r="1.2" fill="currentColor"/>
          <circle cx="3" cy="9" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="9" r="1.2" fill="currentColor"/>
          <circle cx="3" cy="15" r="1.2" fill="currentColor"/>
          <circle cx="9" cy="15" r="1.2" fill="currentColor"/>
        </svg>
      </div>
      <div class="name">${escapeHtml(name)}</div>
      <div class="sub">${escapeHtml(sub)}</div>
      <a class="raw-link" href="${rawUrl}" target="_blank" rel="noopener">原始数据</a>
    </div>
    ${statBanner}
    <div class="row">${chips}</div>
    <div class="abil">${abl}</div>
    <div class="sect">${ICONS.swords} 武器 / 攻击</div>
    ${weps}
    ${featuresHtml}
    ${bpHtml}
  `;
  bindStatRowInputs();
  bindBackpackInteractions();
  // The drag handle DOM element is recreated on every render() (we
  // assigned root.innerHTML), so the existing pointer-event bindings
  // on the previous element are gone. Re-bind for the new node.
  const handle = root.querySelector<HTMLDivElement>("#drag-handle");
  if (handle) {
    if (currentDragUnbind) currentDragUnbind();
    currentDragUnbind = bindPanelDrag(handle, PANEL_IDS.ccInfo);
  }
}

// Tracks the drag-handle's current bindPanelDrag unbind function so we
// can release the previous element's listeners before binding to the
// re-rendered one. (innerHTML reassignment GCs the old DOM nodes; their
// DOM listeners die with them — but we still want to clear our local
// pointer-capture state inside panelDrag, which the unbind handles.)
let currentDragUnbind: (() => void) | null = null;

// DM-only lock button at the right end of the stat banner. Closed
// padlock = locked (default — players see no bar in idle, silhouette
// in combat). Open padlock = unlocked (everyone sees full data). The
// click handler is wired in `bindStatRowInputs` below alongside the
// stat inputs.
function renderLockButton(locked: boolean): string {
  const titleZh = locked
    ? "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）"
    : "已解锁：所有玩家可见完整 HP / AC 数值";
  const lockedAttr = locked ? "true" : "false";
  // Single SVG path that covers both lock + unlock by toggling the
  // shackle's right side via the data-locked attribute → CSS selector.
  return `
    <button class="stat-lock" data-locked="${lockedAttr}" title="${escapeHtml(titleZh)}" aria-label="${escapeHtml(titleZh)}" type="button">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/>
        <path class="lock-shackle" d="M5 7 V5 a3 3 0 0 1 6 0 V7"/>
      </svg>
    </button>
  `;
}

// After every successful patch, push the cross-field-clamped values
// back into all four stat inputs so the user sees what actually got
// committed (e.g. typed HP=999 with max=66 → input snaps to 66).
function refreshStatInputs(live: BubblesData): void {
  const fields: Array<keyof BubblesData> = [
    "health", "max health", "temporary health", "armor class",
  ];
  for (const f of fields) {
    const v = live[f];
    if (v == null) continue;
    const sel = `.stat-input[data-field="${f}"]`;
    const el = root.querySelector<HTMLInputElement>(sel);
    if (el) el.value = String(v);
  }
  // Re-paint the HP pill's fill ratio so the masked overlay tracks
  // edits live (otherwise the pill text updates but the colored fill
  // stays at the previous ratio until the next render).
  const hp = typeof live["health"] === "number" ? (live["health"] as number) : null;
  const maxHp = typeof live["max health"] === "number" ? (live["max health"] as number) : null;
  const ratio = (hp != null && maxHp != null && maxHp > 0)
    ? Math.max(0, Math.min(1, hp / maxHp))
    : 1;
  const pill = root.querySelector<HTMLElement>(".hp-pill");
  if (pill) pill.style.setProperty("--hp-ratio", ratio.toFixed(3));
}

// Wire pointer-events for the HP / max-HP / temp / AC inputs that
// `render()` injected. Each input parses its own value on Enter / blur,
// then patches the bound token's bubbles metadata. The matching
// `.prev-hint` sibling pops above the cell during edit so the user
// can still see the original number while typing the replacement.
function bindStatRowInputs(): void {
  // Lock button (DM only). Toggles BUBBLES_META.locked on the bound
  // token. Visual state syncs from the data-locked attribute that
  // render() set, then updates here on click.
  const lockBtn = root.querySelector<HTMLButtonElement>(".stat-lock");
  const lockTokenId = boundItemId;
  if (lockBtn && lockTokenId) {
    lockBtn.addEventListener("click", async () => {
      const wasLocked = lockBtn.dataset.locked !== "false";
      const next = !wasLocked;
      lockBtn.dataset.locked = next ? "true" : "false";
      lockBtn.title = next
        ? "已上锁：玩家在战斗准备 / 战斗中只看到血条比例（无数值 / AC）"
        : "已解锁：所有玩家可见完整 HP / AC 数值";
      try {
        // Sync `locked` (suite bubbles) + `hide` (external Stat
        // Bubbles plugin) on the same metadata key so the lock
        // button works regardless of which bubbles plugin (or both)
        // is active.
        await patchBubbles(
          lockTokenId,
          { locked: next, hide: next } as Partial<BubblesData>,
        );
      } catch (e) {
        console.warn("[cc-info] toggle lock failed", e);
        lockBtn.dataset.locked = wasLocked ? "true" : "false";
      }
    });
  }

  const inputs = root.querySelectorAll<HTMLInputElement>(".stat-input[data-field]");
  inputs.forEach((input) => {
    const field = input.dataset.field as keyof BubblesData | undefined;
    if (!field) return;
    // Track the "current value at edit start" so the +/- relative
    // parser does the math against the displayed value, not against
    // whatever the user is in the middle of typing.
    let editStart = input.value;
    const cell = input.closest<HTMLElement>(".stat-cell");
    const prevHint = cell?.querySelector<HTMLElement>(".prev-hint");

    const commit = async () => {
      if (!boundItemId) {
        input.value = editStart;
        return;
      }
      const text = input.value;
      const cur = parseFloat(editStart);
      const parsed = parseStatInput(text, Number.isFinite(cur) ? cur : 0);
      if (parsed == null) {
        input.value = editStart;
        return;
      }
      const next = clampStat(field, parsed);
      try {
        // patchBubbles returns the cross-field-clamped final state
        // (e.g. setting health > maxHealth gets clamped down to
        // maxHealth; lowering maxHealth below current health drags
        // health down too). We refresh ALL four inputs so the user
        // sees the corrected values even when their typed value
        // exceeded the clamp.
        const final = await patchBubbles(
          boundItemId,
          { [field]: next } as Partial<BubblesData>,
        );
        refreshStatInputs(final);
        editStart = input.value;
      } catch (e) {
        console.warn("[cc-info] patch bubbles failed", e);
        input.value = editStart;
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = editStart;
        input.blur();
      }
    });
    input.addEventListener("focus", () => {
      // Snapshot the current value so the prev-hint stays stable
      // even if the user clears + retypes mid-edit, and so blur
      // can revert to it on empty input.
      editStart = input.value;
      if (prevHint) prevHint.textContent = editStart;
      cell?.classList.add("editing");
      // Clear the input on focus instead of selecting it. Per user
      // request: no blue text-selection rectangle, and the field
      // becomes blank so they can either type a new absolute value
      // or simply hit Enter / blur to keep the original (empty
      // commit reverts back to editStart).
      requestAnimationFrame(() => {
        input.value = "";
      });
    });
    input.addEventListener("blur", () => {
      cell?.classList.remove("editing");
      const text = input.value.trim();
      if (text === "") {
        // Empty submit = "I changed my mind" — restore the original.
        input.value = editStart;
        return;
      }
      if (text !== editStart) void commit();
    });
  });
}

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
  if (currentBpCleanup) currentBpCleanup();
  const cleanups: Array<() => void> = [];

  const head = document.getElementById("bp-head");
  const transferList = document.getElementById("bp-transfer-list");
  const transferCancel = document.getElementById("bp-transfer-cancel");

  if (head) {
    const onHeadClick = async (e: Event) => {
      backpackExpanded = !backpackExpanded;
      showTransferList = false;
      if (currentCardId) doRerender();
    };
    head.addEventListener("click", onHeadClick);
    cleanups.push(() => head.removeEventListener("click", onHeadClick));
  }

  const moneyEl = document.getElementById("bp-money");
  if (moneyEl && currentCardId) {
    const moneyValEl = moneyEl.querySelector<HTMLElement>(".bp-money-val");
    let editStartValue = "";

    const startEdit = () => {
      if (!moneyValEl) return;
      editStartValue = moneyValEl.textContent?.replace(/\s*GP\s*$/, "").trim() || "";
      const currentVal = currentMoney ?? computeGpFromCard(cardCache.get(currentCardId!) ?? {});
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.className = "bp-money-input";
      input.value = String(currentVal);
      moneyValEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = async () => {
        const raw = input.value.trim();
        const parsed = parseFloat(raw);
        if (raw === "" || isNaN(parsed)) {
          input.replaceWith(moneyValEl);
          moneyValEl.textContent = editStartValue + " GP";
          return;
        }
        const rounded = Math.round(parsed * 100) / 100;
        currentMoney = rounded;
        if (currentCardId) await writeMoney(currentCardId, rounded);
        doRerender();
      };

      const cancel = () => {
        input.replaceWith(moneyValEl);
        moneyValEl.textContent = editStartValue + " GP";
      };

      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      input.addEventListener("blur", () => {
        if (input.parentNode) commit();
      });
    };

    const onMoneyClick = (e: Event) => {
      e.stopPropagation();
      if (!moneyEl.querySelector(".bp-money-input")) startEdit();
    };
    moneyEl.addEventListener("click", onMoneyClick);
    cleanups.push(() => moneyEl.removeEventListener("click", onMoneyClick));
  }

  document.querySelectorAll<HTMLElement>(".bp-chip").forEach((chip) => {
    const idx = parseInt(chip.dataset.idx ?? "", 10);
    if (isNaN(idx)) return;
    const onClick = async () => {
      const item = currentBackpack[idx];
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
      const item = currentBackpack[idx];
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
  const [live, bpWeapons, moneyOverride] = await Promise.all([
    readLiveBubbles(),
    computeBackpackWeapons(currentBackpack, d),
    readMoney(currentCardId),
  ]);
  currentMoney = moneyOverride;
  render(d, currentCardId, OBR.room.id || "default", live, bpWeapons);
}

async function doRemoveItem(idx: number): Promise<void> {
  if (!currentCardId) return;
  const item = currentBackpack[idx];
  if (!item) return;
  currentBackpack = await removeItem(currentCardId, item.srdName);
  doRerender();
}

async function doUpdateItemQty(idx: number, qty: number): Promise<void> {
  if (!currentCardId) return;
  const item = currentBackpack[idx];
  if (!item) return;
  if (qty <= 0) {
    currentBackpack = await removeItem(currentCardId, item.srdName);
  } else {
    const bp = await readBackpack(currentCardId);
    const target = bp.find((i) => i.srdName === item.srdName);
    if (target) target.qty = qty;
    await writeBackpack(currentCardId, bp);
    currentBackpack = bp;
  }
  doRerender();
}

function showContextMenu(e: MouseEvent, srdName: string, name: string, qty: number, idx: number): void {
  const menu = document.createElement("div");
  menu.style.cssText =
    "position:fixed;z-index:9999;background:#1e1e3a;border:1px solid #444;border-radius:6px;" +
    "padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-size:11px;";
  menu.style.left = Math.min(e.clientX, window.innerWidth - 150) + "px";
  menu.style.top = Math.min(e.clientY, window.innerHeight - 130) + "px";

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

  addRow("\u{1F4CB} 查看详情", () => {
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/search-query",
        { q: srdName, autoPin: true },
        { destination: "LOCAL" },
      );
    } catch {}
  });
  addRow("\u{27A1}\u{FE0F} 转移给...", async () => {
    transferItemName = srdName;
    if (currentCardId) await loadTransferCandidates(currentCardId);
    showTransferList = true;
    doRerender();
  });
  addRow("\u{1F522} 修改数量", () => {
    const newQty = prompt(`修改 ${name} 数量:`, String(qty));
    if (newQty !== null && !isNaN(Number(newQty)) && Number(newQty) > 0) {
      doUpdateItemQty(idx, Number(newQty));
    }
  });
  addRow("\u{1F5D1}\u{FE0F} 丢弃", () => {
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

// Compact name-only chips. Click → fires BC_SEARCH_QUERY to populate
// the cluster's search input. The cluster echoes its own input value
// from this broadcast so the user sees the chip text appear in the
// search box and the search popover opens with matching results.
function renderSearchChips(d: any): string {
  const sections: string[] = [];
  const features = d.features ?? {};

  const renderChips = (items: any[]) => items
    .filter((x) => x && x.name)
    .map((x) => {
      const nm = String(x.name);
      return `<span class="srch-chip" data-q="${escapeHtml(nm)}">${escapeHtml(nm)}</span>`;
    })
    .join("");

  // 特性 = race_features + class_features (merged into one tight grid).
  const featList: any[] = [];
  if (Array.isArray(features.race_features)) featList.push(...features.race_features);
  if (Array.isArray(features.class_features)) featList.push(...features.class_features);
  if (featList.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">特性</div>
      <div class="srch-grid">${renderChips(featList)}</div>
    </div>`);
  }

  // 专长 — class feats list.
  if (Array.isArray(features.feats) && features.feats.length) {
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">专长</div>
      <div class="srch-grid">${renderChips(features.feats)}</div>
    </div>`);
  }

  // 法术 — flatten always_known + prepared + cantrips_known into one
  // grid (de-duplicated by name).
  const sp = d.spellcasting ?? {};
  const allSpells: any[] = [];
  for (const key of ["cantrips_known", "always_known", "prepared"]) {
    const arr = sp[key];
    if (Array.isArray(arr)) for (const s of arr) if (s && s.name) allSpells.push(s);
  }
  if (allSpells.length) {
    const seen = new Set<string>();
    const uniq = allSpells.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });
    sections.push(`<div class="srch-sect">
      <div class="srch-sect-h">法术</div>
      <div class="srch-grid">${renderChips(uniq)}</div>
    </div>`);
  }

  return sections.join("");
}

// Single delegated click handler for ALL rollable spans inside the
// card. Reads the bound token id at click time so dice anchor on the
// currently-selected character (falls back to live selection if the
// info popover wasn't opened with one).
async function resolveBoundToken(): Promise<string | null> {
  if (boundItemId) return boundItemId;
  return resolveClickRollTarget();
}

root.addEventListener("click", async (e) => {
  // Search-chip click → fill the cluster's search input so the
  // 5etools popover opens with matching results.
  const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".srch-chip");
  if (chip) {
    e.preventDefault();
    e.stopPropagation();
    const q = chip.dataset.q ?? "";
    if (q) {
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q, autoPin: true },
          { destination: "LOCAL" },
        );
      } catch {}
    }
    chip.classList.remove("srch-flash");
    void chip.offsetWidth;
    chip.classList.add("srch-flash");
    return;
  }

  // Weapon-property chip click → same flow as the search chips.
  // Sends the property name (轻型 / 灵巧 / 缓速 / etc.) into the
  // global-search popover so the user can read the rule definition.
  const propChip = (e.target as HTMLElement | null)?.closest<HTMLElement>(".prop-chip");
  if (propChip) {
    e.preventDefault();
    e.stopPropagation();
    const q = propChip.dataset.search ?? "";
    if (q) {
      try {
        OBR.broadcast.sendMessage(
          "com.obr-suite/search-query",
          { q, autoPin: true },
          { destination: "LOCAL" },
        );
      } catch {}
    }
    return;
  }

  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(".rollable");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  const expression = target.dataset.expr ?? "";
  const label = target.dataset.label ?? "";
  if (!expression) return;
  const itemId = await resolveBoundToken();
  fireQuickRoll({
    expression,
    label,
    itemId,
    focus: !!itemId,
  });
  target.classList.remove("rollable-flash");
  void target.offsetWidth;
  target.classList.add("rollable-flash");
});

// Right-click → context menu (投掷 / 优势 / 劣势 / 添加到骰盘).
// Anchors on the bound character token so dice / camera focus are
// consistent with the left-click behavior above.
//
// The cc-info popover is opened from `characterCards/index.ts` with
// anchorPosition = { left: vw − RIGHT_OFFSET, top: anchorTop } and
// anchorOrigin = RIGHT/BOTTOM. That puts the iframe's BOTTOM-RIGHT
// in viewport at (vw − RIGHT_OFFSET, anchorTop), so its TOP-LEFT is
// (vw − RIGHT_OFFSET − innerWidth, anchorTop − innerHeight). Constants
// mirrored from characterCards/index.ts.
const CC_RIGHT_OFFSET = 12;
const CC_BOTTOM_OFFSET = 160;
const CC_INFO_GAP = 8;
const CC_BUTTON_HEIGHT = 48 + 8;
bindRollableContextMenu(
  root,
  () => "open",
  () => resolveBoundToken(),
  async () => {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth().catch(() => 1280),
      OBR.viewport.getHeight().catch(() => 720),
    ]);
    const anchorTop = vh - CC_BOTTOM_OFFSET - CC_BUTTON_HEIGHT - CC_INFO_GAP;
    return {
      left: Math.round(vw - CC_RIGHT_OFFSET - window.innerWidth),
      top: Math.round(anchorTop - window.innerHeight),
    };
  },
);

OBR.onReady(async () => {
  subscribeToSfx();
  // Cache the player's role BEFORE first render so the DM-only lock
  // button appears on first paint instead of waiting for a re-render.
  try {
    const role = await OBR.player.getRole();
    cachedIsGM = role === "GM";
  } catch {}
  // Initial card from URL — popover is opened on-demand by background.ts
  // with the ids in the query string. While the popover stays open, background
  // broadcasts in-place swaps when a different bound character is selected.
  // Drag grip is rendered inline inside .hdr (rebound after each render).
  try {
    const params = new URLSearchParams(location.search);
    const cardId = params.get("cardId");
    const roomId = params.get("roomId");
    const itemId = params.get("itemId");
    if (itemId) boundItemId = itemId;
    if (cardId && roomId) showCard(cardId, roomId);
  } catch {}

  OBR.broadcast.onMessage(SHOW_MSG, (ev: any) => {
    const p = ev?.data || {};
    // Update the bound-token used by quick-roll clicks (selecting a
    // different character should make rolls anchor on the new token).
    if (typeof p.itemId === "string") boundItemId = p.itemId;
    else if (p.itemId === null) boundItemId = null;
    if (p.cardId && p.roomId) {
      showTransferList = false;
      transferItemName = null;
      showCard(String(p.cardId), String(p.roomId));
    }
  });

  OBR.broadcast.onMessage(BC_BACKPACK_ADD_ITEM, async (ev: any) => {
    const data = ev?.data as { cardId?: string; srdName?: string; name?: string; type?: string } | undefined;
    if (!data?.cardId || !data?.srdName || !data?.name) return;
    if (data.cardId === currentCardId) {
      currentBackpack = await readBackpack(currentCardId);
      doRerender();
    }
  });
});
