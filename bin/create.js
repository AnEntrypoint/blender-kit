#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const getTemplates = require('../lib/templates');
const { findBlender, BLENDER_VERSION } = require('../lib/engine');
const { installSkills } = require('../lib/skills');

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : (process.env.INIT_CWD || process.cwd());
const projectName = path.basename(targetDir);

console.log(`\n  blender-kit - Agentic Blender 4.x Boilerplate\n`);
console.log(`  Project: ${projectName}`);
console.log(`  Target:  ${targetDir}\n`);

fs.mkdirSync(targetDir, { recursive: true });

const templates = getTemplates(projectName);
for (const [relPath, content] of Object.entries(templates)) {
  const full = path.join(targetDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`  + ${relPath}`);
}

const readme = `# ${projectName}

Blender 4.3 project. Uses [blender-kit](https://github.com/AnEntrypoint/blender-kit) for CLI-driven development.

## First-time setup
\`\`\`bash
blender-dev download-engine   # shows Blender ${BLENDER_VERSION} download info
blender-dev setup             # install flake8 + black (needs Python)
blender-dev config set blenderPath "C:/Program Files/Blender Foundation/Blender 4.3/blender.exe"
\`\`\`

## Note
Binary .blend files cannot be templated. Create \`my_project.blend\` manually in Blender,
or run \`scripts/main.py\` headlessly to build a scene programmatically.

## Boilerplate
- **scripts/main.py** — example scene: cube, camera, light, material, custom properties
- **scripts/render.py** — headless render to output/render.png
- **addons/blender_bridge/__init__.py** — HTTP API on port 6009 (runtime control)

## Daily commands
\`\`\`bash
blender-dev run              # run scripts/main.py headlessly
blender-dev render           # render to output/render.png
blender-dev objects          # list scene objects (bridge must be active)
blender-dev eval "expr"      # run Python in running Blender
blender-dev lint && blender-dev format
blender-dev repl             # interactive Python REPL
\`\`\`

See CLAUDE.md for full CLI reference and workflow notes.
`;

fs.writeFileSync(path.join(targetDir, 'README.md'), readme, 'utf8');
console.log(`  + README.md`);

try { installSkills(targetDir); } catch (e) { console.warn('  Skills install warning:', e.message); }

const blenderPath = findBlender(null);
if (!blenderPath) {
  console.log(`
  Blender not found. Get it with:

    blender-dev download-engine
`);
} else {
  console.log(`\n  Blender found at: ${blenderPath}`);
}

console.log(`
  Next:
    blender-dev download-engine
    blender-dev setup
    blender-dev run
`);
