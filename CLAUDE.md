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

## Blender 5.0 Migration — Known API Changes

**Active object**
- ❌ `bpy.context.active_object` — removed in Blender 5
- ✅ `bpy.context.view_layer.objects.active`

**Sky shader**
- ❌ `ShaderNodeTexSky.sky_type = 'NISHITA'` — removed in Blender 5
- ✅ `sky_type = 'HOSEK_WILKIE'` (also: `PREETHAM`, `SINGLE_SCATTERING`, `MULTIPLE_SCATTERING`)
- HOSEK_WILKIE uses `sun_direction` vector, `turbidity`, `ground_albedo`

**Animation / fcurves**
- ❌ `action.fcurves` — legacy API, may not exist on new actions
- ✅ Check `action.is_action_legacy` first; if False use layered API:
  `action.layers[0].strips[0].channelbag(slot).fcurves`

**Thread safety — HTTP bridge**
- Blender's API is NOT thread-safe. All `bpy.ops.*` and `bpy.context.*` writes from the HTTP handler thread crash Blender.
- ✅ Use `_main_thread_call(fn)` — queues fn, runs it via `bpy.app.timers` tick at 50ms, blocks HTTP thread on result queue.
- `bpy.data.*` reads (objects, materials, etc.) are safe from any thread.
- `bpy.ops.*` always needs main thread.

**Material nodes**
- ❌ `material.use_nodes = True` — deprecated (DeprecationWarning in Blender 5, removed in 6)
- ✅ Materials now have `use_nodes=True` by default; just access `material.node_tree.nodes` directly.

**Server / port**
- Always set `SO_REUSEADDR` before `serve_forever()` — prevents port 6009 staying bound after crash.
- Never call `server.shutdown()` from main thread — deadlocks. Run it in a daemon thread.

**Mesh creation performance**
- `bpy.ops.mesh.primitive_*` is slow headlessly (one Blender context switch per call).
- ✅ Use `bmesh` + `bpy.data.objects.new()` directly — 10–50× faster for bulk scene builds:
  ```python
  bm = bmesh.new()
  bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
  me = bpy.data.meshes.new(name)
  bm.to_mesh(me); bm.free()
  obj = bpy.data.objects.new(name, me)
  bpy.context.scene.collection.objects.link(obj)
  ```

## Geometry Nodes — Preferred Approach

Lean into Geometry Nodes for anything involving **instancing, scattering, procedural shapes, or parametric variation**. It is almost always better than duplicating mesh objects.

**When to use GN instead of duplicated objects:**
- Scattering trees/rocks/grass over a surface → `Distribute Points on Faces` + `Instance on Points`
- Repeating shapes (petals, blades of grass, fence posts) → GN modifier on one base mesh
- Anything driven by a parameter that should be tweakable → GN input socket
- Terrain deformation, wind animation, growth → GN + drivers or timeline

**Core pattern — scatter instances:**
```python
import bpy
# Create GN modifier on a plane
obj = bpy.data.objects["Ground"]
mod = obj.modifiers.new("Scatter", 'NODES')
ng = bpy.data.node_groups.new("Scatter", "GeometryNodeTree")
mod.node_group = ng
# Then wire nodes via blender-dev nodetree-add-node / nodetree-link commands
```

**blender-dev commands for GN:**
- `blender-dev geonodes <object>` — list all GN modifiers + inputs
- `blender-dev geonodes-set <object> key=value` — set input values live
- `blender-dev geonodes-create <object>` — add GN modifier
- `blender-dev nodetree <name>` — dump full node graph as JSON
- `blender-dev nodetree-add-node <tree> <type>` — add node
- `blender-dev nodetree-link <tree> from_node from_socket to_node to_socket` — wire nodes
- `blender-dev geonodes-apply <object>` — apply modifier to mesh

**exec:blender for GN scripting:**
```python
# Set up a scatter system entirely via exec:blender
import bpy
obj = bpy.data.objects["Ground"]
mod = obj.modifiers.new("TreeScatter", 'NODES')
ng = bpy.data.node_groups.new("TreeScatter", "GeometryNodeTree")
mod.node_group = ng
# Add nodes
ng.interface.new_socket("Density", in_out='INPUT', socket_type='NodeSocketFloat')
```

**exec:blender timeout note:**
- Bridge calls timeout at ~15s. For long-running scripts (many objects, renders), use headless:
  `blender-dev run scripts/myscript.py`
  or write the script to disk and run via `exec:bash` with the blender binary directly.
