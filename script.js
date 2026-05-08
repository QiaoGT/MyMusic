const CONFIG = {
  user: "QiaoGT",
  repo: "MyMusic",
  branch: "main",
  musicFolder: "mus",
  lrcFolder: "lrc",
  imgFolder: "img"
};

const AUDIO_EXTS = [".mp3", ".flac", ".wav", ".m4a", ".ogg"];
const COVER_EXTS = ["jpg", "jpeg", "png", "webp"];
const LYRIC_EXTS = [".lrc", ".srt"];
const PLAY_MODES = ["list", "single", "shuffle"];
const PLAY_MODE_ICON = { list: "🔁", single: "🔂", shuffle: "🔀" };
const PLAY_MODE_TEXT = { list: "顺序", single: "单曲", shuffle: "随机" };

const cdn = `https://raw.githubusercontent.com/${CONFIG.user}/${CONFIG.repo}/${CONFIG.branch}`;
const commitsApiBase = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/commits`;
const MANIFEST_URL = "./playlist.json";

const DEFAULT_COVER =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#17233a"/><stop offset="100%" stop-color="#0a101a"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="90" fill="#334155"/><circle cx="200" cy="200" r="22" fill="#d9e3f3"/><text x="200" y="340" text-anchor="middle" font-size="26" fill="#ecf3ff" font-family="Arial">MyMusic</text></svg>`);

const audio = document.getElementById("audio");
audio.crossOrigin = "anonymous";
const coverEl = document.getElementById("cover");
const titleEl = document.getElementById("title");
const listEl = document.getElementById("list");
const lyricsEl = document.getElementById("lyrics");
const miniProgressEl = document.getElementById("mini-progress");
const volumeEl = document.getElementById("volume");
const miniNowEl = document.getElementById("mini-now");
const miniTotalEl = document.getElementById("mini-total");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const modeBtn = document.getElementById("mode");
const prevBtn = document.getElementById("prev");
const playBtn = document.getElementById("play");
const nextBtn = document.getElementById("next");
const fullBtn = document.getElementById("btn-full");
const lyricSettingsBtn = document.getElementById("btn-lyric-settings");
const lyricModal = document.getElementById("lyric-modal");
const lyricTextColorInput = document.getElementById("lyric-text-color");
const lyricFillColorInput = document.getElementById("lyric-fill-color");
const lyricSaveBtn = document.getElementById("lyric-save");
const lyricCancelBtn = document.getElementById("lyric-cancel");
const stageEl = document.getElementById("lyrics-stage");
const lyricsMaskEl = document.querySelector(".lyrics-mask");
const spectrumEl = document.getElementById("spectrum");
const fullscreenSpectrumEl = document.getElementById("fullscreen-spectrum");
const authOverlayEl = document.getElementById("auth-overlay");
const authInputEl = document.getElementById("auth-input");
const authSubmitEl = document.getElementById("auth-submit");
const authMsgEl = document.getElementById("auth-msg");

let playlist = [];
let lrcLines = [];
let currentIndex = 0;
let playMode = "list";
let rafId = 0;
let coverSet = new Set();
let lrcMap = new Map();

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let freqData = null;
let spectrumPhase = 0;
let spectrumSmooth = [];
let gradientPhase = 0;
let lyricManualUntil = 0;
let fullscreenHideTimer = null;
const uploadDateCache = new Map();
let fullscreenSpectrumTimer = null;
let appReady = false;

function safeText(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}
function baseName(fileName) {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(0, i) : fileName;
}
function normalizeName(s) {
  return String(s).normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[·•\-_/\\()[\]{}【】「」'"`~!@#$%^&*+=|;:,.<>?，。！？：；（）]/g, "");
}
function setStatus(msg) { statusEl.textContent = msg; }

function applyLyricColors(textColor, fillColor) {
  document.documentElement.style.setProperty("--lyric-active-text", textColor);
  document.documentElement.style.setProperty("--lyric-fill-color", fillColor);
}

function parseLrc(text) {
  const parsed = text
    .split(/\r?\n/)
    .flatMap((line) => {
      const raw = line.trim();
      if (!raw) return [];

      const content = raw.replace(/\[[^\]]*\]/g, "").trim();
      const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
      return tags.map((m) => ({ time: Number(m[1]) * 60 + Number(m[2]), text: content || "..." }));
    })
    .filter((x) => Number.isFinite(x.time))
    .sort((a, b) => a.time - b.time);
  return parsed;
}

