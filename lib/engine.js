'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const CFG_DIR = path.join(os.homedir(), '.blender-kit');
const CFG_PATH = path.join(CFG_DIR, 'config.json');

const BLENDER_VERSIONS = ['5.1', '5.0', '4.4', '4.3', '4.2', '4.1', '4.0'];

function candidatePaths() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const v of BLENDER_VERSIONS) {
      candidates.push(`C:/Program Files/Blender Foundation/Blender ${v}/blender.exe`);
    }
  } else if (process.platform === 'darwin') {
    for (const v of BLENDER_VERSIONS) {
      candidates.push(`/Applications/Blender ${v}.app/Contents/MacOS/Blender`);
    }
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  } else {
    for (const v of BLENDER_VERSIONS) {
      candidates.push(`/usr/bin/blender-${v}`, `/opt/blender-${v}/blender`);
    }
    candidates.push('/usr/bin/blender');
  }
  return candidates;
}

function getVersion(blenderPath) {
  try {
    const r = spawnSync(blenderPath, ['--version'], { encoding: 'utf8', timeout: 8000 });
    const m = (r.stdout || r.stderr || '').match(/Blender\s+(\d+\.\d+[\.\d]*)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function findAllBlenders() {
  const seen = new Set();
  const found = [];

  for (const p of candidatePaths()) {
    if (!fs.existsSync(p) || seen.has(p)) continue;
    seen.add(p);
    const version = getVersion(p);
    if (version) found.push({ path: p, version });
  }

  // Also check PATH variants
  for (const name of ['blender', ...BLENDER_VERSIONS.map(v => `blender${v}`), ...BLENDER_VERSIONS.map(v => `blender-${v}`)]) {
    try {
      const r = spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 4000 });
      const m = (r.stdout || r.stderr || '').match(/Blender\s+(\d+\.\d+[\.\d]*)/);
      if (m && !seen.has(name)) { seen.add(name); found.push({ path: name, version: m[1] }); }
    } catch {}
  }

  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function findBlender(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const cfg = readConfig();
  if (cfg.blenderPath && fs.existsSync(cfg.blenderPath)) return cfg.blenderPath;
  const all = findAllBlenders();
  return all.length ? all[0].path : null;
}

async function downloadEngine() {
  console.log('\nBlender releases: https://www.blender.org/download/');
  console.log('\nAfter installing, pin the version you want:');
  console.log('  blender-dev use              # pick from all detected installs');
  console.log('  blender-dev config set blenderPath /path/to/blender');
}

module.exports = { BLENDER_VERSIONS, CFG_DIR, CFG_PATH, readConfig, writeConfig, findBlender, findAllBlenders, downloadEngine };
