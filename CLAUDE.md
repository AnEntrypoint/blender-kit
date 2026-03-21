# blender-kit

npm package: `blender-kit` (bin: blender-kit scaffolder) + `blender-dev` (bin: CLI).

## Structure
- `bin/create.js` — scaffold entrypoint (`bunx blender-kit <dir>`)
- `bin/cli.js` — `blender-dev` CLI (all commands)
- `lib/templates.js` — all boilerplate files written to new projects
- `lib/blender-bridge.js` — Python addon (HTTP server on port 6009) as JS string
- `lib/engine.js` — Blender download/locate (~/.blender-kit/config.json)
- `lib/cli-core.js` — core commands (lint, format, setup, run, render, watch, config)
- `lib/cli-runtime.js` — runtime HTTP API commands (port 6009)
- `lib/http-client.js` — HTTP helpers for port 6009
- `lib/skills.js` — writes SKILL.md + IDE configs to scaffolded projects
- `lang/loader.js` — loadLangPlugins() for hook discovery
- `lang/blender.js` — exec:blender lang plugin

## Ports
| Port | What | Source |
|------|------|--------|
| 6009 | Blender HTTP bridge | addons/blender_bridge/__init__.py |

## Editing Python addon template
`lib/blender-bridge.js` is a JS string containing Python. Backticks must be escaped.

## Publish
Push to master. CI bumps version, publishes to npm. Requires `NPM_TOKEN` secret.

## Language Plugins (lang/)
- `lang/SPEC.md` — plugin interface specification
- `lang/loader.js` — `loadLangPlugins(projectDir)` used by hooks
- `lang/blender.js` — Blender plugin: `exec:blender` routes to HTTP bridge (port 6009) or headless Blender

Plugin shape: `{ id, exec: { match, run }, lsp?, context?, extensions? }`
