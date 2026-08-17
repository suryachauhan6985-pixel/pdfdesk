// Shared processing overlay + upload-with-progress helper.
// Used by compress/merge/split/rotate so every tool shows the same
// full-screen "working on it" state instead of just a small side-status line.
(function () {
  let overlayEl, titleEl, barFillEl, percentEl, subEl;

  function ensureBuilt() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.className = "processing-overlay";
    overlayEl.innerHTML = `
      <div class="processing-card">
        <div class="processing-spinner"></div>
        <div class="processing-title" id="pdOverlayTitle">Processing…</div>
        <div class="processing-bar"><div class="processing-bar-fill" id="pdOverlayBarFill"></div></div>
        <div class="processing-meta">
          <span id="pdOverlaySub">Please wait</span>
          <span id="pdOverlayPercent"></span>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    titleEl = overlayEl.querySelector("#pdOverlayTitle");
    barFillEl = overlayEl.querySelector("#pdOverlayBarFill");
    percentEl = overlayEl.querySelector("#pdOverlayPercent");
    subEl = overlayEl.querySelector("#pdOverlaySub");
  }

  function show(title) {
    ensureBuilt();
    titleEl.textContent = title || "Processing…";
    subEl.textContent = "Starting…";
    percentEl.textContent = "";
    barFillEl.classList.remove("indeterminate");
    barFillEl.style.width = "0%";
    overlayEl.classList.add("open");
  }

  // percent: 0-100, or null/undefined for an indeterminate "still working" state
  function setProgress(percent, sub) {
    ensureBuilt();
    if (sub) subEl.textContent = sub;
    if (percent === null || percent === undefined) {
      barFillEl.classList.add("indeterminate");
      percentEl.textContent = "";
    } else {
      barFillEl.classList.remove("indeterminate");
      const p = Math.max(0, Math.min(100, Math.round(percent)));
      barFillEl.style.width = p + "%";
      percentEl.textContent = p + "%";
    }
  }

  function hide(delayMs) {
    if (!overlayEl) return;
    if (delayMs) {
      setTimeout(() => overlayEl.classList.remove("open"), delayMs);
    } else {
      overlayEl.classList.remove("open");
    }
  }

  /**
   * POSTs formData to url via XMLHttpRequest (so real upload-progress events
   * are available, unlike fetch), driving the overlay's progress bar:
   *   0–35%   = actual upload progress (accurate, byte-based)
   *   35–92%  = simulated progress that decelerates as it approaches 92%
   *             (server processing has no real progress signal, so this
   *             mimics the "almost there" feel of sites like iLovePDF
   *             instead of a plain indeterminate stripe)
   *   92–100% = snaps to 100% the instant the real response arrives
   * Resolves with an object shaped like a fetch() Response (ok, status,
   * headers.get(), blob(), json()) so existing call sites barely change.
   */
  function upload(url, formData) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.responseType = "blob";

      let current = 0;
      let simTimer = null;

      const startSimulated = () => {
        clearInterval(simTimer);
        subEl && (subEl.textContent = "Processing on server…");
        simTimer = setInterval(() => {
          // Decelerating approach to 92% — bigger steps early, tiny steps late.
          const remaining = 92 - current;
          const step = Math.max(0.15, remaining * 0.045);
          current = Math.min(92, current + step);
          setProgress(current);
        }, 220);
      };

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          current = (e.loaded / e.total) * 35;
          setProgress(current, "Uploading…");
        }
      };
      xhr.upload.onload = () => {
        current = 35;
        setProgress(current);
        startSimulated();
      };

      xhr.onload = () => {
        clearInterval(simTimer);
        setProgress(100, "Done");
        const headerMap = {};
        xhr
          .getAllResponseHeaders()
          .trim()
          .split(/[\r\n]+/)
          .forEach((line) => {
            const idx = line.indexOf(": ");
            if (idx === -1) return;
            headerMap[line.slice(0, idx).toLowerCase()] = line.slice(idx + 2);
          });

        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          headers: { get: (k) => headerMap[String(k).toLowerCase()] || null },
          blob: () => Promise.resolve(xhr.response),
          json: () =>
            new Promise((res) => {
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  res(JSON.parse(reader.result));
                } catch {
                  res({});
                }
              };
              reader.onerror = () => res({});
              reader.readAsText(xhr.response);
            })
        });
      };

      xhr.onerror = () => {
        clearInterval(simTimer);
        reject(new Error("Network error — please check your connection."));
      };
      xhr.ontimeout = () => {
        clearInterval(simTimer);
        reject(new Error("Request timed out."));
      };

      xhr.send(formData);
    });
  }

  window.PDFDeskOverlay = { show, setProgress, hide, upload };
})();