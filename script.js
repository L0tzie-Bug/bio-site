const audio = document.getElementById("bg-audio");
const lyricsElement = document.getElementById("lyrics");
const canvas = document.getElementById("wave-canvas");
const ctx = canvas.getContext("2d");

const avatarImg = document.getElementById("avatar-img");
const displayNameEl = document.getElementById("display-name");
const usernameEl = document.getElementById("username");

const FALLBACK_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSaY72iEaEi4wTebkMLnuUAD6LnjcBhtTQu7eclGyedag&s";
const FALLBACK_NAME = "Lotzi";
const FALLBACK_USERNAME = "@l0tzie";

const SONG_TITLE = "back to friends";
const SONG_ARTIST = "sombr";
const LRCLIB = "https://lrclib.net/api";

const PIXEL_SIZE = 6;
const WAVE_GAIN = 1.7;
const WAVE_REACH = 0.44;
const WAVE_COLOR = [236, 236, 236];
const WINDOW_SAMPLES = 2048;
const ENVELOPE_RATE = 100;
const LATENCY_SECONDS = 0.03;

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

    if (!json.success) {
      throw new Error("Lanyard lookup failed");
    }

    const user = json.data.discord_user;
    avatarImg.src = discordAvatarUrl(user.id, user.avatar);
    displayNameEl.textContent = user.global_name || user.username;
    usernameEl.textContent = `@${user.username}`;
  } catch (err) {
    console.warn("Could not load Discord profile, using fallback values.", err);
  }
}

loadDiscordProfile();

let lyrics = [];
let currentLyricIndex = -1;

let loopStarted = false;

let monoSamples = null;
let sampleRate = 44100;
let bassEnvelope = null;
let loudEnvelope = null;

let liveContext = null;
let liveAnalyser = null;
let liveTime = null;
let liveFreq = null;

let smoothLoudness = 0;
let bassAverage = 0;
let beat = 0;
let lastBeatAt = 0;

let waveWidth = 0;
let waveHeight = 0;
let waveImage = null;
let wavePixels = null;

function parseLrc(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  const stamp = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const raw of lines) {
    const matches = [...raw.matchAll(stamp)];
    if (!matches.length) continue;

    const content = raw.replace(/\[[^\]]*\]/g, "").trim();

    for (const match of matches) {
      const time = Number(match[1]) * 60 + Number(match[2]);
      entries.push({ time, text: content });
    }
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function pickBestTrack(tracks) {
  const synced = tracks.filter((track) => track && track.syncedLyrics);
  if (!synced.length) return null;

  const duration = audio.duration;
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

async function loadLyrics() {
  const attempts = [
    async () => {
      const params = new URLSearchParams({ track_name: SONG_TITLE, artist_name: SONG_ARTIST });
      return requestJson(`${LRCLIB}/search?${params}`);
    },
    async () => {
      const params = new URLSearchParams({ q: `${SONG_ARTIST} ${SONG_TITLE}` });
      return requestJson(`${LRCLIB}/search?${params}`);
    },
    async () => {
      const params = new URLSearchParams({ track_name: SONG_TITLE, artist_name: SONG_ARTIST });
      return [await requestJson(`${LRCLIB}/get?${params}`)];
    }
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const tracks = Array.isArray(result) ? result : [result];
      const track = pickBestTrack(tracks);

      if (track) {
        const parsed = parseLrc(track.syncedLyrics);
        if (parsed.length) {
          lyrics = parsed;
          currentLyricIndex = -2;
          return;
        }
      }
    } catch (err) {
      console.warn("Lyrics lookup attempt failed.", err);
    }
  }

  console.warn("No synced lyrics could be loaded.");
}

loadLyrics();

