import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.7.0/+esm";

const MODEL = "claude-opus-5-5";
const KEY_STORE = "brickpicker.apiKey";
const STATE_STORE = "brickpicker.state";

// ---------- state ----------
let state = loadState() || { setName: "", parts: [] };
// parts: { id, name, color, colorHex, partNumber, needed, have }
let setFiles = [];
let floor = null; // { img: HTMLCanvasElement, w, h, detections: [{partId, x, y, r, conf, picked}] }

function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_STORE)); } catch { return null; }
}
function saveState() {
  try { localStorage.setItem(STATE_STORE, JSON.stringify(state)); } catch {}
}
function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; }
}

const $ = (id) => document.getElementById(id);

// ---------- API key ----------
$("apiKey").value = getKey();
updateKeyStatus();
$("saveKey").onclick = () => {
  try { localStorage.setItem(KEY_STORE, $("apiKey").value.trim()); } catch {}
  updateKeyStatus();
  refreshButtons();
};
function updateKeyStatus() {
  $("keyStatus").textContent = getKey() ? "✅ Key saved." : "No key yet — get one at console.anthropic.com.";
}

function client() {
  return new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });
}

// Ask Claude for JSON that matches `schema`, with images attached.
async function askClaude({ images, prompt, schema, effort }) {
  const content = [
    ...images.map((data) => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data },
    })),
    { type: "text", text: prompt },
  ];
  const stream = client().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request. Try a different photo.");
  if (msg.stop_reason === "max_tokens") throw new Error("The answer was cut off — try a photo with fewer pieces.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// ---------- images ----------
function fileToCanvas(file, maxEdge) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => reject(new Error("Couldn't open that image."));
    img.src = url;
  });
}
const toBase64 = (c) => c.toDataURL("image/jpeg", 0.9).split(",")[1];

// ---------- step 1: read the parts list ----------
$("setName").value = state.setName || "";
$("setName").oninput = (e) => { state.setName = e.target.value; saveState(); };

$("setPhotos").onchange = (e) => {
  setFiles = [...e.target.files];
  $("setThumbs").innerHTML = "";
  for (const f of setFiles) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    $("setThumbs").appendChild(img);
  }
  refreshButtons();
};

const PARTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color", "color_hex", "part_number", "quantity"],
        properties: {
          name: { type: "string" },
          color: { type: "string" },
          color_hex: { type: "string" },
          part_number: { type: "string" },
          quantity: { type: "integer" },
        },
      },
    },
  },
};

$("readSet").onclick = async () => {
  setStatus("setStatus", "Reading the parts list… (this can take a minute)");
  $("readSet").disabled = true;
  try {
    const canvases = await Promise.all(setFiles.map((f) => fileToCanvas(f, 2000)));
    const result = await askClaude({
      images: canvases.map(toBase64),
      effort: "medium",
      schema: PARTS_SCHEMA,
      prompt:
        `These photos show the parts for a LEGO set${state.setName ? ` (${state.setName})` : ""} — ` +
        `usually the parts inventory page from the instruction booklet, where each piece is pictured with a "1x", "2x" etc. count.\n\n` +
        `List every distinct piece (same shape AND same color = one entry) with how many are needed.\n` +
        `- name: short plain description a kid would understand, e.g. "2x4 brick", "1x2 plate", "1x1 round tile", "minifigure head".\n` +
        `- color: common LEGO color name, e.g. "bright red", "dark bluish gray".\n` +
        `- color_hex: a hex color like "#C91A09" that looks like that LEGO color.\n` +
        `- part_number: the element/design number if printed, else "".\n` +
        `- quantity: the count shown.\n` +
        `If the photos show assembled models instead of a parts list, list the pieces you can see as best you can.`,
    });
    state.parts = mergeParts(state.parts, result.parts);
    saveState();
    renderParts();
    setStatus("setStatus", `Found ${result.parts.length} kinds of pieces. Fix anything that looks wrong below.`);
  } catch (err) {
    setStatus("setStatus", friendlyError(err), true);
  } finally {
    refreshButtons();
  }
};

function mergeParts(existing, incoming) {
  const out = [...existing];
  for (const p of incoming) {
    const match = out.find(
      (q) => q.name.toLowerCase() === p.name.toLowerCase() && q.color.toLowerCase() === p.color.toLowerCase()
    );
    if (match) match.needed += Math.max(1, p.quantity);
    else out.push({
      id: "p" + Math.random().toString(36).slice(2, 8),
      name: p.name,
      color: p.color,
      colorHex: /^#[0-9a-f]{6}$/i.test(p.color_hex) ? p.color_hex : "#999999",
      partNumber: p.part_number,
      needed: Math.max(1, p.quantity),
      have: 0,
    });
  }
  return out;
}

