#!/usr/bin/env node
/**
 * YUNAY build script.
 *
 * - Validates every server-side JavaScript file with `node --check`.
 * - Produces a deployable `dist/` bundle (server + dashboard).
 *
 * Usage:
 *   npm run build          # validate + create dist/
 *   npm run check          # validate only
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const checkOnly = process.argv.includes("--check-only");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/* 1. Syntax check */
const jsFiles = [
  path.join(root, "server.js"),
  ...walk(path.join(root, "src")).filter((f) => f.endsWith(".js")),
  ...walk(path.join(root, "public")).filter((f) => f.endsWith(".js")),
  ...walk(path.join(root, "scripts")).filter((f) => f.endsWith(".js"))
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log("✓ syntax check passed (" + jsFiles.length + " files)");

if (checkOnly) process.exit(0);

/* 2. Build dist/ */
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

copyDir(path.join(root, "public"), path.join(dist, "public"));
copyDir(path.join(root, "src"), path.join(dist, "src"));

for (const file of ["server.js", "package.json", "package-lock.json"]) {
  const from = path.join(root, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dist, file));
}

const manifest = {
  name: "yunay-clone",
  version: require(path.join(root, "package.json")).version,
  builtAt: new Date().toISOString(),
  node: process.version,
  files: walk(dist).length
};
fs.writeFileSync(
  path.join(dist, "BUILD_INFO.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

console.log("✓ build complete → dist/ (" + manifest.files + " files)");
