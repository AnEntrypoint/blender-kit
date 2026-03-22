
import bpy, math, random, bmesh

random.seed(99)

# ── helpers ───────────────────────────────────────────────────────────────────
def active(): return bpy.context.view_layer.objects.active

def nodes(mat):
    return mat.node_tree.nodes

def links(mat):
    return mat.node_tree.links

def get_node(mat, label):
    return mat.node_tree.nodes.get(label)

def set_bsdf(mat, slot, value):
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs[slot].default_value = value

# ── upgrade world sky ─────────────────────────────────────────────────────────
world = bpy.context.scene.world
wt = world.node_tree
sky = next((n for n in wt.nodes if n.type == 'TEX_SKY'), None)
bg  = next((n for n in wt.nodes if n.type == 'BACKGROUND'), None)
if sky:
    sky.sky_type      = 'HOSEK_WILKIE'
    sky.turbidity     = 2.5
    sky.ground_albedo = 0.35
    # Warm late-afternoon sun angle
    az = math.radians(220)
    el = math.radians(22)
    sky.sun_direction = (math.cos(el)*math.sin(az), math.cos(el)*math.cos(az), math.sin(el))
if bg:
    bg.inputs["Strength"].default_value = 1.4

# ── upgrade materials ─────────────────────────────────────────────────────────

def upgrade_mat_bark():
    mat = bpy.data.materials.get("Bark")
    if not mat: return
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    # Bump from noise
    noise = t.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.7
    bump = t.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.04
    t.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    t.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Base Color"].default_value = (0.20, 0.12, 0.06, 1)

def upgrade_mat_leaves():
    mat = bpy.data.materials.get("Leaves")
    if not mat: return
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (0.06, 0.28, 0.04, 1)
    bsdf.inputs["Roughness"].default_value = 0.75
    bsdf.inputs["Subsurface Weight"].default_value = 0.18
    bsdf.inputs["Subsurface Radius"].default_value = (0.4, 0.8, 0.2)
    # Slight color variation via noise
    noise = t.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 5.0
    noise.inputs["Detail"].default_value = 4.0
    mix = t.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Fac"].default_value = 0.25
    mix.inputs[2].default_value = (0.12, 0.42, 0.06, 1)
    t.links.new(noise.outputs["Color"], mix.inputs[1])
    base_col = bsdf.inputs["Base Color"]
    t.links.new(mix.outputs["Color"], base_col)

