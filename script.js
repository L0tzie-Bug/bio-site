const audio = document.getElementById("bg-audio");
const lyricsElement = document.getElementById("lyrics");
const canvas = document.getElementById("wave-canvas");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const overlay = document.getElementById("entry-overlay");
const crtFlash = document.getElementById("crt-flash");
const card = document.getElementById("profile-card");
const socials = document.getElementById("socials");

const avatarImg = document.getElementById("avatar-img");
const displayNameEl = document.getElementById("display-name");
const usernameEl = document.getElementById("username");
const bioEl = document.getElementById("profile-bio");

const FALLBACK_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSaY72iEaEi4wTebkMLnuUAD6LnjcBhtTQu7eclGyedag&s";
const FALLBACK_NAME = "Lotzi";
const FALLBACK_USERNAME = "@l0tzie";

const SONG_TITLE = "back to friends";
const SONG_ARTIST = "sombr";
const LRCLIB = "https://lrclib.net/api";

const PIXEL_SIZE = 6;
const WAVE_GAIN = 1.5;
const WAVE_REACH = 0.4;
const WAVE_COLOR = 236;
const FFT_SIZE = 2048;
const WINDOW_SAMPLES = 1024;
const SMOOTH_SAMPLE = 0.22;
const SMOOTH_COLUMN = 0.5;

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLYPHS = "#@$%&?!/\\|<>=+*0123456789";

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

  if (typeof DISCORD_USER_ID === "undefined" || !DISCORD_USER_ID || DISCORD_USER_ID === "000000000000000000") {
    return;
  }

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

loadDiscordProfile();

let entered = false;
let loopStarted = false;

let lyrics = [];
let currentLyricIndex = -2;
let lyricsRequested = false;

let audioCtx = null;
let analyser = null;
let freqData = null;
let timeData = null;
let filtered = null;
let silentFrames = 0;
let useSynth = window.location.protocol === "file:";

let smoothLoudness = 0;
let bassAverage = 0;
let lastBeatAt = 0;

let waveCols = 0;
let waveRows = 0;
let waveImage = null;
let wavePixels = null;
let columns = null;

function parseLrc(text) {
  const entries = [];
  const stamp = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const raw of text.split(/\r?\n/)) {
    const matches = [...raw.matchAll(stamp)];
    if (!matches.length) continue;
    const content = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const match of matches) {
      entries.push({ time: Number(match[1]) * 60 + Number(match[2]), text: content });
    }
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function pickBestTrack(tracks, duration) {
  const synced = tracks.filter((track) => track && track.syncedLyrics);
  if (!synced.length) return null;
  if (!Number.isFinite(duration) || duration <= 0) return synced[0];

  let best = synced[0];
  let bestDiff = Infinity;
  for (const track of synced) {
    const diff = Math.abs((track.duration || 0) - duration);
    if (diff < bestDiff) {
      best = track;
      bestDiff = diff;
    }
  }
  return best;
}

async function requestJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadLyrics(duration) {
  const attempts = [
    () => requestJson(`${LRCLIB}/search?${new URLSearchParams({ track_name: SONG_TITLE, artist_name: SONG_ARTIST })}`),
    () => requestJson(`${LRCLIB}/search?${new URLSearchParams({ q: `${SONG_ARTIST} ${SONG_TITLE}` })}`),
    async () => [await requestJson(`${LRCLIB}/get?${new URLSearchParams({ track_name: SONG_TITLE, artist_name: SONG_ARTIST })}`)]
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const track = pickBestTrack(Array.isArray(result) ? result : [result], duration);
      if (!track) continue;

      const parsed = parseLrc(track.syncedLyrics);
      if (parsed.length) {
        lyrics = parsed;
        currentLyricIndex = -2;
        return;
      }
    } catch (err) {
      console.warn("Lyrics lookup attempt failed.", err);
    }
  }
}

function requestLyricsOnce() {
  if (lyricsRequested) return;
  lyricsRequested = true;
  loadLyrics(audio.duration);
}