function parseSrt(text) {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  const out = [];
  const toSec = (raw) => {
    const m = raw.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!m) return NaN;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
  };

  for (const block of blocks) {
    const rows = block.split("\n").map((x) => x.trim()).filter(Boolean);
    if (rows.length < 2) continue;
    const timeline = rows.find((x) => x.includes("-->"));
    if (!timeline) continue;
    const [startRaw] = timeline.split("-->");
    const start = toSec(startRaw || "");
    if (!Number.isFinite(start)) continue;

    const startIdx = rows.indexOf(timeline) + 1;
    const lineText = rows.slice(startIdx).filter((x) => !/^\d+$/.test(x)).join(" ").trim();
    if (!lineText) continue;
    out.push({ time: start, text: lineText });
  }

  return out.sort((a, b) => a.time - b.time);
}

async function fetchManifest() {
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`清单读取失败 ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.music) || !Array.isArray(data.lyrics) || !Array.isArray(data.covers)) {
    throw new Error("playlist.json 格式无效");
  }
  return data;
}

function buildLookup(manifest) {
  coverSet = new Set();
  lrcMap = new Map();

  manifest.covers.forEach((fn) => {
    if (typeof fn === "string") coverSet.add(fn.toLowerCase());
  });

  manifest.lyrics.forEach((fn) => {
    if (typeof fn !== "string") return;
    if (!LYRIC_EXTS.some((ext) => fn.toLowerCase().endsWith(ext))) return;
    const key = normalizeName(baseName(fn));
    const prev = lrcMap.get(key);
    if (!prev || fn.toLowerCase().endsWith(".lrc")) lrcMap.set(key, fn);
  });
}

function resolveCover(songBase) {
  for (const prefix of [`${songBase}-cover`, songBase]) {
    for (const ext of COVER_EXTS) {
      const fn = `${prefix}.${ext}`;
      if (coverSet.has(fn.toLowerCase())) return `${cdn}/${CONFIG.imgFolder}/${encodeURIComponent(fn)}`;
    }
  }
  return DEFAULT_COVER;
}

function resolveLrc(songBase) {
  const normalized = normalizeName(songBase);
  const exact = lrcMap.get(normalized);
  if (exact) return { fileName: exact, url: `${cdn}/${CONFIG.lrcFolder}/${encodeURIComponent(exact)}` };

  // Fuzzy fallback: match by inclusion first.
  const candidates = [...lrcMap.entries()];
  const fuzzy = candidates.find(([key]) => key.includes(normalized) || normalized.includes(key));
  if (fuzzy) {
    const fileName = fuzzy[1];
    return { fileName, url: `${cdn}/${CONFIG.lrcFolder}/${encodeURIComponent(fileName)}` };
  }

  // Similarity fallback: require high overlap to avoid mismatching unrelated songs.
  const score = (a, b) => {
    if (!a || !b) return 0;
    const min = Math.min(a.length, b.length);
    let samePrefix = 0;
    for (let i = 0; i < min; i += 1) {
      if (a[i] !== b[i]) break;
      samePrefix += 1;
    }
    return samePrefix / Math.max(a.length, b.length);
  };
  let best = null;
  for (const [key, fileName] of candidates) {
    const s = score(normalized, key);
    if (!best || s > best.s) best = { s, fileName };
  }
  if (best && best.s >= 0.6) {
    return { fileName: best.fileName, url: `${cdn}/${CONFIG.lrcFolder}/${encodeURIComponent(best.fileName)}` };
  }

  const fileName = `${songBase}.lrc`;
  return { fileName, url: `${cdn}/${CONFIG.lrcFolder}/${encodeURIComponent(fileName)}` };
}

function hasLrc(songBase) {
  return lrcMap.has(normalizeName(songBase));
}

function renderList() {
  listEl.innerHTML = playlist
    .map((s, i) => `<li data-i="${i}" class="${i === currentIndex ? "active" : ""}">${safeText(s.name)}</li>`)
    .join("");
  countEl.textContent = String(playlist.length);
}

function renderLyrics() {
  if (!lrcLines.length) {
    lyricsEl.innerHTML = "<p>暂无歌词</p>";
    return;
  }
  lyricsEl.innerHTML = lrcLines
    .map((l) => `<p data-time="${l.time}"><span class="lyric-line"><span class="base">${safeText(l.text)}</span><span class="fill">${safeText(l.text)}</span></span></p>`)
    .join("");
}

function updateLyrics() {
  if (!lrcLines.length) return;
  const t = audio.currentTime;
  let idx = -1;
  for (let i = 0; i < lrcLines.length; i += 1) {
    if (t >= lrcLines[i].time) idx = i;
    else break;
  }
  const ps = lyricsEl.querySelectorAll("p");
  ps.forEach((p) => p.classList.remove("active"));
  ps.forEach((p, i) => {
    const fill = p.querySelector(".fill");
    if (!fill) return;
    if (i < idx) fill.style.width = "100%";
    if (i > idx) fill.style.width = "0%";
  });

  // Before the first lyric timestamp: keep all lines inactive.
  if (idx < 0) {
    ps.forEach((p) => {
      const fill = p.querySelector(".fill");
      if (fill) fill.style.width = "0%";
    });
    return;
  }

  const p = ps[idx];
  if (!p) return;
  p.classList.add("active");

  const start = lrcLines[idx].time;
  const end = lrcLines[idx + 1] ? lrcLines[idx + 1].time : start + 3;
  const ratio = Math.max(0, Math.min(1, (t - start) / Math.max(0.5, end - start)));
  const fill = p.querySelector(".fill");
  if (fill) fill.style.width = `${ratio * 100}%`;

  if (Date.now() < lyricManualUntil) return;
  const container = lyricsEl.parentElement;
  if (!container) return;
  // Use viewport-space correction to avoid layout/scale drift on desktop.
  const cRect = container.getBoundingClientRect();
  const pRect = p.getBoundingClientRect();
  const containerCenter = cRect.top + cRect.height * 0.5;
  const lineCenter = pRect.top + pRect.height * 0.5;
  const delta = containerCenter - lineCenter;
  const current = getComputedStyle(lyricsEl).transform;
  const currentY = current && current !== "none" ? new DOMMatrix(current).m42 : 0;
  const nextY = currentY + delta;
  lyricsEl.style.transform = `translateY(${nextY}px)`;
}

function resetLyricsToStart() {
  lyricsEl.style.transform = "translateY(0)";
  const ps = lyricsEl.querySelectorAll("p");
  ps.forEach((p) => p.classList.remove("active"));
  ps.forEach((p, i) => {
    const fill = p.querySelector(".fill");
    if (fill) fill.style.width = "0%";
  });
}

function setPlayIcon(paused) {
  playBtn.textContent = paused ? "▶" : "⏸";
  playBtn.setAttribute("data-tip", paused ? "播放" : "暂停");
}
function setModeIcon() {
  modeBtn.textContent = PLAY_MODE_ICON[playMode];
  modeBtn.setAttribute("data-tip", `模式：${PLAY_MODE_TEXT[playMode]}`);
}

function formatUploadDate(isoTime) {
  if (isoTime === null || isoTime === undefined || isoTime === "") return "日期未知";
  let d;
  if (typeof isoTime === "number") {
    // jsDelivr sources may return seconds or milliseconds
    d = new Date(isoTime < 1e12 ? isoTime * 1000 : isoTime);
  } else if (/^\d+$/.test(String(isoTime).trim())) {
    const n = Number(isoTime);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    d = new Date(isoTime);
  }
  if (Number.isNaN(d.getTime())) return "日期未知";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchCommitDateForMusicFile(fileName) {
  if (uploadDateCache.has(fileName)) return uploadDateCache.get(fileName);
  const path = `${CONFIG.musicFolder}/${fileName}`;
  const url = `${commitsApiBase}?path=${encodeURIComponent(path)}&sha=${CONFIG.branch}&per_page=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const commits = await res.json();
    const commitDate = commits?.[0]?.commit?.author?.date || commits?.[0]?.commit?.committer?.date || "";
    uploadDateCache.set(fileName, commitDate);
    return commitDate;
  } catch {
    return "";
  }
}

