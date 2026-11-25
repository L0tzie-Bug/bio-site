const audio = document.getElementById("bg-audio");
const playBtn = document.getElementById("play-btn");
const seek = document.getElementById("seek");
const timeNow = document.getElementById("time-now");
const timeTotal = document.getElementById("time-total");

const avatarImg = document.getElementById("avatar-img");
const displayNameEl = document.getElementById("display-name");
const usernameEl = document.getElementById("username");

const FALLBACK_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSaY72iEaEi4wTebkMLnuUAD6LnjcBhtTQu7eclGyedag&s";
const FALLBACK_NAME = "Lotzi";
const FALLBACK_USERNAME = "@l0tzie";

function discordAvatarUrl(id, avatarHash) {
  if (!avatarHash) {
    const defaultIndex = Number((BigInt(id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.${ext}?size=256`;
}

async function loadDiscordProfile() {
  avatarImg.src = FALLBACK_AVATAR;
  displayNameEl.textContent = FALLBACK_NAME;
  usernameEl.textContent = FALLBACK_USERNAME;

  if (typeof DISCORD_USER_ID === "undefined" || !DISCORD_USER_ID || DISCORD_USER_ID === "000000000000000000") return;

  try {
    const res = await fetch(`https://api.lanyard.rest/v1/users/${DISCORD_USER_ID}`);
    const json = await res.json();
    if (!json.success) throw new Error("Lanyard lookup failed");

    const user = json.data.discord_user;
    avatarImg.src = discordAvatarUrl(user.id, user.avatar);
    displayNameEl.textContent = user.global_name || user.username;
    usernameEl.textContent = `@${user.username}`;
  } catch (err) {
    console.warn("Could not load Discord profile, using fallback values.", err);
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateProgress() {
  const duration = audio.duration;
  const ratio = Number.isFinite(duration) && duration > 0 ? audio.currentTime / duration : 0;
  seek.value = Math.round(ratio * 1000);
  seek.style.setProperty("--fill", `${ratio * 100}%`);
  timeNow.textContent = formatTime(audio.currentTime);
  timeTotal.textContent = formatTime(duration);
}

let scrubbing = false;

playBtn.addEventListener("click", () => {
  if (audio.paused) audio.play().catch((err) => console.warn("Playback blocked.", err));
  else audio.pause();
});

audio.addEventListener("play", () => {
  playBtn.classList.add("playing");
  playBtn.setAttribute("aria-label", "Pause");
});

audio.addEventListener("pause", () => {
  playBtn.classList.remove("playing");
  playBtn.setAttribute("aria-label", "Play");
});

audio.addEventListener("timeupdate", () => {
  if (!scrubbing) updateProgress();
});

audio.addEventListener("loadedmetadata", updateProgress);
audio.addEventListener("durationchange", updateProgress);

seek.addEventListener("input", () => {
  scrubbing = true;
  const ratio = Number(seek.value) / 1000;
  seek.style.setProperty("--fill", `${ratio * 100}%`);
  if (Number.isFinite(audio.duration)) timeNow.textContent = formatTime(ratio * audio.duration);
});

seek.addEventListener("change", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  scrubbing = false;
});

audio.addEventListener("error", () => {
  console.warn("Audio failed to load.", audio.error);
});

loadDiscordProfile();
updateProgress();

const SVG_NS = "http://www.w3.org/2000/svg";

const GLITCH_SHAPES = [
  { viewBox: "0 0 24 24", ratio: 1, d: "M14 0 L3 14 L10 14 L7 24 L20 9 L13 9 Z" },
  { viewBox: "0 0 24 24", ratio: 1, d: "M12 3 L14 3 L14 17 L11 22 L5 22 L3 18 L8 15 L12 16 Z M14 3 L21 7 L21 12 L14 9 Z" },
  {
    viewBox: "0 0 24 64",
    ratio: 64 / 24,
    d: "M9 0 L15 0 L16 6 L8 6 Z M10 6 L14 6 L14 34 L10 34 Z M12 30 L18 32 L20 38 L17 42 L21 48 L19 58 L12 62 L5 58 L3 48 L7 42 L4 38 L6 32 Z M9 44 L15 44 L15 46 L9 46 Z M9 50 L15 50 L15 52 L9 52 Z"
  }
];

const glitchLayer = document.getElementById("glitch-layer");
const scratchNoise = document.getElementById("scratch-noise");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function spawnGlitch() {
  const shape = GLITCH_SHAPES[Math.floor(Math.random() * GLITCH_SHAPES.length)];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", shape.viewBox);
  svg.setAttribute("class", "glitch-shape");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", shape.d);
  path.setAttribute("fill-rule", "evenodd");
  svg.appendChild(path);

  const width = rand(70, 220);
  const height = width * shape.ratio;
  const rotation = rand(-35, 35);

  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.style.left = `${rand(-5, 95)}vw`;
  svg.style.top = `${rand(-5, 95)}vh`;
  svg.style.setProperty("--blur", `${rand(0.8, 3).toFixed(1)}px`);

  if (scratchNoise) scratchNoise.setAttribute("seed", String(Math.floor(rand(1, 999))));

  glitchLayer.appendChild(svg);

  const peak = rand(0.1, 0.2);
  const shift = rand(8, 26) * (Math.random() < 0.5 ? -1 : 1);
  const base = `rotate(${rotation}deg)`;
  const duration = rand(260, 620);

  const animation = svg.animate(
    [
      { opacity: 0, transform: base, offset: 0 },
      { opacity: peak, transform: `${base} translateX(${shift}px)`, offset: 0.12 },
      { opacity: 0, transform: base, offset: 0.24 },
      { opacity: peak * 0.7, transform: `${base} translateX(${-shift * 0.6}px)`, offset: 0.4 },
      { opacity: peak, transform: `${base} translateX(${shift * 0.3}px)`, offset: 0.55 },
      { opacity: 0, transform: base, offset: 0.7 },
      { opacity: peak * 0.5, transform: base, offset: 0.82 },
      { opacity: 0, transform: base, offset: 1 }
    ],
    { duration, easing: "steps(1, end)", fill: "forwards" }
  );

  animation.onfinish = () => svg.remove();
}

function glitchLoop() {
  if (!document.hidden) {
    spawnGlitch();
    if (Math.random() < 0.25) window.setTimeout(spawnGlitch, rand(40, 160));
  }
  window.setTimeout(glitchLoop, rand(350, 1500));
}

if (!reducedMotion && glitchLayer && typeof glitchLayer.animate === "function") {
  window.setTimeout(glitchLoop, 600);
}

const FOG_BG = { low: 0x05000d, mid: 0x3a0b78, high: 0xb36bff, zoom: 0.75, scale: 0.4, speed: 1, vignette: 1.1 };
const FOG_PANEL = { low: 0x0a0016, mid: 0x4a1396, high: 0xc58bff, zoom: 1.1, scale: 0.22, speed: 1.9, vignette: 0.5 };

const fogLayers = [];
const bgCanvas = document.createElement("canvas");
bgCanvas.id = "fog-canvas";
document.getElementById("vanta-bg").appendChild(bgCanvas);
const bgFog = createFog(bgCanvas, FOG_BG);
if (bgFog) fogLayers.push({ fog: bgFog, canvas: bgCanvas, sway: 1 });
else document.body.classList.add("no-webgl");

const panels = Array.from(document.querySelectorAll(".panel")).map((el) => {
  const canvas = document.createElement("canvas");
  canvas.className = "panel-fog";
  el.prepend(canvas);
  const fx = document.createElement("div");
  fx.className = "panel-fx";
  el.appendChild(fx);
  const fog = createFog(canvas, FOG_PANEL);
  if (fog) fogLayers.push({ fog, canvas, sway: 0.6 });
  return { el, rx: 0, ry: 0, tx: 0, ty: 0, mx: 50, my: 50 };
});

const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };
const drift = { x: 0, y: 0 };

window.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.active = true;
});

document.addEventListener("pointerleave", () => {
  pointer.active = false;
});

const resizeFog = () => fogLayers.forEach((l) => l.fog.resize());
window.addEventListener("resize", resizeFog);
window.addEventListener("load", resizeFog);
window.setTimeout(resizeFog, 400);
window.setTimeout(resizeFog, 1500);

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

let lastFrame = performance.now();
let fogTime = rand(0, 50);

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!document.hidden) {
    if (!reducedMotion) fogTime += dt;

    const nx = pointer.active ? (pointer.x / window.innerWidth) * 2 - 1 : 0;
    const ny = pointer.active ? (pointer.y / window.innerHeight) * 2 - 1 : 0;
    drift.x += (nx - drift.x) * 0.04;
    drift.y += (ny - drift.y) * 0.04;

    fogLayers.forEach((l) => l.fog.render(fogTime, drift.x * l.sway, -drift.y * l.sway));

    panels.forEach((p) => {
      const rect = p.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 - p.tx;
      const cy = rect.top + rect.height / 2 - p.ty;
      const dx = (pointer.x - cx) / (rect.width / 2);
      const dy = (pointer.y - cy) / (rect.height / 2);
      const outside = Math.hypot(Math.max(Math.abs(dx) - 1, 0), Math.max(Math.abs(dy) - 1, 0));
      const inside = outside === 0;
      const strength = pointer.active ? (inside ? 1 : Math.max(0.18, 0.7 - outside * 0.25)) : 0;
      const cdx = clamp(dx, -1.6, 1.6);
      const cdy = clamp(dy, -1.6, 1.6);
      const targetRy = cdx * 9 * strength;
      const targetRx = -cdy * 9 * strength;
      const targetTx = cdx * 12 * strength;
      const targetTy = cdy * 8 * strength;
      p.ry += (targetRy - p.ry) * 0.09;
      p.rx += (targetRx - p.rx) * 0.09;
      p.tx += (targetTx - p.tx) * 0.09;
      p.ty += (targetTy - p.ty) * 0.09;
      p.mx += ((clamp(dx, -1, 1) * 50 + 50) - p.mx) * 0.15;
      p.my += ((clamp(dy, -1, 1) * 50 + 50) - p.my) * 0.15;
      p.el.style.transform = `translate3d(${p.tx.toFixed(2)}px, ${p.ty.toFixed(2)}px, 0) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg)`;
      p.el.style.setProperty("--mx", `${p.mx.toFixed(1)}%`);
      p.el.style.setProperty("--my", `${p.my.toFixed(1)}%`);
      p.el.style.setProperty("--glow", inside ? "1" : "0");
    });
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

const boltCanvas = document.getElementById("lightning-layer");
const boltCtx = boltCanvas ? boltCanvas.getContext("2d") : null;
const bolts = [];
let boltDpr = 1;

function resizeBolts() {
  if (!boltCanvas) return;
  boltDpr = Math.min(window.devicePixelRatio || 1, 2);
  boltCanvas.width = Math.round(window.innerWidth * boltDpr);
  boltCanvas.height = Math.round(window.innerHeight * boltDpr);
}

function buildBolt(x, y, angle, length, width, depth, out) {
  let cx = x;
  let cy = y;
  let a = angle;
  const step = rand(9, 17);
  const count = Math.max(2, Math.floor(length / step));
  let w = width;
  for (let i = 0; i < count; i++) {
    a += rand(-0.55, 0.55);
    const nx = cx + Math.cos(a) * step;
    const ny = cy + Math.sin(a) * step;
    out.push([cx, cy, nx, ny, w]);
    if (depth < 3 && Math.random() < 0.13) {
      buildBolt(nx, ny, a + rand(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1), length * rand(0.25, 0.55), w * 0.65, depth + 1, out);
    }
    cx = nx;
    cy = ny;
    w *= 0.985;
  }
}

function spawnBolt() {
  if (!boltCtx || !panels.length) return;
  const panel = panels[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * panels.length)];
  const rect = panel.el.getBoundingClientRect();
  const side = Math.floor(rand(0, 4));
  let x;
  let y;
  let angle;
  if (side === 0) { x = rect.right; y = rand(rect.top, rect.bottom); angle = 0; }
  else if (side === 1) { x = rand(rect.left, rect.right); y = rect.bottom; angle = Math.PI / 2; }
  else if (side === 2) { x = rect.left; y = rand(rect.top, rect.bottom); angle = Math.PI; }
  else { x = rand(rect.left, rect.right); y = rect.top; angle = -Math.PI / 2; }
  angle += rand(-0.5, 0.5);
  const segs = [];
  buildBolt(x, y, angle, rand(120, 340), rand(1.6, 2.8), 0, segs);
  bolts.push({ segs, born: performance.now(), life: rand(260, 520) });
}

