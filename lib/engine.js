'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CFG_DIR = path.join(os.homedir(), '.blender-kit');
const CFG_PATH = path.join(CFG_DIR, 'config.json');

const BLENDER_VERSION = '4.3';

const COMMON_PATHS = {
  win32: [
    'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  ],
  darwin: [
    '/Applications/Blender.app/Contents/MacOS/Blender',
  ],
  linux: [],
};

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function findBlender(explicitPath) {
  if (explicitPath) return explicitPath;
  const cfg = readConfig();
  if (cfg.blenderPath && fs.existsSync(cfg.blenderPath)) return cfg.blenderPath;

  // Check common installation paths for this platform
  const commonPaths = COMMON_PATHS[process.platform] || [];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Try system PATH
  try { execSync('blender --version', { stdio: 'pipe' }); return 'blender'; } catch {}
  try { execSync('blender4.3 --version', { stdio: 'pipe' }); return 'blender4.3'; } catch {}

  return null;
}

function getDownloadUrl() {
  const base = `https://www.blender.org/download/release/Blender${BLENDER_VERSION}/`;
  if (process.platform === 'win32') return `${base}blender-${BLENDER_VERSION}-windows-x64.msi`;
  if (process.platform === 'darwin') return `${base}blender-${BLENDER_VERSION}-macos-arm64.dmg`;
  return `${base}blender-${BLENDER_VERSION}-linux-x64.tar.xz`;
}

async function downloadEngine() {
  const url = getDownloadUrl();
  console.log(`\nBlender ${BLENDER_VERSION} download URL:`);
  console.log(`  ${url}\n`);
  console.log('Please download and install Blender manually from blender.org,');
  console.log(`then set the path with:\n  blender-dev config set blenderPath /path/to/blender`);
  console.log(`\nDefault install locations:`);
  const paths = COMMON_PATHS[process.platform] || [];
  if (paths.length) paths.forEach(p => console.log(`  ${p}`));
  else console.log('  (Check your package manager or blender.org)');
}

module.exports = { BLENDER_VERSION, CFG_DIR, CFG_PATH, readConfig, writeConfig, findBlender, downloadEngine };
