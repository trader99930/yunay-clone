const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const cheerio = require("cheerio");
const { askYunayAI } = require("./yunayAi");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ASSET_TIMEOUT = 20000;
const MAX_ASSETS = 150;

/**
 * Relative/protocol-relative URL ko absolute banata hai. Non-http(s) URLs
 * (data:, blob:, #, mailto:, etc.) skip hote hain.
 */
function toAbsoluteUrl(raw, baseUrl) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (
    !value ||
    value.startsWith("#") ||
    /^(data:|blob:|javascript:|mailto:|tel:|about:)/i.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch (e) {
    return null;
  }
}

function extensionFor(url, contentType) {
  const cleaned = String(url).split("#")[0].split("?")[0];
  const match = cleaned.match(/\.([a-z0-9]{1,5})$/i);
  if (match) return "." + match[1].toLowerCase();

  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("text/css")) return ".css";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return ".js";
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/jpeg")) return ".jpg";
  if (ct.includes("image/webp")) return ".webp";
  if (ct.includes("image/svg")) return ".svg";
  if (ct.includes("image/gif")) return ".gif";
  if (ct.includes("image/avif")) return ".avif";
  if (ct.includes("font/woff2")) return ".woff2";
  if (ct.includes("font/woff")) return ".woff";
  if (ct.includes("font/ttf") || ct.includes("truetype")) return ".ttf";
  if (ct.includes("application/json")) return ".json";
  return ".bin";
}

/** Simple concurrency limiter (network requests ke liye). */
function createLimiter(max) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= max || queue.length === 0) return;
    const task = queue.shift();
    active++;
    task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        active--;
        next();
      });
  }

  return function limit(run) {
    return new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      next();
    });
  };
}

const limitRequest = createLimiter(8);

/**
 * Scanned page ke assets download karke build folder me save karta hai.
 * CSS ke andar ke url()/@import bhi recursively localize hote hain.
 */