function ensureAnalyser() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  sourceNode = audioCtx.createMediaElementSource(audio);
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

function drawSpectrum() {
  // Keep non-fullscreen spectrum as previous behavior.
  drawSpectrumOn(spectrumEl, 1, 1);
  if (document.fullscreenElement === stageEl) {
    const dimmed = stageEl.classList.contains("spectrum-dim");
    drawSpectrumOn(fullscreenSpectrumEl, dimmed ? 0.72 : 1, 1.7);
  }
}

function drawSpectrumOn(canvas, alphaFactor = 1, ampBoost = 1) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bars = Math.max(96, Math.floor(w / 10));
  const half = Math.floor(bars / 2);
  const gap = 3;
  const barW = Math.max(1, (w - gap * (bars - 1)) / bars);
  const step = barW + gap;
  if (!analyser || !freqData) {
    spectrumPhase += 0.08;
    for (let i = 0; i < half; i += 1) {
      const wave = (Math.sin(spectrumPhase + i * 0.25) + 1) / 2;
      const bh = Math.max(2, wave * h * 0.45);
      const xLeft = (half - 1 - i) * step;
      const xRight = (half + i) * step;
      const y = h - bh;
      ctx.fillStyle = `rgba(237,244,255,${0.35 * alphaFactor})`;
      const rr = Math.min(6, barW / 2, bh / 2);
      ctx.beginPath();
      ctx.roundRect(xLeft, y, barW, bh, rr);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(xRight, y, barW, bh, rr);
      ctx.fill();
    }
    return;
  }

  analyser.getByteFrequencyData(freqData);
  if (spectrumSmooth.length !== half) spectrumSmooth = new Array(half).fill(0);
  gradientPhase += 0.0025;
  let energySum = 0;
  for (let i = 0; i < freqData.length; i += 1) energySum += freqData[i];
  const globalEnergy = energySum / (freqData.length * 255);

  const heights = new Array(half).fill(0);
  for (let i = 0; i < half; i += 1) {
    const pos = half <= 1 ? 0 : i / (half - 1); // 0 center, 1 edges
    const mapped = Math.pow(pos, 0.95);
    const binIndex = Math.min(freqData.length - 1, Math.floor(mapped * (freqData.length - 1)));
    const raw = freqData[binIndex] / 255;
    const nextRaw = freqData[Math.min(freqData.length - 1, binIndex + 1)] / 255;
    const prevRaw = freqData[Math.max(0, binIndex - 1)] / 255;
    const localEnergy = (raw + nextRaw + prevRaw) / 3;
    const sidePulse = 0.08 + 0.08 * (Math.sin(gradientPhase * 8 + i * 0.24) * 0.5 + 0.5);
    const lifted = localEnergy * 0.78 + globalEnergy * 0.16 + sidePulse * 0.06;
    const boosted = Math.pow(Math.max(0, Math.min(1, lifted)), 0.54);
    spectrumSmooth[i] = spectrumSmooth[i] * 0.64 + boosted * 0.36;
    const edgeWeight = Math.pow(pos, 0.8);
    const dynamicFloor = h * (0.09 + 0.08 * globalEnergy + 0.14 * edgeWeight);
    const bh = Math.max(dynamicFloor, Math.min(h, spectrumSmooth[i] * h * ampBoost));
    heights[i] = bh;
  }

  // Edge compensation for split-axis mode.
  const edgeCount = Math.max(6, Math.floor(half * 0.12));
  for (let k = 0; k < edgeCount; k += 1) {
    const idx = half - 1 - k; // edge side index
    const refIdx = Math.max(0, idx - edgeCount);
    const pulse = 2 + 10 * (Math.sin(gradientPhase * 14 + k * 0.55) * 0.5 + 0.5);
    heights[idx] = Math.max(heights[idx], heights[refIdx] * 0.35 + pulse);
  }

  for (let i = 0; i < half; i += 1) {
    const pos = half <= 1 ? 0 : i / (half - 1); // 0 center, 1 edges
    const edgeMin = 6 + 18 * pos;
    const bh = Math.min(h, Math.max(edgeMin, heights[i]));
    const xLeft = (half - 1 - i) * step;
    const xRight = (half + i) * step;
    const y = h - bh;
    const rr = Math.min(7, barW / 2, bh / 2);
    const t = (i / half + gradientPhase) % 1;
    const hue = 210 + 110 * t;
    const sat = 92 - 20 * Math.abs(t - 0.5);
    const edgeLift = 9 * pos;
    const light = 60 + edgeLift + 10 * Math.sin((t + gradientPhase) * Math.PI * 2);
    ctx.fillStyle = `hsla(${hue} ${sat}% ${light}% / ${alphaFactor})`;
    ctx.beginPath();
    ctx.roundRect(xLeft, y, barW, bh, rr);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(xRight, y, barW, bh, rr);
    ctx.fill();
  }

  // Hard-edge guards: always render bars touching left/right border.
  const edgePulse = 6 + 14 * (Math.sin(gradientPhase * 10) * 0.5 + 0.5);
  const edgeH = Math.min(h, Math.max(edgePulse, h * (0.12 + globalEnergy * 0.16)));
  const edgeY = h - edgeH;
  const edgeR = Math.min(7, barW / 2, edgeH / 2);
  const leftColor = `hsla(${210 + 110 * ((gradientPhase + 0.02) % 1)} 90% 66% / ${alphaFactor})`;
  const rightColor = `hsla(${210 + 110 * ((gradientPhase + 0.52) % 1)} 90% 66% / ${alphaFactor})`;

  ctx.fillStyle = leftColor;
  ctx.beginPath();
  ctx.roundRect(0, edgeY, barW, edgeH, edgeR);
  ctx.fill();

  ctx.fillStyle = rightColor;
  ctx.beginPath();
  ctx.roundRect(Math.max(0, w - barW), edgeY, barW, edgeH, edgeR);
  ctx.fill();
}

