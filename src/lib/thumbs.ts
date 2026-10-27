function waitFor(target: EventTarget, event: string, signal: AbortSignal, ms: number): Promise<void> {
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

export async function extractThumbs(
  url: string,
  duration: number,
  count: number,
  signal: AbortSignal,
  onUpdate: (urls: string[]) => void,
): Promise<void> {
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
    await waitFor(video, "loadeddata", signal, 8000);
    if (signal.aborted) return;
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      if (signal.aborted) return;
      const time = Math.min(duration - 0.05, Math.max(0, ((i + 0.5) / count) * duration));
      if (Math.abs(video.currentTime - time) > 0.01) {
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
      urls.push(canvas.toDataURL("image/jpeg", 0.68));
      onUpdate(urls.slice());
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    holder.remove();
  }
}
