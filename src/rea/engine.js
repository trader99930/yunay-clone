function analyzeWebStructure(scanData) {
  const html = scanData.fullHtml.toLowerCase();
  const scripts = scanData.assets.scripts.join(' ').toLowerCase();
  const styles = scanData.assets.styles.join(' ').toLowerCase();

  const detectedStack = [];

  if (html.includes('__next') || scripts.includes('_next/')) detectedStack.push('Next.js');
  if (html.includes('data-reactroot') || scripts.includes('react')) detectedStack.push('React');
  if (html.includes('ng-version') || scripts.includes('angular')) detectedStack.push('Angular');
  if (html.includes('data-v-') || scripts.includes('vue')) detectedStack.push('Vue.js');
  if (styles.includes('tailwind') || html.includes(' class="flex ') || html.includes(' class="bg-')) detectedStack.push('Tailwind CSS');
  if (styles.includes('bootstrap') || scripts.includes('bootstrap')) detectedStack.push('Bootstrap');
  if (scripts.includes('jquery')) detectedStack.push('jQuery');

  if (detectedStack.length === 0) detectedStack.push('Vanilla HTML/CSS/JS');

  return {
    targetUrl: scanData.url,
    finalUrl: scanData.finalUrl,
    title: scanData.title,
    statusCode: scanData.statusCode,
    warnings: scanData.warnings || [],
    detectedTechStack: detectedStack,
    stats: scanData.stats,
    assets: scanData.assets,
    apiEndpoints: scanData.apiCalls,
    screenshot: scanData.screenshot,
    navigations: scanData.navigations || [],
    htmlPreview: scanData.htmlSnippet
  };
}

function analyzeZipStructure(zipData) {
  const detectedStack = [];
  const pkg = zipData.packageJson;
  const exts = zipData.stats.byExtension;

  if (pkg) {
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps.next) detectedStack.push('Next.js');
    if (allDeps.react) detectedStack.push('React');
    if (allDeps.vue) detectedStack.push('Vue.js');
    if (allDeps.express) detectedStack.push('Express.js');
    if (allDeps.tailwindcss) detectedStack.push('Tailwind CSS');
    if (allDeps.typescript || exts['.ts'] || exts['.tsx']) detectedStack.push('TypeScript');
  }

  if (exts['.py']) detectedStack.push('Python');
  if (exts['.html'] && detectedStack.length === 0) detectedStack.push('Static HTML/CSS/JS');
  if (detectedStack.length === 0) detectedStack.push('General Source Archive');

  return {
    projectId: zipData.projectId,
    extractPath: zipData.extractPath,
    projectName: pkg?.name || zipData.projectId,
    detectedTechStack: detectedStack,
    dependencies: pkg?.dependencies || {},
    scripts: pkg?.scripts || {},
    stats: zipData.stats,
    fileTree: zipData.fileTree,
    keyFilesPreview: zipData.keyFilesPreview
  };
}

function analyzeApkStructure(apkData) {
  const detectedStack = [];
  const libs = apkData.stats.nativeLibs.join(' ').toLowerCase();
  const assets = apkData.stats.assetsList.join(' ').toLowerCase();
  const webApk = apkData.manifest.webApk;

  // Chrome "Add to Home screen" wala PWA shortcut (org.chromium.webapk.*)
  if (webApk && webApk.isWebApk) {
    detectedStack.push('WebAPK (Chrome PWA)');
  }
  if (libs.includes('libflutter.so') || assets.includes('flutter_assets')) {
    detectedStack.push('Flutter');
  }
  if (libs.includes('libreactnativejni.so') || assets.includes('index.android.bundle')) {
    detectedStack.push('React Native');
  }
  if (assets.includes('capacitor.config.json') || assets.includes('public/index.html')) {
    detectedStack.push('Capacitor / Hybrid Web');
  }
  if (assets.includes('cordova.js') || assets.includes('www/index.html')) {
    detectedStack.push('Apache Cordova');
  }
  if (libs.includes('libunity.so')) {
    detectedStack.push('Unity 3D');
  }
  if (detectedStack.length === 0) {
    detectedStack.push('Native Android (Java/Kotlin)');
  }

  return {
    apkId: apkData.apkId,
    extractPath: apkData.extractPath,
    packageName: apkData.manifest.package,
    versionName: apkData.manifest.versionName,
    detectedFramework: detectedStack,
    permissions: apkData.manifest.permissions,
    activities: apkData.manifest.activities,
    stats: {
      totalFiles: apkData.stats.totalFiles,
      dexFiles: apkData.stats.dexCount,
      nativeLibsCount: apkData.stats.nativeLibs.length,
      assetsCount: apkData.stats.assetsList.length
    },
    webApp: apkData.manifest.webApk,
    extractedWebPreview: apkData.extractedWebPreview
  };
}

module.exports = { analyzeWebStructure, analyzeZipStructure, analyzeApkStructure };
