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

const DEFAULT_COVER =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1f2937"/>
          <stop offset="100%" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="320" height="320" fill="url(#g)"/>
      <circle cx="160" cy="160" r="72" fill="#374151"/>
      <circle cx="160" cy="160" r="18" fill="#9ca3af"/>
      <text x="160" y="280" font-size="22" text-anchor="middle" fill="#e5e7eb" font-family="Arial, sans-serif">MyMusic</text>
    </svg>`
  );

let playlist = [];
let currentIndex = 0;
let lrcLines = [];
let activeLyricIndex = -1;

const audio = document.getElementById("audio-element");
const musicListEl = document.getElementById("music-list");
const lyricWrapper = document.getElementById("lyric-wrapper");
const progressBar = document.getElementById("progress-bar");
const btnPlay = document.getElementById("btn-play");

function baseNameFromFile(fileName) {
  const ext = fileName.lastIndexOf(".");
  return ext > 0 ? fileName.slice(0, ext) : fileName;
}

function parseLrc(text) {
  return text
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
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveCover(baseName) {
  for (const ext of COVER_EXTS) {
    const url = `${rawBase}/${CONFIG.imgFolder}/${encodeURIComponent(baseName)}.${ext}`;
    if (await exists(url)) return url;
  }
  return DEFAULT_COVER;
}

async function fetchPlaylist() {
  lyricWrapper.innerHTML = "<p>正在拉取 GitHub 音乐列表...</p>";
  try {
    const response = await fetch(apiBase);
    if (!response.ok) {
      throw new Error(`GitHub API 访问失败: ${response.status}`);
    }

    const files = await response.json();
    playlist = files
      .filter((file) => file.type === "file" && AUDIO_EXTS.some((ext) => file.name.toLowerCase().endsWith(ext)))
      .map((file) => {
        const songBase = baseNameFromFile(file.name);
        return {
          name: songBase,
          url: `${rawBase}/${CONFIG.musicFolder}/${encodeURIComponent(file.name)}`,
          lrc: `${rawBase}/${CONFIG.lrcFolder}/${encodeURIComponent(songBase)}.lrc`
        };
      });

    renderPlaylist();
    if (playlist.length > 0) {
      await loadSong(0, false);
    } else {
      lyricWrapper.innerHTML = "<p>未发现可播放音频，请检查 mus/ 目录。</p>";
    }
  } catch (error) {
    console.error(error);
    lyricWrapper.innerHTML = `<p>拉取失败：${error.message}</p>`;
  }
}

function renderPlaylist() {
  musicListEl.innerHTML = playlist
    .map((song, i) => `<li data-index="${i}" class="${i === currentIndex ? "active" : ""}">${song.name}</li>`)
    .join("");
}

async function fetchLyrics(url) {
  lyricWrapper.innerHTML = "<p>加载歌词中...</p>";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("歌词不存在");

    const text = await res.text();
    lrcLines = parseLrc(text);
    if (!lrcLines.length) {
      lyricWrapper.innerHTML = "<p>歌词格式无可用时间轴。</p>";
      return;
    }

    lyricWrapper.innerHTML = lrcLines.map((l) => `<p>${l.text || "..."}</p>`).join("");
    lyricWrapper.style.transform = "translateY(0)";
    activeLyricIndex = -1;
  } catch {
    lrcLines = [];
    lyricWrapper.innerHTML = "<p>暂无歌词</p>";
  }
}

async function loadSong(index, autoplay = true) {
  if (!playlist.length) return;

  currentIndex = (index + playlist.length) % playlist.length;
  const song = playlist[currentIndex];

  audio.src = song.url;
  document.getElementById("current-title").innerText = song.name;
  const coverUrl = await resolveCover(song.name);
  document.getElementById("current-cover").src = coverUrl;
  document.getElementById("bg-blur").style.backgroundImage = `url(${coverUrl})`;

  await fetchLyrics(song.lrc);
  renderPlaylist();
  btnPlay.textContent = "播放";

  if (autoplay) {
    try {
      await audio.play();
      btnPlay.textContent = "暂停";
    } catch {
      btnPlay.textContent = "播放";
    }
  }
}

function updateLyricHighlight() {
  if (!lrcLines.length) return;
  const cur = audio.currentTime;
  const idx = lrcLines.findIndex((line, i) => cur >= line.time && (!lrcLines[i + 1] || cur < lrcLines[i + 1].time));
  if (idx === -1 || idx === activeLyricIndex) return;

  activeLyricIndex = idx;
  const items = lyricWrapper.querySelectorAll("p");
  items.forEach((el) => el.classList.remove("active"));
  if (items[idx]) {
    items[idx].classList.add("active");
    lyricWrapper.style.transform = `translateY(${-idx * 62 + 160}px)`;
  }
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock-time").innerText = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("clock-date").innerText = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

musicListEl.addEventListener("click", async (event) => {
  const target = event.target.closest("li[data-index]");
  if (!target) return;
  await loadSong(Number(target.dataset.index));
});

audio.addEventListener("timeupdate", () => {
  progressBar.value = (audio.currentTime / audio.duration) * 100 || 0;
  updateLyricHighlight();
});

audio.addEventListener("ended", () => loadSong(currentIndex + 1));

document.getElementById("btn-next").addEventListener("click", () => loadSong(currentIndex + 1));
document.getElementById("btn-prev").addEventListener("click", () => loadSong(currentIndex - 1));
btnPlay.addEventListener("click", async () => {
  if (!audio.src) return;
  if (audio.paused) {
    await audio.play();
    btnPlay.textContent = "暂停";
  } else {
    audio.pause();
    btnPlay.textContent = "播放";
  }
});

progressBar.addEventListener("input", () => {
  if (!audio.duration) return;
  audio.currentTime = (progressBar.value / 100) * audio.duration;
});

updateClock();
setInterval(updateClock, 1000);
fetchPlaylist();