if (Number.isFinite(audio.duration) && audio.duration > 0) {
  requestLyricsOnce();
} else {
  audio.addEventListener("loadedmetadata", requestLyricsOnce, { once: true });
  window.setTimeout(requestLyricsOnce, 4000);
}

function setupAnalyser() {
  if (useSynth || analyser) return;

  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
    const source = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.55;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    filtered = new Float32Array(analyser.fftSize);

    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioCtx.resume().catch(() => {});
  } catch (err) {
    console.warn("Analyser unavailable, using the built-in pattern.", err);
    analyser = null;
    useSynth = true;
  }
}

function synthSignal(time) {
  if (!freqData) freqData = new Uint8Array(FFT_SIZE / 2);
  if (!timeData) timeData = new Uint8Array(FFT_SIZE);
  if (!filtered) filtered = new Float32Array(FFT_SIZE);

  const pulse = Math.pow(Math.max(0, Math.sin(time * 2.1 * Math.PI)), 6);
  const amp = 0.3 + pulse * 0.45;

  for (let i = 0; i < FFT_SIZE; i += 1) {
    const t = time + i / 44100;
    const v = Math.sin(t * 2 * Math.PI * 110) * 0.6 + Math.sin(t * 2 * Math.PI * 330 + 1.3) * 0.25 + Math.sin(t * 2 * Math.PI * 770) * 0.1;
    timeData[i] = 128 + v * amp * 127;
  }

  for (let i = 0; i < freqData.length; i += 1) {
    freqData[i] = Math.max(0, Math.min(255, (Math.exp(-i / 40) * (0.4 + pulse * 0.5)) * 255));
  }
}

function readSpectrum() {
  if (!audio.paused && analyser) {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    let sum = 0;
    for (let i = 1; i < 64; i += 1) sum += freqData[i];

    if (sum === 0) {
      silentFrames += 1;
      if (silentFrames > 180 && audio.currentTime > 2) useSynth = true;
    } else {
      silentFrames = 0;
    }
  }

  if (useSynth && !audio.paused) {
    synthSignal(audio.currentTime);
  }

  return freqData;
}

function analyseBeat(now, data) {
  let bass = 0;
  for (let i = 1; i <= 5; i += 1) bass += data[i];
  bass /= 5 * 255;

  let total = 0;
  for (let i = 1; i < 240; i += 4) total += data[i];
  const loudness = Math.min(total / 60 / 140, 1);

  smoothLoudness += (loudness - smoothLoudness) * 0.2;
  bassAverage += (bass - bassAverage) * 0.04;

  if (bass > 0.35 && bass > bassAverage * 1.18 + 0.03 && now - lastBeatAt > 180) {
    lastBeatAt = now;
    triggerLineGlitch();
  }
}

