

import bpy, random, math

bpy.ops.wm.read_factory_settings(use_empty=True)

def active():
    return bpy.context.view_layer.objects.active

def move_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)

def mat(name, r, g, b, roughness=0.8):
    m = bpy.data.materials.new(name)
    nodes = m.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
        bsdf.inputs["Roughness"].default_value = roughness
    return m

bark_mat   = mat("Bark",   0.25, 0.15, 0.08)
leaf_mat   = mat("Leaves", 0.08, 0.35, 0.06)
ground_mat = mat("Ground", 0.18, 0.28, 0.10)
rock_mat   = mat("Rock",   0.35, 0.33, 0.30)

tree_coll = bpy.data.collections.new("Trees")
rock_coll = bpy.data.collections.new("Rocks")
bpy.context.scene.collection.children.link(tree_coll)
bpy.context.scene.collection.children.link(rock_coll)

bpy.ops.mesh.primitive_plane_add(size=50, location=(0, 0, 0))
ground = active()
ground.name = "Ground"
ground.data.materials.append(ground_mat)

def make_tree(name, x, y, trunk_h, trunk_r, canopy_r):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=trunk_r, depth=trunk_h, location=(x, y, trunk_h/2))
    trunk = active()
    trunk.name = f"{name}_trunk"
    trunk.data.materials.append(bark_mat)
    move_to(trunk, tree_coll)

    bpy.ops.mesh.primitive_ico_sphere_add(radius=canopy_r, subdivisions=2, location=(x, y, trunk_h + canopy_r*0.65))
    canopy = active()
    canopy.name = f"{name}_canopy"
    canopy.data.materials.append(leaf_mat)
    canopy.scale = (1.0, 1.0, 0.75)
    move_to(canopy, tree_coll)

def make_rock(name, x, y, size):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=size, subdivisions=1, location=(x, y, size*0.4))
    rock = active()
    rock.name = name
    rock.scale = (1.0, random.uniform(0.6, 1.0), random.uniform(0.4, 0.7))
    rock.rotation_euler = (0, 0, random.uniform(0, math.pi))
    rock.data.materials.append(rock_mat)
    move_to(rock, rock_coll)

random.seed(42)

for i in range(30):
    angle = random.uniform(0, 2*math.pi)
    dist = random.uniform(5, 22)
    x = math.cos(angle)*dist + random.uniform(-1.5, 1.5)
    y = math.sin(angle)*dist + random.uniform(-1.5, 1.5)
    h = random.uniform(2.0, 4.5)
    make_tree(f"Tree_{i:02d}", x, y, h, random.uniform(0.1, 0.22), random.uniform(1.0, 2.2))

for i in range(12):
    angle = random.uniform(0, 2*math.pi)
    dist = random.uniform(3, 20)
    x, y = math.cos(angle)*dist, math.sin(angle)*dist
    make_rock(f"Rock_{i:02d}", x, y, random.uniform(0.2, 0.7))

bpy.ops.object.light_add(type='SUN', location=(10, -10, 15))
sun = active()
sun.name = "Sun"
sun.data.energy = 5.0
sun.rotation_euler = (math.radians(45), 0, math.radians(30))

bpy.ops.object.camera_add(location=(25, -25, 18))
cam = active()
cam.name = "ForestCam"
cam.rotation_euler = (math.radians(55), 0, math.radians(45))
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.filepath = "//forest_render.png"

bpy.ops.wm.save_as_mainfile(filepath="C:/dev/blender-kit/forest.blend")
print(f"Saved: {len(bpy.data.objects)} objects, {len(bpy.data.collections)} collections")
print("Trees:", len(tree_coll.objects), "Rocks:", len(rock_coll.objects))