function buildEnvelopes(buffer) {
  sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const channels = buffer.numberOfChannels;

  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }

  const frames = Math.ceil(length / sampleRate * ENVELOPE_RATE) + 1;
  const hop = Math.floor(sampleRate / ENVELOPE_RATE);
  const bass = new Float32Array(frames);
  const loud = new Float32Array(frames);

  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let low = 0;
  let bassSum = 0;
  let loudSum = 0;
  let count = 0;
  let frame = 0;

  for (let i = 0; i < length; i += 1) {
    const sample = mono[i];
    low += alpha * (sample - low);
    bassSum += low * low;
    loudSum += sample * sample;
    count += 1;

    if (count >= hop) {
      bass[frame] = Math.sqrt(bassSum / count);
      loud[frame] = Math.sqrt(loudSum / count);
      frame += 1;
      bassSum = 0;
      loudSum = 0;
      count = 0;
    }
  }

  let bassMax = 1e-6;
  let loudMax = 1e-6;
  for (let i = 0; i < frames; i += 1) {
    if (bass[i] > bassMax) bassMax = bass[i];
    if (loud[i] > loudMax) loudMax = loud[i];
  }
  for (let i = 0; i < frames; i += 1) {
    bass[i] /= bassMax;
    loud[i] /= loudMax;
  }

  monoSamples = mono;
  bassEnvelope = bass;
  loudEnvelope = loud;
}

async function decodeTrack(rate) {
  const res = await fetch(audio.currentSrc || audio.src);
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);

  const bytes = await res.arrayBuffer();
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decoder = new OfflineCtx(2, 1, rate);

  return new Promise((resolve, reject) => {
    const promise = decoder.decodeAudioData(bytes, resolve, reject);
    if (promise && typeof promise.then === "function") promise.then(resolve, reject);
  });
}

function startLiveFallback() {
  if (liveAnalyser || !audio.captureStream) return;

  try {
    const stream = audio.captureStream();
    liveContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = liveContext.createMediaStreamSource(stream);
    liveAnalyser = liveContext.createAnalyser();
    liveAnalyser.fftSize = 2048;
    liveAnalyser.smoothingTimeConstant = 0.2;
    liveTime = new Uint8Array(liveAnalyser.fftSize);
    liveFreq = new Uint8Array(liveAnalyser.frequencyBinCount);
    source.connect(liveAnalyser);
    liveContext.resume().catch(() => {});
  } catch (err) {
    liveAnalyser = null;
    console.warn("Live audio fallback could not start.", err);
  }
}

async function analyseTrack() {
  const rates = [22050, 11025];

  for (const rate of rates) {
    try {
      const buffer = await decodeTrack(rate);
      buildEnvelopes(buffer);
      return;
    } catch (err) {
      console.warn(`Decoding at ${rate} Hz failed.`, err);
    }
  }

  console.warn("Could not decode the track, switching to the live fallback.");
  startLiveFallback();
}

analyseTrack();

