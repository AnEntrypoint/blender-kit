'use strict';

const { bridgeGet, bridgePost } = require('./http-client');
const { registerGeometryCommands, REPL_SHORTCUTS: GN_SHORTCUTS } = require('./cli-geonodes');

function pj(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(msg) { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(1); }
async function run(fn) { try { await fn(); } catch (e) { fail(e.message); } }

function printObjects(objects) {
  if (!Array.isArray(objects)) { pj(objects); return; }
  objects.forEach(obj => {
    const loc = obj.location ? `(${obj.location.map(v => v.toFixed(2)).join(', ')})` : '';
    console.log(`  [${obj.type || 'OBJ'}] ${obj.name} ${loc}`);
  });
}

async function blenderRepl() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[32mblender> \x1b[0m' });
  const SPECIAL = {
    '.objects': async () => { try { const r = await bridgeGet('/objects'); printObjects(r.objects || r); } catch (e) { console.error(e.message); } },
    '.scene':   async () => { try { pj(await bridgeGet('/scene')); } catch (e) { console.error(e.message); } },
    '.info':    async () => { try { pj(await bridgeGet('/info')); } catch (e) { console.error(e.message); } },
    '.render-settings': async () => { try { pj(await bridgeGet('/render-settings')); } catch (e) { console.error(e.message); } },
    '.help': () => console.log('Commands: .objects .scene .info .render-settings .geonodes <obj> .nodetree <name> .mods <obj> .nodegroups .help  or any Python/bpy expression'),
  };
  rl.prompt();
  rl.on('line', async (line) => {
    const l = line.trim();
    if (!l) { rl.prompt(); return; }
    const [cmd, ...rest] = l.split(' ');
    if (SPECIAL[l]) { await SPECIAL[l](); rl.prompt(); return; }
    if (GN_SHORTCUTS[cmd]) { await GN_SHORTCUTS[cmd](rest.join(' ')); rl.prompt(); return; }
    try {
      const r = await bridgePost('/eval', { expr: l });
      console.log(r.error ? '\x1b[31m' + r.error + '\x1b[0m' : (r.result === '' ? '(null)' : r.result));
    } catch (e) { console.error('\x1b[31m' + e.message + '\x1b[0m'); }
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}

function registerRuntimeCommands(program) {
  // --- info ---
  program.command('info').description('Show Blender version, scene name, object count (bridge port 6009)')
    .action(() => run(async () => pj(await bridgeGet('/info'))));

  // --- scene ---
  program.command('scene').description('Dump active scene tree')
    .action(() => run(async () => pj(await bridgeGet('/scene'))));

  // --- objects ---
  program.command('objects').description('List all objects with name/type/location')
    .action(() => run(async () => {
      const r = await bridgeGet('/objects');
      printObjects(r.objects || r);
    }));

  // --- eval ---
  program.command('eval <expr>').description('Evaluate a Python/bpy expression in running Blender')
    .action((expr) => run(async () => {
      const r = await bridgePost('/eval', { expr });
      if (r.error) { console.error('\x1b[31m' + r.error + '\x1b[0m'); process.exit(1); }
      else console.log(r.result === '' ? '(null)' : r.result);
    }));

  // --- set ---
  program.command('set <path> <prop> <value>').description('Set object property via bridge')
    .action((objPath, prop, value) => run(async () => {
      let parsed = value;
      try { parsed = JSON.parse(value); } catch {}
      pj(await bridgePost('/set', { path: objPath, prop, value: parsed }));
    }));

  // --- select ---
  program.command('select <name>').description('Select object by name')
    .action((name) => run(async () => pj(await bridgePost('/select', { name }))));

  // --- call ---
  program.command('call <path> <method> [args]').description('Call a bpy method')
    .action((objPath, method, args) => run(async () => {
      let parsedArgs = [];
      if (args) { try { parsedArgs = JSON.parse(args); } catch { parsedArgs = [args]; } }
      pj(await bridgePost('/call', { path: objPath, method, args: parsedArgs }));
    }));

  // --- render-settings ---
  program.command('render-settings').description('Show current render engine, resolution, samples')
    .action(() => run(async () => pj(await bridgeGet('/render-settings'))));

  // --- reload ---
  program.command('reload').description('Re-load the current .blend file')
    .action(() => run(async () => pj(await bridgePost('/reload', {}))));

  // --- repl ---
  program.command('repl').description('Interactive Python REPL against running Blender (Ctrl+C exits)')
    .action(() => blenderRepl());

  registerGeometryCommands(program);
}

module.exports = { registerRuntimeCommands };
