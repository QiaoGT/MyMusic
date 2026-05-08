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
const rawBase = `https://raw.githubusercontent.com/${CONFIG.user}/${CONFIG.repo}/${CONFIG.branch}`;
const apiBase = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.musicFolder}`;
const imgApiBase = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.imgFolder}`;
const cdnBase = `https://cdn.jsdelivr.net/gh/${CONFIG.user}/${CONFIG.repo}@${CONFIG.branch}`;
const jsdIndexApi = `https://data.jsdelivr.com/v1/package/gh/${CONFIG.user}/${CONFIG.repo}@${CONFIG.branch}/flat`;

const DEFAULT_COVER =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#111827"/></linearGradient></defs><rect width="500" height="500" fill="url(#g)"/><circle cx="250" cy="250" r="110" fill="#334155"/><circle cx="250" cy="250" r="28" fill="#cbd5e1"/><text x="250" y="420" text-anchor="middle" font-size="34" fill="#e2e8f0" font-family="Arial, sans-serif">MyMusic</text></svg>`);

const PLAY_MODES = ["list", "single", "shuffle"];
const PLAY_MODE_LABEL = { list: "顺序", single: "单曲", shuffle: "随机" };

let playlist = [];
let currentIndex = 0;
let lrcLines = [];
let activeLyricIndex = -1;
let playMode = "list";
let rafId = 0;
let coverSet = new Set();
let lrcMap = new Map();

const audio = document.getElementById("audio-element");
const musicListEl = document.getElementById("music-list");
const lyricWrapper = document.getElementById("lyric-wrapper");
const progressBar = document.getElementById("progress-bar");
const volumeBar = document.getElementById("volume-bar");
const btnPlay = document.getElementById("btn-play");
const btnMode = document.getElementById("btn-mode");
const statusText = document.getElementById("status-text");
const btnLyricsFullscreen = document.getElementById("btn-lyrics-fullscreen");

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function safeText(text) {
  return text.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function baseNameFromFile(fileName) {
  const ext = fileName.lastIndexOf(".");
  return ext > 0 ? fileName.slice(0, ext) : fileName;
}

function normalizeTrackName(name) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·•\-_/\\()[\]{}【】「」"'`,.，。！？!?:：；;]/g, "");
}

function parseLrc(text) {
  const parsed = text
    .split(/\r?\n/)
    .flatMap((line) => {
      const content = line.replace(/\[[^\]]*\]/g, "").trim();
      const tags = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
      return tags.map((tag) => ({
        time: Number(tag[1]) * 60 + Number(tag[2]),
        text: content || "..."
      }));
    })
    .filter((v) => Number.isFinite(v.time))
    .sort((a, b) => a.time - b.time);

  if (!parsed.length) return parsed;
  const shift = parsed[0].time;
  if (shift > 1) {
    return parsed.map((line) => ({ ...line, time: Math.max(0, line.time - shift) }));
  }
  return parsed;
}

async function fetchCoverIndex() {
  if (coverSet.size) return;
  try {
    const response = await fetch(jsdIndexApi);
    if (!response.ok) throw new Error("jsDelivr index unavailable");
    const data = await response.json();
    coverSet = new Set(
      (data.files || [])
        .map((f) => f.name)
        .filter((name) => name.startsWith(`/${CONFIG.imgFolder}/`))
        .map((name) => name.slice(name.lastIndexOf("/") + 1).toLowerCase())
    );
    if (coverSet.size) return;
  } catch {
    // fallback to GitHub API when jsDelivr index is unavailable
  }

  try {
    const response = await fetch(imgApiBase);
    if (!response.ok) return;
    const files = await response.json();
    coverSet = new Set(files.filter((file) => file.type === "file").map((file) => file.name.toLowerCase()));
  } catch {
    coverSet = new Set();
  }
}

function resolveCover(baseName) {
  const candidates = [`${baseName}-cover`, baseName];
  for (const ext of COVER_EXTS) {
    for (const fileBase of candidates) {
      const fileName = `${fileBase}.${ext}`;
      if (coverSet.has(fileName.toLowerCase())) {
        return `${cdnBase}/${CONFIG.imgFolder}/${encodeURIComponent(fileName)}`;
      }
    }
  }
  return DEFAULT_COVER;
}

async function fetchLrcIndex() {
  lrcMap = new Map();
  try {
    const response = await fetch(jsdIndexApi);
    if (!response.ok) return;
    const data = await response.json();
    const lrcPrefix = `/${CONFIG.lrcFolder}/`;
    (data.files || [])
      .map((f) => f.name)
      .filter((name) => name.startsWith(lrcPrefix) && name.toLowerCase().endsWith(".lrc"))
      .forEach((name) => {
        const fileName = name.slice(name.lastIndexOf("/") + 1);
        const base = baseNameFromFile(fileName);
        lrcMap.set(normalizeTrackName(base), fileName);
      });
  } catch {
    lrcMap = new Map();
  }
}