function loop() {
  const cur = audio.currentTime || 0;
  const total = audio.duration || 0;
  miniNowEl.textContent = fmt(cur);
  miniTotalEl.textContent = fmt(total);
  miniProgressEl.value = total ? (cur / total) * 100 : 0;
  updateLyrics();
  drawSpectrum();
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function nextIndex() {
  if (!playlist.length) return 0;
  if (playMode === "single") return currentIndex;
  if (playMode === "shuffle") {
    if (playlist.length === 1) return currentIndex;
    let n = currentIndex;
    while (n === currentIndex) n = Math.floor(Math.random() * playlist.length);
    return n;
  }
  return (currentIndex + 1) % playlist.length;
}

function prevIndex() {
  if (!playlist.length) return 0;
  if (playMode === "single") return currentIndex;
  if (playMode === "shuffle") {
    if (playlist.length === 1) return currentIndex;
    let n = currentIndex;
    while (n === currentIndex) n = Math.floor(Math.random() * playlist.length);
    return n;
  }
  return (currentIndex - 1 + playlist.length) % playlist.length;
}

async function fetchLyrics(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("歌词不存在");
    const raw = await res.text();
    if (url.toLowerCase().endsWith(".srt")) lrcLines = parseSrt(raw);
    else lrcLines = parseLrc(raw);
    if (!lrcLines.length) {
      lrcLines = parseSrt(raw);
      if (!lrcLines.length) lrcLines = parseLrc(raw);
    }
    renderLyrics();
    setStatus("歌词已匹配");
  } catch {
    lrcLines = [];
    lyricsEl.innerHTML = "<p>暂无歌词</p>";
    setStatus("当前歌曲没有匹配歌词文件");
  }
  lyricsEl.style.transform = "translateY(0)";
}