function drawBolts(now) {
  if (boltCtx) {
    boltCtx.setTransform(boltDpr, 0, 0, boltDpr, 0, 0);
    boltCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    boltCtx.lineCap = "round";
    boltCtx.lineJoin = "round";
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const age = (now - b.born) / b.life;
      if (age >= 1) {
        bolts.splice(i, 1);
        continue;
      }
      const flicker = Math.random() < 0.18 ? 0.35 : 1;
      const alpha = (1 - age) * flicker;
      boltCtx.globalAlpha = alpha;
      boltCtx.shadowColor = "#a855f7";
      boltCtx.shadowBlur = 16;
      boltCtx.strokeStyle = "#a855f7";
      boltCtx.beginPath();
      b.segs.forEach((s) => {
        boltCtx.lineWidth = s[4] * 2.2;
        boltCtx.moveTo(s[0], s[1]);
        boltCtx.lineTo(s[2], s[3]);
      });
      boltCtx.stroke();
      boltCtx.shadowBlur = 0;
      boltCtx.strokeStyle = "#f3e8ff";
      b.segs.forEach((s) => {
        boltCtx.beginPath();
        boltCtx.lineWidth = Math.max(0.6, s[4] * 0.6);
        boltCtx.moveTo(s[0], s[1]);
        boltCtx.lineTo(s[2], s[3]);
        boltCtx.stroke();
      });
    }
    boltCtx.globalAlpha = 1;
  }
  requestAnimationFrame(drawBolts);
}

function boltLoop() {
  if (!document.hidden) {
    spawnBolt();
    if (Math.random() < 0.3) window.setTimeout(spawnBolt, rand(50, 200));
  }
  window.setTimeout(boltLoop, rand(700, 2600));
}

if (boltCtx && !reducedMotion) {
  resizeBolts();
  window.addEventListener("resize", resizeBolts);
  requestAnimationFrame(drawBolts);
  window.setTimeout(boltLoop, 900);
}
