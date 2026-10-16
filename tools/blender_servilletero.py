"""
Modela el servilletero de bar cromado (doble cara) y lo exporta a GLB para la web.

Uso (sin abrir Blender):
  blender -b -P servilletero/tools/blender_servilletero.py -- servilletero/models/servilletero.glb [preview.png]

Medidas en cm, iguales que las constantes de main.js (W, H, D, LIFT, WIN_*).
En Blender: X = ancho, Y = fondo (caras abiertas en ±Y), Z = alto.
Solo se modela el metal y las gomas: las servilletas las pone la web porque se deforman.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(argv[0]) if argv else os.path.join(HERE, "..", "models", "servilletero.glb")
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

W, H, D, T, LIFT = 8.6, 12.6, 8.4, 0.1, 0.35
R_TOP, R_BOT, R_RIM = 2.1, 0.35, 0.42     # radios: lomo superior, base, canto lateral
WIN_SIDE, WIN_BOT, WIN_TOP = 0.45, 1.05, 2.05  # marco que sujeta la servilleta
WIN_R = 0.35

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    return m


inox = material("Inox", (0.86, 0.87, 0.89), 1.0, 0.12)
goma = material("Goma", (0.025, 0.025, 0.028), 0.0, 0.55)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_all(obj):
    select_only(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def smooth(obj, deg=40):
    select_only(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))


def link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj


def rounded_rect(w, h, radii, seg=12):
    """Contorno 2D centrado; radii = (abajo-izq, abajo-der, arriba-der, arriba-izq)."""
    corners = [(-w / 2, -h / 2, math.pi), (w / 2, -h / 2, 1.5 * math.pi),
               (w / 2, h / 2, 0), (-w / 2, h / 2, 0.5 * math.pi)]
    pts = []
    for (cx, cy, a0), r in zip(corners, radii):
        sx = 1 if cx > 0 else -1
        sy = 1 if cy > 0 else -1
        ox, oy = cx - sx * r, cy - sy * r
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


# ---------- Carcasa: perfil con lomo redondeado, extruido a lo ancho ----------
bm = bmesh.new()
prof = rounded_rect(D, H, (R_BOT, R_BOT, R_TOP, R_TOP), seg=14)
verts = [bm.verts.new((-W / 2, y, LIFT + H / 2 + z)) for y, z in prof]
cap = bm.faces.new(verts)
ext = bmesh.ops.extrude_face_region(bm, geom=[cap])
bmesh.ops.translate(bm, vec=(W, 0, 0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
rim = [e for e in bm.edges if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-4
       and abs(abs(e.verts[0].co.x) - W / 2) < 1e-4]
bmesh.ops.bevel(bm, geom=rim, offset=R_RIM, segments=8, profile=0.5, affect="EDGES", clamp_overlap=True)
shell = link("Carcasa", bm)
shell.data.materials.append(inox)
sol = shell.modifiers.new("Chapa", "SOLIDIFY")
sol.thickness = T
sol.offset = -1
apply_all(shell)

# ventanas: un solo cortador atraviesa las dos caras
win_w, win_h = W - 2 * WIN_SIDE, H - WIN_BOT - WIN_TOP
win_zc = LIFT + WIN_BOT + win_h / 2
bm = bmesh.new()
wpts = rounded_rect(win_w, win_h, (WIN_R,) * 4, seg=8)
wv = [bm.verts.new((x, -D, win_zc + z)) for x, z in wpts]
wf = bm.faces.new(wv)
ext = bmesh.ops.extrude_face_region(bm, geom=[wf])
bmesh.ops.translate(bm, vec=(0, 2 * D, 0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
cutter = link("Cortador", bm)
boo = shell.modifiers.new("Ventanas", "BOOLEAN")
boo.operation = "DIFFERENCE"
boo.solver = "EXACT"
boo.object = cutter
apply_all(shell)
bpy.data.objects.remove(cutter)
smooth(shell)

# ---------- Borde enrollado alrededor de cada ventana ----------
for s in (1, -1):
    cu = bpy.data.curves.new(f"Borde{s:+d}", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(wpts) - 1)
    for p, (x, z) in zip(sp.points, wpts):
        p.co = (x, s * (D / 2 - T / 2), win_zc + z, 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = 0.075
    cu.bevel_resolution = 4
    ob = bpy.data.objects.new(f"Borde{'A' if s > 0 else 'B'}", cu)
    scene.collection.objects.link(ob)
    select_only(ob)
    bpy.ops.object.convert(target="MESH")
    ob.data.materials.append(inox)
    smooth(ob, 60)

# ---------- Chapa central (empuja los tacos contra las ventanas) ----------
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(W - 0.4, 0.05, H - 0.5), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0, LIFT + H / 2), verts=bm.verts)
central = link("Central", bm)
central.data.materials.append(inox)

# ---------- Gomas negras ----------
for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.38, depth=LIFT + 0.05,
                                        location=(sx * (W / 2 - 0.9), sy * (D / 2 - 0.9), (LIFT + 0.05) / 2))
    pata = bpy.context.active_object
    pata.name = f"Goma{i}"
    pata.data.materials.append(goma)
    bev = pata.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.12
    bev.segments = 4
    apply_all(pata)
    smooth(pata, 50)

# ---------- Exportar ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True)
print(f"✓ Exportado {OUT}")

# ---------- Render de comprobación (opcional) ----------
if PREVIEW:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = 800, 1000
    world = bpy.data.worlds.new("Estudio")
    world.use_nodes = True
    nt = world.node_tree
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "LINEAR"
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, math.radians(-90), 0)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.04, 0.05, 0.75, 1)
    ramp.color_ramp.elements[1].color = (0.95, 0.95, 0.97, 1)
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], nt.nodes["Background"].inputs[0])
    scene.world = world
    for loc, size, energy in [((-18, 8, 20), (6, 30), 6000), ((20, -6, 14), (5, 24), 4000), ((0, -26, 30), (20, 6), 3000)]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        lt = bpy.context.active_object
        lt.data.shape = "RECTANGLE"
        lt.data.size, lt.data.size_y = size
        lt.data.energy = energy
        lt.rotation_euler = (Vector((0, 0, LIFT + H / 2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.active_object
    floor.is_shadow_catcher = True
    bpy.ops.object.camera_add(location=(22, -34, 16))
    cam = bpy.context.active_object
    cam.data.lens = 85
    target = bpy.data.objects.new("Objetivo", None)
    target.location = (0, 0, LIFT + H * 0.48)
    scene.collection.objects.link(target)
    cam.constraints.new("TRACK_TO").target = target
    scene.camera = cam
    scene.render.film_transparent = False
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print(f"✓ Render {PREVIEW}")