$("mAdd").onclick = () => {
  const name = $("mName").value.trim();
  if (!name) return;
  state.parts = mergeParts(state.parts, [{
    name, color: $("mColor").value.trim() || "any", color_hex: "#999999",
    part_number: "", quantity: parseInt($("mQty").value, 10) || 1,
  }]);
  $("mName").value = ""; $("mColor").value = ""; $("mQty").value = 1;
  saveState(); renderParts(); refreshButtons();
};

$("resetAll").onclick = () => {
  if (!confirm("Clear the whole parts list and start over?")) return;
  state = { setName: "", parts: [] };
  floor = null;
  $("setName").value = "";
  $("stage").classList.add("hidden");
  $("foundList").innerHTML = "";
  saveState(); renderParts(); refreshButtons();
};

// ---------- checklist ----------
function renderParts() {
  const ul = $("partList");
  ul.innerHTML = "";
  const sorted = [...state.parts].sort((a, b) => (a.have >= a.needed) - (b.have >= b.needed));
  for (const p of sorted) {
    const li = document.createElement("li");
    if (p.have >= p.needed) li.classList.add("complete");
    li.innerHTML = `
      <span class="swatch" style="background:${p.colorHex}"></span>
      <div><div class="pname"></div><div class="pmeta"></div></div>
      <div class="counter">
        <button data-a="-">−</button>
        <span class="n">${p.have} / ${p.needed}</span>
        <button data-a="+">+</button>
        <button data-a="x" class="del" title="Remove">✕</button>
      </div>`;
    li.querySelector(".pname").textContent = (p.have >= p.needed ? "✓ " : "") + p.name;
    li.querySelector(".pmeta").textContent = p.color + (p.partNumber ? ` · #${p.partNumber}` : "");
    li.querySelector('[data-a="-"]').onclick = () => changeHave(p.id, -1);
    li.querySelector('[data-a="+"]').onclick = () => changeHave(p.id, +1);
    li.querySelector('[data-a="x"]').onclick = () => {
      state.parts = state.parts.filter((q) => q.id !== p.id);
      saveState(); renderParts(); refreshButtons();
    };
    ul.appendChild(li);
  }
  const need = state.parts.reduce((s, p) => s + p.needed, 0);
  const have = state.parts.reduce((s, p) => s + Math.min(p.have, p.needed), 0);
  $("progressBar").style.width = need ? `${(100 * have) / need}%` : "0";
  $("progressText").textContent = need
    ? `${have} of ${need} pieces collected · ${state.parts.filter((p) => p.have < p.needed).length} kinds still to find`
    : "No set loaded yet.";
}

function changeHave(id, delta) {
  const p = state.parts.find((q) => q.id === id);
  if (!p) return;
  const wasDone = allDone();
  p.have = Math.max(0, Math.min(p.needed, p.have + delta));
  saveState(); renderParts(); drawFloor();
  if (!wasDone && allDone()) $("done").classList.remove("hidden");
}
const allDone = () => state.parts.length > 0 && state.parts.every((p) => p.have >= p.needed);
$("closeDone").onclick = () => $("done").classList.add("hidden");

// ---------- step 2: find pieces on the floor ----------
let floorFile = null;
$("floorPhoto").onchange = (e) => { floorFile = e.target.files[0] || null; refreshButtons(); };

