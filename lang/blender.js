'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { findBlender } = require('../lib/engine');

function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } });
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function stripBlenderHeader(out) {
  return out.split('\n').filter(l => !l.match(/^Blender \d|^\s*$/) || l.trim()).join('\n').trim();
}

async function run(code, cwd) {
  const expr = code.trim();
  // Always try bridge first (works for both expressions and scripts via /eval)
  try {
    const res = await httpPost(6009, '/eval', { expr });
    if (res.result !== undefined) return String(res.result);
    if (res.error) return `Error: ${res.error}`;
    return res.raw || JSON.stringify(res);
  } catch (_) {
    // Bridge not available — fall back to headless Blender
  }
  const blender = findBlender(null);
  if (!blender) return 'Error: Blender not found. Set blenderPath in ~/.blender-kit/config.json';
  const tmp = path.join(os.tmpdir(), `blender_exec_${Date.now()}.py`);
  fs.writeFileSync(tmp, expr + '\n');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const out = execFileSync(blender, ['--background', '--python', tmp], {
      cwd, signal: ac.signal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return stripBlenderHeader(out);
  } catch (e) {
    const combined = (e.stdout || '') + (e.stderr || '');
    return stripBlenderHeader(combined) || String(e.message);
  } finally {
    clearTimeout(timer);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function check(code, cwd) {
  const tmp = path.join(os.tmpdir(), `flake8_${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(tmp, code);
    let out = '';
    try { execFileSync('flake8', [tmp], { encoding: 'utf8' }); } catch (e) { out = e.stdout || e.message || ''; }
    return out.split('\n').reduce((acc, line) => {
      const m = line.match(/^.+:(\d+):(\d+):\s+([EWC]\d+)\s+(.+)$/);
      if (m) acc.push({ line: parseInt(m[1]), col: parseInt(m[2]), severity: m[3].startsWith('E') ? 'error' : 'warning', message: `${m[3]} ${m[4].trim()}` });
      return acc;
    }, []);
  } catch (_) { return []; }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

module.exports = {
  id: 'blender',
  extensions: ['.py'],
  exec: { match: /^exec:blender/, run },
  lsp: { check },
  context: `=== Blender exec: support ===
exec:blender
<python expression or script>

Always tries HTTP bridge first (port 6009, requires Blender open + blender_bridge addon enabled).
Falls back to blender --background --python for headless execution.
Requires: Blender installed and blenderPath set in ~/.blender-kit/config.json`,
};
