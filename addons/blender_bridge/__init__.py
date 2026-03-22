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
import queue
import socket
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 6009
_server = None
_server_thread = None
_main_queue = queue.Queue()


def _tick():
    while not _main_queue.empty():
        fn, result_q = _main_queue.get_nowait()
        try:
            result_q.put(("ok", fn()))
        except Exception as e:
            result_q.put(("err", e))
    return 0.05


def _main_thread_call(fn):
    result_q = queue.Queue()
    _main_queue.put((fn, result_q))
    status, value = result_q.get(timeout=10)
    if status == "err":
        raise value
    return value

def _get_obj_info(obj):
    return {
        "name": obj.name,
        "type": obj.type,
        "location": list(obj.location),
        "rotation_euler": list(obj.rotation_euler),
        "scale": list(obj.scale),
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


            elif self.path == "/materials":
                result = [{"name": m.name, "users": m.users, "use_nodes": m.use_nodes} for m in bpy.data.materials]
                self.send_json(200, {"materials": result})

            elif self.path.startswith("/material/"):
                name = self.path[len("/material/"):]
                mat = bpy.data.materials.get(name)
                if mat is None:
                    self.send_json(404, {"error": f"Material not found: {name}"}); return
                node_info = []
                if mat.use_nodes and mat.node_tree:
                    node_info = [{"name": n.name, "type": n.bl_idname} for n in mat.node_tree.nodes]
                self.send_json(200, {"name": mat.name, "users": mat.users, "use_nodes": mat.use_nodes, "nodes": node_info})



            elif self.path.endswith("/fcurves") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/fcurves")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                if not obj.animation_data or not obj.animation_data.action:
                    self.send_json(200, {"object": name, "fcurves": []}); return
                action = obj.animation_data.action
                curves = []
                def _collect(fc_list):
                    for fc in fc_list:
                        curves.append({"data_path": fc.data_path, "array_index": fc.array_index, "keyframes": [[k.co.x, k.co.y] for k in fc.keyframe_points]})
                if action.is_action_legacy:
                    _collect(action.fcurves)
                else:
                    slot = action.slots[0] if action.slots else None
                    if slot:
                        for layer in action.layers:
                            for strip in layer.strips:
                                _collect(strip.channelbag(slot).fcurves)
                self.send_json(200, {"object": name, "fcurves": curves})

            elif self.path.startswith("/object/") and not any(self.path.endswith(s) for s in ["/hide", "/transform", "/delete", "/keyframe", "/fcurves", "/assign-material", "/rename", "/duplicate"]):
                name = self.path[len("/object/"):]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                mesh_stats = None
                if obj.type == "MESH" and obj.data:
                    mesh_stats = {"vertices": len(obj.data.vertices), "edges": len(obj.data.edges), "faces": len(obj.data.polygons)}
                self.send_json(200, {
                    "name": obj.name,
                    "type": obj.type,
                    "location": list(obj.location),
                    "rotation_euler": list(obj.rotation_euler),
                    "scale": list(obj.scale),
                    "visible": not obj.hide_viewport,
                    "hide_render": obj.hide_render,
                    "material_slots": [ms.material.name if ms.material else None for ms in obj.material_slots],
                    "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
                    "mesh_stats": mesh_stats,
                })

            elif self.path == "/scenes":
                scenes = [{"name": s.name, "object_count": len(s.objects), "frame_current": s.frame_current} for s in bpy.data.scenes]
                self.send_json(200, {"scenes": scenes})

            elif self.path == "/collections":
                result = []
                for col in bpy.data.collections:
                    result.append({"name": col.name, "object_count": len(col.objects), "children": [c.name for c in col.children]})
                self.send_json(200, {"collections": result})



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



            elif self.path == "/render/status":
                self.send_json(200, {"rendering": bpy.app.is_job_running("RENDER")})

            elif self.path == "/frame":
                scene = bpy.context.scene
                self.send_json(200, {"current": scene.frame_current, "start": scene.frame_start, "end": scene.frame_end, "fps": scene.render.fps})


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
                def _run_eval():
                    try:
                        tree = ast.parse(expr, mode='eval')
                        return ("expr", eval(compile(tree, '<expr>', 'eval'), ns))
                    except SyntaxError:
                        exec(expr, ns)
                        return ("exec", None)
                try:
                    kind, result = _main_thread_call(_run_eval)
                    out = buf.getvalue()
                    self.send_json(200, {"result": out if out else (str(result) if kind == "expr" else "(executed)")})
                except Exception as e:
                    self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})

            elif self.path == "/select":
                name = body.get("name", "")
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                def _select():
                    bpy.ops.object.select_all(action="DESELECT")
                    obj.select_set(True)
                    bpy.context.view_layer.objects.active = obj
                _main_thread_call(_select)
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
                    _main_thread_call(bpy.ops.script.reload)
                except Exception:
                    pass
                self.send_json(200, {"reloaded": True})


            elif self.path == "/material/create":
                mat_name = body.get("name", "Material")
                use_nodes = body.get("use_nodes", True)
                mat = bpy.data.materials.new(name=mat_name)
                mat.use_nodes = use_nodes
                self.send_json(200, {"name": mat.name, "use_nodes": mat.use_nodes})

            elif self.path.startswith("/object/") and self.path.endswith("/assign-material"):
                obj_name = self.path[len("/object/"):-len("/assign-material")]
                obj = bpy.data.objects.get(obj_name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {obj_name}"}); return
                if not hasattr(obj.data, "materials"):
                    self.send_json(400, {"error": "Object cannot have materials"}); return
                mat_name = body.get("material", "")
                mat = bpy.data.materials.get(mat_name)
                if mat is None:
                    self.send_json(404, {"error": f"Material not found: {mat_name}"}); return
                if obj.data.materials:
                    obj.data.materials[0] = mat
                else:
                    obj.data.materials.append(mat)
                self.send_json(200, {"object": obj_name, "material": mat.name})



            elif self.path == "/collection/create":
                name = body.get("name", "")
                col = bpy.data.collections.new(name)
                bpy.context.scene.collection.children.link(col)
                self.send_json(200, {"name": col.name})

            elif self.path.startswith("/collection/") and self.path.endswith("/link"):
                col_name = self.path[len("/collection/"):-len("/link")]
                col = bpy.data.collections.get(col_name)
                if col is None:
                    self.send_json(404, {"error": f"Collection not found: {col_name}"}); return
                obj = bpy.data.objects.get(body.get("object", ""))
                if obj is None:
                    self.send_json(404, {"error": "Object not found"}); return
                try:
                    col.objects.link(obj)
                    self.send_json(200, {"collection": col_name, "object": obj.name, "action": "linked"})
                except RuntimeError as e:
                    self.send_json(409, {"error": str(e)})

            elif self.path.startswith("/collection/") and self.path.endswith("/unlink"):
                col_name = self.path[len("/collection/"):-len("/unlink")]
                col = bpy.data.collections.get(col_name)
                if col is None:
                    self.send_json(404, {"error": f"Collection not found: {col_name}"}); return
                obj = bpy.data.objects.get(body.get("object", ""))
                if obj is None:
                    self.send_json(404, {"error": "Object not found"}); return
                col.objects.unlink(obj)
                self.send_json(200, {"collection": col_name, "object": obj.name, "action": "unlinked"})

            elif self.path == "/object/create":
                obj_type = body.get("type", "MESH")
                obj_name = body.get("name", "Object")
                mesh = bpy.data.meshes.new(obj_name) if obj_type == "MESH" else None
                obj = bpy.data.objects.new(obj_name, mesh)
                bpy.context.scene.collection.objects.link(obj)
                self.send_json(200, {"name": obj.name, "type": obj.type})

            elif self.path.endswith("/delete") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/delete")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                bpy.data.objects.remove(obj, do_unlink=True)
                self.send_json(200, {"deleted": name})

            elif self.path.endswith("/hide") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/hide")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                if "viewport" in body:
                    obj.hide_viewport = body["viewport"]
                if "render" in body:
                    obj.hide_render = body["render"]
                self.send_json(200, {"name": name, "hide_viewport": obj.hide_viewport, "hide_render": obj.hide_render})

            elif self.path.endswith("/transform") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/transform")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                if "location" in body:
                    obj.location = body["location"]
                if "rotation" in body:
                    obj.rotation_euler = body["rotation"]
                if "scale" in body:
                    obj.scale = body["scale"]
                self.send_json(200, {"name": name, "location": list(obj.location), "rotation_euler": list(obj.rotation_euler), "scale": list(obj.scale)})

            elif self.path.endswith("/keyframe") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/keyframe")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                prop = body.get("prop", "location")
                frame = body.get("frame", bpy.context.scene.frame_current)
                obj.keyframe_insert(data_path=prop, frame=frame)
                self.send_json(200, {"object": name, "prop": prop, "frame": frame})

            elif self.path.endswith("/rename") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/rename")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                new_name = body.get("new_name", "")
                if not new_name:
                    self.send_json(400, {"error": "new_name required"}); return
                obj.name = new_name
                self.send_json(200, {"old_name": name, "new_name": obj.name})

            elif self.path.endswith("/duplicate") and self.path.startswith("/object/"):
                name = self.path[len("/object/"):-len("/duplicate")]
                obj = bpy.data.objects.get(name)
                if obj is None:
                    self.send_json(404, {"error": f"Object not found: {name}"}); return
                linked = body.get("linked", False)
                new_obj = obj.copy()
                if not linked and obj.data:
                    new_obj.data = obj.data.copy()
                bpy.context.scene.collection.objects.link(new_obj)
                self.send_json(200, {"original": name, "duplicate": new_obj.name})

            elif self.path == "/scene/set":
                scene_name = body.get("name", "")
                scene = bpy.data.scenes.get(scene_name)
                if scene is None:
                    self.send_json(404, {"error": f"Scene not found: {scene_name}"}); return
                try:
                    _main_thread_call(lambda: setattr(bpy.context.window_manager.windows[0], "scene", scene))
                    self.send_json(200, {"scene": scene.name})
                except Exception as e:
                    self.send_json(500, {"error": str(e)})



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
                    self.send_json(404, {"error": "No node group on modifier"}); return
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
                mod_name_captured = mod.name
                def _apply():
                    bpy.context.view_layer.objects.active = obj
                    bpy.ops.object.select_all(action='DESELECT')
                    obj.select_set(True)
                    wm = bpy.context.window_manager
                    win = wm.windows[0] if wm.windows else None
                    area = next((a for a in win.screen.areas if a.type == 'VIEW_3D'), None) if win else None
                    ctx = {"window": win, "area": area, "active_object": obj, "object": obj, "selected_objects": [obj]} if area else {"active_object": obj, "object": obj, "selected_objects": [obj]}
                    with bpy.context.temp_override(**ctx):
                        bpy.ops.object.modifier_apply(modifier=mod_name_captured)
                _main_thread_call(_apply)
                self.send_json(200, {"applied": mod_name_captured})



            elif self.path == "/render":
                output_path = body.get("output_path")
                frame = body.get("frame")
                animation = body.get("animation", False)
                if output_path:
                    bpy.context.scene.render.filepath = output_path
                if frame is not None:
                    bpy.context.scene.frame_set(frame)
                def _do_render():
                    bpy.ops.render.render(animation=animation, write_still=not animation)
                    return None
                bpy.app.timers.register(_do_render, first_interval=0)
                self.send_json(200, {"status": "started", "frame": bpy.context.scene.frame_current})

            elif self.path == "/frame":
                scene = bpy.context.scene
                bdata = body
                def _set_frame():
                    if "current" in bdata:
                        scene.frame_set(int(bdata["current"]))
                    if "start" in bdata:
                        scene.frame_start = int(bdata["start"])
                    if "end" in bdata:
                        scene.frame_end = int(bdata["end"])
                _main_thread_call(_set_frame)
                self.send_json(200, {"current": scene.frame_current, "start": scene.frame_start, "end": scene.frame_end, "fps": scene.render.fps})

            elif self.path == "/render-settings":
                scene = bpy.context.scene
                r = scene.render
                if "engine" in body:
                    r.engine = body["engine"]
                if "resolution_x" in body:
                    r.resolution_x = int(body["resolution_x"])
                if "resolution_y" in body:
                    r.resolution_y = int(body["resolution_y"])
                if "resolution_percentage" in body:
                    r.resolution_percentage = int(body["resolution_percentage"])
                if "samples" in body and hasattr(scene, "cycles"):
                    scene.cycles.samples = int(body["samples"])
                if "output_path" in body:
                    r.filepath = body["output_path"]
                self.send_json(200, {"engine": r.engine, "resolution_x": r.resolution_x, "resolution_y": r.resolution_y})


            else:
                self.send_json(404, {"error": "Not found", "path": self.path})

        except Exception as e:
            self.send_json(500, {"error": str(e), "traceback": traceback.format_exc()})


def start_server():
    global _server
    try:
        _server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
        _server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        print(f"[blender_bridge] HTTP server started on port {PORT}")
        _server.serve_forever()
    except Exception as e:
        print(f"[blender_bridge] Server error: {e}")


def register():
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return
    if not bpy.app.timers.is_registered(_tick):
        bpy.app.timers.register(_tick, persistent=True)
    _server_thread = threading.Thread(target=start_server, daemon=True)
    _server_thread.start()


def unregister():
    global _server, _server_thread
    if bpy.app.timers.is_registered(_tick):
        bpy.app.timers.unregister(_tick)
    srv = _server
    _server = None
    if srv:
        threading.Thread(target=srv.shutdown, daemon=True).start()
