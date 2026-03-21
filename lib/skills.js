'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_CONTENT = `---
name: blender-dev
description: Blender 4.x agentic development CLI - scene control, Python REPL, HTTP bridge, headless rendering
triggers: [blender, bpy, blend, .py, .blend, 3d, render, blender-dev, blender-kit, geonodes, nodetree, nodegroup]
tools: [Bash, Read, Write, Edit]
---

# blender-dev — Blender CLI

## Scaffold a new project
\`\`\`bash
bunx blender-kit <project-dir>     # scaffold boilerplate, installs CLAUDE.md + all configs
blender-dev setup                  # install flake8 + black (needs Python)
blender-dev config set blenderPath /path/to/blender  # set custom blender path
blender-dev config get             # show current config
\`\`\`

## Port
| Service | Port | When active |
|---------|------|-------------|
| Blender HTTP Bridge | 6009 | Blender open + blender_bridge addon enabled |

## Core commands
\`\`\`bash
blender-dev run [script.py]        # run script headlessly in Blender
blender-dev render [script.py]     # run render.py headlessly
blender-dev lint [files...]        # flake8 lint
blender-dev format [files...]      # black format
blender-dev watch                  # watch .py files, reload bridge on change
\`\`\`

## Runtime commands (port 6009 — Blender must be open + bridge addon enabled)
\`\`\`bash
blender-dev info                   # version, scene name, object count
blender-dev scene                  # dump scene tree as JSON
blender-dev objects                # list all objects with name/type/location
blender-dev eval "<expr>"          # evaluate Python/bpy expression in running Blender
blender-dev set <path> <prop> <v>  # set object property
blender-dev select <name>          # select object by name
blender-dev call <path> <method>   # call bpy method
blender-dev render-settings        # show render engine, resolution, samples
blender-dev reload                 # re-load current .blend file
blender-dev repl                   # interactive Python REPL (Ctrl+C exits)
\`\`\`

## Geometry nodes commands
\`\`\`bash
blender-dev geonodes <object>                          # list all GN modifiers + live input values
blender-dev geonodes-set <object> key=val [key=val...] # set inputs (batch), --modifier flag
blender-dev geonodes-create <object>                   # add GN modifier, -n name, -g group
blender-dev geonodes-apply <object>                    # apply GN modifier, -m name
blender-dev nodegroups                                 # list all node groups in scene
blender-dev nodetree <name>                            # dump node tree (nodes, links, sockets)
blender-dev nodetree-add-node <tree> <type>            # add node, -x/-y for location
blender-dev nodetree-link <tree> <fn> <fs> <tn> <ts>  # link nodes (socket by name or index)
blender-dev nodetree-unlink <tree> <fn> <fs> <tn> <ts> # remove link
blender-dev nodetree-delete-node <tree> <node>         # delete node
\`\`\`

## Bridge HTTP API (port 6009)
| Method | Path | Description |
|--------|------|-------------|
| GET | /info | blender version, scene name, object count |
| GET | /objects | all objects with name/type/location |
| GET | /scene | scene tree |
| GET | /render-settings | engine, resolution, samples |
| GET | /geonodes/<obj> | all GN modifiers + live input values |
| GET | /geonodes/<obj>?modifier=X | single named modifier |
| GET | /nodegroups | list all node groups |
| GET | /nodetree/<name> | full node tree dump (nodes+links+sockets) |
| POST | /eval | evaluate Python expr, returns result |
| POST | /select | select object by name |
| POST | /set | set object property |
| POST | /call | call bpy method |
| POST | /reload | reload current .blend file |
| POST | /geonodes/<obj>/set | set input values by name |
| POST | /geonodes/<obj>/apply | apply modifier |
| POST | /geonodes/create | add GN modifier to object |
| POST | /nodetree/<name>/add-node | add node |
| POST | /nodetree/<name>/delete-node | delete node |
| POST | /nodetree/<name>/add-link | link two node sockets |
| POST | /nodetree/<name>/remove-link | remove a link |

## exec:blender
\`\`\`
exec:blender
bpy.context.scene.name
\`\`\`
Single expressions: try HTTP bridge (port 6009), fallback to headless.
Multi-line: run headlessly via blender --background --python.

## REPL shortcuts
\`\`\`
.geonodes <obj>    # show GN modifier inputs with live values
.nodetree <name>   # dump node tree
.mods <obj>        # list all modifiers
.nodegroups        # list all node groups
\`\`\`

## Enabling blender_bridge addon
1. In Blender: Edit > Preferences > Add-ons
2. Click "Install..." and select \`addons/blender_bridge/__init__.py\`
3. Enable "Development: Blender Bridge (blender-kit)"
4. The HTTP server starts automatically on port 6009
`;

const CURSOR_CONTENT = `---
description: Blender 4.x agentic development with blender-dev CLI
globs: ["**/*.py", "**/*.blend"]
alwaysApply: false
---

# blender-dev CLI

Use \`blender-dev\` for all Blender interactions. Bridge runs on :6009.

Key commands:
- \`blender-dev run script.py\` - run script headlessly
- \`blender-dev eval "<expr>"\` - evaluate bpy expression at runtime
- \`blender-dev objects\` - list all scene objects
- \`blender-dev scene\` - dump scene tree
- \`blender-dev render\` - headless render
- \`blender-dev watch\` - auto-reload on file change
- \`blender-dev lint\` / \`blender-dev format\` - code quality
`;

const WINDSURF_CONTENT = `# blender-dev CLI

blender-dev is the CLI for Blender 4.x agentic development. Always use it instead of running Blender directly.

- Blender HTTP Bridge: port 6009 (requires blender_bridge addon enabled in Blender)

Run \`blender-dev --help\` for full command list.
`;

const AIDER_CONTENT = `# aider config
# blender-dev CLI available for Blender scene/runtime control
read: [".cursor/rules/blender-dev.mdc"]
`;

function tryWrite(filePath, content, label) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  [skills] Installed ${label} -> ${filePath}`);
    return true;
  } catch (e) {
    console.warn(`  [skills] Could not write ${label}: ${e.message}`);
    return false;
  }
}

function installSkills(projectDir) {
  tryWrite(path.join(projectDir, '.claude', 'skills', 'blender-dev', 'SKILL.md'), SKILL_CONTENT, 'Claude Code skill');
  tryWrite(path.join(projectDir, '.cursor', 'rules', 'blender-dev.mdc'), CURSOR_CONTENT, 'Cursor rule');
  tryWrite(path.join(projectDir, '.windsurf', 'rules', 'blender-dev.md'), WINDSURF_CONTENT, 'Windsurf rule');

  const aiderCfg = path.join(projectDir, '.aider.conf.yml');
  if (!fs.existsSync(aiderCfg)) {
    tryWrite(aiderCfg, AIDER_CONTENT, 'Aider config');
  }
}

module.exports = { installSkills, SKILL_CONTENT };
