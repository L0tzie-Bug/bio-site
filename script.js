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

function initVanta() {
  if (typeof VANTA === "undefined" || !VANTA.FOG) return;
  VANTA.FOG({
    el: "#vanta-bg",
    mouseControls: false,
    touchControls: false,
    gyroControls: false,
    minHeight: 200,
    minWidth: 200,
    highlightColor: 0x2e2e2e,
    midtoneColor: 0x141414,
    lowlightColor: 0x000000,
    baseColor: 0x000000,
    blurFactor: 0.7,
    speed: 0.25,
    zoom: 3
  });
}

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

initVanta();
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
