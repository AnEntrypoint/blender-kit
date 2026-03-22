'use strict';
const BRIDGE_GEONODES_GET = `
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
`;

const BRIDGE_GEONODES_POST = `
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
`;

module.exports = { BRIDGE_GEONODES_GET, BRIDGE_GEONODES_POST };