async function loadSong(index, autoplay = true) {
  if (!playlist.length) return;
  currentIndex = (index + playlist.length) % playlist.length;
  const song = playlist[currentIndex];
  audio.src = song.url;
  audio.currentTime = 0;
  titleEl.textContent = song.name;
  coverEl.src = resolveCover(song.name);
  document.getElementById("artist").textContent = "";

  await fetchLyrics(song.lrcUrl);
  resetLyricsToStart();
  renderList();

  if (!autoplay) {
    setPlayIcon(true);
    setStatus(`已加载：${song.name}（歌词：${song.lrcFileName}）`);
    return;
  }

  try {
    ensureAnalyser();
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    await audio.play();
    setPlayIcon(false);
    setStatus(`正在播放：${song.name}（歌词：${song.lrcFileName}）`);
  } catch {
    setPlayIcon(true);
    setStatus("点击播放开始");
  }
}

async function loadPlaylist() {
  setStatus("正在加载资源...");
  try {
    const manifest = await fetchManifest();
    buildLookup(manifest);

    playlist = manifest.music
      .filter((name) => typeof name === "string")
      .map((name) => ({ name, time: "" }))
      .filter((entry) => AUDIO_EXTS.some((ext) => entry.name.toLowerCase().endsWith(ext)))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((entry) => {
        const fn = entry.name;
        const b = baseName(fn);
        const lrcResolved = resolveLrc(b);
        return {
          name: b,
          url: `${cdn}/${CONFIG.musicFolder}/${encodeURIComponent(fn)}`,
          lrcUrl: lrcResolved.url,
          lrcFileName: lrcResolved.fileName,
          fileName: fn,
          uploadedAt: entry.time
        };
      });

    // Always prefer each song file's latest commit date from GitHub.
    await Promise.all(
      playlist.map(async (song) => {
        const commitDate = await fetchCommitDateForMusicFile(song.fileName);
        if (commitDate) {
          song.uploadedAt = commitDate;
          return;
        }
        const formatted = formatUploadDate(song.uploadedAt);
        const year = Number(formatted.slice(0, 4));
        if (formatted === "日期未知" || !Number.isFinite(year) || year < 2000 || year > 2100) {
          song.uploadedAt = "";
        }
      })
    );

    renderList();
    if (!playlist.length) {
      setStatus("mus 目录没有音频");
      lyricsEl.innerHTML = "<p>没有找到可播放音乐</p>";
      return;
    }
    const firstWithLyric = playlist.findIndex((s) => hasLrc(s.name));
    await loadSong(firstWithLyric >= 0 ? firstWithLyric : 0, false);
  } catch (e) {
    console.error(e);
    setStatus(e?.message || "加载失败");
    lyricsEl.innerHTML = `<p>拉取失败：${safeText(e?.message || "未知错误")}</p>`;
  }
}

