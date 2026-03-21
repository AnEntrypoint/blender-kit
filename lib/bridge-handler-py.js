'use strict';
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
                self.send_json(200, {
                    "blender_version": ".".join(str(v) for v in bpy.app.version),
                    "scene": bpy.context.scene.name if bpy.context.scene else None,
                    "object_count": len(bpy.data.objects),
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

            elif self.path.startswith("/geonodes/"):
                name = self.path[len("/geonodes/"):]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                mod = _gn_modifier(obj)
                if mod is None:
                    self.send_json(200, {"object": name, "modifiers": []}); return
                ng = mod.node_group
                self.send_json(200, {
                    "object": name,
                    "modifier_name": mod.name,
                    "node_group": ng.name if ng else None,
                    "inputs": _get_gn_inputs(ng) if ng else [],
                })

            elif self.path.startswith("/nodetree/"):
                name = self.path[len("/nodetree/"):]
                ng = bpy.data.node_groups.get(name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {name}"}); return
                nodes = [{"name": n.name, "type": n.bl_idname, "location": [n.location.x, n.location.y]} for n in ng.nodes]
                links = [{"from": [l.from_node.name, l.from_socket.name], "to": [l.to_node.name, l.to_socket.name]} for l in ng.links]
                self.send_json(200, {"name": name, "nodes": nodes, "links": links})

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
                    ns = {"bpy": bpy}
                    exec(expr, ns)
                    self.send_json(200, {"result": "(executed)"})

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
                bpy.ops.wm.revert_mainfile()
                self.send_json(200, {"reloaded": True})

            elif self.path.startswith("/geonodes/") and self.path.endswith("/set"):
                name = self.path[len("/geonodes/"):-len("/set")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                mod = _gn_modifier(obj)
                if mod is None:
                    self.send_json(404, {"error": f"No geometry nodes modifier on: {name}"}); return
                inputs = body.get("inputs", {})
                set_list = []
                for k, v in inputs.items():
                    mod[k] = v
                    set_list.append({"name": k, "value": v})
                self.send_json(200, {"object": name, "set": set_list})

            elif self.path == "/geonodes/create":
                obj_name = body.get("object", "")
                obj = bpy.data.objects.get(obj_name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {obj_name}"}); return
                mod = obj.modifiers.new(name=body.get("modifier_name", "GeometryNodes"), type='NODES')
                ng_name = body.get("node_group")
                if ng_name:
                    ng = bpy.data.node_groups.get(ng_name)
                    if ng: mod.node_group = ng
                self.send_json(200, {"object": obj_name, "modifier": mod.name, "node_group": mod.node_group.name if mod.node_group else None})

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
