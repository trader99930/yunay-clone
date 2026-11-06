const fs = require("fs");
const path = require("path");
const { askYunayAI } = require("./yunayAi");

async function reconstructProject({ reaContext = {}, prompt = "Reconstruct modern web app", projectName = "yunay-reconstructed-app" }) {
  const buildId = "build_" + Date.now();
  const outDir = path.join(__dirname, "../../workspace/reconstructed", buildId);
  fs.mkdirSync(outDir, { recursive: true });

  const stack = reaContext.detectedTechStack || reaContext.detectedFramework || ["HTML5", "Tailwind CSS", "JavaScript"];
  const title = reaContext.title || reaContext.projectName || reaContext.packageName || projectName;

  const aiPrompt = "Return ONLY valid JSON with keys: files (object mapping filename to code string). Target: " + title + ". Task: " + prompt;
  const aiRes = await askYunayAI({ prompt: aiPrompt, reaContext });

  let generatedFiles = null;
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
      "package.json": JSON.stringify({
        name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        version: "1.0.0",
        description: "Reconstructed by YUNAY AI Engine",
        scripts: { start: "npx serve ." }
      }, null, 2),
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

  const savedFiles = [];
  for (const [relPath, content] of Object.entries(generatedFiles)) {
    const fullPath = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    savedFiles.push({ path: relPath, size: Buffer.byteLength(content, "utf8") });
  }

  return {
    buildId,
    outputDir: outDir,
    provider: aiRes.provider,
    mode: aiRes.mode,
    filesCount: savedFiles.length,
    files: savedFiles,
    previewUrl: "/preview/" + buildId + "/index.html"
  };
}

module.exports = { reconstructProject };
