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
const PLAY_MODES = ["list", "single", "shuffle"];
const PLAY_MODE_ICON = { list: "🔁", single: "🔂", shuffle: "🔀" };
const PLAY_MODE_TEXT = { list: "顺序", single: "单曲", shuffle: "随机" };

const cdn = `https://cdn.jsdelivr.net/gh/${CONFIG.user}/${CONFIG.repo}@${CONFIG.branch}`;
const flatApi = `https://data.jsdelivr.com/v1/package/gh/${CONFIG.user}/${CONFIG.repo}@${CONFIG.branch}/flat`;

const DEFAULT_COVER =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#17233a"/><stop offset="100%" stop-color="#0a101a"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="200" r="90" fill="#334155"/><circle cx="200" cy="200" r="22" fill="#d9e3f3"/><text x="200" y="340" text-anchor="middle" font-size="26" fill="#ecf3ff" font-family="Arial">MyMusic</text></svg>`);

const audio = document.getElementById("audio");
const coverEl = document.getElementById("cover");
const titleEl = document.getElementById("title");
const listEl = document.getElementById("list");
const lyricsEl = document.getElementById("lyrics");
const progressEl = document.getElementById("progress");
const volumeEl = document.getElementById("volume");
const nowEl = document.getElementById("now");
const totalEl = document.getElementById("total");
const countEl = document.getElementById("count");
const statusEl = document.getElementById("status");
const modeBtn = document.getElementById("mode");
const prevBtn = document.getElementById("prev");
const playBtn = document.getElementById("play");
const nextBtn = document.getElementById("next");
const fullBtn = document.getElementById("btn-full");
const stageEl = document.getElementById("lyrics-stage");
const spectrumEl = document.getElementById("spectrum");
const fontSelect = document.getElementById("font-select");
const fontCustom = document.getElementById("font-custom");
const fontApply = document.getElementById("font-apply");

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

function parseLrc(text) {
  const parsed = text
    .split(/\r?\n/)
    .flatMap((line) => {
      const content = line.replace(/\[[^\]]*\]/g, "").trim();
      const tags = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
      return tags.map((m) => ({ time: Number(m[1]) * 60 + Number(m[2]), text: content || "..." }));
    })
    .filter((x) => Number.isFinite(x.time))
    .sort((a, b) => a.time - b.time);

  if (!parsed.length) return parsed;
  const offset = parsed[0].time;
  return offset > 1 ? parsed.map((x) => ({ ...x, time: Math.max(0, x.time - offset) })) : parsed;
}

