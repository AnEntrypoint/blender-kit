'use strict';
const { BRIDGE_GEONODES_GET, BRIDGE_GEONODES_POST } = require('./bridge-handler-geonodes-py');
const { BRIDGE_OBJECTS_GET, BRIDGE_OBJECTS_POST } = require('./bridge-handler-objects-py');
const { BRIDGE_MATERIALS_GET, BRIDGE_MATERIALS_POST } = require('./bridge-handler-materials-py');
const { BRIDGE_RENDER_GET, BRIDGE_RENDER_POST } = require('./bridge-handler-render-py');
const BRIDGE_PY_HANDLER = `class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

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
                import sys
                scene = bpy.context.scene
                ao = bpy.context.view_layer.objects.active
                self.send_json(200, {
                    "blender_version": ".".join(str(v) for v in bpy.app.version),
                    "scene": scene.name if scene else None,
                    "object_count": len(bpy.data.objects),
                    "current_frame": scene.frame_current if scene else None,
                    "frame_start": scene.frame_start if scene else None,
                    "frame_end": scene.frame_end if scene else None,
                    "fps": scene.render.fps if scene else None,
                    "active_object": ao.name if ao else None,
                    "python_version": sys.version.split()[0],
                })

            elif self.path == "/objects":
                self.send_json(200, {"objects": [_get_obj_info(o) for o in bpy.data.objects]})

            elif self.path == "/scene":
                def walk(obj, depth=0):
                    return {"name": obj.name, "type": obj.type, "children": [walk(c) for c in obj.children]}
                scene = bpy.context.scene
                roots = [o for o in scene.objects if o.parent is None]
                self.send_json(200, {"scene": scene.name, "objects": [walk(r) for r in roots]})

            elif self.path == "/render-settings":
                scene = bpy.context.scene
                self.send_json(200, {
                    "engine": scene.render.engine,
                    "resolution_x": scene.render.resolution_x,
                    "resolution_y": scene.render.resolution_y,
                    "resolution_percentage": scene.render.resolution_percentage,
                    "samples": getattr(getattr(scene, "cycles", None), "samples", None),
                    "eevee_samples": getattr(getattr(scene, "eevee", None), "taa_render_samples", None),
                    "frame_start": scene.frame_start,
                    "frame_end": scene.frame_end,
                    "output_path": scene.render.filepath,
                })

            elif self.path == "/nodegroups":
                result = []
                for ng in bpy.data.node_groups:
                    result.append({"name": ng.name, "node_count": len(ng.nodes), "users": ng.users})
                self.send_json(200, {"node_groups": result})

${BRIDGE_MATERIALS_GET}

${BRIDGE_OBJECTS_GET}

${BRIDGE_GEONODES_GET}

${BRIDGE_RENDER_GET}

            else:
                self.send_json(404, {"error": "Not found", "path": self.path})

        except Exception as e:
            self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})

    def do_POST(self):
        try:
            body = self.read_json()

            if self.path == "/eval":
                import io, ast
                expr = body.get("expr", "")
                buf = io.StringIO()
                def _print(*a, **kw): buf.write(" ".join(str(x) for x in a) + kw.get("end", chr(10)))
                ns = {"bpy": bpy, "__builtins__": __builtins__, "print": _print}
                try:
                    try:
                        tree = ast.parse(expr, mode='eval')
                        result = eval(compile(tree, '<expr>', 'eval'), ns)
                        out = buf.getvalue()
                        self.send_json(200, {"result": out if out else str(result)})
                    except SyntaxError:
                        exec(expr, ns)
                        out = buf.getvalue()
                        self.send_json(200, {"result": out if out else "(executed)"})
                except Exception as e:
                    self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})

            elif self.path == "/select":
                name = body.get("name", "")
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                bpy.ops.object.select_all(action="DESELECT")
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                self.send_json(200, {"selected": name})

            elif self.path == "/set":
                target = _resolve_path(body.get("path", ""))
                prop = body.get("prop", "")
                value = body.get("value")
                setattr(target, prop, value)
                self.send_json(200, {"set": prop, "value": value})

            elif self.path == "/call":
                target = _resolve_path(body.get("path", ""))
                method = getattr(target, body.get("method", ""))
                args = body.get("args", [])
                self.send_json(200, {"result": str(method(*args))})

            elif self.path == "/reload":
                try:
                    bpy.ops.script.reload()
                except Exception:
                    pass
                self.send_json(200, {"reloaded": True})

${BRIDGE_MATERIALS_POST}

${BRIDGE_OBJECTS_POST}

${BRIDGE_GEONODES_POST}

${BRIDGE_RENDER_POST}

            else:
                self.send_json(404, {"error": "Not found", "path": self.path})

        except Exception as e:
            self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})


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
module.exports = { BRIDGE_PY_HANDLER };
