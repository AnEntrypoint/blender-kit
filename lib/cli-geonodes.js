'use strict';

const { bridgeGet, bridgePost } = require('./http-client');

function pj(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(msg) { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(1); }
async function run(fn) { try { await fn(); } catch (e) { fail(e.message); } }

function printGeoNodes(r) {
  if (!r.modifiers && !r.modifier_name) {
    console.log(`${r.object}: no geometry nodes modifier`); return;
  }
  if (r.modifiers) {
    if (r.modifiers.length === 0) { console.log(`${r.object}: no geometry nodes modifier`); return; }
    r.modifiers.forEach(mod => {
      console.log(`${r.object}  modifier=${mod.modifier_name}  node_group=${mod.node_group || '(none)'}`);
      (mod.inputs || []).forEach(i => {
        const range = i.min != null ? ` [${i.min}–${i.max}]` : '';
        const type = i.type.replace('NodeSocket', '');
        const live = i.value !== i.default ? ` (default: ${JSON.stringify(i.default)})` : '';
        console.log(`  ${i.name.padEnd(22)} ${type.padEnd(10)} = ${JSON.stringify(i.value)}${range}${live}`);
      });
    });
  } else {
    console.log(`${r.object}  modifier=${r.modifier_name}  node_group=${r.node_group || '(none)'}`);
    (r.inputs || []).forEach(i => {
      const range = i.min != null ? ` [${i.min}–${i.max}]` : '';
      const type = i.type.replace('NodeSocket', '');
      const live = i.value !== i.default ? ` (default: ${JSON.stringify(i.default)})` : '';
      console.log(`  ${i.name.padEnd(22)} ${type.padEnd(10)} = ${JSON.stringify(i.value)}${range}${live}`);
    });
  }
}

function registerGeometryCommands(program) {
  program.command('geonodes <object>').description('List geometry nodes modifier and inputs on object')
    .action((obj) => run(async () => printGeoNodes(await bridgeGet(`/geonodes/${obj}`))));

  program.command('geonodes-set <object> [assignments...]').description('Set geometry nodes input values (key=value ...)')
    .option('-m, --modifier <name>', 'target modifier by name')
    .action((obj, assignments, opts) => run(async () => {
      const inputs = {};
      for (const a of assignments) {
        const eq = a.indexOf('=');
        if (eq < 1) { fail(`invalid assignment: ${a}`); return; }
        const k = a.slice(0, eq);
        const raw = a.slice(eq + 1);
        let v; try { v = JSON.parse(raw); } catch { v = raw; }
        inputs[k] = v;
      }
      const path = opts.modifier ? `/geonodes/${obj}/set?modifier=${encodeURIComponent(opts.modifier)}` : `/geonodes/${obj}/set`;
      pj(await bridgePost(path, { inputs }));
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

  program.command('nodegroups').description('List all geometry node groups in scene')
    .action(() => run(async () => {
      const r = await bridgeGet('/nodegroups');
      (r.node_groups || []).forEach(ng => {
        console.log(`  ${ng.name.padEnd(30)} nodes=${ng.node_count}  users=${ng.users}`);
      });
    }));

  program.command('nodetree-add-node <tree> <type>').description('Add node to node tree')
    .option('-x, --x <x>', 'x location', '0')
    .option('-y, --y <y>', 'y location', '0')
    .action((tree, type, opts) => run(async () => pj(await bridgePost(`/nodetree/${tree}/add-node`, { type, location: [parseFloat(opts.x), parseFloat(opts.y)] }))));

  program.command('nodetree-link <tree> <from_node> <from_socket> <to_node> <to_socket>').description('Link two nodes in a node tree')
    .action((tree, fn, fs, tn, ts) => run(async () => {
      const fsi = isNaN(Number(fs)) ? fs : Number(fs);
      const tsi = isNaN(Number(ts)) ? ts : Number(ts);
      pj(await bridgePost(`/nodetree/${tree}/add-link`, { from_node: fn, from_socket: fsi, to_node: tn, to_socket: tsi }));
    }));

  program.command('nodetree-unlink <tree> <from_node> <from_socket> <to_node> <to_socket>').description('Remove a link between nodes')
    .action((tree, fn, fs, tn, ts) => run(async () => pj(await bridgePost(`/nodetree/${tree}/remove-link`, { from_node: fn, from_socket: fs, to_node: tn, to_socket: ts }))));

  program.command('nodetree-delete-node <tree> <node>').description('Delete a node from a node tree')
    .action((tree, node) => run(async () => pj(await bridgePost(`/nodetree/${tree}/delete-node`, { name: node }))));

  program.command('geonodes-apply <object>').description('Apply geometry nodes modifier')
    .option('-m, --modifier <name>', 'modifier name (defaults to first)')
    .action((obj, opts) => run(async () => {
      const path = opts.modifier ? `/geonodes/${obj}/apply?modifier=${encodeURIComponent(opts.modifier)}` : `/geonodes/${obj}/apply`;
      pj(await bridgePost(path, {}));
    }));
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
  '.nodegroups': async () => {
    try {
      const r = await bridgeGet('/nodegroups');
      (r.node_groups || []).forEach(ng => console.log(`  ${ng.name.padEnd(30)} nodes=${ng.node_count}  users=${ng.users}`));
    } catch (e) { console.error(e.message); }
  },
};

module.exports = { registerGeometryCommands, REPL_SHORTCUTS };