listEl.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  await loadSong(Number(li.dataset.i), true);
});

prevBtn.addEventListener("click", () => loadSong(prevIndex(), true));
nextBtn.addEventListener("click", () => loadSong(nextIndex(), true));

playBtn.addEventListener("click", async () => {
  if (!audio.src) return;
  ensureAnalyser();
  if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
  if (audio.paused) {
    await audio.play();
    setPlayIcon(false);
    setStatus("播放中");
  } else {
    audio.pause();
    setPlayIcon(true);
    setStatus("已暂停");
  }
});

modeBtn.addEventListener("click", () => {
  const i = PLAY_MODES.indexOf(playMode);
  playMode = PLAY_MODES[(i + 1) % PLAY_MODES.length];
  setModeIcon();
  setStatus(`播放模式：${PLAY_MODE_TEXT[playMode]}`);
});

miniProgressEl.addEventListener("input", () => {
  if (!audio.duration) return;
  audio.currentTime = (Number(miniProgressEl.value) / 100) * audio.duration;
});

volumeEl.addEventListener("input", () => {
  audio.volume = Number(volumeEl.value);
});

audio.addEventListener("loadedmetadata", () => {
  miniTotalEl.textContent = fmt(audio.duration);
});
audio.addEventListener("play", () => {
  setPlayIcon(false);
  if (!rafId) loop();
});
audio.addEventListener("pause", () => {
  setPlayIcon(true);
  stopLoop();
});
audio.addEventListener("ended", () => loadSong(nextIndex(), true));
audio.addEventListener("error", () => setStatus("音频加载失败"));

fullBtn.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await stageEl.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    setStatus("当前浏览器不支持全屏");
  }
});

document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  fullBtn.textContent = on ? "🡼" : "⛶";
  fullBtn.setAttribute("data-tip", on ? "退出全屏" : "歌词全屏");
  if (!on) {
    stageEl.classList.remove("controls-hidden");
    stageEl.classList.remove("spectrum-dim");
    if (fullscreenHideTimer) clearTimeout(fullscreenHideTimer);
    if (fullscreenSpectrumTimer) clearTimeout(fullscreenSpectrumTimer);
    fullscreenHideTimer = null;
    fullscreenSpectrumTimer = null;
  } else {
    restartFullscreenHideTimer();
  }
});