const FIND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detections"],
  properties: {
    detections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["part_id", "x", "y", "radius", "confidence"],
        properties: {
          part_id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          radius: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

$("scan").onclick = async () => {
  const stillNeeded = state.parts.filter((p) => p.have < p.needed);
  if (!stillNeeded.length) return setStatus("scanStatus", "You already have everything! 🎉");
  setStatus("scanStatus", "Looking through the pile… (this can take a minute or two)");
  $("scan").disabled = true;
  try {
    const c = await fileToCanvas(floorFile, 1800);
    floor = { img: c, w: c.width, h: c.height, detections: [] };
    drawFloor();
    $("stage").classList.remove("hidden");

    const list = stillNeeded
      .map((p) => `- part_id "${p.id}": ${p.name}, ${p.color}${p.partNumber ? ` (#${p.partNumber})` : ""} — need ${p.needed - p.have} more`)
      .join("\n");
    const result = await askClaude({
      images: [toBase64(c)],
      effort: "high",
      schema: FIND_SCHEMA,
      prompt:
        `This photo (${c.width}×${c.height} pixels) shows LEGO pieces on the floor. ` +
        `I'm hunting for these pieces:\n${list}\n\n` +
        `Find each piece in the photo that matches one of these (same shape AND color). For each one, give:\n` +
        `- part_id: the id from the list\n` +
        `- x, y: pixel coordinates of the piece's center in this ${c.width}×${c.height} image (0,0 = top-left)\n` +
        `- radius: pixel radius of a circle that just encloses the piece\n` +
        `- confidence: high / medium / low\n` +
        `Don't report more of a part than the "need" count — pick the easiest-to-grab ones. ` +
        `Skip pieces you aren't reasonably sure about, and don't report pieces that aren't on the list. ` +
        `Return an empty list if none are visible.`,
    });
    const ids = new Set(stillNeeded.map((p) => p.id));
    floor.detections = result.detections
      .filter((d) => ids.has(d.part_id))
      .map((d) => ({
        partId: d.part_id,
        x: clamp(d.x, 0, c.width), y: clamp(d.y, 0, c.height),
        r: clamp(d.radius, 14, Math.max(c.width, c.height) / 4),
        conf: d.confidence, picked: false,
      }));
    drawFloor();
    renderFound();
    setStatus("scanStatus", floor.detections.length
      ? `Circled ${floor.detections.length} piece${floor.detections.length > 1 ? "s" : ""}. Pick one up, then tap its circle to check it off.`
      : "Didn't spot any of your pieces in this photo. Try another angle or spread the pile out.");
  } catch (err) {
    setStatus("scanStatus", friendlyError(err), true);
  } finally {
    refreshButtons();
  }
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const partById = (id) => state.parts.find((p) => p.id === id);

function drawFloor() {
  if (!floor) return;
  const cv = $("canvas");
  cv.width = floor.w; cv.height = floor.h;
  const ctx = cv.getContext("2d");
  ctx.drawImage(floor.img, 0, 0);
  const lw = Math.max(3, floor.w / 300);
  floor.detections.forEach((d, i) => {
    const color = d.picked ? "#1f9d55" : d.conf === "low" ? "#ffcf00" : "#ff2a2a";
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r + lw, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.stroke();
    if (d.picked) { ctx.fillStyle = "rgba(31,157,85,.35)"; ctx.fill(); }
    // number tag
    const fs = Math.max(16, floor.w / 55);
    const tx = d.x + d.r * 0.72, ty = d.y - d.r * 0.72;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(tx, ty, fs * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = d.picked ? "#fff" : "#000";
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(d.picked ? "✓" : String(i + 1), tx, ty + 1);
  });
}

function renderFound() {
  const ul = $("foundList");
  ul.innerHTML = "";
  floor?.detections.forEach((d, i) => {
    const p = partById(d.partId);
    const li = document.createElement("li");
    li.innerHTML = `<b></b> <span></span>`;
    li.querySelector("b").textContent = `${d.picked ? "✓" : "#" + (i + 1)}`;
    li.querySelector("span").textContent =
      `${p ? `${p.name} (${p.color})` : "removed piece"}${d.conf === "low" ? " — not sure, check it" : ""}`;
    if (d.picked) li.style.textDecoration = "line-through";
    ul.appendChild(li);
  });
}

$("canvas").onclick = (e) => {
  if (!floor) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * floor.w;
  const y = ((e.clientY - rect.top) / rect.height) * floor.h;
  let best = null, bestDist = Infinity;
  for (const d of floor.detections) {
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist < Math.max(d.r * 1.3, floor.w / 25) && dist < bestDist) { best = d; bestDist = dist; }
  }
  if (!best) return;
  best.picked = !best.picked;
  changeHave(best.partId, best.picked ? +1 : -1);
  renderFound();
};

// ---------- helpers ----------
function setStatus(id, msg, isErr = false) {
  $(id).textContent = msg;
  $(id).classList.toggle("err", isErr);
}
function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "That API key didn't work — check it in step 0.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now — wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude — check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error: ${err.message}`;
  return err?.message || String(err);
}
function refreshButtons() {
  const hasKey = !!getKey();
  $("readSet").disabled = !(hasKey && setFiles.length);
  $("scan").disabled = !(hasKey && floorFile && state.parts.length);
}

renderParts();
refreshButtons();
