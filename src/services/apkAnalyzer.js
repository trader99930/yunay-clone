const AdmZip = require('adm-zip');
const ApkReader = require('adbkit-apkreader');
const fs = require('fs');
const path = require('path');

async function analyzeApkFile(apkFilePath, apkId) {
  const extractDir = path.join(__dirname, '../../workspace/apk_extracted', apkId);
  fs.mkdirSync(extractDir, { recursive: true });

  // 1. Binary AndroidManifest.xml parse karna (Real APKs ke liye)
  let manifestData = {
    package: 'unknown',
    versionName: '1.0',
    versionCode: 1,
    permissions: [],
    activities: []
  };

  try {
    const reader = await ApkReader.open(apkFilePath);
    const manifest = await reader.readManifest();
    manifestData = {
      package: manifest.package || 'unknown',
      versionName: manifest.versionName || '1.0',
      versionCode: manifest.versionCode || 1,
      permissions: (manifest.usesPermissions || []).map(p => p.name),
      activities: (manifest.application?.activities || []).map(a => a.name)
    };
  } catch (err) {
    // Fallback: Agar plain text/mock XML manifest ho
    try {
      const zipTemp = new AdmZip(apkFilePath);
      const entry = zipTemp.getEntry('AndroidManifest.xml');
      if (entry) {
        const rawXml = entry.getData().toString('utf8');
        const pkgMatch = rawXml.match(/package="([^"]+)"/);
        if (pkgMatch) manifestData.package = pkgMatch[1];
      }
    } catch (e) {}
  }

  // 2. APK Archive entries scan aur web/config assets extract karna
  const zip = new AdmZip(apkFilePath);
  const entries = zip.getEntries();

  const stats = {
    totalFiles: entries.length,
    dexCount: 0,
    nativeLibs: [],
    assetsList: []
  };

  const extractedWebPreview = {};

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;

    if (name.endsWith('.dex')) stats.dexCount++;
    if (name.startsWith('lib/') && name.endsWith('.so')) stats.nativeLibs.push(name);
    if (name.startsWith('assets/')) stats.assetsList.push(name);

    // Agar APK mein Web/Hybrid files (Capacitor/Cordova/WebView/Configs) hain toh preview lena
    if (
      name.startsWith('assets/') &&
      (name.endsWith('.html') || name.endsWith('.js') || name.endsWith('.json') || name.endsWith('.css')) &&
      entry.header.size < 50000 &&
      Object.keys(extractedWebPreview).length < 10
    ) {
      try {
        extractedWebPreview[name] = entry.getData().toString('utf8').substring(0, 2000);
      } catch (e) {}
    }
  }

  zip.extractAllTo(extractDir, true);

  return {
    apkId,
    extractPath: extractDir,
    manifest: manifestData,
    stats,
    extractedWebPreview
  };
}

module.exports = { analyzeApkFile };
