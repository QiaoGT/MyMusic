# MyMusic

一个基于静态前端的 GitHub 音乐播放器项目。  
通过读取仓库中的 `mus/`、`lrc/`、`img/` 目录，自动加载音乐、歌词与封面。

## 功能概览

- 自动扫描并加载歌曲列表（来自 GitHub 仓库）
- 歌词高亮与逐字填充效果
- 支持歌词时间轴跳转（点击歌词定位进度）
- 支持全屏歌词模式
- 频谱可视化（彩色渐变动态）
- 播放控制：顺序 / 单曲 / 随机、上一首、下一首、播放暂停
- 音量调节、进度拖动

## 目录结构

```text
MyMusic/
├─ mus/          # 音频文件（.mp3/.flac/.wav/.m4a/.ogg）
├─ lrc/          # 歌词文件（.lrc）
├─ img/          # 封面图片（推荐：歌名-cover.jpg）
├─ index.html
├─ style.css
├─ script.js
└─ vercel.json
```

## 文件命名建议

- 音频：`歌曲名 - 歌手.mp3`
- 歌词：`歌曲名 - 歌手.lrc`
- 封面：`歌曲名 - 歌手-cover.jpg`

> 命名一致可提高自动匹配成功率。

## 本地运行

本项目为纯静态页面，无需 `npm install`。

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; python -m http.server 5173
```

浏览器访问：

- `http://localhost:5173`

## Vercel 部署

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; npx vercel pull --yes --environment preview
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; npx vercel build --yes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; npx vercel deploy --prebuilt --yes
```

## 常见问题

### 1. 歌词未匹配

- 检查 `lrc/` 中是否存在同名歌词文件
- 检查文件编码是否正常（推荐 UTF-8）
- 检查歌词是否包含标准时间标签，如：`[00:11.914]`

### 2. 封面不显示

- 确认 `img/` 下文件名与歌曲名一致，或使用 `-cover` 后缀
- 推荐格式：`.jpg/.jpeg/.png/.webp`

### 3. 部署后看不到最新效果

- 强制刷新：`Ctrl + F5`
- 确认访问的是最新部署地址

## 备注

- 项目已适配桌面与移动端布局。
- 当前代码通过 `script.js` 维护主要逻辑，建议改动后先本地验证再部署。
