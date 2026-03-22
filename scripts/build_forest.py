
import bpy, math, random, bmesh

bpy.ops.wm.read_factory_settings(use_empty=True)

random.seed(42)

def move_to(obj, coll):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    coll.objects.link(obj)

def mat(name, base, roughness=0.8, subsurface=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1.0)
    b.inputs["Roughness"].default_value  = roughness
    if subsurface > 0:
        b.inputs["Subsurface Weight"].default_value = subsurface
        b.inputs["Subsurface Radius"].default_value = (1.0, 0.2, 0.1)
    return m

def add_obj(name, mesh, location, coll, scale=None):
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    if scale: obj.scale = scale
    bpy.context.scene.collection.objects.link(obj)
    move_to(obj, coll)
    return obj

def cyl_mesh(name, radius, depth, verts=8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts,
                          radius1=radius, radius2=radius, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    return me

def sphere_mesh(name, radius, subdivisions=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    return me

def plane_mesh(name, size):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size/2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    return me

# World — HOSEK_WILKIE sky (Blender 5, NISHITA removed)
world = bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
wt = world.node_tree
for n in list(wt.nodes): wt.nodes.remove(n)
bg  = wt.nodes.new("ShaderNodeBackground")
sky = wt.nodes.new("ShaderNodeTexSky")
sky.sky_type      = 'HOSEK_WILKIE'
sky.sun_direction = (math.sin(math.radians(215)) * math.cos(math.radians(28)),
                     math.cos(math.radians(215)) * math.cos(math.radians(28)),
                     math.sin(math.radians(28)))
sky.turbidity = 3.0
sky.ground_albedo = 0.3
out = wt.nodes.new("ShaderNodeOutputWorld")
wt.links.new(sky.outputs["Color"], bg.inputs["Color"])
wt.links.new(bg.outputs["Background"], out.inputs["Surface"])
bg.inputs["Strength"].default_value = 1.1

# Materials
mat_bark   = mat("Bark",   (0.22, 0.13, 0.07), 0.92)
mat_leaves = mat("Leaves", (0.07, 0.32, 0.05), 0.85, 0.12)
mat_ground = mat("Ground", (0.14, 0.22, 0.08), 0.97)
mat_rock   = mat("Rock",   (0.38, 0.35, 0.30), 0.88)
mat_grassA = mat("GrassA", (0.09, 0.30, 0.06), 0.95)
mat_grassB = mat("GrassB", (0.11, 0.25, 0.05), 0.95)
mat_stem   = mat("Stem",   (0.10, 0.38, 0.08), 0.8)
mat_center = mat("FlowerCenter", (0.50, 0.28, 0.04), 0.7)
mat_wrap   = mat("Wrap",   (0.82, 0.72, 0.88), 0.6)
petal_data = [
    ("Petal_Red",    (0.88, 0.08, 0.12)),
    ("Petal_Yellow", (0.95, 0.82, 0.08)),
    ("Petal_Pink",   (0.95, 0.42, 0.62)),
    ("Petal_White",  (0.92, 0.90, 0.88)),
    ("Petal_Orange", (0.95, 0.45, 0.05)),
    ("Petal_Purple", (0.55, 0.12, 0.75)),
]
petal_mats = [mat(n, c, 0.55, 0.2) for n, c in petal_data]

# Collections
def col(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

col_trees   = col("Trees")
col_rocks   = col("Rocks")
col_grass   = col("Grass")
col_bouquet = col("Bouquet")

# Ground
ground = add_obj("Ground", plane_mesh("ground_me", 60), (0,0,0), col_trees)
ground.data.materials.append(mat_ground)
bpy.context.scene.collection.objects.link(ground)
move_to(ground, bpy.context.scene.collection)

# Grass tufts
for i in range(40):
    x = random.uniform(-24, 24)
    y = random.uniform(-24, 24)
    if x*x + y*y < 2.5: continue
    for blade in range(2):
        bx = x + random.uniform(-0.15, 0.15)
        by = y + random.uniform(-0.15, 0.15)
        h  = random.uniform(0.12, 0.28)
        me = cyl_mesh(f"g_{i}_{blade}_me", 0.015, h, 3)
        g  = add_obj(f"Grass_{i:02d}_{blade}", me, (bx, by, h/2), col_grass)
        g.rotation_euler = (random.uniform(-0.25,0.25), random.uniform(-0.25,0.25), random.uniform(0,math.pi))
        g.data.materials.append(mat_grassA if i%2==0 else mat_grassB)

# Trees
def make_tree(name, x, y, trunk_h, trunk_r, canopy_r):
    trunk = add_obj(f"{name}_trunk", cyl_mesh(f"{name}_tme", trunk_r, trunk_h, 8),
                    (x, y, trunk_h/2), col_trees)
    trunk.data.materials.append(mat_bark)
    for lr, lz in [(canopy_r*0.95, trunk_h+canopy_r*0.45),
                   (canopy_r*0.78, trunk_h+canopy_r*1.15),
                   (canopy_r*0.52, trunk_h+canopy_r*1.75)]:
        c = add_obj(f"{name}_c{lr:.2f}", sphere_mesh(f"{name}_sme{lz:.1f}", lr, 2),
                    (x+random.uniform(-0.1,0.1), y+random.uniform(-0.1,0.1), lz), col_trees)
        c.scale = (1+random.uniform(-0.08,0.08), 1+random.uniform(-0.08,0.08), 0.76)
        c.data.materials.append(mat_leaves)

for i in range(30):
    angle = random.uniform(0, 2*math.pi)
    dist  = random.uniform(6, 22)
    x = math.cos(angle)*dist + random.uniform(-1.5, 1.5)
    y = math.sin(angle)*dist + random.uniform(-1.5, 1.5)
    h = random.uniform(3.0, 6.0)
    make_tree(f"Tree_{i:02d}", x, y, h, random.uniform(0.12,0.28), random.uniform(1.1,2.4))

# Rocks
for i in range(16):
    angle = random.uniform(0, 2*math.pi)
    dist  = random.uniform(4, 20)
    x, y  = math.cos(angle)*dist, math.sin(angle)*dist
    s = random.uniform(0.2, 0.7)
    rock = add_obj(f"Rock_{i:02d}", sphere_mesh(f"rock_{i}_me", s, 2),
                   (x, y, s*0.35), col_rocks)
    rock.scale = (random.uniform(0.8,1.2), random.uniform(0.6,1.0), random.uniform(0.35,0.6))
    rock.rotation_euler = (random.uniform(-0.2,0.2), random.uniform(-0.1,0.1), random.uniform(0,math.pi))
    rock.data.materials.append(mat_rock)

# Bouquet
random.seed(7)
def make_flower(idx, x, y, height, pm):
    stem = add_obj(f"Stem_{idx:02d}", cyl_mesh(f"stem_{idx}_me", 0.025, height, 6),
                   (x, y, height/2), col_bouquet)
    stem.data.materials.append(mat_stem)
    for p in range(6):
        a = p*(math.pi*2/6)
        px, py = x+math.cos(a)*0.11, y+math.sin(a)*0.11
        petal = add_obj(f"Petal_{idx:02d}_{p}", sphere_mesh(f"pet_{idx}_{p}_me", 0.08, 1),
                        (px, py, height+0.01), col_bouquet)
        petal.scale = (1.0, 0.4, 0.14)
        petal.rotation_euler = (0, 0, a)
        petal.data.materials.append(pm)
    center = add_obj(f"Center_{idx:02d}", sphere_mesh(f"ctr_{idx}_me", 0.065, 1),
                     (x, y, height+0.03), col_bouquet)
    center.scale = (1, 1, 0.45)
    center.data.materials.append(mat_center)
    la = random.uniform(0, math.pi*2)
    leaf = add_obj(f"Leaf_{idx:02d}", sphere_mesh(f"leaf_{idx}_me", 0.09, 1),
                   (x+math.cos(la)*0.08, y+math.sin(la)*0.08, height*0.5), col_bouquet)
    leaf.scale = (0.4, 1.1, 0.12)
    leaf.rotation_euler = (0, math.radians(25), la)
    leaf.data.materials.append(mat_stem)

for i in range(14):
    a = i*(math.pi*2/14)+random.uniform(-0.15,0.15)
    d = random.uniform(0.0, 0.55)
    x, y = math.cos(a)*d, math.sin(a)*d
    h = random.uniform(0.75, 1.25)
    make_flower(i, x, y, h, petal_mats[i % len(petal_mats)])

wrap = add_obj("BouquetWrap", cyl_mesh("wrap_me", 0.25, 0.4, 12), (0, 0, 0.2), col_bouquet)
wrap.data.materials.append(mat_wrap)

# Sun — warm late-afternoon
sun_data = bpy.data.lights.new("Sun", 'SUN')
sun_data.energy = 4.5
sun_data.angle  = math.radians(2.5)
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = (math.radians(55), 0, math.radians(215))
bpy.context.scene.collection.objects.link(sun)

# Fill light
fill_data = bpy.data.lights.new("FillLight", 'AREA')
fill_data.energy = 120; fill_data.size = 6.0
fill_data.color  = (0.8, 0.88, 1.0)
fill = bpy.data.objects.new("FillLight", fill_data)
fill.location = (-8, 6, 8)
fill.rotation_euler = (math.radians(50), 0, math.radians(-40))
bpy.context.scene.collection.objects.link(fill)

# Camera — 50mm, DoF on bouquet
cam_data = bpy.data.cameras.new("ForestCam")
cam_data.lens = 50
cam_data.dof.use_dof         = True
cam_data.dof.focus_distance  = 8.5
cam_data.dof.aperture_fstop = 2.8
cam = bpy.data.objects.new("ForestCam", cam_data)
cam.location = (5.5, -7.0, 3.2)
cam.rotation_euler = (math.radians(68), 0, math.radians(38))
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# Render settings
scene = bpy.context.scene
scene.render.engine        = 'CYCLES'
scene.cycles.samples       = 256
scene.cycles.use_denoising = True
scene.render.resolution_x  = 1920
scene.render.resolution_y  = 1080
scene.view_settings.look   = 'AgX - High Contrast'
scene.render.filepath      = "//forest_render.png"

bpy.ops.wm.save_as_mainfile(filepath="C:/dev/blender-kit/forest.blend")
print(f"DONE — {len(bpy.data.objects)} objects")
print(f"Trees:{len(col_trees.objects)} Rocks:{len(col_rocks.objects)} Grass:{len(col_grass.objects)} Bouquet:{len(col_bouquet.objects)}")
