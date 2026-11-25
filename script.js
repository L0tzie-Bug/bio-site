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
    speed: 0.8,
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