function resolveLyricsUrl(songBase) {
  const normalized = normalizeTrackName(songBase);
  const matched = lrcMap.get(normalized);
  if (matched) return `${cdnBase}/${CONFIG.lrcFolder}/${encodeURIComponent(matched)}`;
  return `${cdnBase}/${CONFIG.lrcFolder}/${encodeURIComponent(songBase)}.lrc`;
}

async function fetchMusicFiles() {
  try {
    const response = await fetch(jsdIndexApi);
    if (!response.ok) throw new Error("jsDelivr index unavailable");
    const data = await response.json();
    const musPrefix = `/${CONFIG.musicFolder}/`;
    return (data.files || [])
      .map((f) => f.name)
      .filter((name) => name.startsWith(musPrefix))
      .map((name) => name.slice(name.lastIndexOf("/") + 1))
      .filter((name) => AUDIO_EXTS.some((ext) => name.toLowerCase().endsWith(ext)))
      .map((name) => ({ name, type: "file" }));
  } catch {
    const response = await fetch(apiBase);
    if (!response.ok) {
      throw new Error(`GitHub API 访问失败: ${response.status}（可能是限流，稍后再试）`);
    }
    return await response.json();
  }
}

function setStatus(text) {
  statusText.textContent = text;
}

function setPlayButtonState(paused) {
  btnPlay.innerHTML = `<span aria-hidden="true">${paused ? "▶" : "⏸"}</span>`;
  btnPlay.setAttribute("aria-label", paused ? "播放" : "暂停");
  btnPlay.setAttribute("data-tip", paused ? "播放" : "暂停");
}

function setModeButtonState() {
  const modeIcon = { list: "🔁", single: "🔂", shuffle: "🔀" }[playMode];
  btnMode.innerHTML = `<span aria-hidden="true">${modeIcon}</span>`;
  btnMode.setAttribute("aria-label", `播放模式：${PLAY_MODE_LABEL[playMode]}`);
  btnMode.setAttribute("data-tip", `播放模式：${PLAY_MODE_LABEL[playMode]}`);
}

function renderPlaylist() {
  musicListEl.innerHTML = playlist
    .map((song, i) => `<li data-index="${i}" class="${i === currentIndex ? "active" : ""}">${safeText(song.name)}</li>`)
    .join("");
  document.getElementById("song-count").textContent = `${playlist.length} 首`;
}

function renderLyrics() {
  if (!lrcLines.length) {
    lyricWrapper.innerHTML = "<p>暂无歌词</p>";
    return;
  }
  const intro = `<p><span class="lyric-line"><span class="line">♪ 前奏 ♪</span><span class="fill">♪ 前奏 ♪</span></span></p>`;
  lyricWrapper.innerHTML = intro + lrcLines
    .map((line) => `<p><span class="lyric-line"><span class="line">${safeText(line.text)}</span><span class="fill">${safeText(line.text)}</span></span></p>`)
    .join("");
}

function updateLyricFlow() {
  if (!lrcLines.length) return;
  const cur = audio.currentTime;
  let idx = -1;
  for (let i = 0; i < lrcLines.length; i += 1) {
    if (cur >= lrcLines[i].time) idx = i;
    else break;
  }
  if (idx === -1) return;

  const items = lyricWrapper.querySelectorAll("p");
  items.forEach((el) => el.classList.remove("active"));
  lyricWrapper.querySelectorAll(".fill").forEach((fillEl, i) => {
    fillEl.style.width = i <= idx ? "100%" : "0%";
  });
  if (items[idx + 1]) {
    items[idx + 1].classList.add("active");
    lyricWrapper.style.transform = `translateY(${-(idx + 1) * 56 + 170}px)`;
  }
  activeLyricIndex = idx;

  const item = lyricWrapper.querySelectorAll("p")[idx + 1];
  if (!item) return;
  const fill = item.querySelector(".fill");
  const txt = lrcLines[idx].text || "";
  const start = lrcLines[idx].time;
  const end = lrcLines[idx + 1] ? lrcLines[idx + 1].time : start + 3;
  const duration = Math.max(0.6, end - start);
  const ratio = Math.max(0, Math.min(1, (cur - start) / duration));
  fill.style.width = `${ratio * 100}%`;
}

function stepFrame() {
  const cur = audio.currentTime || 0;
  const total = audio.duration || 0;
  progressBar.value = total ? (cur / total) * 100 : 0;
  document.getElementById("current-time").textContent = fmtTime(cur);
  document.getElementById("total-time").textContent = fmtTime(total);
  updateLyricFlow();
  rafId = requestAnimationFrame(stepFrame);
}

function stopFrame() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function pickNextIndex() {
  if (!playlist.length) return 0;
  if (playMode === "single") return currentIndex;
  if (playMode === "shuffle") {
    if (playlist.length === 1) return currentIndex;
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * playlist.length);
    return next;
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
    lyricWrapper.innerHTML = "<p>暂无歌词</p>";
  }
  activeLyricIndex = -1;
  lyricWrapper.style.transform = "translateY(0)";
}

