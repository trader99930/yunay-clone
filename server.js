require("dotenv").config({ quiet: true });
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { scanWebsite } = require("./src/services/scanner");
const { analyzeZipFile } = require("./src/services/zipAnalyzer");
const { analyzeApkFile } = require("./src/services/apkAnalyzer");
const { analyzeWebStructure, analyzeZipStructure, analyzeApkStructure } = require("./src/rea/engine");
const { askYunayAI } = require("./src/services/yunayAi");
const { reconstructProject } = require("./src/services/reconstructor");

const app = express();
const PORT = process.env.PORT || 4000;

// Uploads directory ko startup par hi ensure karo (multer khud create nahi karta)
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "50mb" }));
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

// Static serving for reconstructed apps
app.use("/preview", express.static(path.join(__dirname, "workspace/reconstructed")));

// Static dashboard (served at /)
app.use(express.static(path.join(__dirname, "public")));

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[Upload cleanup]", e.message);
  }
}

function requireUpload(req, res) {
  if (!req.file) {
    res.status(400).json({ error: 'File missing. Multipart form me "file" field bhejo.' });
    return false;
  }
  return true;
}

app.get("/api/status", (req, res) => {
  res.json({ status: "online", stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8] });
});

app.post("/api/scan-url", async (req, res) => {
  const url = req.body && req.body.url;
  if (!url) {
    return res.status(400).json({ error: "URL required hai." });
  }
  try {
    const raw = await scanWebsite(url);
    res.json({ success: true, report: analyzeWebStructure(raw) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/analyze-zip", upload.single("file"), (req, res) => {
  if (!requireUpload(req, res)) return;
  try {
    const raw = analyzeZipFile(req.file.path, "proj_" + Date.now());
    res.json({ success: true, report: analyzeZipStructure(raw) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    safeUnlink(req.file && req.file.path);
  }
});

app.post("/api/analyze-apk", upload.single("file"), async (req, res) => {
  if (!requireUpload(req, res)) return;
  try {
    const raw = await analyzeApkFile(req.file.path, "apk_" + Date.now());
    res.json({ success: true, report: analyzeApkStructure(raw) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    safeUnlink(req.file && req.file.path);
  }
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    const ai = await askYunayAI(req.body || {});
    res.json({ success: true, ai });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 8: AI Reconstruction Endpoint
app.post("/api/reconstruct", async (req, res) => {
  try {
    console.log("[Reconstructor] Building project files...");
    const result = await reconstructProject(req.body || {});
    res.json({ success: true, build: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unknown API route -> JSON (HTML error page kabhi nahi)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found: " + req.method + " " + req.originalUrl });
});

// Central error handler -> hamesha JSON, chahe multer/express error ho
app.use((err, req, res, next) => {
  console.error("[API Error]", err.message);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || (err.name === "MulterError" ? 400 : 500);
  res.status(status).json({ error: err.message || "Request failed" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("YUNAY Backend running on http://localhost:" + PORT);
});
