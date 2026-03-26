'use strict';

const { BLENDER_BRIDGE_PY } = require('./blender-bridge');
const { BLENDER_VERSIONS } = require('./engine');

function getTemplates(projectName) {
  return {
    'scripts/main.py': `"""
${projectName} - main.py
Example bpy script: creates a simple scene with cube, camera, light.
Run headlessly: blender-dev run scripts/main.py
"""
import bpy

# Clear existing scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Add a cube
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
cube = bpy.context.view_layer.objects.active
cube.name = "MyCube"
cube.scale = (1.5, 1.5, 1.5)

# Add a custom property
cube["project"] = "${projectName}"
cube["version"] = "1.0.0"

# Add a camera
bpy.ops.object.camera_add(location=(7, -7, 5))
camera = bpy.context.view_layer.objects.active
camera.name = "MainCamera"
camera.rotation_euler = (1.1, 0, 0.785)
bpy.context.scene.camera = camera

# Add a sun light
bpy.ops.object.light_add(type='SUN', location=(5, 5, 10))
light = bpy.context.view_layer.objects.active
light.name = "Sun"
light.data.energy = 3.0

# Add a material to the cube
mat = bpy.data.materials.new(name="CubeMaterial")
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.2, 0.5, 0.8, 1.0)
bsdf.inputs["Roughness"].default_value = 0.3
cube.data.materials.append(mat)

print(f"Scene created: {len(bpy.data.objects)} objects")
for obj in bpy.data.objects:
    print(f"  - {obj.name} ({obj.type}) at {tuple(round(v, 2) for v in obj.location)}")
`,

    'scripts/render.py': `"""
${projectName} - render.py
Headless render script: sets up scene and renders to output/render.png.
Run: blender-dev render
"""
import bpy
import os

# Set render engine
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'

# Resolution
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100

# Output settings
output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output")
os.makedirs(output_dir, exist_ok=True)
scene.render.filepath = os.path.join(output_dir, "render.png")
scene.render.image_settings.file_format = 'PNG'

# Samples (EEVEE)
scene.eevee.taa_render_samples = 64

print(f"Rendering to: {scene.render.filepath}")
bpy.ops.render.render(write_still=True)
print("Render complete.")
`,

    'addons/blender_bridge/__init__.py': BLENDER_BRIDGE_PY,

    'Makefile': `# ${projectName} Makefile
# Requires blender-dev CLI (npm i -g blender-kit)

.PHONY: run render eval lint format setup

run:
\tblender-dev run scripts/main.py

render:
\tblender-dev render scripts/render.py

eval:
\tblender-dev eval "bpy.context.scene.name"

lint:
\tblender-dev lint scripts/

format:
\tblender-dev format scripts/

setup:
\tblender-dev setup
`,

    '.vscode/settings.json': JSON.stringify({
      "python.pythonPath": `C:/Program Files/Blender Foundation/Blender ${BLENDER_VERSIONS[0]}/${BLENDER_VERSIONS[0]}/python/bin/python.exe`,
      "python.analysis.extraPaths": [
        `C:/Program Files/Blender Foundation/Blender ${BLENDER_VERSIONS[0]}/${BLENDER_VERSIONS[0]}/python/lib/site-packages`
      ],
      "python.linting.enabled": true,
      "python.linting.flake8Enabled": true,
      "python.formatting.provider": "black",
      "editor.formatOnSave": true,
      "files.exclude": {
        "**/__pycache__": true,
        "**/*.pyc": true,
        "**/*.blend1": true
      }
    }, null, 2),

    '.vscode/extensions.json': JSON.stringify({
      "recommendations": [
        "ms-python.python",
        "ms-python.black-formatter",
        "JacquesLucke.blender-development"
      ]
    }, null, 2),

    'CLAUDE.md': `# ${projectName}

Blender project scaffolded with [blender-kit](https://github.com/AnEntrypoint/blender-kit).

## Setup
\`\`\`bash
blender-dev install-addon     # write addon to ./addons/blender_bridge/__init__.py
blender-dev config set blenderPath "/path/to/blender"
blender-dev setup             # install flake8 + black
\`\`\`

## Enable bridge addon
1. Blender > Edit > Preferences > Add-ons > Install
2. Select: \`addons/blender_bridge/__init__.py\`
3. Enable "Blender Bridge" — starts HTTP server on port 6009

## Daily commands
\`\`\`bash
make run                      # run scripts/main.py headlessly
make render                   # render to output/render.png
blender-dev repl              # interactive Python REPL
blender-dev objects           # list scene objects
blender-dev eval "bpy.context.scene.name"
blender-dev watch             # auto-reload on .py change
\`\`\`

## Geometry nodes
\`\`\`bash
blender-dev geonodes <obj>              # list GN modifiers + live input values
blender-dev geonodes-set <obj> k=v      # set inputs (batch ok, --modifier flag)
blender-dev geonodes-apply <obj>        # apply modifier
blender-dev nodegroups                  # list all node groups
blender-dev nodetree <name>             # dump node tree (nodes, links, sockets)
blender-dev nodetree-add-node <t> <type> # add node
blender-dev nodetree-link <t> <fn> <fs> <tn> <ts>  # link nodes
\`\`\`

## Project structure
- \`scripts/main.py\` — scene setup script
- \`scripts/render.py\` — headless render
- \`addons/blender_bridge/__init__.py\` — HTTP bridge (port 6009)
`,

    '.gitignore': `*.blend1
*.blend2
__pycache__/
*.pyc
*.pyo
output/
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
.DS_Store
Thumbs.db
`,
  };
}

module.exports = getTemplates;
