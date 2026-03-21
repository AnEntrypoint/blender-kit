'use strict';

// The Blender bridge addon as a Python string.
// This is written to addons/blender_bridge/__init__.py in scaffolded projects.
const BLENDER_BRIDGE_PY = `bl_info = {
    "name": "Blender Bridge (blender-kit)",
    "author": "blender-kit",
    "version": (1, 0, 0),
    "blender": (4, 0, 0),
    "location": "Runs automatically on enable",
    "description": "HTTP API server on port 6009 for agentic development with blender-dev CLI",
    "category": "Development",
}

import bpy
import json
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 6009
_server = None
_server_thread = None

# ---------------------------------------------------------------------------
# Helpers for safe bpy access
# ---------------------------------------------------------------------------

def _get_obj_info(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "location": list(obj.location),
        "visible": not obj.hide_viewport,
    }


def _resolve_path(path_str):
    """Resolve a dotted path like 'bpy.data.objects["Cube"]' to an object."""
    parts = path_str.split(".")
    obj = bpy
    for part in parts:
        if "[" in part:
            attr, rest = part.split("[", 1)
            key = rest.rstrip("]").strip('"').strip("'")
            obj = getattr(obj, attr)[key]
        else:
            obj = getattr(obj, part)
    return obj


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default access log

    def send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        try:
            if self.path == "/info":
                result = {
                    "blender_version": ".".join(str(v) for v in bpy.app.version),
                    "scene": bpy.context.scene.name if bpy.context.scene else None,
                    "object_count": len(bpy.data.objects),
                }
                self.send_json(200, result)

            elif self.path == "/objects":
                objects = [_get_obj_info(o) for o in bpy.data.objects]
                self.send_json(200, {"objects": objects})

            elif self.path == "/scene":
                def walk(obj, depth=0):
                    children = [walk(c, depth + 1) for c in obj.children]
                    return {"name": obj.name, "type": obj.type, "children": children}
                scene = bpy.context.scene
                roots = [o for o in scene.objects if o.parent is None]
                tree = [walk(r) for r in roots]
                self.send_json(200, {"scene": scene.name, "objects": tree})

            elif self.path == "/render-settings":
                scene = bpy.context.scene
                result = {
                    "engine": scene.render.engine,
                    "resolution_x": scene.render.resolution_x,
                    "resolution_y": scene.render.resolution_y,
                    "resolution_percentage": scene.render.resolution_percentage,
                    "samples": getattr(getattr(scene, "cycles", None), "samples", None),
                    "eevee_samples": getattr(getattr(scene, "eevee", None), "taa_render_samples", None),
                    "frame_start": scene.frame_start,
                    "frame_end": scene.frame_end,
                    "output_path": scene.render.filepath,
                }
                self.send_json(200, result)

            else:
                self.send_json(404, {"error": "Not found", "path": self.path})

        except Exception as e:
            self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})

    def do_POST(self):
        try:
            body = self.read_json()

            if self.path == "/eval":
                expr = body.get("expr", "")
                try:
                    result = eval(expr, {"bpy": bpy, "__builtins__": __builtins__})
                    self.send_json(200, {"result": str(result)})
                except SyntaxError:
                    # Try exec for statements
                    ns = {"bpy": bpy}
                    exec(expr, ns)
                    self.send_json(200, {"result": "(executed)"})

            elif self.path == "/select":
                name = body.get("name", "")
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"})
                    return
                bpy.ops.object.select_all(action="DESELECT")
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                self.send_json(200, {"selected": name})

            elif self.path == "/set":
                obj_path = body.get("path", "")
                prop = body.get("prop", "")
                value = body.get("value")
                target = _resolve_path(obj_path)
                setattr(target, prop, value)
                self.send_json(200, {"set": prop, "value": value})

            elif self.path == "/call":
                obj_path = body.get("path", "")
                method_name = body.get("method", "")
                args = body.get("args", [])
                target = _resolve_path(obj_path)
                method = getattr(target, method_name)
                result = method(*args)
                self.send_json(200, {"result": str(result)})

            elif self.path == "/reload":
                bpy.ops.wm.revert_mainfile()
                self.send_json(200, {"reloaded": True})

            else:
                self.send_json(404, {"error": "Not found", "path": self.path})

        except Exception as e:
            self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

def start_server():
    global _server
    try:
        _server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
        print(f"[blender_bridge] HTTP server started on port {PORT}")
        _server.serve_forever()
    except Exception as e:
        print(f"[blender_bridge] Server error: {e}")


def register():
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return
    _server_thread = threading.Thread(target=start_server, daemon=True)
    _server_thread.start()


def unregister():
    global _server
    if _server:
        _server.shutdown()
        _server = None
`;

module.exports = { BLENDER_BRIDGE_PY };