async function fetchIndex() {
  const res = await fetch(flatApi);
  if (!res.ok) throw new Error(`索引拉取失败 ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

function buildLookup(files) {
  coverSet = new Set();
  lrcMap = new Map();

  files.forEach((f) => {
    const p = f.name || "";
    if (p.startsWith(`/${CONFIG.imgFolder}/`)) {
      coverSet.add(p.slice(p.lastIndexOf("/") + 1).toLowerCase());
    }
    if (p.startsWith(`/${CONFIG.lrcFolder}/`) && p.toLowerCase().endsWith(".lrc")) {
      const fn = p.slice(p.lastIndexOf("/") + 1);
      lrcMap.set(normalizeName(baseName(fn)), fn);
    }
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
  const hit = lrcMap.get(normalizeName(songBase));
  const fn = hit || `${songBase}.lrc`;
  return `${cdn}/${CONFIG.lrcFolder}/${encodeURIComponent(fn)}`;
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
    .map((l) => `<p><span class="lyric-line"><span class="base">${safeText(l.text)}</span><span class="fill">${safeText(l.text)}</span></span></p>`)
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
  if (idx < 0) return;

  const ps = lyricsEl.querySelectorAll("p");
  ps.forEach((p) => p.classList.remove("active"));
  ps.forEach((p, i) => {
    const fill = p.querySelector(".fill");
    if (!fill) return;
    if (i < idx) fill.style.width = "100%";
    if (i > idx) fill.style.width = "0%";
  });

  const p = ps[idx];
  if (!p) return;
  p.classList.add("active");

  const start = lrcLines[idx].time;
  const end = lrcLines[idx + 1] ? lrcLines[idx + 1].time : start + 3;
  const ratio = Math.max(0, Math.min(1, (t - start) / Math.max(0.5, end - start)));
  const fill = p.querySelector(".fill");
  if (fill) fill.style.width = `${ratio * 100}%`;

  const lineHeight = window.innerWidth < 1100 ? 50 : 56;
  lyricsEl.style.transform = `translateY(${-idx * lineHeight + (window.innerWidth < 1100 ? 140 : 180)}px)`;
}

function setPlayIcon(paused) {
  playBtn.textContent = paused ? "▶" : "⏸";
  playBtn.setAttribute("data-tip", paused ? "播放" : "暂停");
}
function setModeIcon() {
  modeBtn.textContent = PLAY_MODE_ICON[playMode];
  modeBtn.setAttribute("data-tip", PLAY_MODE_TEXT[playMode]);
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
  const ctx = spectrumEl.getContext("2d");
  if (!ctx) return;
  const w = spectrumEl.clientWidth;
  const h = spectrumEl.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (spectrumEl.width !== Math.floor(w * dpr) || spectrumEl.height !== Math.floor(h * dpr)) {
    spectrumEl.width = Math.floor(w * dpr);
    spectrumEl.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!analyser || !freqData) return;

  analyser.getByteFrequencyData(freqData);
  const bars = Math.min(58, freqData.length);
  const barW = w / bars;
  for (let i = 0; i < bars; i += 1) {
    const val = freqData[i + 2] / 255;
    const bh = Math.max(2, val * h);
    const x = i * barW;
    const y = h - bh;
    ctx.fillStyle = "rgba(237,244,255,.88)";
    ctx.fillRect(x + 1, y, Math.max(1, barW - 2), bh);
  }
}

function loop() {
  const cur = audio.currentTime || 0;
  const total = audio.duration || 0;
  nowEl.textContent = fmt(cur);
  totalEl.textContent = fmt(total);
  progressEl.value = total ? (cur / total) * 100 : 0;
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

async function fetchLyrics(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("歌词不存在");
    lrcLines = parseLrc(await res.text());
    renderLyrics();
  } catch {
    lrcLines = [];
    lyricsEl.innerHTML = "<p>暂无歌词</p>";
  }
  lyricsEl.style.transform = "translateY(0)";
}

async function loadSong(index, autoplay = true) {
  if (!playlist.length) return;
  currentIndex = (index + playlist.length) % playlist.length;
  const song = playlist[currentIndex];
  audio.src = song.url;
  titleEl.textContent = song.name;
  coverEl.src = resolveCover(song.name);

  await fetchLyrics(song.lrc);
  renderList();

  if (!autoplay) {
    setPlayIcon(true);
    setStatus(`已加载：${song.name}`);
    return;
  }

  try {
    ensureAnalyser();
    if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
    await audio.play();
    setPlayIcon(false);
    setStatus(`正在播放：${song.name}`);
  } catch {
    setPlayIcon(true);
    setStatus("点击播放开始");
  }
}

async function loadPlaylist() {
  setStatus("正在加载资源...");
  try {
    const files = await fetchIndex();
    buildLookup(files);

    const prefix = `/${CONFIG.musicFolder}/`;
    playlist = files
      .map((f) => f.name)
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(p.lastIndexOf("/") + 1))
      .filter((n) => AUDIO_EXTS.some((ext) => n.toLowerCase().endsWith(ext)))
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map((fn) => {
        const b = baseName(fn);
        return {
          name: b,
          url: `${cdn}/${CONFIG.musicFolder}/${encodeURIComponent(fn)}`,
          lrc: resolveLrc(b)
        };
      });

    renderList();
    if (!playlist.length) {
      setStatus("mus 目录没有音频");
      lyricsEl.innerHTML = "<p>没有找到可播放音乐</p>";
      return;
    }
    await loadSong(0, false);
  } catch (e) {
    console.error(e);
    setStatus(e?.message || "加载失败");
    lyricsEl.innerHTML = `<p>拉取失败：${safeText(e?.message || "未知错误")}</p>`;
  }
}

function setupFonts() {
  const preferred = [
    "LXGW WenKai", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Arial"
  ];
  const available = [];
  if (document.fonts && typeof document.fonts.check === "function") {
    preferred.forEach((f) => {
      if (document.fonts.check(`16px '${f}'`)) available.push(f);
    });
  }

  ["系统默认", ...available].forEach((f) => {
    const op = document.createElement("option");
    op.value = f;
    op.textContent = f;
    fontSelect.appendChild(op);
  });

  const saved = localStorage.getItem("mymusic_font") || "系统默认";
  fontSelect.value = saved;
  if (saved !== "系统默认") {
    document.documentElement.style.setProperty("--lyric-font", `'${saved}', 'PingFang SC', 'Microsoft YaHei', sans-serif`);
  }
}

function applyFont(name) {
  if (!name || name === "系统默认") {
    localStorage.removeItem("mymusic_font");
    document.documentElement.style.setProperty("--lyric-font", `"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`);
    setStatus("已切回系统默认字体");
    return;
  }
  document.documentElement.style.setProperty("--lyric-font", `'${name}', 'PingFang SC', 'Microsoft YaHei', sans-serif`);
  localStorage.setItem("mymusic_font", name);
  setStatus(`已切换字体：${name}`);
}

listEl.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  await loadSong(Number(li.dataset.i), true);
});

prevBtn.addEventListener("click", () => loadSong(currentIndex - 1, true));
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

progressEl.addEventListener("input", () => {
  if (!audio.duration) return;
  audio.currentTime = (Number(progressEl.value) / 100) * audio.duration;
});

volumeEl.addEventListener("input", () => {
  audio.volume = Number(volumeEl.value);
});

audio.addEventListener("loadedmetadata", () => {
  totalEl.textContent = fmt(audio.duration);
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
});

fontSelect.addEventListener("change", () => applyFont(fontSelect.value));
fontApply.addEventListener("click", () => {
  const f = fontCustom.value.trim();
  if (!f) return;
  if (![...fontSelect.options].some((o) => o.value === f)) {
    const op = document.createElement("option");
    op.value = f;
    op.textContent = f;
    fontSelect.appendChild(op);
  }
  fontSelect.value = f;
  applyFont(f);
});

function tickClock() {
  const now = new Date();
  document.getElementById("artist").textContent = now.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) + " · Neon Radio";
}

setupFonts();
setModeIcon();
setPlayIcon(true);
coverEl.src = DEFAULT_COVER;
audio.volume = 1;
tickClock();
setInterval(tickClock, 60000);
loadPlaylist();