async function loadSong(index, autoplay = true) {
  if (!playlist.length) return;
  currentIndex = (index + playlist.length) % playlist.length;
  const song = playlist[currentIndex];

  audio.src = song.url;
  document.getElementById("current-title").textContent = song.name;
  const coverUrl = resolveCover(song.name);
  document.getElementById("current-cover").src = coverUrl;
  document.getElementById("bg-blur").style.backgroundImage = `url(${coverUrl})`;
  await fetchLyrics(song.lrc);
  renderPlaylist();

  if (autoplay) {
    try {
      await audio.play();
      setPlayButtonState(false);
      setStatus(`正在播放：${song.name}`);
    } catch {
      setPlayButtonState(true);
      setStatus("浏览器阻止自动播放，请点击播放");
    }
  } else {
    setPlayButtonState(true);
    setStatus(`已加载：${song.name}`);
  }
}

async function fetchPlaylist() {
  setStatus("正在拉取 GitHub 音乐列表...");
  lyricWrapper.innerHTML = "<p>正在拉取 GitHub 音乐列表...</p>";
  try {
    await fetchCoverIndex();
    await fetchLrcIndex();
    const files = await fetchMusicFiles();
    playlist = files
      .filter((file) => file.type === "file" && AUDIO_EXTS.some((ext) => file.name.toLowerCase().endsWith(ext)))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((file) => {
        const songBase = baseNameFromFile(file.name);
        return {
          name: songBase,
          url: `${cdnBase}/${CONFIG.musicFolder}/${encodeURIComponent(file.name)}`,
          lrc: resolveLyricsUrl(songBase)
        };
      });

    renderPlaylist();
    if (!playlist.length) {
      setStatus("未发现可播放音频，请检查 mus/ 目录");
      lyricWrapper.innerHTML = "<p>未发现可播放音频，请检查 mus/ 目录。</p>";
      return;
    }
    await loadSong(0, false);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
    lyricWrapper.innerHTML = `<p>拉取失败：${safeText(error.message)}</p>`;
  }
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock-time").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("clock-date").textContent = now.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" });
}

musicListEl.addEventListener("click", async (event) => {
  const target = event.target.closest("li[data-index]");
  if (!target) return;
  await loadSong(Number(target.dataset.index), true);
});

document.getElementById("btn-prev").addEventListener("click", () => loadSong(currentIndex - 1, true));
document.getElementById("btn-next").addEventListener("click", () => loadSong(pickNextIndex(), true));

btnPlay.addEventListener("click", async () => {
  if (!audio.src) return;
  if (audio.paused) {
    await audio.play();
    setPlayButtonState(false);
    setStatus("播放中");
  } else {
    audio.pause();
    setPlayButtonState(true);
    setStatus("已暂停");
  }
});

btnMode.addEventListener("click", () => {
  const idx = PLAY_MODES.indexOf(playMode);
  playMode = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
  setModeButtonState();
  setStatus(`播放模式：${PLAY_MODE_LABEL[playMode]}`);
});

progressBar.addEventListener("input", () => {
  if (!audio.duration) return;
  audio.currentTime = (progressBar.value / 100) * audio.duration;
});

volumeBar.addEventListener("input", () => {
  audio.volume = Number(volumeBar.value);
});

audio.addEventListener("play", () => {
  setPlayButtonState(false);
  if (!rafId) stepFrame();
});

audio.addEventListener("pause", () => {
  setPlayButtonState(true);
  stopFrame();
});

audio.addEventListener("loadedmetadata", () => {
  document.getElementById("total-time").textContent = fmtTime(audio.duration);
});

audio.addEventListener("ended", () => loadSong(pickNextIndex(), true));
audio.addEventListener("error", () => setStatus("音频加载失败，请检查文件路径和格式"));

btnLyricsFullscreen.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.getElementById("lyrics-view").requestFullscreen();
      btnLyricsFullscreen.setAttribute("data-tip", "退出全屏");
      btnLyricsFullscreen.innerHTML = `<span aria-hidden="true">🡼</span>`;
    } else {
      await document.exitFullscreen();
    }
  } catch {
    setStatus("当前浏览器不支持歌词全屏");
  }
});

document.addEventListener("fullscreenchange", () => {
  const inFullscreen = !!document.fullscreenElement;
  btnLyricsFullscreen.setAttribute("data-tip", inFullscreen ? "退出全屏" : "歌词全屏");
  btnLyricsFullscreen.setAttribute("aria-label", inFullscreen ? "退出全屏" : "歌词全屏");
  btnLyricsFullscreen.innerHTML = `<span aria-hidden="true">${inFullscreen ? "🡼" : "⛶"}</span>`;
});

updateClock();
setInterval(updateClock, 1000);
setModeButtonState();
setPlayButtonState(true);
document.getElementById("current-cover").src = DEFAULT_COVER;
audio.volume = 1;
fetchPlaylist();
