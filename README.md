# blender-kit

Agentic Blender 4.x development boilerplate — Python REPL/CLI, HTTP bridge, scene inspector, headless rendering.

## Install

```bash
npx blender-kit <project-dir>
cd <project-dir>
```

This scaffolds a new project and installs the `blender-dev` CLI.

## Requirements

- Node.js 18+
- Blender 4.x ([download](https://www.blender.org/download/releases/4-3/))
- Python + pip (for lint/format tools)

## Configuration

```bash
blender-dev config set blenderPath /path/to/blender
blender-dev config get
blender-dev config path
blender-dev download-engine   # show download instructions
```

Config is stored at `~/.blender-kit/config.json`.

## CLI Commands

### Headless (no Blender open required)

| Command | Description |
|---------|-------------|
| `blender-dev run [script]` | Run a Python script headlessly (default: `scripts/main.py`) |
| `blender-dev render [script]` | Run render script headlessly (default: `scripts/render.py`) |
| `blender-dev setup` | Install `flake8` and `black` via pip |
| `blender-dev lint [files...]` | Lint Python files with flake8 |
| `blender-dev format [files...]` | Format Python files with black |
| `blender-dev download-engine` | Show Blender 4.3 download instructions |

### Live Bridge (requires Blender open + blender_bridge addon enabled)

The bridge runs an HTTP server on port **6009** inside Blender.

| Command | Description |
|---------|-------------|
| `blender-dev repl` | Interactive Python REPL against running Blender |
| `blender-dev eval <expr>` | Evaluate a Python/bpy expression |
| `blender-dev info` | Show Blender version, scene name, object count |
| `blender-dev scene` | Dump active scene tree |
| `blender-dev objects` | List all objects with name/type/location |
| `blender-dev set <path> <prop> <value>` | Set an object property |
| `blender-dev select <name>` | Select object by name |
| `blender-dev call <path> <method> [args]` | Call a bpy method |
| `blender-dev render-settings` | Show render engine, resolution, samples |
| `blender-dev reload` | Reload the current .blend file |
| `blender-dev watch` | Watch `.py` files and notify bridge on change |

### REPL dot-commands

Inside `blender-dev repl`:

```
.objects          list scene objects
.scene            dump scene tree
.info             Blender version + scene info
.render-settings  render config
.help             show available dot-commands
```

Any other input is evaluated as a Python/bpy expression.

## Project Structure (scaffolded)

```
<project>/
  scripts/
    main.py       # entry point for blender-dev run
    render.py     # entry point for blender-dev render
  addons/
    blender_bridge/
      __init__.py # HTTP bridge addon (port 6009)
```

## Ports

| Port | Service |
|------|---------|
| 6009 | Blender HTTP bridge |

## License

MIT