function resizeCanvas() {
  waveCols = Math.max(1, Math.ceil(window.innerWidth / PIXEL_SIZE));
  waveRows = Math.max(1, Math.ceil(window.innerHeight / PIXEL_SIZE));
  canvas.width = waveCols;
  canvas.height = waveRows;
  waveImage = ctx.createImageData(waveCols, waveRows);
  wavePixels = new Uint32Array(waveImage.data.buffer);
  columns = new Float32Array(waveCols);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function packColor(r, g, b, a) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function updateColumns() {
  const playing = !audio.paused && timeData && filtered;

  if (!playing) {
    for (let x = 0; x < waveCols; x += 1) columns[x] *= 0.85;
    return;
  }

  const n = timeData.length;
  let low = 0;
  for (let i = 0; i < n; i += 1) {
    low += SMOOTH_SAMPLE * ((timeData[i] - 128) / 128 - low);
    filtered[i] = low;
  }

  let start = 0;
  const limit = n - WINDOW_SAMPLES - 1;
  for (let i = 1; i < limit; i += 1) {
    if (filtered[i - 1] < 0 && filtered[i] >= 0) {
      start = i;
      break;
    }
  }

  for (let x = 0; x < waveCols; x += 1) {
    const from = start + Math.floor((x * WINDOW_SAMPLES) / waveCols);
    const to = Math.max(from + 1, start + Math.floor(((x + 1) * WINDOW_SAMPLES) / waveCols));

    let peak = 0;
    for (let i = from; i < to; i += 1) {
      if (Math.abs(filtered[i]) > Math.abs(peak)) peak = filtered[i];
    }

    columns[x] += (peak - columns[x]) * SMOOTH_COLUMN;
  }
}

function drawPixelWave(now) {
  updateColumns();
  wavePixels.fill(0);

  const middle = Math.floor(waveRows / 2);
  const maxReach = waveRows * WAVE_REACH;
  const gain = WAVE_GAIN + smoothLoudness * 0.8;
  const flick = Math.floor(now / 70);

  for (let x = 0; x < waveCols; x += 1) {
    const scaled = Math.tanh(columns[x] * gain * 2.2);
    let reach = Math.round((scaled * maxReach) / 2) * 2;
    const direction = reach >= 0 ? 1 : -1;
    reach = Math.abs(reach);

    for (let step = 0; step <= reach; step += 1) {
      const t = reach === 0 ? 1 : step / reach;
      const grainSeed = Math.sin((x * 12.9898 + step * 78.233 + flick * 37.719) * 0.5) * 43758.5453;
      const rand = grainSeed - Math.floor(grainSeed);

      const isTip = step >= reach - 1;
      const dropout = 0.12 + (1 - t) * 0.5;

      if (!isTip && rand < dropout) continue;

      const brightness = isTip ? 1 : 0.45 + t * 0.4 + (rand - 0.5) * 0.35;
      const alpha = Math.max(40, Math.min(255, Math.floor(brightness * 255)));
      const level = Math.min(255, Math.floor(WAVE_COLOR * (0.8 + brightness * 0.2)));

      const y = middle + step * direction;
      if (y < 0 || y >= waveRows) continue;

      wavePixels[y * waveCols + x] = packColor(level, level, level, alpha);
    }
  }

  ctx.putImageData(waveImage, 0, 0);
}

function isHow(word) {
  return /^how(s)?$/i.test(word.replace(/[^a-z]/gi, ""));
}

function buildLine(text, duration, accent) {
  const line = document.createElement("div");
  line.className = "lyric-line";
  if (accent) line.classList.add("accent");
  line.setAttribute("aria-label", text);

  const words = text.split(/\s+/).filter(Boolean);
  const totalChars = words.reduce((sum, word) => sum + word.length, 0);
  const spread = Math.max(0.9, Math.min(duration * 0.85, 2.8));
  const perChar = spread / Math.max(totalChars, 1);

  let charIndex = 0;

  for (const word of words) {
    const wordEl = document.createElement("span");
    wordEl.className = "lyric-word";
    wordEl.setAttribute("aria-hidden", "true");

    if (isHow(word)) {
      wordEl.classList.add("how");
      wordEl.dataset.text = word;
      wordEl.style.setProperty("--d", (charIndex * perChar).toFixed(3));
    }

    for (const letter of word) {
      const charEl = document.createElement("span");
      charEl.className = "lyric-char";
      charEl.textContent = letter;
      charEl.dataset.ch = letter;
      charEl.style.setProperty("--d", (charIndex * perChar).toFixed(3));
      wordEl.appendChild(charEl);
      charIndex += 1;
    }

    line.appendChild(wordEl);
  }

  return line;
}

function showLyric(index) {
  const lyric = lyrics[index];
  const next = lyrics[index + 1];
  const end = next ? next.time : (Number.isFinite(audio.duration) ? audio.duration : lyric.time + 4);
  const duration = Math.max(0.4, end - lyric.time);

  const previousLine = lyricsElement.querySelector(".lyric-line:not(.leaving)");
  if (previousLine) {
    previousLine.classList.add("leaving");
    window.setTimeout(() => previousLine.remove(), 950);
  }

  if (!lyric.text) return;
  lyricsElement.appendChild(buildLine(lyric.text, duration, index % 3 === 0));
}

function updateLyrics() {
  if (!lyrics.length) return;

  const time = audio.currentTime + 0.05;
  let nextIndex = -1;

  for (let i = 0; i < lyrics.length; i += 1) {
    if (time >= lyrics[i].time) nextIndex = i;
    else break;
  }

  if (nextIndex !== currentLyricIndex) {
    currentLyricIndex = nextIndex;
    if (nextIndex === -1) lyricsElement.replaceChildren();
    else showLyric(nextIndex);
  }
}

function triggerLineGlitch() {
  const line = lyricsElement.querySelector(".lyric-line:not(.leaving)");
  if (!line) return;

  line.classList.remove("glitch-hit");
  void line.offsetWidth;
  line.classList.add("glitch-hit");
  window.setTimeout(() => line.classList.remove("glitch-hit"), 260);
}

if (!REDUCED_MOTION) {
  window.setInterval(() => {
    const chars = lyricsElement.querySelectorAll(".lyric-line:not(.leaving) .lyric-word.how .lyric-char");
    for (const el of chars) {
      if (Math.random() < 0.22) {
        el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      } else if (el.textContent !== el.dataset.ch) {
        el.textContent = el.dataset.ch;
      }
    }
  }, 70);
}

function scramble(el, duration) {
  const finalText = el.textContent;
  if (!finalText || REDUCED_MOTION) return;

  const start = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const settled = Math.floor(progress * finalText.length);
    let out = "";

    for (let i = 0; i < finalText.length; i += 1) {
      const ch = finalText[i];
      if (i < settled || ch === " ") out += ch;
      else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }

    el.textContent = out;

    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = el.dataset.final || finalText;
  }

  el.dataset.final = finalText;
  requestAnimationFrame(tick);
}

