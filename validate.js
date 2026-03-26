#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');

let pass = 0, fail = 0, errors = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch(e) { fail++; errors.push(`${name}: ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); pass++; }
  catch(e) { fail++; errors.push(`${name}: ${e.message}`); }
}

async function run() {
  const root = __dirname;

  const engine = require(path.join(root, 'lib/engine'));

  t('engine: BLENDER_VERSIONS is array of version strings', () => {
    assert.ok(Array.isArray(engine.BLENDER_VERSIONS));
    assert.ok(engine.BLENDER_VERSIONS.length > 0);
    engine.BLENDER_VERSIONS.forEach(v => assert.match(v, /^\d+\.\d+$/));
  });

  t('engine: CFG_DIR and CFG_PATH are correct', () => {
    assert.ok(engine.CFG_DIR.includes('.blender-kit'));
    assert.ok(engine.CFG_PATH.includes('config.json'));
  });

  t('engine: readConfig returns object', () => {
    assert.equal(typeof engine.readConfig(), 'object');
  });

  t('engine: findBlender returns string or null', () => {
    const r = engine.findBlender(null);
    assert.ok(r === null || typeof r === 'string');
  });

  t('engine: findAllBlenders returns array', () => {
    const all = engine.findAllBlenders();
    assert.ok(Array.isArray(all));
  });

  const { bridgeGet, bridgePost, pingBridge, BRIDGE_PORT } = require(path.join(root, 'lib/http-client'));

  t('http: BRIDGE_PORT is 6009', () => assert.equal(BRIDGE_PORT, 6009));

  await ta('http: pingBridge returns ok:false when no server', async () => {
    const r = await pingBridge();
    assert.equal(r.ok, false);
  });

  await ta('http: bridgeGet rejects on ECONNREFUSED', async () => {
    try { await bridgeGet('/info', 2000); assert.fail('should reject'); }
    catch(e) { assert.ok(e.message.includes('bridge not running')); }
  });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, path: req.url, echo: body || null }));
    });
  });
  await new Promise(r => server.listen(6009, '127.0.0.1', r));

  await ta('http: bridgeGet returns parsed JSON', async () => {
    const r = await bridgeGet('/info');
    assert.equal(r.method, 'GET');
  });

  await ta('http: bridgePost sends body', async () => {
    const r = await bridgePost('/eval', { expr: 'x' });
    assert.equal(JSON.parse(r.echo).expr, 'x');
  });

  await ta('http: pingBridge ok:true with server', async () => {
    assert.equal((await pingBridge()).ok, true);
  });

  server.close();

  const getTemplates = require(path.join(root, 'lib/templates'));

  t('templates: expected keys present', () => {
    const keys = Object.keys(getTemplates('p'));
    ['scripts/main.py', 'scripts/render.py', 'addons/blender_bridge/__init__.py',
     'Makefile', 'CLAUDE.md', '.gitignore'].forEach(k => assert.ok(keys.includes(k), k));
  });

  t('templates: all values non-empty strings', () => {
    for (const [k, v] of Object.entries(getTemplates('p'))) {
      assert.equal(typeof v, 'string'); assert.ok(v.length > 0);
    }
  });

  t('templates: project name interpolated', () => {
    assert.ok(getTemplates('proj')['scripts/main.py'].includes('proj'));
  });

  t('templates: no deprecated Blender API', () => {
    const main = getTemplates('t')['scripts/main.py'];
    assert.ok(!main.includes('bpy.context.active_object'));
    assert.ok(main.includes('view_layer.objects.active'));
    assert.ok(!main.includes('use_nodes = True'));
  });

  const { installSkills, SKILL_CONTENT } = require(path.join(root, 'lib/skills'));

  t('skills: SKILL_CONTENT has frontmatter', () => {
    assert.ok(SKILL_CONTENT.startsWith('---'));
    assert.ok(SKILL_CONTENT.includes('name: blender-dev'));
  });

  t('skills: installSkills creates files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkit-v-'));
    installSkills(tmp);
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'skills', 'blender-dev', 'SKILL.md')));
    fs.rmSync(tmp, { recursive: true });
  });

  const { loadLangPlugins } = require(path.join(root, 'lang/loader'));

  t('loader: discovers blender plugin', () => {
    const plugins = loadLangPlugins(root);
    const bp = plugins.find(p => p.id === 'blender');
    assert.ok(bp);
    assert.ok(bp.exec.match instanceof RegExp);
    assert.equal(typeof bp.exec.run, 'function');
  });

  t('loader: returns [] for missing dir', () => {
    assert.deepEqual(loadLangPlugins('/nonexistent'), []);
  });

  t('cli: --help lists all commands', () => {
    const help = execSync(`node ${path.join(root, 'bin/cli.js')} --help`, { encoding: 'utf8' });
    ['lint', 'format', 'run', 'render', 'eval', 'objects', 'geonodes', 'nodetree',
     'materials', 'collections', 'keyframe', 'fcurves', 'repl'].forEach(cmd =>
      assert.ok(help.includes(cmd), `missing: ${cmd}`));
  });

  t('cli: --version matches package.json', () => {
    const ver = execSync(`node ${path.join(root, 'bin/cli.js')} --version`, { encoding: 'utf8' }).trim();
    assert.equal(ver, require(path.join(root, 'package.json')).version);
  });

  const { BLENDER_BRIDGE_PY } = require(path.join(root, 'lib/bridge-addon'));

  t('bridge: Python compiles', () => {
    const tmp = path.join(os.tmpdir(), `bv_${Date.now()}.py`);
    fs.writeFileSync(tmp, BLENDER_BRIDGE_PY);
    execSync(`python3 -c "import py_compile; py_compile.compile('${tmp}', doraise=True)"`);
    fs.unlinkSync(tmp);
  });

  t('bridge: has required sections', () => {
    ['bl_info', 'class BridgeHandler', 'def register', 'def unregister',
     '_main_thread_call', 'SO_REUSEADDR'].forEach(s =>
      assert.ok(BLENDER_BRIDGE_PY.includes(s), `missing: ${s}`));
  });

  t('bridge: matches addon on disk', () => {
    const disk = fs.readFileSync(path.join(root, 'addons/blender_bridge/__init__.py'), 'utf8');
    assert.equal(BLENDER_BRIDGE_PY, disk);
  });

  t('scaffolder: creates project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bkit-sc-'));
    const dir = path.join(tmp, 'proj');
    execSync(`node ${path.join(root, 'bin/create.js')} "${dir}"`, { encoding: 'utf8' });
    ['scripts/main.py', 'CLAUDE.md', 'README.md', '.gitignore'].forEach(f =>
      assert.ok(fs.existsSync(path.join(dir, f)), `missing: ${f}`));
    fs.rmSync(tmp, { recursive: true });
  });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (errors.length) {
    errors.forEach(e => console.error(`  ✗ ${e}`));
    process.exit(1);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
