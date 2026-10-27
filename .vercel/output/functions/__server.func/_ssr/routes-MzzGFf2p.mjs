import { i as __toESM } from "../_runtime.mjs";
import { K as require_react, b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as RotateCcw, d as Pause, f as Keyboard, i as Undo2, l as Redo2, m as Clapperboard, n as VolumeX, o as SkipForward, p as FolderOpen, r as Volume2, s as SkipBack, t as X, u as Play } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-MzzGFf2p.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FRAME = 1 / 30;
var MIN_SPAN = .1;
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function nearly(a, b) {
	return Math.abs(a - b) < .001;
}
function formatClock(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	const centi = Math.round(seconds * 100);
	const cs = centi % 100;
	const total = Math.floor(centi / 100);
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const body = `${pad(m)}:${pad(s)}.${pad(cs)}`;
	return h > 0 ? `${h}:${body}` : body;
}
function pad(n) {
	return String(n).padStart(2, "0");
}
function clampTrim(inPoint, outPoint, duration) {
	if (!Number.isFinite(duration) || duration <= 0) return {
		in: 0,
		out: 0
	};
	const min = Math.min(MIN_SPAN, duration);
	let start = clamp(inPoint, 0, duration);
	let end = clamp(outPoint, 0, duration);
	if (end < start) {
		const swap = start;
		start = end;
		end = swap;
	}
	if (end - start < min) {
		if (start + min <= duration) end = start + min;
		else {
			end = duration;
			start = Math.max(0, duration - min);
		}
	}
	return {
		in: start,
		out: end
	};
}
function trimFilename(name) {
	const dot = name.lastIndexOf(".");
	return `${(dot > 0 ? name.slice(0, dot) : name).trim() || "clip"}-trim.mp4`;
}
var VIDEO_QUALITY = {
	lean: "low",
	fine: "medium",
	rich: "high"
};
async function exportCut(options) {
	const { file, start, end, quality, video, signal, onProgress } = options;
	if (signal.aborted) throw abortError();
	try {
		onProgress(0, "Encoding cut");
		return {
			blob: await encodeWithMediabunny(file, start, end, quality, signal, onProgress),
			filename: trimFilename(options.filename)
		};
	} catch (error) {
		if (signal.aborted || isAbort$1(error)) throw abortError();
		if (!video || !captureOf(video)) throw error instanceof Error ? error : /* @__PURE__ */ new Error("Export failed");
		onProgress(0, "Recording cut");
		const blob = await recordSelection(video, start, end, signal, (progress) => onProgress(progress, "Recording cut"));
		const ext = (blob.type || "video/webm").includes("mp4") ? "mp4" : "webm";
		return {
			blob,
			filename: `${trimFilename(options.filename).replace(/\.mp4$/, "")}.${ext}`
		};
	}
}
async function encodeWithMediabunny(file, start, end, quality, signal, onProgress) {
	const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } = await import("../_libs/mediabunny.mjs").then((n) => n.t);
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(file)
	});
	const target = new BufferTarget();
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: "in-memory" }),
		target
	});
	try {
		const level = VIDEO_QUALITY[quality];
		const conversion = await Conversion.init({
			input,
			output,
			trim: {
				start,
				end
			},
			tracks: "primary",
			showWarnings: false,
			copy: false,
			video: {
				quality: new Quality(level),
				hardwareAcceleration: "prefer-hardware",
				keyFrameInterval: 2
			},
			audio: {
				codec: "aac",
				quality: new Quality("medium")
			}
		});
		if (!conversion.isValid) {
			const reason = conversion.discardedTracks.find((track) => track.reason !== "discarded_by_user")?.reason;
			throw new Error(reasonText(reason));
		}
		conversion.onProgress = (progress) => onProgress(progress, "Encoding cut");
		const cancel = () => {
			conversion.cancel();
		};
		signal.addEventListener("abort", cancel);
		try {
			if (signal.aborted) {
				await conversion.cancel();
				throw abortError();
			}
			await conversion.execute();
		} finally {
			signal.removeEventListener("abort", cancel);
		}
		if (!target.buffer) throw new Error("Export produced an empty file.");
		return new Blob([target.buffer], { type: "video/mp4" });
	} finally {
		dispose(input);
	}
}
function recordSelection(video, start, end, signal, onProgress) {
	const capture = captureOf(video);
	if (!capture) return Promise.reject(/* @__PURE__ */ new Error("This browser can’t encode that cut."));
	const stream = capture.call(video);
	const mime = pickMime();
	const recorder = new MediaRecorder(stream, mime ? {
		mimeType: mime,
		videoBitsPerSecond: 4e6,
		audioBitsPerSecond: 128e3
	} : void 0);
	const chunks = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size) chunks.push(event.data);
	};
	return new Promise((resolve, reject) => {
		let stopped = false;
		const finish = () => {
			if (stopped) return;
			stopped = true;
			video.pause();
			if (recorder.state !== "inactive") recorder.stop();
		};
		recorder.onerror = () => reject(/* @__PURE__ */ new Error("Recording the cut failed."));
		recorder.onstop = () => {
			resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
		};
		const onAbort = () => {
			finish();
			reject(abortError());
		};
		if (signal.aborted) {
			reject(abortError());
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		const span = Math.max(.05, end - start);
		const arm = () => {
			video.playbackRate = 1;
			video.play().then(() => {
				if (signal.aborted) {
					onAbort();
					return;
				}
				recorder.start(200);
				const tick = () => {
					if (stopped) return;
					const progress = (video.currentTime - start) / span;
					onProgress(Math.max(0, Math.min(1, progress)));
					if (video.currentTime >= end - .04 || video.ended) {
						signal.removeEventListener("abort", onAbort);
						finish();
						return;
					}
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}).catch(() => {
				signal.removeEventListener("abort", onAbort);
				reject(/* @__PURE__ */ new Error("Playback has to run to record this cut."));
			});
		};
		if (Math.abs(video.currentTime - start) < .05) arm();
		else {
			const onSeeked = () => {
				video.removeEventListener("seeked", onSeeked);
				arm();
			};
			video.addEventListener("seeked", onSeeked);
			video.currentTime = start;
		}
	});
}
function captureOf(video) {
	const el = video;
	if (typeof el.captureStream === "function") return el.captureStream;
	if (typeof el.mozCaptureStream === "function") return el.mozCaptureStream;
	return null;
}
function pickMime() {
	return [
		"video/mp4;codecs=avc1,mp4a.40.2",
		"video/mp4",
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/webm"
	].find((type) => MediaRecorder.isTypeSupported(type));
}
function reasonText(reason) {
	switch (reason) {
		case "undecodable_source_codec":
		case "unknown_source_codec": return "This browser can’t decode that codec.";
		case "no_encodable_target_codec": return "This browser can’t encode an MP4 from that clip.";
		default: return "Couldn’t encode that cut.";
	}
}
function abortError() {
	return new DOMException("Export canceled", "AbortError");
}
function isAbort$1(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
function dispose(input) {
	const maybe = input;
	try {
		maybe[Symbol.dispose]?.();
	} catch {}
}
function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 2e3);
}
var WIDTH = 960;
var HEIGHT = 540;
var FPS = 24;
var SECONDS = 6;
var SCENES = [
	{
		name: "OPEN",
		wash: "#2a2118"
	},
	{
		name: "HOLD",
		wash: "#1a2822"
	},
	{
		name: "CUT",
		wash: "#261c28"
	},
	{
		name: "TAIL",
		wash: "#2c2416"
	}
];
var cached = null;
function createSampleClip(onProgress) {
	if (!cached) cached = buildSample(onProgress).catch((error) => {
		cached = null;
		throw error;
	});
	return cached.then((file) => {
		onProgress(1);
		return file;
	});
}
async function buildSample(onProgress) {
	onProgress(.02);
	try {
		return await encodeFast(onProgress);
	} catch {
		return recordRealtime(onProgress);
	}
}
function drawFrame(ctx, time) {
	const scene = SCENES[Math.min(SCENES.length - 1, Math.floor(time / (SECONDS / SCENES.length)))];
	const w = ctx.canvas.width;
	const h = ctx.canvas.height;
	ctx.fillStyle = "#100e0c";
	ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = scene.wash;
	ctx.fillRect(36, 36, w - 72, h - 36 - 108);
	const bar = 36 + time / SECONDS * (w - 72);
	ctx.fillStyle = "#e4a04a";
	ctx.fillRect(bar, 36, 5, h - 36 - 108);
	ctx.fillStyle = "#f4efe6";
	ctx.font = "600 26px 'IBM Plex Sans', sans-serif";
	ctx.fillText(scene.name, 64, 104);
	ctx.font = "500 84px 'IBM Plex Mono', ui-monospace, monospace";
	ctx.fillText(formatClock(time), 64, h / 2 + 10);
	ctx.fillStyle = "#c3b6a6";
	ctx.font = "500 22px 'IBM Plex Sans', sans-serif";
	ctx.fillText("KEEL SAMPLE", 64, h / 2 + 52);
	ctx.fillStyle = "#1c1914";
	ctx.fillRect(0, h - 84, w, 84);
	ctx.fillStyle = "#4a4034";
	for (let i = 0; i <= 12; i++) ctx.fillRect(i / 12 * w, h - 84, 2, i % 2 === 0 ? 22 : 12);
	ctx.fillStyle = "#e4a04a";
	ctx.fillRect(time / SECONDS * w, h - 84, 3, 84);
}
async function encodeFast(onProgress) {
	const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } = await import("../_libs/mediabunny.mjs").then((n) => n.t);
	if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((resolve) => window.setTimeout(resolve, 1200))]);
	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas unavailable");
	const target = new BufferTarget();
	const output = new Output({
		format: new Mp4OutputFormat({ fastStart: "in-memory" }),
		target
	});
	const video = new CanvasSource(canvas, {
		codec: "avc",
		quality: new Quality("medium"),
		keyFrameInterval: 1
	});
	output.addVideoTrack(video);
	await output.start();
	const frames = 144;
	const frame = 1 / FPS;
	for (let i = 0; i < frames; i++) {
		drawFrame(ctx, i * frame);
		await video.add(i * frame, frame);
		if (i % 6 === 0) onProgress(.05 + i / frames * .9);
	}
	await output.finalize();
	if (!target.buffer) throw new Error("Sample encode produced nothing");
	onProgress(1);
	return new File([target.buffer], "keel-sample.mp4", { type: "video/mp4" });
}
function recordRealtime(onProgress) {
	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) return Promise.reject(/* @__PURE__ */ new Error("Couldn’t build the sample clip"));
	const stream = canvas.captureStream(FPS);
	const audioCtx = new AudioContext();
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	osc.type = "sine";
	osc.frequency.value = 220;
	gain.gain.value = .04;
	osc.connect(gain);
	const dest = audioCtx.createMediaStreamDestination();
	gain.connect(dest);
	osc.start();
	const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
	const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
	const recorder = new MediaRecorder(mixed, {
		mimeType: mime,
		videoBitsPerSecond: 18e5
	});
	const chunks = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size) chunks.push(event.data);
	};
	const done = new Promise((resolve, reject) => {
		recorder.onerror = () => reject(/* @__PURE__ */ new Error("Couldn’t build the sample clip"));
		recorder.onstop = () => {
			osc.stop();
			audioCtx.close();
			const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
			resolve(new File([blob], "keel-sample.webm", { type: blob.type }));
		};
	});
	recorder.start(100);
	const started = performance.now();
	const tick = () => {
		const elapsed = (performance.now() - started) / 1e3;
		const time = Math.min(SECONDS, elapsed);
		drawFrame(ctx, time);
		onProgress(Math.min(.99, time / SECONDS));
		if (elapsed >= SECONDS) {
			recorder.stop();
			onProgress(1);
			return;
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return done;
}
function waitFor(target, event, signal, ms) {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		const onEvent = () => {
			cleanup();
			resolve();
		};
		const cleanup = () => {
			window.clearTimeout(timer);
			target.removeEventListener(event, onEvent);
			signal.removeEventListener("abort", onAbort);
		};
		signal.addEventListener("abort", onAbort);
		target.addEventListener(event, onEvent, { once: true });
	});
}
async function extractThumbs(url, duration, count, signal, onUpdate) {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	video.crossOrigin = "anonymous";
	const holder = document.createElement("div");
	holder.setAttribute("aria-hidden", "true");
	holder.style.cssText = "position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden";
	holder.appendChild(video);
	document.body.appendChild(holder);
	const canvas = document.createElement("canvas");
	canvas.width = 160;
	canvas.height = 90;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		holder.remove();
		return;
	}
	try {
		video.src = url;
		await waitFor(video, "loadeddata", signal, 8e3);
		if (signal.aborted) return;
		const urls = [];
		for (let i = 0; i < count; i++) {
			if (signal.aborted) return;
			const time = Math.min(duration - .05, Math.max(0, (i + .5) / count * duration));
			if (Math.abs(video.currentTime - time) > .01) {
				video.currentTime = time;
				await waitFor(video, "seeked", signal, 2500);
			}
			const vw = video.videoWidth || 16;
			const vh = video.videoHeight || 9;
			const scale = Math.min(canvas.width / vw, canvas.height / vh);
			const dw = vw * scale;
			const dh = vh * scale;
			ctx.fillStyle = "#14120e";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
			urls.push(canvas.toDataURL("image/jpeg", .68));
			onUpdate(urls.slice());
		}
	} finally {
		video.pause();
		video.removeAttribute("src");
		video.load();
		holder.remove();
	}
}
function Scrubber({ duration, current, trim, snap, locked, onScrub, onPlayFrom }) {
	const barRef = (0, import_react.useRef)(null);
	const dragRef = (0, import_react.useRef)(false);
	const timeRef = (0, import_react.useRef)(current);
	const [live, setLive] = (0, import_react.useState)(null);
	const disabled = locked || duration <= 0;
	const shown = live ?? current;
	function timeAt(clientX) {
		const bar = barRef.current;
		if (!bar || duration <= 0) return 0;
		const rect = bar.getBoundingClientRect();
		const width = rect.width || 1;
		let time = clamp((clientX - rect.left) / width, 0, 1) * duration;
		if (!snap) return time;
		const threshold = 8 / (width / duration);
		let best = time;
		let bestD = threshold;
		for (const mark of [
			trim.in,
			trim.out,
			0,
			duration
		]) {
			const dist = Math.abs(time - mark);
			if (dist <= bestD) {
				best = mark;
				bestD = dist;
			}
		}
		time = best;
		return time;
	}
	function move(clientX) {
		const time = timeAt(clientX);
		timeRef.current = time;
		setLive(time);
		onScrub(time);
	}
	function finish(play) {
		if (!dragRef.current) return;
		dragRef.current = false;
		const time = timeRef.current;
		setLive(null);
		if (play) onPlayFrom(time);
	}
	function nudge(next, play) {
		const time = clamp(next, 0, duration);
		timeRef.current = time;
		if (play) onPlayFrom(time);
		else onScrub(time);
	}
	const playPct = duration > 0 ? shown / duration * 100 : 0;
	const inPct = duration > 0 ? trim.in / duration * 100 : 0;
	const spanPct = duration > 0 ? (trim.out - trim.in) / duration * 100 : 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-11 items-center gap-3 px-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "shrink-0 text-xs tracking-wide whitespace-nowrap text-faint uppercase",
				children: "Play from"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				ref: barRef,
				role: "slider",
				"aria-label": "Jump and play from",
				"aria-valuemin": 0,
				"aria-valuemax": Math.round(duration * 100) / 100,
				"aria-valuenow": Math.round(shown * 100) / 100,
				"aria-valuetext": formatClock(shown),
				"aria-disabled": disabled,
				tabIndex: disabled ? -1 : 0,
				"data-scrubber": "",
				className: disabled ? "relative flex h-11 min-w-0 flex-1 touch-none items-center opacity-40 select-none" : "relative flex h-11 min-w-0 flex-1 cursor-pointer touch-none items-center select-none",
				onPointerDown: (event) => {
					if (disabled || event.button !== 0) return;
					dragRef.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
					move(event.clientX);
				},
				onPointerMove: (event) => {
					if (!dragRef.current) return;
					move(event.clientX);
				},
				onPointerUp: () => finish(true),
				onPointerCancel: () => finish(false),
				onKeyDown: (event) => {
					if (disabled) return;
					if (event.key === "Enter") {
						event.preventDefault();
						event.stopPropagation();
						onPlayFrom(shown);
						return;
					}
					let delta = 0;
					if (event.key === "ArrowLeft") delta = event.shiftKey ? -1 : -FRAME;
					else if (event.key === "ArrowRight") delta = event.shiftKey ? 1 : FRAME;
					else if (event.key === "Home") delta = -duration;
					else if (event.key === "End") delta = duration;
					else return;
					event.preventDefault();
					event.stopPropagation();
					nudge(shown + delta, false);
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "relative h-1.5 w-full rounded-full bg-bg",
					children: [
						duration > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute inset-y-0 rounded-full bg-line",
							style: {
								left: `${inPct}%`,
								width: `${spanPct}%`
							}
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute inset-y-0 left-0 rounded-full bg-accent",
							style: { width: `${playPct}%` }
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg bg-fg",
							style: { left: `${playPct}%` }
						}),
						duration > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "absolute top-1/2 h-3 w-px -translate-y-1/2 bg-accent",
							style: { left: `${inPct}%` }
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "absolute top-1/2 h-3 w-px -translate-y-1/2 bg-accent",
							style: { left: `${inPct + spanPct}%` }
						})] })
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: live !== null ? "w-20 shrink-0 text-right font-mono text-xs text-accent tabular-nums" : "w-20 shrink-0 text-right font-mono text-xs text-muted tabular-nums",
				children: formatClock(shown)
			})
		]
	});
}
var CARD_W = 288;
function nearestThumb(thumbs, time, duration) {
	if (thumbs.length === 0 || duration <= 0) return null;
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < thumbs.length; i++) {
		const sample = (i + .5) / thumbs.length * duration;
		const dist = Math.abs(sample - time);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return thumbs[best] ?? null;
}
function seekTime(video, time) {
	const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : time;
	return clamp(time, 0, dur > .08 ? dur - .04 : Math.max(0, dur));
}
function TrimLoupe({ ref, src, preview, thumbs, duration }) {
	const videoRef = (0, import_react.useRef)(null);
	const canvasRef = (0, import_react.useRef)(null);
	const wantRef = (0, import_react.useRef)(0);
	const openRef = (0, import_react.useRef)(false);
	const pumpRef = (0, import_react.useRef)(() => {});
	const sharpRef = (0, import_react.useRef)(false);
	const primed = (0, import_react.useRef)(false);
	const [sharp, setSharp] = (0, import_react.useState)(false);
	const open = preview !== null;
	openRef.current = open;
	if (preview) wantRef.current = preview.time;
	const [seenOpen, setSeenOpen] = (0, import_react.useState)(false);
	if (open !== seenOpen) {
		setSeenOpen(open);
		if (!open) {
			sharpRef.current = false;
			setSharp(false);
		}
	}
	(0, import_react.useImperativeHandle)(ref, () => ({ prime() {
		const video = videoRef.current;
		if (!video || primed.current) return;
		primed.current = true;
		video.play().then(() => {
			video.pause();
			pumpRef.current();
		}).catch(() => {
			primed.current = false;
		});
	} }));
	(0, import_react.useEffect)(() => {
		const video = videoRef.current;
		if (!video) return;
		let seeking = false;
		let dead = false;
		video.src = src;
		video.load();
		const draw = () => {
			if (dead || !openRef.current) return;
			const node = canvasRef.current;
			if (!node || video.readyState < 2 || video.videoWidth === 0) return;
			const ctx = node.getContext("2d");
			if (!ctx) return;
			const cssW = node.clientWidth;
			const cssH = node.clientHeight;
			if (cssW < 2 || cssH < 2) return;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const bw = Math.round(cssW * dpr);
			const bh = Math.round(cssH * dpr);
			if (node.width !== bw || node.height !== bh) {
				node.width = bw;
				node.height = bh;
			}
			const vw = video.videoWidth;
			const vh = video.videoHeight;
			const scale = Math.min(cssW / vw, cssH / vh);
			const dw = vw * scale;
			const dh = vh * scale;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, cssW, cssH);
			ctx.drawImage(video, (cssW - dw) / 2, (cssH - dh) / 2, dw, dh);
			if (!sharpRef.current) {
				sharpRef.current = true;
				setSharp(true);
			}
		};
		const pump = () => {
			if (dead || !openRef.current || seeking || video.readyState < 2) return;
			const target = seekTime(video, wantRef.current);
			if (Math.abs(video.currentTime - target) < .02) {
				draw();
				return;
			}
			seeking = true;
			try {
				video.currentTime = target;
			} catch {
				seeking = false;
			}
		};
		pumpRef.current = pump;
		const onSeeked = () => {
			seeking = false;
			const paint = () => {
				if (dead) return;
				draw();
				if (!openRef.current || video.readyState < 2) return;
				if (Math.abs(video.currentTime - seekTime(video, wantRef.current)) >= .02) pump();
			};
			paint();
			if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => {
				if (!dead && openRef.current) draw();
			});
		};
		video.addEventListener("seeked", onSeeked);
		video.addEventListener("loadeddata", pump);
		pump();
		return () => {
			dead = true;
			seeking = false;
			pumpRef.current = () => {};
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("loadeddata", pump);
			video.pause();
			video.removeAttribute("src");
			video.load();
			primed.current = false;
			sharpRef.current = false;
		};
	}, [src]);
	(0, import_react.useEffect)(() => {
		if (open) pumpRef.current();
	}, [
		open,
		preview?.time,
		preview?.edge
	]);
	const fallback = preview ? nearestThumb(thumbs, preview.time, duration) : null;
	const viewW = typeof document === "undefined" ? CARD_W : document.documentElement.clientWidth;
	const left = preview ? clamp(preview.x - CARD_W / 2, 12, Math.max(12, viewW - CARD_W - 12)) : 0;
	const caret = preview ? clamp(preview.x - left, 16, 272) : CARD_W / 2;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
		ref: videoRef,
		muted: true,
		playsInline: true,
		preload: "auto",
		className: "pointer-events-none fixed top-0 left-0 size-px opacity-0",
		"aria-hidden": true
	}), preview && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "pointer-events-none fixed z-50 w-72",
		style: {
			left,
			top: preview.y - 8,
			transform: "translateY(-100%)"
		},
		"data-trim-loupe": preview.edge,
		"aria-hidden": true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "overflow-hidden rounded-md border border-accent bg-surface",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative aspect-video w-full bg-bg",
				children: [
					fallback && !sharp ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
						src: fallback,
						alt: "",
						className: "absolute inset-0 size-full object-contain"
					}) : null,
					!sharp && !fallback ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "absolute inset-0 flex items-center justify-center text-xs text-faint",
						children: "Reading frame"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
						ref: canvasRef,
						className: sharp ? "absolute inset-0 size-full" : "absolute inset-0 size-full opacity-0"
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-3 px-3 py-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-xs font-medium tracking-wide text-accent uppercase",
					children: preview.edge === "in" ? "In point" : "Out point"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono text-xs text-fg tabular-nums",
					children: formatClock(preview.time)
				})]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "absolute top-full h-2 w-0.5 -translate-x-1/2 bg-accent",
			style: { left: caret }
		})]
	})] });
}
var HANDLE = 16;
function Timeline({ duration, trim, current, thumbs, thumbFraction, snap, playing, src, locked, onToggleSnap, onSeek, onPlayFrom, onTrim, onTrimStart, onTrimEnd }) {
	const scrollerRef = (0, import_react.useRef)(null);
	const trackRef = (0, import_react.useRef)(null);
	const dragRef = (0, import_react.useRef)(null);
	const zoomRef = (0, import_react.useRef)(1);
	const [zoom, setZoomState] = (0, import_react.useState)(1);
	const [viewport, setViewport] = (0, import_react.useState)(0);
	const [edgeDrag, setEdgeDrag] = (0, import_react.useState)(null);
	const loupeRef = (0, import_react.useRef)(null);
	const trimRef = (0, import_react.useRef)(trim);
	const currentRef = (0, import_react.useRef)(current);
	const durationRef = (0, import_react.useRef)(duration);
	const snapRef = (0, import_react.useRef)(snap);
	const metricsRef = (0, import_react.useRef)({ px: 1 });
	const setZoomRef = (0, import_react.useRef)(() => {});
	trimRef.current = trim;
	currentRef.current = current;
	durationRef.current = duration;
	snapRef.current = snap;
	zoomRef.current = zoom;
	const innerPx = Math.max(viewport, Math.round(viewport * zoom));
	const px = duration > 0 ? innerPx / duration : 1;
	metricsRef.current.px = px;
	(0, import_react.useEffect)(() => {
		const el = scrollerRef.current;
		if (!el) return;
		const measure = () => setViewport(el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	(0, import_react.useEffect)(() => {
		const el = scrollerRef.current;
		if (!el || duration <= 0) return;
		const onWheel = (event) => {
			event.preventDefault();
			const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			if (event.shiftKey) {
				el.scrollLeft += dy;
				return;
			}
			const rect = el.getBoundingClientRect();
			const local = event.clientX - rect.left;
			const contentX = el.scrollLeft + local;
			const prevZoom = zoomRef.current;
			const width = el.clientWidth;
			const time = contentX / (Math.max(width, Math.round(width * prevZoom)) / duration);
			const next = clamp(prevZoom * Math.exp(-dy * .0016), 1, 24);
			const nextInner = Math.max(width, Math.round(width * next));
			zoomRef.current = next;
			setZoomState(next);
			el.scrollLeft = time * (nextInner / duration) - local;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [duration]);
	(0, import_react.useEffect)(() => {
		if (!playing) return;
		const el = scrollerRef.current;
		if (!el || zoomRef.current <= 1.01) return;
		const x = current * metricsRef.current.px;
		const pad = 36;
		if (x < el.scrollLeft + pad || x > el.scrollLeft + el.clientWidth - pad) el.scrollLeft = x - el.clientWidth * .35;
	}, [current, playing]);
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			const target = event.target;
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "f" || event.key === "F") {
				event.preventDefault();
				setZoomRef.current(1);
			} else if (event.key === "-" || event.key === "_") {
				event.preventDefault();
				setZoomRef.current(zoomRef.current / 1.4);
			} else if (event.key === "=" || event.key === "+") {
				event.preventDefault();
				setZoomRef.current(zoomRef.current * 1.4);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	function setZoom(next) {
		const el = scrollerRef.current;
		const dur = durationRef.current;
		if (!el || dur <= 0) return;
		const prev = zoomRef.current;
		const clampedZoom = clamp(next, 1, 24);
		const width = el.clientWidth;
		const local = width / 2;
		const time = (el.scrollLeft + local) / (Math.max(width, Math.round(width * prev)) / dur);
		zoomRef.current = clampedZoom;
		setZoomState(clampedZoom);
		el.scrollLeft = time * (Math.max(width, Math.round(width * clampedZoom)) / dur) - local;
	}
	setZoomRef.current = setZoom;
	function timeAt(clientX) {
		const track = trackRef.current;
		if (!track) return 0;
		return clamp((clientX - track.getBoundingClientRect().left) / metricsRef.current.px, 0, durationRef.current);
	}
	function snapped(time, targets) {
		if (!snapRef.current) return time;
		const threshold = 8 / Math.max(metricsRef.current.px, 1e-4);
		let best = time;
		let bestD = threshold;
		for (const mark of targets) {
			const dist = Math.abs(time - mark);
			if (dist <= bestD) {
				best = mark;
				bestD = dist;
			}
		}
		return best;
	}
	function applyDrag(mode, time, origin) {
		const dur = durationRef.current;
		const play = currentRef.current;
		if (mode === "seek") {
			onSeek(snapped(time, [
				trimRef.current.in,
				trimRef.current.out,
				0,
				dur
			]));
			return;
		}
		if (mode === "in") {
			onTrim({
				in: Math.min(snapped(time, [play, 0]), trimRef.current.out),
				out: trimRef.current.out
			});
			return;
		}
		if (mode === "out") {
			onTrim({
				in: trimRef.current.in,
				out: Math.max(snapped(time, [play, dur]), trimRef.current.in)
			});
			return;
		}
		const span = origin.originOut - origin.originIn;
		let start = origin.originIn + (time - origin.originTime);
		let end = start + span;
		const threshold = 8 / Math.max(metricsRef.current.px, 1e-4);
		if (snapRef.current && Math.abs(start - play) <= threshold) {
			start = play;
			end = play + span;
		} else if (snapRef.current && Math.abs(end - play) <= threshold) {
			end = play;
			start = play - span;
		}
		if (start < 0) {
			end -= start;
			start = 0;
		}
		if (end > dur) {
			start -= end - dur;
			end = dur;
		}
		onTrim({
			in: start,
			out: end
		});
	}
	function hit(clientX) {
		const track = trackRef.current;
		if (!track) return "seek";
		const x = clientX - track.getBoundingClientRect().left;
		const pxPer = metricsRef.current.px;
		const inX = trimRef.current.in * pxPer;
		const outX = trimRef.current.out * pxPer;
		const distIn = Math.abs(x - inX);
		const distOut = Math.abs(x - outX);
		if (distIn <= HANDLE && distIn <= distOut) return "in";
		if (distOut <= HANDLE) return "out";
		if (x > inX && x < outX) return "slip";
		return "seek";
	}
	const ready = duration > 0 && viewport > 0;
	const inX = trim.in * px;
	const outX = trim.out * px;
	const playX = current * px;
	const trackWidth = zoom > 1.01 ? innerPx : viewport;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "shrink-0 border-t border-line bg-surface",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "border-b border-line",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scrubber, {
					duration,
					current,
					trim,
					snap,
					locked,
					onScrub: onSeek,
					onPlayFrom
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex min-h-12 items-center gap-2 px-3 py-1",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs tracking-wide text-faint uppercase",
						children: "Timeline"
					}),
					duration > 0 && thumbFraction < 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs text-muted",
						children: thumbs.length === 0 ? "Reading frames" : "Filmstrip"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "ml-auto flex items-center gap-1",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: snap ? "inline-flex h-11 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-ink" : "inline-flex h-11 items-center rounded-md border border-line bg-bg px-3 text-xs text-fg",
								"aria-pressed": snap,
								onClick: onToggleSnap,
								children: "Snap"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: mini,
								onClick: () => setZoom(zoom / 1.4),
								disabled: !ready || zoom <= 1.01,
								"aria-label": "Zoom out",
								children: "−"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "w-12 text-center font-mono text-xs text-muted tabular-nums",
								children: zoom <= 1.01 ? "Fit" : `${Math.round(zoom * 100)}%`
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: mini,
								onClick: () => setZoom(zoom * 1.4),
								disabled: !ready,
								"aria-label": "Zoom in",
								children: "+"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: miniWide,
								onClick: () => setZoom(1),
								disabled: !ready || zoom <= 1.01,
								children: "Fit"
							})
						]
					})
				]
			}),
			duration > 0 && thumbFraction < 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-0.5 bg-bg",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-full bg-accent",
					style: { width: `${Math.max(4, thumbFraction * 100)}%` }
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				ref: scrollerRef,
				className: "timeline-scroll overflow-x-auto",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					ref: trackRef,
					className: "relative h-28 touch-none bg-bg select-none md:h-32",
					style: { width: ready && zoom > 1.01 ? innerPx : "100%" },
					onPointerDown: (event) => {
						if (!ready || event.button !== 0) return;
						const mode = hit(event.clientX);
						const originTime = timeAt(event.clientX);
						dragRef.current = {
							mode,
							originIn: trimRef.current.in,
							originOut: trimRef.current.out,
							originTime,
							pointerId: event.pointerId
						};
						event.currentTarget.setPointerCapture(event.pointerId);
						if (mode === "in" || mode === "out") {
							setEdgeDrag(mode);
							loupeRef.current?.prime();
						} else setEdgeDrag(null);
						if (mode !== "seek") onTrimStart();
						else onSeek(snapped(originTime, [
							trimRef.current.in,
							trimRef.current.out,
							0,
							duration
						]));
						event.currentTarget.style.cursor = mode === "slip" ? "grabbing" : mode === "seek" ? "col-resize" : "ew-resize";
					},
					onPointerMove: (event) => {
						const drag = dragRef.current;
						if (!drag || drag.pointerId !== event.pointerId) {
							const mode = hit(event.clientX);
							event.currentTarget.style.cursor = mode === "in" || mode === "out" ? "ew-resize" : mode === "slip" ? "grab" : "col-resize";
							return;
						}
						applyDrag(drag.mode, timeAt(event.clientX), drag);
					},
					onPointerUp: (event) => {
						const drag = dragRef.current;
						if (!drag || drag.pointerId !== event.pointerId) return;
						dragRef.current = null;
						setEdgeDrag(null);
						if (drag.mode !== "seek") onTrimEnd();
						event.currentTarget.style.cursor = "col-resize";
					},
					onPointerCancel: () => {
						if (dragRef.current && dragRef.current.mode !== "seek") onTrimEnd();
						dragRef.current = null;
						setEdgeDrag(null);
					},
					children: [
						ready && thumbs.length > 0 ? thumbs.map((src, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
							src,
							alt: "",
							draggable: false,
							className: "pointer-events-none absolute top-0 h-full object-cover",
							style: {
								left: `${index / thumbs.length * 100}%`,
								width: `${100 / thumbs.length}%`
							}
						}, `${index}-${src.slice(-16)}`)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "pointer-events-none absolute inset-0 flex items-end justify-between px-3 pb-3",
							children: Array.from({ length: 9 }, (_, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-3 w-px bg-line" }, index))
						}),
						ready && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute inset-y-0 left-0 bg-bg/75",
								style: { width: inX }
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute inset-y-0 bg-bg/75",
								style: {
									left: outX,
									width: Math.max(0, trackWidth - outX)
								}
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute top-0 bottom-0 border-y-2 border-accent",
								style: {
									left: inX,
									width: Math.max(1, outX - inX)
								}
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute top-0 z-20 h-full w-3 -translate-x-1/2",
								style: { left: inX },
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: edgeDrag === "in" ? "mx-auto block h-full w-1 bg-accent" : "mx-auto block h-full w-1 bg-fg" })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute top-0 z-20 h-full w-3 -translate-x-1/2",
								style: { left: outX },
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: edgeDrag === "out" ? "mx-auto block h-full w-1 bg-accent" : "mx-auto block h-full w-1 bg-fg" })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "pointer-events-none absolute top-0 z-30 h-full w-0.5 bg-accent",
								style: { transform: `translateX(${playX}px)` },
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "absolute top-0 left-1/2 h-2 w-2.5 -translate-x-1/2 bg-accent",
									style: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" }
								})
							})
						] }),
						!ready && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-faint",
							children: "The cut sits on this ruler"
						})
					]
				})
			}),
			src && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TrimLoupe, {
				ref: loupeRef,
				src,
				preview: edgePreview(edgeDrag, trim, px, trackRef.current),
				thumbs,
				duration
			})
		]
	});
}
var mini = "inline-flex size-11 items-center justify-center rounded-md border border-line bg-bg text-sm text-fg hover:bg-raised disabled:opacity-40";
var miniWide = "inline-flex h-11 items-center rounded-md border border-line bg-bg px-3 text-xs text-fg hover:bg-raised disabled:opacity-40";
function edgePreview(edge, trim, px, track) {
	if (!edge || !track) return null;
	const time = edge === "in" ? trim.in : trim.out;
	const rect = track.getBoundingClientRect();
	return {
		edge,
		time,
		x: rect.left + time * px,
		y: rect.top
	};
}
var PREFS_KEY = "keel.prefs.v1";
var RATES = [
	.5,
	1,
	1.5,
	2
];
var DEFAULT_PREFS = {
	loop: true,
	rate: 1,
	muted: false,
	volume: 1,
	quality: "fine",
	snap: true
};
var SHORTCUTS = [
	["Space", "Play or pause"],
	["J  K  L", "Back 1s, pause, play"],
	["←  →", "Step one frame"],
	["Shift ← →", "Step one second"],
	["I  /  O", "Mark in and out"],
	["Home  /  End", "Go to in or out"],
	["M", "Mute"],
	["R", "Reset the cut"],
	["⌘Z  /  ⌘⇧Z", "Undo and redo"],
	["−  /  +", "Zoom the timeline"],
	["F", "Fit the timeline"],
	["⌘E", "Export"],
	["?", "Shortcuts"]
];
function Editor() {
	const videoRef = (0, import_react.useRef)(null);
	const inputRef = (0, import_react.useRef)(null);
	const urlRef = (0, import_react.useRef)(null);
	const openId = (0, import_react.useRef)(0);
	const initedFor = (0, import_react.useRef)(0);
	const trimRef = (0, import_react.useRef)({
		in: 0,
		out: 0
	});
	const durationRef = (0, import_react.useRef)(0);
	const currentRef = (0, import_react.useRef)(0);
	const loopRef = (0, import_react.useRef)(true);
	const rateRef = (0, import_react.useRef)(1);
	const busyRef = (0, import_react.useRef)(false);
	const gestureRef = (0, import_react.useRef)(null);
	const historyRef = (0, import_react.useRef)({
		past: [],
		future: []
	});
	const abortRef = (0, import_react.useRef)(null);
	const sampleLock = (0, import_react.useRef)(false);
	const playScopeRef = (0, import_react.useRef)("cut");
	const [clip, setClip] = (0, import_react.useState)(null);
	const [trim, setTrim] = (0, import_react.useState)({
		in: 0,
		out: 0
	});
	const [current, setCurrent] = (0, import_react.useState)(0);
	const [playing, setPlaying] = (0, import_react.useState)(false);
	const [prefs, setPrefs] = (0, import_react.useState)(DEFAULT_PREFS);
	const [thumbs, setThumbs] = (0, import_react.useState)([]);
	const [thumbFraction, setThumbFraction] = (0, import_react.useState)(0);
	const [banner, setBanner] = (0, import_react.useState)(null);
	const [help, setHelp] = (0, import_react.useState)(false);
	const [dragging, setDragging] = (0, import_react.useState)(false);
	const [sampleProgress, setSampleProgress] = (0, import_react.useState)(null);
	const [job, setJob] = (0, import_react.useState)(null);
	const [canUndo, setCanUndo] = (0, import_react.useState)(false);
	const [canRedo, setCanRedo] = (0, import_react.useState)(false);
	trimRef.current = trim;
	durationRef.current = clip?.duration ?? 0;
	currentRef.current = current;
	loopRef.current = prefs.loop;
	rateRef.current = prefs.rate;
	busyRef.current = job !== null;
	(0, import_react.useEffect)(() => {
		try {
			const raw = localStorage.getItem(PREFS_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			setPrefs((prev) => ({
				...prev,
				loop: typeof parsed.loop === "boolean" ? parsed.loop : prev.loop,
				rate: RATES.includes(parsed.rate ?? -1) ? parsed.rate : prev.rate,
				muted: typeof parsed.muted === "boolean" ? parsed.muted : prev.muted,
				volume: typeof parsed.volume === "number" ? clamp(parsed.volume, 0, 1) : prev.volume,
				quality: parsed.quality === "lean" || parsed.quality === "fine" || parsed.quality === "rich" ? parsed.quality : prev.quality,
				snap: typeof parsed.snap === "boolean" ? parsed.snap : prev.snap
			}));
		} catch {}
	}, []);
	(0, import_react.useEffect)(() => {
		localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
	}, [prefs]);
	(0, import_react.useEffect)(() => {
		const video = videoRef.current;
		if (!video || job) return;
		video.playbackRate = prefs.rate;
		video.muted = prefs.muted;
		video.volume = prefs.volume;
	}, [
		prefs.rate,
		prefs.muted,
		prefs.volume,
		job,
		clip?.id
	]);
	(0, import_react.useEffect)(() => {
		if (!playing || job) return;
		let frame = 0;
		const tick = () => {
			const video = videoRef.current;
			if (!video) return;
			if (!busyRef.current && loopRef.current && playScopeRef.current === "cut" && !video.paused) {
				const fudge = Math.max(.05, .08 * rateRef.current);
				if (video.currentTime >= trimRef.current.out - fudge) {
					video.currentTime = trimRef.current.in;
					if (video.paused) video.play();
				}
			}
			setCurrent(video.currentTime);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, job]);
	(0, import_react.useEffect)(() => {
		if (!clip || clip.duration <= 0) return;
		if (initedFor.current === clip.id) return;
		initedFor.current = clip.id;
		const next = {
			in: 0,
			out: clip.duration
		};
		trimRef.current = next;
		setTrim(next);
		historyRef.current = {
			past: [],
			future: []
		};
		setCanUndo(false);
		setCanRedo(false);
		setCurrent(0);
	}, [clip]);
	(0, import_react.useEffect)(() => {
		if (!clip || clip.duration <= 0) {
			setThumbs([]);
			setThumbFraction(0);
			return;
		}
		const ac = new AbortController();
		const count = Math.min(14, Math.max(8, Math.round(clip.duration)));
		setThumbs([]);
		setThumbFraction(0);
		extractThumbs(clip.url, clip.duration, count, ac.signal, (urls) => {
			if (ac.signal.aborted) return;
			setThumbs(urls);
			setThumbFraction(urls.length / count);
		}).catch(() => {});
		return () => ac.abort();
	}, [clip]);
	(0, import_react.useEffect)(() => {
		return () => {
			if (urlRef.current) URL.revokeObjectURL(urlRef.current);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const title = clip ? `${clip.name} — Keel` : "Keel";
		document.title = title;
	}, [clip]);
	const openFileRef = (0, import_react.useRef)(() => {});
	const exportRef = (0, import_react.useRef)(() => {});
	const apiRef = (0, import_react.useRef)({
		togglePlay: () => {},
		step: (_delta) => {},
		jump: (_time) => {},
		markIn: () => {},
		markOut: () => {},
		resetTrim: () => {},
		undo: () => {},
		redo: () => {},
		toggleMute: () => {},
		toggleHelp: () => {},
		cancelJob: () => {}
	});
	function syncHistory() {
		setCanUndo(historyRef.current.past.length > 0);
		setCanRedo(historyRef.current.future.length > 0);
	}
	function applyTrim(next) {
		const clamped = clampTrim(next.in, next.out, durationRef.current);
		trimRef.current = clamped;
		setTrim(clamped);
	}
	function recordAndApply(next) {
		const clamped = clampTrim(next.in, next.out, durationRef.current);
		if (nearly(clamped.in, trimRef.current.in) && nearly(clamped.out, trimRef.current.out)) return;
		historyRef.current.past.push(trimRef.current);
		if (historyRef.current.past.length > 80) historyRef.current.past.shift();
		historyRef.current.future = [];
		applyTrim(clamped);
		syncHistory();
	}
	function openFile(file) {
		if (!isLikelyVideo(file)) {
			setBanner({
				tone: "error",
				text: "Keel opens video files — MP4, WebM, or MOV."
			});
			return;
		}
		abortRef.current?.abort();
		const id = ++openId.current;
		if (urlRef.current) URL.revokeObjectURL(urlRef.current);
		const url = URL.createObjectURL(file);
		urlRef.current = url;
		setBanner(null);
		setPlaying(false);
		setThumbs([]);
		setThumbFraction(0);
		setClip({
			id,
			file,
			url,
			name: file.name,
			duration: 0,
			width: 0,
			height: 0
		});
	}
	openFileRef.current = openFile;
	function adopt(video) {
		const id = openId.current;
		const apply = (duration) => {
			if (!Number.isFinite(duration) || duration <= 0 || duration === Infinity) return;
			setClip((prev) => {
				if (!prev || prev.id !== id) return prev;
				if (prev.duration > 0) {
					if (prev.width === video.videoWidth && prev.height === video.videoHeight) return prev;
					return {
						...prev,
						width: video.videoWidth,
						height: video.videoHeight
					};
				}
				return {
					...prev,
					duration,
					width: video.videoWidth,
					height: video.videoHeight
				};
			});
		};
		const duration = video.duration;
		if (Number.isFinite(duration) && duration > 0) {
			apply(duration);
			return;
		}
		probeDuration(video).then(apply);
	}
	function failOpen() {
		if (openId.current === 0) return;
		openId.current += 1;
		if (urlRef.current) URL.revokeObjectURL(urlRef.current);
		urlRef.current = null;
		setClip(null);
		setBanner({
			tone: "error",
			text: "This browser can’t play that file. Try MP4, WebM, or MOV."
		});
	}
	function seek(time) {
		const video = videoRef.current;
		const next = clamp(time, 0, durationRef.current || 0);
		currentRef.current = next;
		setCurrent(next);
		if (video) {
			video.pause();
			video.currentTime = next;
		}
	}
	function playFrom(time) {
		const video = videoRef.current;
		if (!video || !clip || clip.duration <= 0 || job) return;
		const dur = durationRef.current || 0;
		const next = clamp(time, 0, dur);
		currentRef.current = next;
		setCurrent(next);
		video.currentTime = next;
		if (dur - next < .05) {
			video.pause();
			return;
		}
		playScopeRef.current = next >= trimRef.current.out - .05 ? "free" : "cut";
		video.play().catch(() => setPlaying(false));
	}
	function togglePlay() {
		const video = videoRef.current;
		if (!video || !clip || clip.duration <= 0 || job) return;
		if (!video.paused) {
			video.pause();
			return;
		}
		playScopeRef.current = "cut";
		if (prefs.loop && (video.currentTime < trimRef.current.in || video.currentTime >= trimRef.current.out - .05)) video.currentTime = trimRef.current.in;
		video.play().catch(() => setPlaying(false));
	}
	function step(delta) {
		const video = videoRef.current;
		if (!video || !clip) return;
		video.pause();
		seek((video.currentTime || currentRef.current) + delta);
	}
	function markIn() {
		recordAndApply({
			in: videoRef.current?.currentTime ?? currentRef.current,
			out: trimRef.current.out
		});
	}
	function markOut() {
		const time = videoRef.current?.currentTime ?? currentRef.current;
		recordAndApply({
			in: trimRef.current.in,
			out: time
		});
	}
	function resetTrim() {
		if (!clip || clip.duration <= 0) return;
		recordAndApply({
			in: 0,
			out: clip.duration
		});
	}
	function undo() {
		const prev = historyRef.current.past.pop();
		if (!prev) return;
		historyRef.current.future.push(trimRef.current);
		applyTrim(prev);
		syncHistory();
	}
	function redo() {
		const next = historyRef.current.future.pop();
		if (!next) return;
		historyRef.current.past.push(trimRef.current);
		applyTrim(next);
		syncHistory();
	}
	function toggleMute() {
		setPrefs((prev) => ({
			...prev,
			muted: !prev.muted
		}));
	}
	function cancelJob() {
		abortRef.current?.abort();
	}
	apiRef.current = {
		togglePlay,
		step,
		jump: seek,
		markIn,
		markOut,
		resetTrim,
		undo,
		redo,
		toggleMute,
		toggleHelp: () => setHelp((open) => !open),
		cancelJob
	};
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			const target = event.target;
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
			const key = event.key;
			const meta = event.metaKey || event.ctrlKey;
			if (key === "Escape") {
				if (help) {
					setHelp(false);
					return;
				}
				if (busyRef.current) {
					event.preventDefault();
					apiRef.current.cancelJob();
				}
				return;
			}
			if (key === "?" || key === "/" && event.shiftKey) {
				event.preventDefault();
				apiRef.current.toggleHelp();
				return;
			}
			if (meta && key.toLowerCase() === "e") {
				event.preventDefault();
				exportRef.current();
				return;
			}
			if (meta && key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) apiRef.current.redo();
				else apiRef.current.undo();
				return;
			}
			if (meta || event.altKey) return;
			if (key === " ") {
				event.preventDefault();
				apiRef.current.togglePlay();
			} else if (key === "k" || key === "K") {
				event.preventDefault();
				videoRef.current?.pause();
			} else if (key === "l" || key === "L") {
				event.preventDefault();
				if (videoRef.current?.paused) apiRef.current.togglePlay();
			} else if (key === "j" || key === "J") {
				event.preventDefault();
				apiRef.current.step(-1);
			} else if (key === "ArrowLeft") {
				event.preventDefault();
				apiRef.current.step(event.shiftKey ? -1 : -FRAME);
			} else if (key === "ArrowRight") {
				event.preventDefault();
				apiRef.current.step(event.shiftKey ? 1 : FRAME);
			} else if (key === "i" || key === "I" || key === "[") {
				event.preventDefault();
				apiRef.current.markIn();
			} else if (key === "o" || key === "O" || key === "]") {
				event.preventDefault();
				apiRef.current.markOut();
			} else if (key === "Home") {
				event.preventDefault();
				apiRef.current.jump(trimRef.current.in);
			} else if (key === "End") {
				event.preventDefault();
				apiRef.current.jump(trimRef.current.out);
			} else if (key === "m" || key === "M") {
				event.preventDefault();
				apiRef.current.toggleMute();
			} else if (key === "r" || key === "R") {
				event.preventDefault();
				apiRef.current.resetTrim();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [help]);
	(0, import_react.useEffect)(() => {
		let depth = 0;
		const hasFiles = (event) => event.dataTransfer?.types?.includes("Files");
		const enter = (event) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth += 1;
			setDragging(true);
		};
		const over = (event) => {
			if (!hasFiles(event) || !event.dataTransfer) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		};
		const leave = (event) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth -= 1;
			if (depth <= 0) {
				depth = 0;
				setDragging(false);
			}
		};
		const drop = (event) => {
			if (!hasFiles(event) || !event.dataTransfer) return;
			event.preventDefault();
			depth = 0;
			setDragging(false);
			const file = pickVideo(event.dataTransfer.files);
			if (file) openFileRef.current(file);
			else if (event.dataTransfer.files.length) setBanner({
				tone: "error",
				text: "Keel opens video files — MP4, WebM, or MOV."
			});
		};
		window.addEventListener("dragenter", enter);
		window.addEventListener("dragover", over);
		window.addEventListener("dragleave", leave);
		window.addEventListener("drop", drop);
		return () => {
			window.removeEventListener("dragenter", enter);
			window.removeEventListener("dragover", over);
			window.removeEventListener("dragleave", leave);
			window.removeEventListener("drop", drop);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		if (!new URLSearchParams(window.location.search).has("demo")) return;
		loadSample();
	}, []);
	async function loadSample() {
		if (sampleLock.current) return;
		sampleLock.current = true;
		setSampleProgress(0);
		setBanner(null);
		try {
			const file = await createSampleClip((progress) => setSampleProgress(progress));
			openFileRef.current(file);
		} catch (error) {
			setBanner({
				tone: "error",
				text: error instanceof Error ? error.message : "Couldn’t build the sample."
			});
		} finally {
			sampleLock.current = false;
			setSampleProgress(null);
		}
	}
	async function onExport() {
		if (!clip || clip.duration <= 0 || job) return;
		if (trimRef.current.out - trimRef.current.in < .05) {
			setBanner({
				tone: "error",
				text: "The cut is too short to export."
			});
			return;
		}
		const ctrl = new AbortController();
		abortRef.current = ctrl;
		videoRef.current?.pause();
		setJob({
			progress: 0,
			label: "Encoding cut"
		});
		setBanner(null);
		try {
			const result = await exportCut({
				file: clip.file,
				filename: clip.name,
				start: trimRef.current.in,
				end: trimRef.current.out,
				quality: prefs.quality,
				video: videoRef.current,
				signal: ctrl.signal,
				onProgress: (progress, label) => setJob({
					progress,
					label
				})
			});
			downloadBlob(result.blob, result.filename);
			setBanner({
				tone: "info",
				text: `Downloaded ${result.filename}`
			});
		} catch (error) {
			if (isAbort(error)) setBanner({
				tone: "info",
				text: "Export canceled"
			});
			else setBanner({
				tone: "error",
				text: error instanceof Error ? error.message : "Export failed"
			});
		} finally {
			setJob(null);
			abortRef.current = null;
		}
	}
	exportRef.current = onExport;
	const ready = Boolean(clip && clip.duration > 0);
	const span = Math.max(0, trim.out - trim.in);
	const meta = ready && clip ? `${clip.width}×${clip.height} · ${formatClock(clip.duration)}` : "On this device";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "relative flex h-dvh flex-col overflow-hidden bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex h-14 shrink-0 items-center gap-2 border-b border-line px-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex shrink-0 items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-sm font-medium tracking-tight",
							children: "Keel"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "min-w-0 flex-1",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "truncate text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: clip?.name ?? "No clip" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-faint",
								children: [" · ", meta]
							})]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: iconBtn,
						"aria-label": "Keyboard shortcuts",
						onClick: () => setHelp(true),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Keyboard, { className: "size-4" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ghost,
						onClick: () => inputRef.current?.click(),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FolderOpen, { className: "size-4" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "hidden sm:inline",
							children: "Open"
						})]
					}),
					job ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: iconBtn,
						onClick: cancelJob,
						"aria-label": "Cancel export",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: primary,
						disabled: !ready || Boolean(job),
						onClick: () => void onExport(),
						"aria-label": job ? job.label : "Export trim",
						children: job ? `${Math.round(job.progress * 100)}%` : "Export"
					})
				]
			}),
			job && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "h-0.5 shrink-0 bg-bg",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-full bg-accent",
					style: { width: `${Math.max(3, job.progress * 100)}%` }
				})
			}),
			banner && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex shrink-0 items-center gap-3 border-b border-line bg-raised px-3 py-2 text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "min-w-0 flex-1",
					children: banner.text
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: iconBtn,
					"aria-label": "Dismiss",
					onClick: () => setBanner(null),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "relative flex min-h-0 flex-1 items-center justify-center bg-bg p-3 md:p-6",
				children: clip ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
					ref: videoRef,
					src: clip.url,
					playsInline: true,
					preload: "auto",
					disablePictureInPicture: true,
					className: "max-h-full max-w-full bg-surface",
					onLoadedMetadata: (event) => adopt(event.currentTarget),
					onDurationChange: (event) => adopt(event.currentTarget),
					onPlay: () => setPlaying(true),
					onPause: () => setPlaying(false),
					onEnded: () => setPlaying(false),
					onError: () => {
						if (clip.id === openId.current && clip.duration <= 0) failOpen();
					},
					onClick: togglePlay
				}, clip.id), clip.duration <= 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "absolute text-sm text-muted",
					children: "Reading clip…"
				})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex w-full max-w-md flex-col items-center px-4 text-center",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "mb-4 flex size-12 items-center justify-center rounded-md border border-line bg-surface text-accent",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clapperboard, { className: "size-6" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "text-2xl font-medium tracking-tight text-balance",
							children: "Drop a short video"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 max-w-sm text-sm text-pretty text-muted",
							children: "Drag the edges of the timeline to keep the middle. The file stays in this browser."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-6 flex flex-wrap items-center justify-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: primary,
								onClick: () => inputRef.current?.click(),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FolderOpen, { className: "size-4" }), "Browse"]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: ghost,
								onClick: () => void loadSample(),
								disabled: sampleProgress !== null,
								children: sampleProgress === null ? "Try a sample" : `Making sample ${Math.round(sampleProgress * 100)}%`
							})]
						})
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex shrink-0 flex-col gap-2 border-t border-line px-3 py-2 md:flex-row md:items-center",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-center gap-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: playBtn,
							onClick: togglePlay,
							disabled: !ready || Boolean(job),
							"aria-label": playing ? "Pause" : "Play",
							children: playing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, { className: "size-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, { className: "size-5" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: () => step(-FRAME),
							disabled: !ready,
							"aria-label": "Step back one frame",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipBack, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: () => step(FRAME),
							disabled: !ready,
							"aria-label": "Step forward one frame",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipForward, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "font-mono text-sm tabular-nums",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatClock(current) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-faint",
								children: [" / ", formatClock(clip?.duration ?? 0)]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: prefs.loop ? toggleOn : ghost,
							"aria-pressed": prefs.loop,
							onClick: () => setPrefs((prev) => ({
								...prev,
								loop: !prev.loop
							})),
							children: "Loop cut"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: toggleMute,
							"aria-label": prefs.muted ? "Unmute" : "Mute",
							"aria-pressed": prefs.muted,
							children: prefs.muted || prefs.volume === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VolumeX, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Volume2, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "keel-slider hidden sm:block",
							type: "range",
							min: 0,
							max: 1,
							step: .01,
							"aria-label": "Volume",
							value: prefs.muted ? 0 : prefs.volume,
							onChange: (event) => {
								const volume = Number(event.target.value);
								setPrefs((prev) => ({
									...prev,
									volume,
									muted: volume === 0
								}));
							}
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ghost,
							onClick: () => setPrefs((prev) => {
								const index = RATES.indexOf(prev.rate);
								return {
									...prev,
									rate: RATES[(index + 1) % RATES.length] ?? 1
								};
							}),
							children: [prefs.rate, "×"]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-center gap-2 md:ml-auto",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
							label: "In",
							value: formatClock(trim.in)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
							label: "Length",
							value: formatClock(span),
							accent: true
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Readout, {
							label: "Out",
							value: formatClock(trim.out)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: ghost,
							onClick: markIn,
							disabled: !ready,
							children: "Mark in"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: ghost,
							onClick: markOut,
							disabled: !ready,
							children: "Mark out"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: resetTrim,
							disabled: !ready,
							"aria-label": "Reset trim",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCcw, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: undo,
							disabled: !canUndo,
							"aria-label": "Undo trim",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Undo2, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: iconBtn,
							onClick: redo,
							disabled: !canRedo,
							"aria-label": "Redo trim",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Redo2, { className: "size-4" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex h-11 items-center rounded-md border border-line p-0.5",
							children: [
								"lean",
								"fine",
								"rich"
							].map((level) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-pressed": prefs.quality === level,
								className: prefs.quality === level ? "h-10 rounded-sm bg-raised px-3 text-xs font-medium text-fg capitalize" : "h-10 rounded-sm px-3 text-xs text-faint capitalize",
								onClick: () => setPrefs((prev) => ({
									...prev,
									quality: level
								})),
								children: level
							}, level))
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Timeline, {
				duration: clip?.duration ?? 0,
				trim,
				current,
				thumbs,
				thumbFraction,
				snap: prefs.snap,
				playing,
				src: clip?.url ?? null,
				locked: Boolean(job),
				onToggleSnap: () => setPrefs((prev) => ({
					...prev,
					snap: !prev.snap
				})),
				onSeek: seek,
				onPlayFrom: playFrom,
				onTrim: (next) => applyTrim(next),
				onTrimStart: () => {
					gestureRef.current = trimRef.current;
					videoRef.current?.pause();
				},
				onTrimEnd: () => {
					const start = gestureRef.current;
					gestureRef.current = null;
					if (!start) return;
					if (nearly(start.in, trimRef.current.in) && nearly(start.out, trimRef.current.out)) return;
					historyRef.current.past.push(start);
					if (historyRef.current.past.length > 80) historyRef.current.past.shift();
					historyRef.current.future = [];
					syncHistory();
				}
			}, clip?.id ?? 0),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				ref: inputRef,
				type: "file",
				accept: "video/*,.mp4,.mov,.m4v,.webm,.mkv,.ogv,.ogg",
				className: "sr-only",
				tabIndex: -1,
				onChange: (event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) openFile(file);
				}
			}),
			dragging && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg/85",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-md border border-accent px-8 py-6 text-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-lg font-medium",
						children: "Drop to open"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "Replaces the current clip"
					})]
				})
			}),
			help && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "absolute inset-0 z-50 flex items-end justify-center bg-bg/80 p-3 sm:items-center",
				onClick: () => setHelp(false),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-md border border-line bg-surface",
					onClick: (event) => event.stopPropagation(),
					role: "dialog",
					"aria-labelledby": "shortcut-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between border-b border-line px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "shortcut-title",
								className: "text-sm font-medium",
								children: "Shortcuts"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: iconBtn,
								"aria-label": "Close shortcuts",
								onClick: () => setHelp(false),
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
							className: "overflow-auto px-4 py-2",
							children: SHORTCUTS.map(([key, action]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
									className: "font-mono text-sm text-accent tabular-nums",
									children: key
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
									className: "text-sm text-muted",
									children: action
								})]
							}, key))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "border-t border-line px-4 py-3 text-xs text-faint",
							children: "Drag either edge to trim. The frame at that cut pops up above the handle. The bar above the filmstrip jumps there and plays. Drag the kept region to slide the cut. Scroll to zoom."
						})
					]
				})
			})
		]
	});
}
function Readout({ label, value, accent }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: "flex min-w-16 flex-col",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-xs tracking-wide text-faint uppercase",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: accent ? "font-mono text-sm text-accent tabular-nums" : "font-mono text-sm tabular-nums",
			children: value
		})]
	});
}
function Mark() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
		viewBox: "0 0 24 24",
		className: "size-6",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
				x: "2",
				y: "4",
				width: "3",
				height: "16",
				rx: "0.5",
				className: "fill-accent"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
				x: "19",
				y: "4",
				width: "3",
				height: "16",
				rx: "0.5",
				className: "fill-accent"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", {
				x: "6",
				y: "11",
				width: "12",
				height: "2",
				className: "fill-fg"
			})
		]
	});
}
function probeDuration(video) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			video.removeEventListener("seeked", onSeeked);
			window.clearTimeout(timer);
			const fromMeta = video.duration;
			const found = Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : video.currentTime;
			if (video.currentTime !== 0) video.currentTime = 0;
			resolve(found);
		};
		const onSeeked = () => finish();
		const timer = window.setTimeout(finish, 1200);
		video.addEventListener("seeked", onSeeked);
		try {
			video.currentTime = 1e101;
		} catch {
			finish();
		}
	});
}
function isLikelyVideo(file) {
	if (file.type.startsWith("video/")) return true;
	if (file.type.startsWith("image/") || file.type.startsWith("audio/")) return false;
	if (/\.(mp4|mov|m4v|webm|mkv|ogv|ogg|avi|mpeg|mpg|qt)$/i.test(file.name)) return true;
	return file.type === "" || file.type === "application/octet-stream";
}
function pickVideo(list) {
	return Array.from(list).find(isLikelyVideo) ?? null;
}
function isAbort(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
var ghost = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-bg px-3 text-sm text-fg hover:bg-raised disabled:opacity-40";
var iconBtn = "inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-bg text-fg hover:bg-raised disabled:opacity-40";
var primary = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-40";
var playBtn = "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-40";
var toggleOn = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink";
var SplitComponent = Editor;
//#endregion
export { SplitComponent as component };
