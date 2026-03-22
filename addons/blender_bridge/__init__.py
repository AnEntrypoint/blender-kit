bl_info = {
    "name": "Blender Bridge",
    "author": "blender-kit",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "Enabled automatically — HTTP server on port 6009",
    "description": "HTTP API server on port 6009 for blender-dev CLI",
    "category": "Development",
}

import bpy
import json
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 6009
_server = None
_server_thread = None

def _get_obj_info(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "location": list(obj.location),
        "visible": not obj.hide_viewport,
    }


def _resolve_path(path_str):
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


def _serialize_value(v):
    try:
        return list(v)
    except TypeError:
        return v


def _gn_modifier(obj):
    for m in obj.modifiers:
        if m.type == 'NODES':
            return m
    return None


def _all_gn_modifiers(obj):
    return [m for m in obj.modifiers if m.type == 'NODES']


def _get_gn_inputs(ng, mod=None):
    result = []
    for item in ng.interface.items_tree:
        if item.item_type != 'SOCKET' or item.in_out != 'INPUT':
            continue
        entry = {"name": item.name, "identifier": item.identifier, "type": item.socket_type, "default": _serialize_value(item.default_value)}
        if hasattr(item, 'min_value') and item.min_value is not None:
            entry["min"] = item.min_value
        if hasattr(item, 'max_value') and item.max_value is not None:
            entry["max"] = item.max_value
        if mod is not None:
            try:
                entry["value"] = _serialize_value(mod[item.identifier])
            except (KeyError, TypeError):
                entry["value"] = entry["default"]
        else:
            entry["value"] = entry["default"]
        result.append(entry)
    return result

