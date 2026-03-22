'use strict';
const { bridgeGet, bridgePost } = require('./http-client');

function pj(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(msg) { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(1); }
async function run(fn) { try { await fn(); } catch (e) { fail(e.message); } }

function registerObjectCommands(program) {
  program.command('object <name>').description('Show full object detail')
    .action((name) => run(async () => pj(await bridgeGet(`/object/${name}`))));

  program.command('object-create <type> <name>').description('Create a new object (type: MESH, LIGHT, CAMERA, EMPTY)')
    .action((type, name) => run(async () => pj(await bridgePost('/object/create', { type, name }))));

  program.command('object-delete <name>').description('Delete an object from the scene')
    .action((name) => run(async () => pj(await bridgePost(`/object/${name}/delete`, {}))));

  program.command('object-hide <name>').description('Set object visibility')
    .option('--viewport <bool>', 'hide in viewport (true/false)')
    .option('--render <bool>', 'hide in render (true/false)')
    .action((name, opts) => run(async () => {
      const body = {};
      if (opts.viewport !== undefined) body.viewport = opts.viewport === 'true';
      if (opts.render !== undefined) body.render = opts.render === 'true';
      pj(await bridgePost(`/object/${name}/hide`, body));
    }));

  program.command('object-transform <name>').description('Set object location/rotation/scale')
    .option('-l, --location <x,y,z>', 'location as x,y,z')
    .option('-r, --rotation <x,y,z>', 'rotation euler as x,y,z (radians)')
    .option('-s, --scale <x,y,z>', 'scale as x,y,z')
    .action((name, opts) => run(async () => {
      const body = {};
      const parse3 = s => s.split(',').map(Number);
      if (opts.location) body.location = parse3(opts.location);
      if (opts.rotation) body.rotation = parse3(opts.rotation);
      if (opts.scale) body.scale = parse3(opts.scale);
      pj(await bridgePost(`/object/${name}/transform`, body));
    }));

  program.command('materials').description('List all materials in scene')
    .action(() => run(async () => {
      const r = await bridgeGet('/materials');
      (r.materials || []).forEach(m => console.log(`  ${m.name.padEnd(30)} users=${m.users}  nodes=${m.use_nodes}`));
    }));

  program.command('material <name>').description('Show material detail')
    .action((name) => run(async () => pj(await bridgeGet(`/material/${name}`))));

  program.command('material-create <name>').description('Create a new material')
    .option('--no-nodes', 'disable node-based material')
    .action((name, opts) => run(async () => pj(await bridgePost('/material/create', { name, use_nodes: opts.nodes !== false }))));

  program.command('assign-material <object> <material>').description('Assign material to object slot 0')
    .action((object, material) => run(async () => pj(await bridgePost(`/object/${object}/assign-material`, { material }))));

  program.command('collections').description('List all collections')
    .action(() => run(async () => {
      const r = await bridgeGet('/collections');
      (r.collections || []).forEach(c => console.log(`  ${c.name.padEnd(30)} objects=${c.object_count}  children=${(c.children||[]).length}`));
    }));

  program.command('collection-create <name>').description('Create a new collection')
    .action((name) => run(async () => pj(await bridgePost('/collection/create', { name }))));

  program.command('collection-link <collection> <object>').description('Link object to collection')
    .action((collection, object) => run(async () => pj(await bridgePost(`/collection/${collection}/link`, { object }))));

  program.command('collection-unlink <collection> <object>').description('Unlink object from collection')
    .action((collection, object) => run(async () => pj(await bridgePost(`/collection/${collection}/unlink`, { object }))));

  program.command('keyframe <object> <prop> [frame]').description('Insert keyframe on object property')
    .action((object, prop, frame) => run(async () => {
      const body = { prop };
      if (frame !== undefined) body.frame = parseInt(frame);
      pj(await bridgePost(`/object/${object}/keyframe`, body));
    }));

  program.command('fcurves <object>').description('List animation fcurves on object')
    .action((object) => run(async () => {
      const r = await bridgeGet(`/object/${object}/fcurves`);
      (r.fcurves || []).forEach(fc => console.log(`  ${fc.data_path}[${fc.array_index}]  ${fc.keyframes.length} keyframes`));
    }));

  program.command('render-now').description('Trigger render in running Blender')
    .option('-f, --frame <n>', 'frame number')
    .option('-o, --output <path>', 'output path')
    .option('-a, --animation', 'render animation instead of still')
    .action((opts) => run(async () => {
      const body = { animation: !!opts.animation };
      if (opts.frame) body.frame = parseInt(opts.frame);
      if (opts.output) body.output_path = opts.output;
      pj(await bridgePost('/render', body));
    }));

  program.command('render-status').description('Check if Blender is currently rendering')
    .action(() => run(async () => pj(await bridgeGet('/render/status'))));

  program.command('frame').description('Show current frame info')
    .action(() => run(async () => {
      const r = await bridgeGet('/frame');
      console.log(`Frame: ${r.current}  Range: ${r.start}–${r.end}  FPS: ${r.fps}`);
    }));

  program.command('frame-set <n>').description('Set current frame')
    .action((n) => run(async () => pj(await bridgePost('/frame', { current: parseInt(n) }))));

  program.command('frame-range <start> <end>').description('Set frame range')
    .action((start, end) => run(async () => pj(await bridgePost('/frame', { start: parseInt(start), end: parseInt(end) }))));

  program.command('render-settings-set [assignments...]').description('Set render settings (key=value ...)')
    .action((assignments) => run(async () => {
      const body = {};
      for (const a of (assignments || [])) {
        const eq = a.indexOf('=');
        if (eq < 1) { fail(`invalid: ${a}`); return; }
        const k = a.slice(0, eq);
        const raw = a.slice(eq + 1);
        let v; try { v = JSON.parse(raw); } catch { v = raw; }
        body[k] = v;
      }
      pj(await bridgePost('/render-settings', body));
    }));

  program.command('object-rename <name> <new-name>').description('Rename an object')
    .action((name, newName) => run(async () => pj(await bridgePost(`/object/${name}/rename`, { new_name: newName }))));

  program.command('object-duplicate <name>').description('Duplicate an object')
    .option('-l, --linked', 'linked duplicate')
    .action((name, opts) => run(async () => pj(await bridgePost(`/object/${name}/duplicate`, { linked: !!opts.linked }))));

  program.command('scenes').description('List all scenes')
    .action(() => run(async () => {
      const r = await bridgeGet('/scenes');
      (r.scenes || []).forEach(s => console.log(`  ${s.name.padEnd(30)} objects=${s.object_count}  frame=${s.frame_current}`));
    }));

  program.command('scene-set <name>').description('Switch active scene')
    .action((name) => run(async () => pj(await bridgePost('/scene/set', { name }))));
}

module.exports = { registerObjectCommands };