function revealBio() {
  card.classList.add("revealed", "glitch-in");
  scramble(displayNameEl, 850);
  scramble(usernameEl, 950);
  scramble(bioEl, 1000);

  window.setTimeout(() => {
    socials.classList.add("revealed", "glitch-in");
  }, 420);

  window.setTimeout(() => {
    card.classList.remove("glitch-in");
    socials.classList.remove("glitch-in");
  }, 1700);
}

let lastDraw = 0;

function frameLoop(now) {
  try {
    const data = readSpectrum();
    if (data && !audio.paused) analyseBeat(now, data);
    if (now - lastDraw > 15) {
      drawPixelWave(now);
      lastDraw = now;
    }
    updateLyrics();
  } catch (err) {
    console.warn("Frame error.", err);
  }

  requestAnimationFrame(frameLoop);
}

function startPlayback() {
  audio.muted = false;
  audio.volume = 1;
  if (audioCtx) audioCtx.resume().catch(() => {});

  const attempt = audio.play();
  if (attempt && typeof attempt.catch === "function") {
    attempt.catch((err) => {
      console.warn("Playback was blocked, will retry on next interaction.", err);
      const retry = () => {
        audio.play().catch(() => {});
        if (audioCtx) audioCtx.resume().catch(() => {});
      };
      document.addEventListener("pointerdown", retry, { once: true });
      document.addEventListener("keydown", retry, { once: true });
    });
  }
}

function enterSite() {
  if (entered) return;
  entered = true;

  overlay.style.display = "none";

  stage.classList.add("on");
  if (!REDUCED_MOTION) crtFlash.classList.add("on");

  setupAnalyser();
  audio.currentTime = 0;
  startPlayback();

  window.setTimeout(() => crtFlash.remove(), 1300);
  window.setTimeout(revealBio, REDUCED_MOTION ? 0 : 750);

  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(frameLoop);
  }
}

window.enterSite = enterSite;

overlay.addEventListener("click", enterSite);
overlay.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    enterSite();
  }
});

audio.addEventListener("seeked", () => {
  currentLyricIndex = -2;
  lyricsElement.replaceChildren();
  updateLyrics();
});

audio.addEventListener("ended", () => {
  currentLyricIndex = -2;
  lyricsElement.replaceChildren();
});

audio.addEventListener("error", () => {
  console.warn("Audio failed to load.", audio.error);
});