class BridgeHandler(BaseHTTPRequestHandler):
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

            elif self.path == "/nodegroups":
                result = []
                for ng in bpy.data.node_groups:
                    result.append({"name": ng.name, "node_count": len(ng.nodes), "users": ng.users})
                self.send_json(200, {"node_groups": result})


            elif self.path.startswith("/geonodes/") and not self.path.endswith("/apply"):
                path_part, _, qs = self.path.partition("?")
                params = urllib.parse.parse_qs(qs)
                name = path_part[len("/geonodes/"):]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                mods = _all_gn_modifiers(obj)
                if not mods:
                    self.send_json(200, {"object": name, "modifiers": []}); return
                mod_filter = params.get("modifier", [None])[0]
                if mod_filter:
                    mod = next((m for m in mods if m.name == mod_filter), None)
                    if mod is None:
                        self.send_json(404, {"error": f"Modifier not found: {mod_filter}"}); return
                    ng = mod.node_group
                    self.send_json(200, {"object": name, "modifier_name": mod.name, "node_group": ng.name if ng else None, "inputs": _get_gn_inputs(ng, mod) if ng else []})
                else:
                    result = []
                    for mod in mods:
                        ng = mod.node_group
                        result.append({"modifier_name": mod.name, "node_group": ng.name if ng else None, "inputs": _get_gn_inputs(ng, mod) if ng else []})
                    self.send_json(200, {"object": name, "modifiers": result})

            elif self.path.startswith("/nodetree/") and not any(self.path.endswith(s) for s in ["/add-node", "/delete-node", "/add-link", "/remove-link"]):
                name = self.path[len("/nodetree/"):].split("?")[0]
                ng = bpy.data.node_groups.get(name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {name}"}); return
                def sock_info(s):
                    entry = {"name": s.name, "type": s.bl_idname}
                    if hasattr(s, 'default_value'):
                        try:
                            entry["default_value"] = _serialize_value(s.default_value)
                        except Exception:
                            pass
                    return entry
                nodes = []
                for n in ng.nodes:
                    nodes.append({
                        "name": n.name,
                        "type": n.bl_idname,
                        "label": n.label,
                        "muted": n.mute,
                        "location": [n.location.x, n.location.y],
                        "color": list(n.color),
                        "inputs": [sock_info(s) for s in n.inputs],
                        "outputs": [sock_info(s) for s in n.outputs],
                    })
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


            elif self.path.startswith("/geonodes/") and "/set" in self.path:
                raw_path = self.path.split("?")[0]
                query = self.path[len(raw_path)+1:] if "?" in self.path else ""
                mod_name = None
                for part in query.split("&"):
                    if part.startswith("modifier="):
                        mod_name = urllib.parse.unquote(part[len("modifier="):])
                name = raw_path[len("/geonodes/"):-len("/set")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                if mod_name:
                    mod = obj.modifiers.get(mod_name)
                    if mod is None:
                        self.send_json(404, {"error": f"Modifier not found: {mod_name}"}); return
                else:
                    mod = _gn_modifier(obj)
                if mod is None:
                    self.send_json(404, {"error": f"No geometry nodes modifier on: {name}"}); return
                ng = mod.node_group
                if ng is None:
                    self.send_json(404, {"error": f"No node group on modifier"}); return
                id_map = {item.name: item.identifier for item in ng.interface.items_tree if item.item_type == 'SOCKET' and item.in_out == 'INPUT'}
                inputs = body.get("inputs", {})
                set_list = []
                for k, v in inputs.items():
                    identifier = id_map.get(k)
                    if identifier is None:
                        self.send_json(400, {"error": f"Input not found: {k}"}); return
                    mod[identifier] = v
                    set_list.append({"name": k, "identifier": identifier, "value": v})
                self.send_json(200, {"object": name, "set": set_list})

            elif self.path == "/geonodes/create":
                obj_name = body.get("object", "")
                obj = bpy.data.objects.get(obj_name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {obj_name}"}); return
                mod_name_val = body.get("modifier_name", "GeometryNodes")
                mod = obj.modifiers.new(name=mod_name_val, type='NODES')
                ng_name = body.get("node_group")
                if ng_name:
                    ng = bpy.data.node_groups.get(ng_name)
                    if ng: mod.node_group = ng
                if mod.node_group is None:
                    ng = bpy.data.node_groups.new(mod_name_val, "GeometryNodeTree")
                    mod.node_group = ng
                self.send_json(200, {"object": obj_name, "modifier": mod.name, "node_group": mod.node_group.name if mod.node_group else None})

            elif self.path.endswith("/add-node") and "/nodetree/" in self.path:
                ng_name = self.path[len("/nodetree/"):-len("/add-node")]
                ng = bpy.data.node_groups.get(ng_name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {ng_name}"}); return
                node_type = body.get("type", "")
                loc = body.get("location", [0, 0])
                node = ng.nodes.new(type=node_type)
                node.location = (loc[0], loc[1])
                self.send_json(200, {"name": node.name, "type": node.bl_idname, "location": [node.location.x, node.location.y]})

            elif self.path.endswith("/delete-node") and "/nodetree/" in self.path:
                ng_name = self.path[len("/nodetree/"):-len("/delete-node")]
                ng = bpy.data.node_groups.get(ng_name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {ng_name}"}); return
                node_name = body.get("name", "")
                node = ng.nodes.get(node_name)
                if node is None:
                    self.send_json(404, {"error": f"Node not found: {node_name}"}); return
                ng.nodes.remove(node)
                self.send_json(200, {"deleted": node_name})

            elif self.path.endswith("/add-link") and "/nodetree/" in self.path:
                ng_name = self.path[len("/nodetree/"):-len("/add-link")]
                ng = bpy.data.node_groups.get(ng_name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {ng_name}"}); return
                fn = ng.nodes.get(body.get("from_node", ""))
                tn = ng.nodes.get(body.get("to_node", ""))
                if fn is None or tn is None:
                    self.send_json(404, {"error": "Node not found"}); return
                fs_id = body.get("from_socket", 0)
                ts_id = body.get("to_socket", 0)
                fs = fn.outputs[fs_id] if isinstance(fs_id, int) else next((s for s in fn.outputs if s.name == fs_id), None)
                ts = tn.inputs[ts_id] if isinstance(ts_id, int) else next((s for s in tn.inputs if s.name == ts_id), None)
                if fs is None or ts is None:
                    self.send_json(404, {"error": "Socket not found"}); return
                link = ng.links.new(fs, ts)
                self.send_json(200, {"from": [fn.name, fs.name], "to": [tn.name, ts.name]})

            elif self.path.endswith("/remove-link") and "/nodetree/" in self.path:
                ng_name = self.path[len("/nodetree/"):-len("/remove-link")]
                ng = bpy.data.node_groups.get(ng_name)
                if ng is None:
                    self.send_json(404, {"error": f"Node group not found: {ng_name}"}); return
                fn_name = body.get("from_node", "")
                fs_name = body.get("from_socket", "")
                tn_name = body.get("to_node", "")
                ts_name = body.get("to_socket", "")
                link = next((l for l in ng.links if l.from_node.name == fn_name and l.from_socket.name == fs_name and l.to_node.name == tn_name and l.to_socket.name == ts_name), None)
                if link is None:
                    self.send_json(404, {"error": "Link not found"}); return
                ng.links.remove(link)
                self.send_json(200, {"removed": {"from": [fn_name, fs_name], "to": [tn_name, ts_name]}})

            elif self.path.startswith("/geonodes/") and self.path.split("?")[0].endswith("/apply"):
                raw_path, _, qs = self.path.partition("?")
                params = urllib.parse.parse_qs(qs)
                name = raw_path[len("/geonodes/"):-len("/apply")]
                mod_name = urllib.parse.unquote(params.get("modifier", [""])[0])
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                mods = [m for m in obj.modifiers if m.type == 'NODES']
                if not mods:
                    self.send_json(404, {"error": f"No geometry nodes modifier on: {name}"}); return
                if mod_name:
                    mod = next((m for m in mods if m.name == mod_name), None)
                    if mod is None:
                        self.send_json(404, {"error": f"Modifier not found: {mod_name}"}); return
                else:
                    mod = mods[0]
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                try:
                    bpy.ops.object.mode_set(mode='OBJECT')
                except Exception:
                    pass
                bpy.ops.object.modifier_apply(modifier=mod.name)
                self.send_json(200, {"applied": mod.name})


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