function resizeCanvas() {
  waveWidth = Math.max(1, Math.ceil(window.innerWidth / PIXEL_SIZE));
  waveHeight = Math.max(1, Math.ceil(window.innerHeight / PIXEL_SIZE));
  canvas.width = waveWidth;
  canvas.height = waveHeight;
  waveImage = ctx.createImageData(waveWidth, waveHeight);
  wavePixels = new Uint32Array(waveImage.data.buffer);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function packColor(r, g, b, a) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function startPlayback() {
  audio.muted = false;
  audio.volume = 1;

  const attempt = audio.play();

  if (attempt && typeof attempt.catch === "function") {
    attempt.catch((err) => {
      console.warn("Playback was blocked, will retry on next interaction.", err);
      const retry = () => {
        audio.muted = false;
        audio.play().catch(() => {});
      };
      document.addEventListener("pointerdown", retry, { once: true });
      document.addEventListener("keydown", retry, { once: true });
    });
  }
}

function enterSite() {
  const overlay = document.getElementById("entry-overlay");
  overlay.classList.add("fade-out");

  window.setTimeout(() => {
    overlay.style.display = "none";
  }, 1200);

  audio.currentTime = 0;
  startPlayback();

  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(frameLoop);
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

function readLiveLevels() {
  liveAnalyser.getByteFrequencyData(liveFreq);

  let bassSum = 0;
  for (let i = 1; i <= 8; i += 1) {
    bassSum += liveFreq[i];
  }

  let total = 0;
  for (let i = 0; i < liveFreq.length; i += 4) {
    total += liveFreq[i];
  }

  return {
    bass: bassSum / 8 / 255,
    loudness: Math.min(total / (liveFreq.length / 4) / 110, 1)
  };
}

function readTrackLevels(time) {
  const index = Math.min(bassEnvelope.length - 1, Math.max(0, Math.floor(time * ENVELOPE_RATE)));
  return {
    bass: bassEnvelope[index],
    loudness: Math.min(loudEnvelope[index] * 1.4, 1)
  };
}

function analyseBeat(now, levels) {
  const bass = levels.bass;
  const loudness = levels.loudness;

  smoothLoudness += (loudness - smoothLoudness) * 0.2;
  bassAverage += (bass - bassAverage) * 0.04;

  if (bass > 0.3 && bass > bassAverage * 1.16 + 0.02 && now - lastBeatAt > 170) {
    beat = 1;
    lastBeatAt = now;
    triggerLineGlitch();
  } else {
    beat *= 0.87;
    if (beat < 0.002) beat = 0;
  }
}

function trackPeakReader(time) {
  const maxStart = Math.max(0, monoSamples.length - WINDOW_SAMPLES - 1);
  const windowStart = Math.min(maxStart, Math.max(0, Math.floor(time * sampleRate)));

  return (x) => {
    const start = windowStart + Math.floor((x * WINDOW_SAMPLES) / waveWidth);
    const end = Math.max(start + 1, windowStart + Math.floor(((x + 1) * WINDOW_SAMPLES) / waveWidth));

    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = monoSamples[i];
      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }
    return peak;
  };
}

function livePeakReader() {
  liveAnalyser.getByteTimeDomainData(liveTime);

  return (x) => {
    const start = Math.floor((x * liveTime.length) / waveWidth);
    const end = Math.max(start + 1, Math.floor(((x + 1) * liveTime.length) / waveWidth));

    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const value = (liveTime[i] - 128) / 128;
      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }
    return peak;
  };
}

function drawPixelWave(now, readPeak) {
  wavePixels.fill(0);

  const middle = Math.floor(waveHeight / 2);
  const maxReach = waveHeight * WAVE_REACH;
  const gain = WAVE_GAIN + smoothLoudness * 0.5 + beat * 0.3;
  const [cr] = WAVE_COLOR;
  const flick = Math.floor(now / 70);

  for (let x = 0; x < waveWidth; x += 1) {
    const peak = readPeak(x);

    const scaled = Math.tanh(peak * gain);
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
      const level = Math.min(255, Math.floor(cr * (0.8 + brightness * 0.2)));

      const y = middle + step * direction;
      if (y < 0 || y >= waveHeight) continue;

      wavePixels[y * waveWidth + x] = packColor(level, level, level, alpha);
    }
  }

  ctx.putImageData(waveImage, 0, 0);
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

    for (const letter of word) {
      const charEl = document.createElement("span");
      charEl.className = "lyric-char";
      charEl.textContent = letter;
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

  const accent = index % 3 === 0;
  lyricsElement.appendChild(buildLine(lyric.text, duration, accent));
}

function updateLyrics() {
  if (!lyrics.length) return;

  const time = audio.currentTime + 0.05;
  let nextIndex = -1;

  for (let i = 0; i < lyrics.length; i += 1) {
    if (time >= lyrics[i].time) {
      nextIndex = i;
    } else {
      break;
    }
  }

  if (nextIndex !== currentLyricIndex) {
    currentLyricIndex = nextIndex;

    if (nextIndex === -1) {
      lyricsElement.replaceChildren();
    } else {
      showLyric(nextIndex);
    }
  }
}

function frameLoop(now) {
  if (!audio.paused) {
    if (monoSamples) {
      const time = audio.currentTime + LATENCY_SECONDS;
      analyseBeat(now, readTrackLevels(time));
      drawPixelWave(now, trackPeakReader(time));
    } else if (liveAnalyser) {
      analyseBeat(now, readLiveLevels());
      drawPixelWave(now, livePeakReader());
    }
  }

  updateLyrics();
  requestAnimationFrame(frameLoop);
}

audio.addEventListener("seeked", () => {
  currentLyricIndex = -2;
  lyricsElement.replaceChildren();
  updateLyrics();
});

audio.addEventListener("ended", () => {
  currentLyricIndex = -2;
  lyricsElement.replaceChildren();
});
