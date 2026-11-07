/* YUNAY dashboard — talks to the local Express API on the same origin. */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let lastReport = null;
  let lastWebAppUrl = null;

  /* Fetch response ko safely JSON parse karta hai. Agar server HTML bheje
     (jaise Express ka error page) to readable error deta hai, obscure
     "Unexpected token '<'" nahi. */
  async function readJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      const type = res.headers.get("content-type") || "unknown content-type";
      const body = text.trim();
      const hint = body.startsWith("<")
        ? "Server ne JSON ki jagah HTML bheja (" + res.status + ", " + type + "). API route ya server logs check karo."
        : (body.slice(0, 200) || "Empty response");
      throw new Error(hint);
    }
  }

  /* ---------- tabs ---------- */
  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("active", p.id === "tab-" + name);
    });
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  /* ---------- helpers ---------- */
  function showError(id, message) {
    const box = $(id);
    box.textContent = message;
    box.classList.remove("hidden");
  }
  function clearError(id) {
    $(id).classList.add("hidden");
  }
  function setBusy(button, busy, label) {
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Working…';
    } else {
      button.disabled = false;
      button.textContent = label || button.dataset.label || "Done";
    }
  }
  function chip(text) {
    return el("span", "chip", text);
  }
  function renderChips(container, items) {
    container.innerHTML = "";
    (items || []).forEach((item) => container.appendChild(chip(item)));
    if (!items || items.length === 0) container.appendChild(el("span", "muted", "None detected"));
  }
  function renderStats(container, pairs) {
    container.innerHTML = "";
    pairs.forEach(([key, value]) => {
      const row = el("div");
      row.appendChild(el("dt", null, key));
      row.appendChild(el("dd", null, value === undefined || value === null ? "—" : String(value)));
      container.appendChild(row);
    });
  }
  function renderList(container, items, renderItem) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
      container.appendChild(el("div", "empty", "Nothing detected"));
      return;
    }
    items.forEach((item) => container.appendChild(renderItem(item)));
  }
  function assetItem(text) {
    return el("div", "item", text);
  }

  /* ---------- status ---------- */
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("status " + res.status);
      const data = await readJson(res);
      const box = $("#status");
      box.classList.remove("bad");
      box.classList.add("ok");
      $("#status-text").textContent = "online · " + (data.stepsCompleted || []).length + " steps";
      $("#footer-status").textContent = "API online · steps " + (data.stepsCompleted || []).join(", ");
    } catch (err) {
      const box = $("#status");
      box.classList.remove("ok");
      box.classList.add("bad");
      $("#status-text").textContent = "offline";
      $("#footer-status").textContent = "API offline";
    }
  }

  /* ---------- website scan ---------- */
  $("#scan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#scan-btn");
    const url = $("#url").value.trim();

    clearError("#web-error");
    $("#web-result").classList.add("hidden");
    $("#build-result").classList.add("hidden");
    setBusy(button, true);

    try {
      const res = await fetch("/api/scan-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Scan failed");
      lastReport = data.report;
      renderWebReport(data.report);
    } catch (err) {
      showError("#web-error", "Scan fail hua: " + err.message);
    } finally {
      setBusy(button, false, "Scan Website");
    }
  });

  function renderWebReport(report) {
    $("#web-title").textContent = report.title || "Untitled";
    const link = $("#web-url");
    const displayUrl = report.finalUrl || report.targetUrl || "";
    link.textContent = displayUrl;
    link.href = displayUrl || "#";

    const warnBox = $("#web-warning");
    if (report.warnings && report.warnings.length) {
      warnBox.textContent = report.warnings.join("\n");
      warnBox.classList.remove("hidden");
    } else {
      warnBox.classList.add("hidden");
    }

    renderChips($("#web-stack"), report.detectedTechStack);

    const stats = report.stats || {};
    renderStats($("#web-stats"), [
      ["HTML length", stats.htmlLength],
      ["Scripts", stats.scriptsCount],
      ["Stylesheets", stats.stylesCount],
      ["Images", stats.imagesCount],
      ["API calls", stats.apiCallsCount]
    ]);

    const shot = $("#web-shot");
    if (report.screenshot) {
      shot.src = report.screenshot;
      shot.style.display = "block";
    } else {
      shot.removeAttribute("src");
      shot.style.display = "none";
    }

    const assets = report.assets || {};
    renderList($("#web-assets"), [
      ...(assets.scripts || []).map((src) => "JS  " + src),
      ...(assets.styles || []).map((href) => "CSS " + href),
      ...(assets.images || []).map((src) => "IMG " + src)
    ], assetItem);

    renderList($("#web-apis"), report.apiEndpoints || [], (call) =>
      assetItem((call.method || "GET") + " " + (call.url || ""))
    );

    $("#web-raw").textContent = JSON.stringify(report, null, 2);
    $("#web-result").classList.remove("hidden");
    $("#web-result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- reconstruct ---------- */
  $("#recon-btn").addEventListener("click", async () => {
    if (!lastReport) {
      showError("#web-error", "Pehle website scan karo, phir reconstruct dabao.");
      return;
    }
    const button = $("#recon-btn");
    clearError("#web-error");
    setBusy(button, true);

    try {
      const res = await fetch("/api/reconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reaContext: lastReport,
          prompt: $("#recon-prompt").value.trim() || "Reconstruct modern web app",
          projectName: $("#project-name").value.trim() || "yunay-reconstructed-app"
        })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Reconstruction failed");

      const build = data.build;
      $("#build-id").textContent = build.buildId;
      const modeLabel = build.mode === "snapshot" ? "static snapshot" : build.mode;
      $("#build-meta").textContent =
        build.filesCount + " files · provider: " + build.provider + " · mode: " + modeLabel;
      $("#build-link").href = build.previewUrl;
      $("#build-frame").src = build.previewUrl;
      $("#build-result").classList.remove("hidden");
      $("#build-result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError("#web-error", "Reconstruct fail hua: " + err.message);
    } finally {
      setBusy(button, false, "Reconstruct");
    }
  });

  /* ---------- ZIP ---------- */
  $("#zip-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = $("#zip-form");
    const button = $("#zip-btn");
    const file = $("#zip-file").files[0];

    clearError("#zip-error");
    $("#zip-result").classList.add("hidden");
    if (!file) return showError("#zip-error", "Pehle ZIP file select karo.");

    setBusy(button, true);
    const body = new FormData();
    body.append("file", file);

    fetch("/api/analyze-zip", { method: "POST", body })
      .then(async (res) => {
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        renderZipReport(data.report);
        $("#zip-result").classList.remove("hidden");
        $("#zip-result").scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch((err) => showError("#zip-error", "Analysis fail hua: " + err.message))
      .finally(() => setBusy(button, false, "Analyze ZIP"));
  });

  function renderZipReport(report) {
    $("#zip-name").textContent = report.projectName || report.projectId || "Project";
    renderChips($("#zip-stack"), report.detectedTechStack);

    const stats = report.stats || {};
    renderStats($("#zip-stats"), [
      ["Total files", stats.totalFiles],
      ["Project ID", report.projectId],
      ["Extract path", report.extractPath]
    ]);

    const deps = Object.entries(report.dependencies || {}).map(([name, ver]) => name + "  " + ver);
    renderList($("#zip-deps"), deps, assetItem);

    const tree = (report.fileTree || [])
      .map((entry) => (entry.type === "directory" ? "📁 " : "📄 ") + entry.path)
      .join("\n");
    $("#zip-tree").textContent = tree || "No files";
    $("#zip-raw").textContent = JSON.stringify(report, null, 2);
  }

  /* ---------- APK ---------- */
  $("#apk-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const button = $("#apk-btn");
    const file = $("#apk-file").files[0];

    clearError("#apk-error");
    $("#apk-result").classList.add("hidden");
    if (!file) return showError("#apk-error", "Pehle APK file select karo.");

    setBusy(button, true);
    const body = new FormData();
    body.append("file", file);

    fetch("/api/analyze-apk", { method: "POST", body })
      .then(async (res) => {
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        renderApkReport(data.report);
        $("#apk-result").classList.remove("hidden");
        $("#apk-result").scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch((err) => showError("#apk-error", "Analysis fail hua: " + err.message))
      .finally(() => setBusy(button, false, "Analyze APK"));
  });

  function renderApkReport(report) {
    $("#apk-pkg").textContent = report.packageName || "unknown";
    $("#apk-version").textContent =
      "version " + (report.versionName || "?") + " · " + (report.apkId || "");
    renderChips($("#apk-stack"), report.detectedFramework);

    const stats = report.stats || {};
    renderStats($("#apk-stats"), [
      ["Total files", stats.totalFiles],
      ["DEX files", stats.dexFiles],
      ["Native libs", stats.nativeLibsCount],
      ["Assets", stats.assetsCount],
      ["Activities", (report.activities || []).length]
    ]);

    renderList($("#apk-perms"), report.permissions || [], assetItem);

    // WebAPK / PWA shortcut: original website URL dikhao
    const webApp = report.webApp;
    const webAppBox = $("#apk-webapp");
    lastWebAppUrl = (webApp && (webApp.startUrl || webApp.scope)) || null;
    if (webApp && webApp.isWebApk) {
      renderStats($("#apk-webapp-info"), [
        ["Start URL", webApp.startUrl],
        ["Scope", webApp.scope],
        ["Manifest URL", webApp.webManifestUrl],
        ["Display mode", webApp.displayMode]
      ]);
      webAppBox.classList.remove("hidden");
    } else {
      webAppBox.classList.add("hidden");
    }

    const web = report.extractedWebPreview || {};
    const preview = Object.entries(web)
      .map(([name, content]) => "=== " + name + " ===\n" + content)
      .join("\n\n");
    $("#apk-web").textContent = preview || "No web assets found";
    $("#apk-raw").textContent = JSON.stringify(report, null, 2);
  }

  /* ---------- WebAPK -> website scan ---------- */
  $("#apk-scan-web").addEventListener("click", () => {
    if (!lastWebAppUrl) return;
    activateTab("web");
    $("#url").value = lastWebAppUrl;
    $("#scan-form").requestSubmit();
  });

  /* ---------- boot ---------- */
  loadStatus();
  setInterval(loadStatus, 20000);
})();
