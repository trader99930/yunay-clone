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
app.use(cors());
app.use(express.json({ limit: "50mb" }));
const upload = multer({ dest: "uploads/" });

// Static serving for reconstructed apps
app.use("/preview", express.static(path.join(__dirname, "workspace/reconstructed")));

// Static dashboard (served at /)
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({ status: "online", stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8] });
});

app.post("/api/scan-url", async (req, res) => {
  try {
    const raw = await scanWebsite(req.body.url);
    res.json({ success: true, report: analyzeWebStructure(raw) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/analyze-zip", upload.single("file"), (req, res) => {
  try {
    const raw = analyzeZipFile(req.file.path, "proj_" + Date.now());
    fs.unlinkSync(req.file.path);
    res.json({ success: true, report: analyzeZipStructure(raw) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/analyze-apk", upload.single("file"), async (req, res) => {
  try {
    const raw = await analyzeApkFile(req.file.path, "apk_" + Date.now());
    fs.unlinkSync(req.file.path);
    res.json({ success: true, report: analyzeApkStructure(raw) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ai/chat", async (req, res) => {
  try {
    const ai = await askYunayAI(req.body);
    res.json({ success: true, ai });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Step 8: AI Reconstruction Endpoint
app.post("/api/reconstruct", async (req, res) => {
  try {
    console.log("[Reconstructor] Building project files...");
    const result = await reconstructProject(req.body);
    res.json({ success: true, build: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("YUNAY Backend running on http://localhost:" + PORT);
});
