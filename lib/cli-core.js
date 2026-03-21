'use strict';

const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

function isToolNotFound(e) {
  return e.code === 'ENOENT' || (e.stderr && (e.stderr.includes('not found') || e.stderr.includes('not recognized')));
}

function blenderNotFoundError(CFG_DIR) {
  console.error('\x1b[31mBlender executable not found.\x1b[0m');
  const { BLENDER_VERSIONS } = require('./engine');
  console.error(`Checked: config file, common install paths, system PATH (blender, ${BLENDER_VERSIONS.map(v => 'blender' + v).join(', ')})`);
  console.error('Download info:  blender-dev download-engine');
  console.error('Or set a custom path:  blender-dev config set blenderPath /path/to/blender');
  process.exit(1);
}

function registerCoreCommands(program) {
  const { findBlender, findAllBlenders, downloadEngine, CFG_DIR, readConfig, writeConfig } = require('./engine');

  // --- lint ---
  program.command('lint [files...]').description('Lint Python files using flake8')
    .action((files) => {
      const targets = files.length ? files : ['.'];
      try {
        const r = execSync(['flake8', ...targets].join(' '), { stdio: 'pipe', encoding: 'utf8' });
        if (r) console.log(r);
        console.log('\x1b[32mLint passed.\x1b[0m');
      } catch (e) {
        if (isToolNotFound(e)) { console.log('flake8 not found. Run: blender-dev setup'); return; }
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        process.exit(e.status || 1);
      }
    });

  // --- format ---
  program.command('format [files...]').description('Format Python files using black')
    .action((files) => {
      const targets = files.length ? files : ['.'];
      try {
        const r = execSync(['black', ...targets].join(' '), { stdio: 'pipe', encoding: 'utf8' });
        if (r) console.log(r);
        console.log('\x1b[32mFormat complete.\x1b[0m');
      } catch (e) {
        if (isToolNotFound(e)) { console.log('black not found. Run: blender-dev setup'); return; }
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        process.exit(e.status || 1);
      }
    });

  // --- setup ---
  program.command('setup').description('Install Python tools: flake8, black')
    .action(() => {
      console.log('Installing flake8 and black...');
      try {
        execSync('pip install flake8 black', { stdio: 'inherit' });
        console.log('\x1b[32mSetup complete.\x1b[0m');
      } catch (e) {
        console.error('pip install failed. Ensure Python + pip are installed.');
        process.exit(1);
      }
    });

  // --- download-engine ---
  program.command('download-engine').description('Show Blender download instructions')
    .action(async () => { await downloadEngine(); });

  // --- run ---
  program.command('run [script]').description('Run a Python script headlessly in Blender')
    .action((script) => {
      const blender = findBlender(null);
      if (!blender) return blenderNotFoundError(CFG_DIR);
      const target = script || 'scripts/main.py';
      if (!fs.existsSync(target)) {
        console.error(`Script not found: ${target}`);
        process.exit(1);
      }
      console.log(`Running: ${blender} --background --python ${target}`);
      const r = spawnSync(blender, ['--background', '--python', target], { stdio: 'inherit' });
      process.exit(r.status || 0);
    });

  // --- render ---
  program.command('render [script]').description('Run render script headlessly in Blender')
    .action((script) => {
      const blender = findBlender(null);
      if (!blender) return blenderNotFoundError(CFG_DIR);
      const target = script || 'scripts/render.py';
      if (!fs.existsSync(target)) {
        console.error(`Render script not found: ${target}`);
        process.exit(1);
      }
      console.log(`Rendering: ${blender} --background --python ${target}`);
      const r = spawnSync(blender, ['--background', '--python', target], { stdio: 'inherit' });
      process.exit(r.status || 0);
    });

  // --- watch ---
  program.command('watch').description('Watch .py files and notify bridge to reload on change')
    .action(() => {
      const chokidar = require('chokidar');
      const { bridgePost } = require('./http-client');
      console.log('Watching .py files for changes... (Ctrl+C to exit)');
      const watcher = chokidar.watch('**/*.py', { ignored: /node_modules|__pycache__/, persistent: true });
      watcher.on('change', async (filePath) => {
        console.log(`[watch] Changed: ${filePath}`);
        try {
          await bridgePost('/reload', { file: filePath });
          console.log('[watch] Bridge reloaded.');
        } catch (e) {
          console.warn('[watch] Bridge not running (Blender may not be open):', e.message);
        }
      });
    });

  // --- config ---
  const cfg = program.command('config').description('Manage blender-kit configuration');

  cfg.command('get').description('Show current configuration')
    .action(() => {
      const c = readConfig();
      console.log(JSON.stringify(c, null, 2));
    });

  cfg.command('set <key> <value>').description('Set a config value')
    .action((key, value) => {
      const c = readConfig();
      c[key] = value;
      writeConfig(c);
      console.log(`Set ${key} = ${value}`);
    });

  cfg.command('path').description('Print config file path')
    .action(() => {
      const { CFG_PATH } = require('./engine');
      console.log(CFG_PATH);
    });

  // --- use ---
  program.command('use [path-or-version]').description('Pick which installed Blender to use')
    .action(async (arg) => {
      const all = findAllBlenders();
      if (!all.length) {
        console.error('\x1b[31mNo Blender installations found.\x1b[0m');
        console.error('Run: blender-dev download-engine');
        process.exit(1);
      }

      // Direct match by path or version prefix
      if (arg) {
        const match = all.find(b => b.path === arg || b.version === arg || b.version.startsWith(arg));
        if (match) {
          const c = readConfig(); c.blenderPath = match.path; writeConfig(c);
          console.log(`\x1b[32mActive: Blender ${match.version} — ${match.path}\x1b[0m`);
          return;
        }
        // Treat arg as explicit path
        if (require('fs').existsSync(arg)) {
          const c = readConfig(); c.blenderPath = arg; writeConfig(c);
          console.log(`\x1b[32mActive: ${arg}\x1b[0m`);
          return;
        }
        console.error(`No match for "${arg}". Run without arguments to list options.`);
        process.exit(1);
      }

      // Interactive pick
      const cfg = readConfig();
      console.log('\nInstalled Blender versions:\n');
      all.forEach((b, i) => {
        const active = cfg.blenderPath === b.path ? ' \x1b[32m← active\x1b[0m' : '';
        console.log(`  [${i + 1}] Blender ${b.version}${active}`);
        console.log(`      ${b.path}`);
      });
      console.log();

      const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      readline.question(`Select [1-${all.length}]: `, (ans) => {
        readline.close();
        const idx = parseInt(ans.trim()) - 1;
        if (isNaN(idx) || idx < 0 || idx >= all.length) {
          console.error('Invalid selection.'); process.exit(1);
        }
        const chosen = all[idx];
        const c = readConfig(); c.blenderPath = chosen.path; writeConfig(c);
        console.log(`\x1b[32mActive: Blender ${chosen.version} — ${chosen.path}\x1b[0m`);
      });
    });
}

module.exports = { registerCoreCommands };
