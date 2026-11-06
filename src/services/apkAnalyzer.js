const AdmZip = require('adm-zip');
const ApkReader = require('adbkit-apkreader');
const fs = require('fs');
const path = require('path');

const WEBAPK_PACKAGE_PREFIX = 'org.chromium.webapk';
const WEBAPK_META_PREFIX = 'org.chromium.webapk.shell_apk.';

/**
 * WebAPK (Chrome PWA shortcut) ki info manifest metadata se nikalta hai.
 * Start URL manifest ke <meta-data android:name="org.chromium.webapk.shell_apk.startUrl"> me hota hai.
 */
function extractWebApkInfo(packageName, metaData = {}) {
  const isWebApk = String(packageName || '').startsWith(WEBAPK_PACKAGE_PREFIX);
  const read = (key) => metaData[WEBAPK_META_PREFIX + key] || null;

  const startUrl = read('startUrl');
  const scope = read('scope');
  const webManifestUrl = read('webManifestUrl');
  const hasWebApkMeta = Boolean(startUrl || scope || webManifestUrl);

  if (!isWebApk && !hasWebApkMeta) return null;

  return {
    isWebApk,
    startUrl,
    scope,
    webManifestUrl,
    displayMode: read('displayMode'),
    themeColor: read('themeColor'),
    backgroundColor: read('backgroundColor'),
    orientation: read('orientation')
  };
}

/**
 * application-level <meta-data> entries ko DOM se nikalta hai.
 * adbkit-apkreader ka readManifest() application metaData include nahi karta,
 * isliye binary XML ko directly traverse karte hain.
 */
async function readAppMetaData(reader) {
  const metaData = {};
  try {
    const root = await reader.readXml('AndroidManifest.xml');
    const application = (root.childNodes || []).find((node) => node.nodeName === 'application');
    if (!application) return metaData;

    for (const child of application.childNodes || []) {
      if (child.nodeName !== 'meta-data') continue;
      const attrs = {};
      for (const attr of child.attributes || []) {
        attrs[attr.name] = attr.value != null ? attr.value : (attr.typedValue ? attr.typedValue.value : null);
      }
      if (attrs.name) metaData[attrs.name] = attrs.value;
    }
  } catch (e) {}
  return metaData;
}

async function analyzeApkFile(apkFilePath, apkId) {
  const extractDir = path.join(__dirname, '../../workspace/apk_extracted', apkId);
  fs.mkdirSync(extractDir, { recursive: true });

  // 1. Binary AndroidManifest.xml parse karna (Real APKs ke liye)
  let manifestData = {
    package: 'unknown',
    versionName: '1.0',
    versionCode: 1,
    permissions: [],
    activities: [],
    webApk: null
  };

  try {
    const reader = await ApkReader.open(apkFilePath);
    const manifest = await reader.readManifest();
    const application = manifest.application || {};

    // Manifest-level <meta-data> (WebAPK startUrl, scope, etc.)
    const metaData = await readAppMetaData(reader);

    manifestData = {
      package: manifest.package || 'unknown',
      versionName: manifest.versionName || '1.0',
      versionCode: manifest.versionCode || 1,
      permissions: (manifest.usesPermissions || []).map(p => p.name),
      activities: (application.activities || []).map(a => a.name),
      webApk: extractWebApkInfo(manifest.package, metaData)
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
        manifestData.webApk = extractWebApkInfo(manifestData.package, {});
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

module.exports = { analyzeApkFile, extractWebApkInfo };
