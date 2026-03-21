'use strict';

const { bridgeGet, bridgePost } = require('./http-client');

function pj(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(msg) { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(1); }
async function run(fn) { try { await fn(); } catch (e) { fail(e.message); } }

function printGeoNodes(r) {
  if (!r.modifiers || r.modifiers.length === 0) {
    console.log(`${r.object}: no geometry nodes modifier`); return;
  }
  console.log(`${r.object}  modifier=${r.modifier_name}  node_group=${r.node_group || '(none)'}`);
  (r.inputs || []).forEach(i => {
    const range = i.min != null ? ` [${i.min}–${i.max}]` : '';
    const type = i.type.replace('NodeSocket', '');
    console.log(`  ${i.name.padEnd(22)} ${type.padEnd(10)} = ${JSON.stringify(i.value)}${range}`);
  });
}

function registerGeometryCommands(program) {
  program.command('geonodes <object>').description('List geometry nodes modifier and inputs on object')
    .action((obj) => run(async () => printGeoNodes(await bridgeGet(`/geonodes/${obj}`))));

  program.command('geonodes-set <object> <input> <value>').description('Set a geometry nodes input value')
    .action((obj, input, value) => run(async () => {
      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      pj(await bridgePost(`/geonodes/${obj}/set`, { inputs: { [input]: parsed } }));
    }));

  program.command('geonodes-create <object>').description('Add a geometry nodes modifier to object')
    .option('-n, --name <name>', 'modifier name', 'GeometryNodes')
    .option('-g, --group <group>', 'existing node group name')
    .action((obj, opts) => run(async () => {
      const body = { object: obj, modifier_name: opts.name };
      if (opts.group) body.node_group = opts.group;
      pj(await bridgePost('/geonodes/create', body));
    }));

  program.command('nodetree <name>').description('Dump full node tree (nodes + links) as JSON')
    .action((name) => run(async () => pj(await bridgeGet(`/nodetree/${name}`))));
}

const REPL_SHORTCUTS = {
  '.geonodes': async (args) => {
    if (!args) { console.log('usage: .geonodes <object>'); return; }
    try { printGeoNodes(await bridgeGet(`/geonodes/${args}`)); } catch (e) { console.error(e.message); }
  },
  '.nodetree': async (args) => {
    if (!args) { console.log('usage: .nodetree <node_group_name>'); return; }
    try { pj(await bridgeGet(`/nodetree/${args}`)); } catch (e) { console.error(e.message); }
  },
  '.mods': async (args) => {
    if (!args) { console.log('usage: .mods <object>'); return; }
    try {
      const r = await bridgePost('/eval', { expr: `[(m.name, m.type) for m in bpy.data.objects["${args}"].modifiers]` });
      console.log(r.error ? r.error : r.result);
    } catch (e) { console.error(e.message); }
  },
};

module.exports = { registerGeometryCommands, REPL_SHORTCUTS };
