# Keel

Keel is a short-clip trimmer that runs in the browser. Drop a video on it, set the in and out points, and export an MP4. Files stay on your machine. Nothing is uploaded.

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer
- npm (included with Node)

No FFmpeg install. Trimming and export use the browser.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open [http://localhost:9090](http://localhost:9090).

## Production build

```bash
npm run build
npm run preview
```

The preview of that build is at [http://127.0.0.1:8081](http://127.0.0.1:8081).

## Use

1. Drop a video onto the window, or choose **Open**. **Try a sample** loads a short demo clip.
2. Drag the edges of the timeline to trim. Drag the kept region to slide the cut.
3. Use the **Play from** bar above the timeline to jump and start playback there.
4. Choose **Lean**, **Fine**, or **Rich**, then **Export**.

Press `?` in the app for keyboard shortcuts. MP4, WebM, and MOV are the formats that play back reliably.