def upgrade_mat_ground():
    mat = bpy.data.materials.get("Ground")
    if not mat: return
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (0.12, 0.20, 0.07, 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    noise = t.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.5
    noise.inputs["Detail"].default_value = 10.0
    noise.inputs["Roughness"].default_value = 0.8
    bump = t.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    bump.inputs["Distance"].default_value = 0.06
    t.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    t.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

def upgrade_mat_rock():
    mat = bpy.data.materials.get("Rock")
    if not mat: return
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (0.32, 0.30, 0.26, 1)
    bsdf.inputs["Roughness"].default_value = 0.92
    noise = t.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 12.0
    noise.inputs["Detail"].default_value = 8.0
    bump = t.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    bump.inputs["Distance"].default_value = 0.03
    t.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    t.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

upgrade_mat_bark()
upgrade_mat_leaves()
upgrade_mat_ground()
upgrade_mat_rock()

# ── replace grass objects with GN scatter on ground ───────────────────────────
# Delete old grass objects
col_grass = bpy.data.collections.get("Grass")
if col_grass:
    for obj in list(col_grass.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

# Create a single blade mesh to instance
bm = bmesh.new()
# Simple tapered blade: 3 verts tall
verts = [bm.verts.new(v) for v in [(-0.02,0,0),(0.02,0,0),(0.0,0,0.28),(0.0,0.02,0.18)]]
bm.faces.new([verts[0],verts[1],verts[2]])
bm.faces.new([verts[0],verts[3],verts[2]])
blade_me = bpy.data.meshes.new("GrassBlade")
bm.to_mesh(blade_me); bm.free()

mat_blade = bpy.data.materials.get("GrassA")
if not mat_blade:
    mat_blade = bpy.data.materials.new("GrassA")
    mat_blade.use_nodes = True
    bsdf = mat_blade.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.08, 0.26, 0.05, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
else:
    bsdf = next(n for n in mat_blade.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs["Base Color"].default_value = (0.08, 0.26, 0.05, 1)
blade_me.materials.append(mat_blade)

blade_obj = bpy.data.objects.new("GrassBlade", blade_me)
bpy.context.scene.collection.objects.link(blade_obj)
blade_obj.hide_render = True
blade_obj.hide_viewport = True

# GN scatter modifier on ground
ground = bpy.data.objects.get("Ground")
mod = ground.modifiers.new("GrassScatter", 'NODES')
ng = bpy.data.node_groups.new("GrassScatter", "GeometryNodeTree")
mod.node_group = ng

# Build node graph
t = ng
# Interface
t.interface.new_socket("Geometry", in_out='INPUT',  socket_type='NodeSocketGeometry')
t.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
density_sock = t.interface.new_socket("Density", in_out='INPUT', socket_type='NodeSocketFloat')
density_sock.default_value = 8.0

n_in   = t.nodes.new("NodeGroupInput")
n_out  = t.nodes.new("NodeGroupOutput")
n_dist = t.nodes.new("GeometryNodeDistributePointsOnFaces")
n_inst = t.nodes.new("GeometryNodeInstanceOnPoints")
n_obj  = t.nodes.new("GeometryNodeObjectInfo")
n_rz   = t.nodes.new("GeometryNodeRotateInstances") if hasattr(bpy.types, 'GeometryNodeRotateInstances') else None
n_real = t.nodes.new("GeometryNodeRealizeInstances")
n_join = t.nodes.new("GeometryNodeJoinGeometry")
n_rand_r = t.nodes.new("FunctionNodeRandomValue")
n_rand_s = t.nodes.new("FunctionNodeRandomValue")

n_dist.distribute_method = 'RANDOM'
n_obj.inputs["Object"].default_value = blade_obj
n_rand_r.data_type = 'FLOAT_VECTOR'
n_rand_r.inputs["Min"].default_value = (0, 0, 0)
n_rand_r.inputs["Max"].default_value = (0, 0, math.pi * 2)
n_rand_s.data_type = 'FLOAT_VECTOR'
n_rand_s.inputs["Min"].default_value = (0.6, 0.6, 0.8)
n_rand_s.inputs["Max"].default_value = (1.3, 1.3, 1.6)

t.links.new(n_in.outputs["Geometry"], n_dist.inputs["Mesh"])
t.links.new(n_in.outputs["Density"],  n_dist.inputs["Density"])
t.links.new(n_dist.outputs["Points"], n_inst.inputs["Points"])
t.links.new(n_obj.outputs["Geometry"], n_inst.inputs["Instance"])
t.links.new(n_rand_r.outputs["Value"], n_inst.inputs["Rotation"])
t.links.new(n_rand_s.outputs["Value"], n_inst.inputs["Scale"])
t.links.new(n_inst.outputs["Instances"], n_real.inputs["Geometry"])
t.links.new(n_in.outputs["Geometry"],  n_join.inputs["Geometry"])
t.links.new(n_real.outputs["Geometry"], n_join.inputs["Geometry"])
t.links.new(n_join.outputs["Geometry"], n_out.inputs["Geometry"])
print("GN grass scatter: ok")

# ── lighting overhaul ─────────────────────────────────────────────────────────
# Remove existing lights
for obj in [o for o in bpy.data.objects if o.type == 'LIGHT']:
    bpy.data.objects.remove(obj, do_unlink=True)

# Key: warm sun, low angle
sun_d = bpy.data.lights.new("Sun", 'SUN')
sun_d.energy = 5.0
sun_d.angle  = math.radians(3.0)
sun_d.color  = (1.0, 0.92, 0.78)
sun = bpy.data.objects.new("Sun", sun_d)
sun.rotation_euler = (math.radians(52), 0, math.radians(220))
bpy.context.scene.collection.objects.link(sun)

# Fill: cool sky bounce
fill_d = bpy.data.lights.new("SkyFill", 'AREA')
fill_d.energy = 80
fill_d.size   = 8.0
fill_d.color  = (0.72, 0.84, 1.0)
fill = bpy.data.objects.new("SkyFill", fill_d)
fill.location = (-10, 8, 12)
fill.rotation_euler = (math.radians(42), 0, math.radians(-50))
bpy.context.scene.collection.objects.link(fill)

# Rim: warm back light to separate trees from sky
rim_d = bpy.data.lights.new("RimLight", 'SUN')
rim_d.energy = 1.2
rim_d.angle  = math.radians(8.0)
rim_d.color  = (1.0, 0.85, 0.6)
rim = bpy.data.objects.new("RimLight", rim_d)
rim.rotation_euler = (math.radians(75), 0, math.radians(40))
bpy.context.scene.collection.objects.link(rim)

# ── camera: cinematic framing low through the forest toward bouquet ────────────
cam = bpy.context.scene.camera
cam.location = (3.8, -5.5, 1.6)
cam.rotation_euler = (math.radians(82), 0, math.radians(34))
cam.data.lens = 85
cam.data.dof.use_dof          = True
cam.data.dof.focus_distance   = 6.2
cam.data.dof.aperture_fstop  = 1.8

# ── render: quality pass ──────────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine           = 'CYCLES'
scene.cycles.samples          = 512
scene.cycles.use_denoising    = True
scene.cycles.denoiser         = 'OPENIMAGEDENOISE'
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.render.resolution_x     = 1920
scene.render.resolution_y     = 1080
scene.view_settings.look      = 'AgX - High Contrast'
scene.view_settings.exposure  = 0.3
scene.render.filepath         = "//forest_render.png"

# Mist / depth fog
scene.world.mist_settings.use_mist  = True
scene.world.mist_settings.start     = 8.0
scene.world.mist_settings.depth     = 35.0
scene.world.mist_settings.falloff   = 'QUADRATIC'

bpy.ops.wm.save_as_mainfile(filepath="C:/dev/blender-kit/forest.blend")
print("Polish complete")
print("Lights:", [o.name for o in bpy.data.objects if o.type=='LIGHT'])
print("Cam lens:", cam.data.lens, "f/", cam.data.dof.aperture_fstop)
