'use strict';
const BRIDGE_OBJECTS_GET = `
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
`;
const BRIDGE_OBJECTS_POST = `
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
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                try:
                    bpy.ops.object.mode_set(mode='OBJECT')
                except Exception:
                    pass
                bpy.ops.object.duplicate(linked=body.get("linked", False))
                new_obj = bpy.context.view_layer.objects.active
                self.send_json(200, {"original": name, "duplicate": new_obj.name if new_obj else None})

            elif self.path == "/scene/set":
                scene_name = body.get("name", "")
                scene = bpy.data.scenes.get(scene_name)
                if scene is None:
                    self.send_json(404, {"error": f"Scene not found: {scene_name}"}); return
                try:
                    bpy.context.window_manager.windows[0].scene = scene
                    self.send_json(200, {"scene": scene.name})
                except Exception as e:
                    self.send_json(500, {"error": str(e)})
`;
module.exports = { BRIDGE_OBJECTS_GET, BRIDGE_OBJECTS_POST };