function restartFullscreenHideTimer() {
  if (!document.fullscreenElement) return;
  if (fullscreenHideTimer) clearTimeout(fullscreenHideTimer);
  stageEl.classList.remove("controls-hidden");
  stageEl.classList.add("spectrum-dim");
  if (fullscreenSpectrumTimer) clearTimeout(fullscreenSpectrumTimer);
  fullscreenSpectrumTimer = setTimeout(() => {
    stageEl.classList.remove("spectrum-dim");
  }, 5000);
  fullscreenHideTimer = setTimeout(() => {
    stageEl.classList.add("controls-hidden");
  }, 5000);
}

stageEl.addEventListener("mousemove", () => {
  if (!document.fullscreenElement) return;
  restartFullscreenHideTimer();
});

lyricSettingsBtn.addEventListener("click", () => {
  lyricModal.classList.remove("hidden");
});
lyricCancelBtn.addEventListener("click", () => {
  lyricModal.classList.add("hidden");
});
lyricSaveBtn.addEventListener("click", () => {
  const textColor = lyricTextColorInput.value || "#ffffff";
  const fillColor = lyricFillColorInput.value || "#5aa2ff";
  applyLyricColors(textColor, fillColor);
  localStorage.setItem("mymusic_lyric_text_color", textColor);
  localStorage.setItem("mymusic_lyric_fill_color", fillColor);
  lyricModal.classList.add("hidden");
  setStatus("设置已保存");
});
lyricModal.addEventListener("click", (e) => {
  if (e.target === lyricModal) lyricModal.classList.add("hidden");
});
lyricsMaskEl.addEventListener("wheel", () => {
  lyricManualUntil = Date.now() + 3000;
}, { passive: true });

lyricsEl.addEventListener("click", (e) => {
  const line = e.target.closest("p[data-time]");
  if (!line) return;
  const t = Number(line.dataset.time);
  if (!Number.isFinite(t)) return;
  audio.currentTime = t;
  lyricManualUntil = Date.now() + 1200;
});

async function checkAuthRequired() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.passwordRequired;
  } catch {
    return false;
  }
}

async function verifyPassword(password) {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

async function initAuth() {
  const required = await checkAuthRequired();
  if (!required) return true;
  if (sessionStorage.getItem("mymusic_auth_ok") === "1") return true;
  authOverlayEl.classList.remove("hidden");
  return false;
}

window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea") return;

  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    playBtn.click();
    return;
  }
  if (e.key === "f" || e.key === "F") {
    e.preventDefault();
    fullBtn.click();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    audio.volume = Math.min(1, audio.volume + 0.05);
    volumeEl.value = String(audio.volume);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    audio.volume = Math.max(0, audio.volume - 0.05);
    volumeEl.value = String(audio.volume);
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevBtn.click();
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    nextBtn.click();
    return;
  }
  if (e.key === "1") {
    e.preventDefault();
    playMode = "list";
    setModeIcon();
    setStatus("播放模式：顺序");
    return;
  }
  if (e.key === "2") {
    e.preventDefault();
    playMode = "single";
    setModeIcon();
    setStatus("播放模式：单曲");
    return;
  }
  if (e.key === "3") {
    e.preventDefault();
    playMode = "shuffle";
    setModeIcon();
    setStatus("播放模式：随机");
    return;
  }
});
authSubmitEl.addEventListener("click", async () => {
  const ok = await verifyPassword(authInputEl.value || "");
  if (!ok) {
    authMsgEl.textContent = "密码错误";
    return;
  }
  sessionStorage.setItem("mymusic_auth_ok", "1");
  authOverlayEl.classList.add("hidden");
  authMsgEl.textContent = "";
  if (!appReady) {
    appReady = true;
    loadPlaylist();
  }
});
authInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") authSubmitEl.click();
});

setModeIcon();
setPlayIcon(true);
coverEl.src = DEFAULT_COVER;
audio.volume = 1;
const savedTextColor = localStorage.getItem("mymusic_lyric_text_color") || "#ffffff";
const savedFillColor = localStorage.getItem("mymusic_lyric_fill_color") || "#5aa2ff";
lyricTextColorInput.value = savedTextColor;
lyricFillColorInput.value = savedFillColor;
applyLyricColors(savedTextColor, savedFillColor);
initAuth().then((ok) => {
  if (!ok) return;
  appReady = true;
  loadPlaylist();
});