function createAssetStore(outDir) {
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const cache = new Map();
  const saved = [];
  let fetchCount = 0;

  async function fetchAsset(rawUrl, baseUrl, depth = 0) {
    const url = toAbsoluteUrl(rawUrl, baseUrl);
    if (!url) return null;
    if (cache.has(url)) return cache.get(url);
    if (fetchCount >= MAX_ASSETS) return null;

    const promise = (async () => {
      try {
        fetchCount++;
        const res = await limitRequest(() =>
          axios.get(url, {
            timeout: ASSET_TIMEOUT,
            responseType: "arraybuffer",
            maxRedirects: 5,
            maxContentLength: 25 * 1024 * 1024,
            headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
            validateStatus: (status) => status >= 200 && status < 400
          })
        );

        let buffer = Buffer.from(res.data);
        const contentType = String(res.headers["content-type"] || "");
        const ext = extensionFor(url, contentType);
        const name = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16) + ext;
        const relPath = "assets/" + name;
        const fullPath = path.join(assetsDir, name);

        const isCss = ext === ".css" || contentType.toLowerCase().includes("text/css");
        if (isCss && depth < 3) {
          const localized = await localizeCss(buffer.toString("utf8"), url, depth + 1);
          buffer = Buffer.from(localized, "utf8");
        }

        fs.writeFileSync(fullPath, buffer);
        saved.push(relPath);
        return relPath;
      } catch (e) {
        return null;
      }
    })();

    cache.set(url, promise);
    return promise;
  }

  async function localizeCss(css, cssUrl, depth = 0) {
    if (!css || depth > 3) return css;

    const replacements = new Map();

    // url(...) — images, fonts, background assets
    const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    await Promise.all(
      [...css.matchAll(urlPattern)].map(async (match) => {
        const raw = match[2].trim();
        if (!raw || /^(data:|blob:|#|javascript:)/i.test(raw)) return;
        const local = await fetchAsset(raw, cssUrl, depth);
        if (local) replacements.set(match[0], 'url("' + local + '")');
      })
    );

    // @import "file.css" (bina url() ke)
    const importPattern = /@import\s+(['"])([^'"]+)\1/gi;
    await Promise.all(
      [...css.matchAll(importPattern)].map(async (match) => {
        const local = await fetchAsset(match[2].trim(), cssUrl, depth);
        if (local) replacements.set(match[0], '@import url("' + local + '")');
      })
    );

    let out = css;
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
  }

  return { fetchAsset, localizeCss, saved };
}

/**
 * Scanned report ke rendered DOM se self-contained static snapshot banata hai.
 * Scripts hata diye jaate hain taaki preview remote APIs call karke page ko
 * re-render/redirect na kare. Return null agar report me HTML nahi hai.
 */
async function buildSnapshot({ reaContext, prompt, projectName, outDir }) {
  const html = reaContext.html || reaContext.fullHtml || reaContext.htmlPreview;
  if (!html || html.length < 200) return null;

  const baseUrl = reaContext.finalUrl || reaContext.targetUrl;
  if (!baseUrl) return null;

  const $ = cheerio.load(html);
  const title = reaContext.title || projectName;

  $("script").remove();
  $("base").remove();
  $('meta[http-equiv="Content-Security-Policy" i]').remove();
  $('link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"]').remove();

  const store = createAssetStore(outDir);
  const jobs = [];

  const localizeAttr = (selector, attr) => {
    $(selector).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!raw) return;
      jobs.push(
        store.fetchAsset(raw, baseUrl).then((local) => {
          if (local) $(el).attr(attr, local);
        })
      );
    });
  };

  localizeAttr('link[rel="stylesheet"][href]', "href");
  localizeAttr('link[rel="icon"][href]', "href");
  localizeAttr('link[rel="shortcut icon"][href]', "href");
  localizeAttr('link[rel="apple-touch-icon"][href]', "href");
  localizeAttr("img[src]", "src");
  localizeAttr("source[src]", "src");
  localizeAttr("video[poster]", "poster");
  localizeAttr('input[type="image"][src]', "src");

  // srcset="a.png 1x, b.png 2x"
  $("img[srcset], source[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (!srcset) return;
    const parts = srcset.split(",").map((part) => part.trim()).filter(Boolean);

    jobs.push(
      Promise.all(
        parts.map(async (part) => {
          const [url, ...descriptor] = part.split(/\s+/);
          const local = await store.fetchAsset(url, baseUrl);
          return local ? [local, ...descriptor].join(" ") : part;
        })
      ).then((localized) => $(el).attr("srcset", localized.join(", ")))
    );
  });

  // Inline CSS blocks aur style attributes ke andar ke url()
  $("style").each((_, el) => {
    const css = $(el).html();
    if (!css || !/url\(/i.test(css)) return;
    jobs.push(
      store.localizeCss(css, baseUrl, 0).then((next) => {
        if (next) $(el).html(next);
      })
    );
  });

  $("[style]").each((_, el) => {
    const css = $(el).attr("style");
    if (!css || !/url\(/i.test(css)) return;
    jobs.push(
      store.localizeCss(css, baseUrl, 0).then((next) => {
        if (next) $(el).attr("style", next);
      })
    );
  });

  await Promise.all(jobs);

  const readme = [
    "# " + title + " — YUNAY static snapshot",
    "",
    "Source: " + baseUrl,
    "Captured: " + new Date().toISOString(),
    "Prompt: " + prompt,
    "",
    "Ye scanned page ke rendered DOM + localized assets se bana static snapshot hai.",
    "Scripts hata diye gaye hain taaki preview stable rahe.",
    "",
    "Preview: index.html",
    ""
  ].join("\n");

  return {
    html: $.html(),
    readme,
    sourceUrl: baseUrl,
    title,
    assets: store.saved.slice()
  };
}

async function reconstructProject({
  reaContext = {},
  prompt = "Reconstruct modern web app",
  projectName = "yunay-reconstructed-app"
}) {
  const buildId = "build_" + Date.now();
  const outDir = path.join(__dirname, "../../workspace/reconstructed", buildId);
  fs.mkdirSync(outDir, { recursive: true });

  const stack = reaContext.detectedTechStack || reaContext.detectedFramework || [
    "HTML5",
    "Tailwind CSS",
    "JavaScript"
  ];
  const title = reaContext.title || reaContext.projectName || reaContext.packageName || projectName;

  let generatedFiles = null;
  let provider = "yunay-local-synthesizer";
  let mode = "fallback";
  let sourceUrl = null;
  let snapshotAssets = [];

  // 1) Scanned HTML ho to local static snapshot (AI key ki zaroorat nahi).
  const snapshot = await buildSnapshot({ reaContext, prompt, projectName, outDir });
  if (snapshot) {
    generatedFiles = {
      "index.html": snapshot.html,
      "README.md": snapshot.readme
    };
    provider = "yunay-snapshot";
    mode = "snapshot";
    sourceUrl = snapshot.sourceUrl;
    snapshotAssets = snapshot.assets;
  } else {
    // 2) Warna AI reconstruction (key hone par live, nahi to fallback template).
    const aiPrompt =
      "Return ONLY valid JSON with keys: files (object mapping filename to code string). Target: " +
      title +
      ". Task: " +
      prompt;
    const aiRes = await askYunayAI({ prompt: aiPrompt, reaContext });
    provider = aiRes.provider;
    mode = aiRes.mode;

    if (aiRes.mode === "live") {
      try {
        const match = aiRes.reply.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.files) generatedFiles = parsed.files;
        }
      } catch (e) {}
    }

    if (!generatedFiles) {
      generatedFiles = {
        "package.json": JSON.stringify(
          {
            name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
            version: "1.0.0",
            description: "Reconstructed by YUNAY AI Engine",
            scripts: { start: "npx serve ." }
          },
          null,
          2
        ),
        "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} - Reconstructed</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="container">
    <header class="header">
      <span class="badge">YUNAY AI RECONSTRUCTED</span>
      <h1>${title}</h1>
      <p>Detected Stack: ${stack.join(", ")}</p>
    </header>
    <main class="card">
      <h2>Project Overview</h2>
      <p id="status-text">Prompt: ${prompt}</p>
      <button id="action-btn">Run Diagnostics</button>
      <pre id="console-box">Ready.</pre>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
        "style.css": `* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
body { background: #0b0f19; color: #e2e8f0; padding: 2rem; }
.container { max-width: 800px; margin: 0 auto; }
.header { margin-bottom: 2rem; border-bottom: 1px solid #1e293b; padding-bottom: 1rem; }
.badge { background: #10b981; color: #052e16; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; }
h1 { margin: 0.8rem 0 0.4rem; color: #38bdf8; }
.card { background: #111827; border: 1px solid #1f2937; padding: 1.5rem; border-radius: 8px; }
button { margin-top: 1rem; background: #3b82f6; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: 600; }
button:hover { background: #2563eb; }
pre { margin-top: 1rem; background: #030712; padding: 1rem; border-radius: 6px; color: #34d399; font-family: monospace; }`,
        "app.js": `document.getElementById("action-btn").addEventListener("click", () => {
  const box = document.getElementById("console-box");
  box.textContent = "[YUNAY Runtime] Diagnostics passed at " + new Date().toLocaleTimeString();
});`
      };
    }
  }

  const savedFiles = [];
  for (const [relPath, content] of Object.entries(generatedFiles)) {
    const fullPath = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    savedFiles.push({ path: relPath, size: Buffer.byteLength(content, "utf8") });
  }

  // Snapshot assets already disk par hain — sirf report ke liye list karo.
  for (const relPath of snapshotAssets) {
    try {
      const stat = fs.statSync(path.join(outDir, relPath));
      savedFiles.push({ path: relPath, size: stat.size });
    } catch (e) {}
  }

  return {
    buildId,
    outputDir: outDir,
    provider,
    mode,
    sourceUrl,
    filesCount: savedFiles.length,
    files: savedFiles,
    previewUrl: "/preview/" + buildId + "/index.html"
  };
}

module.exports = { reconstructProject };
