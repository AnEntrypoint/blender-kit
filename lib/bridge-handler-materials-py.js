'use strict';
const BRIDGE_MATERIALS_GET = `
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
`;

const BRIDGE_MATERIALS_POST = `
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
`;

module.exports = { BRIDGE_MATERIALS_GET, BRIDGE_MATERIALS_POST };
