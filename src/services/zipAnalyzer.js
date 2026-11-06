const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const IGNORE_LIST = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.DS_Store'];
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.json', '.md'];

function analyzeZipFile(zipFilePath, projectId) {
  const extractDir = path.join(__dirname, '../../workspace/extracted', projectId);
  fs.mkdirSync(extractDir, { recursive: true });

  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(extractDir, true);

  const fileTree = [];
  const fileStats = { totalFiles: 0, byExtension: {} };
  const keyFilesContent = {};
  let packageJsonData = null;

  function scanDir(currentDir, relativePath = '') {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      if (IGNORE_LIST.includes(item)) continue;

      const fullPath = path.join(currentDir, item);
      const relPath = path.join(relativePath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        fileTree.push({ path: relPath, type: 'directory' });
        scanDir(fullPath, relPath);
      } else {
        const ext = path.extname(item).toLowerCase() || 'no-ext';
        fileStats.totalFiles++;
        fileStats.byExtension[ext] = (fileStats.byExtension[ext] || 0) + 1;

        fileTree.push({ path: relPath, type: 'file', size: stat.size });

        // package.json detect karna
        if (item === 'package.json' && !packageJsonData) {
          try {
            packageJsonData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          } catch (e) {}
        }

        // Key source files (under 30KB) ka sample read karna (max 15 files)
        if (
          CODE_EXTENSIONS.includes(ext) &&
          stat.size < 30000 &&
          Object.keys(keyFilesContent).length < 15
        ) {
          try {
            keyFilesContent[relPath] = fs.readFileSync(fullPath, 'utf8').substring(0, 3000);
          } catch (e) {}
        }
      }
    }
  }

  scanDir(extractDir);

  return {
    projectId,
    extractPath: extractDir,
    stats: fileStats,
    packageJson: packageJsonData,
    fileTree,
    keyFilesPreview: keyFilesContent
  };
}

module.exports = { analyzeZipFile };
