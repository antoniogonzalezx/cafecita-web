"""
Modela el servilletero de bar (acero inoxidable, doble cara) y lo exporta a GLB para la web.

Uso (sin abrir Blender):
  blender -b -P servilletero/tools/blender_servilletero.py -- servilletero/models/servilletero.glb [preview.png]

Medidas en cm, iguales que las constantes de main.js (W, H, D, T, LIFT, LID, GAP, WIN_*).
En Blender: X = ancho, Y = fondo (caras abiertas en ±Y), Z = alto.
Materiales (main.js los sustituye por nombre): Inox = cepillado, Cromo = pulido,
Grabado = logo al ácido, Goma = patas.
Solo se modela el metal: las servilletas las pone la web porque se deforman.
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
FONT = os.path.join(HERE, "..", "..", "PRODUCT", "fonts", "BricolageGrotesque-Bold.ttf")

W, H, D, T, LIFT = 9.0, 12.6, 8.0, 0.1, 0.35
LID, GAP = 0.55, 0.05                     # tapa pulida y la junta que la separa del cuerpo
R_BODY, R_LID = 0.4, 0.28
WIN_SIDE, WIN_BOT, WIN_TOP, WIN_R = 0.55, 1.1, 1.2, 0.3
BODY_TOP = LIFT + H - LID - GAP

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if roughness > 0.15 and metallic and "Anisotropic" in b.inputs:
        b.inputs["Anisotropic"].default_value = 0.7
    return m


inox = material("Inox", (0.78, 0.79, 0.80), 1.0, 0.24)
cromo = material("Cromo", (0.92, 0.93, 0.94), 1.0, 0.04)
grabado = material("Grabado", (0.45, 0.46, 0.48), 1.0, 0.5)
goma = material("Goma", (0.02, 0.02, 0.022), 0.0, 0.6)


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


def cube_uv(obj):
    """Proyección cúbica a 1 UV por cm: el cepillado va siempre en horizontal."""
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def link(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    me.materials.append(mat)
    return obj


def rounded_box(name, sx, sy, sz, center, radius, mat, seg=8):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=radius, segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return link(name, bm, mat)


def rounded_rect(w, h, r, seg=8):
    pts = []
    for cx, cy, a0 in [(w / 2 - r, -h / 2 + r, 1.5 * math.pi), (w / 2 - r, h / 2 - r, 0),
                       (-w / 2 + r, h / 2 - r, 0.5 * math.pi), (-w / 2 + r, -h / 2 + r, math.pi)]:
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ---------- Cuerpo: caja de chapa con cantos redondeados ----------
body_h = BODY_TOP - LIFT
body = rounded_box("Cuerpo", W, D, body_h, (0, 0, LIFT + body_h / 2), R_BODY, inox)
sol = body.modifiers.new("Chapa", "SOLIDIFY")
sol.thickness = T
sol.offset = -1
apply_all(body)

# ventanas: un solo cortador atraviesa las dos caras
win_w, win_h = W - 2 * WIN_SIDE, body_h - WIN_BOT - WIN_TOP
win_zc = LIFT + WIN_BOT + win_h / 2
wpts = rounded_rect(win_w, win_h, WIN_R)
bm = bmesh.new()
wf = bm.faces.new([bm.verts.new((x, -D, win_zc + z)) for x, z in wpts])
ext = bmesh.ops.extrude_face_region(bm, geom=[wf])
bmesh.ops.translate(bm, vec=(0, 2 * D, 0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
cutter = link("Cortador", bm, inox)
boo = body.modifiers.new("Ventanas", "BOOLEAN")
boo.operation = "DIFFERENCE"
boo.solver = "EXACT"
boo.object = cutter
apply_all(body)
bpy.data.objects.remove(cutter)
smooth(body)
cube_uv(body)

# ---------- Tapa pulida, un pelo más ancha que el cuerpo ----------
lid = rounded_box("Tapa", W + 0.12, D + 0.12, LID, (0, 0, LIFT + H - LID / 2), R_LID, cromo)
smooth(lid)

# ---------- Junta oscura entre cuerpo y tapa ----------
junta = rounded_box("Junta", W - 0.3, D - 0.3, GAP + 0.1, (0, 0, BODY_TOP + GAP / 2), 0.2, grabado, seg=3)

# ---------- Borde enrollado y pulido alrededor de cada ventana ----------
for s in (1, -1):
    cu = bpy.data.curves.new(f"Borde{s:+d}", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(wpts) - 1)
    for p, (x, z) in zip(sp.points, wpts):
        p.co = (x, s * (D / 2 - T / 2), win_zc + z, 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = 0.08
    cu.bevel_resolution = 4
    ob = bpy.data.objects.new(f"Borde{'A' if s > 0 else 'B'}", cu)
    scene.collection.objects.link(ob)
    select_only(ob)
    bpy.ops.object.convert(target="MESH")
    ob.data.materials.append(cromo)
    smooth(ob, 60)

# ---------- Chapa central (el muelle que empuja los tacos) ----------
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(W - 0.5, 0.05, body_h - 0.4), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0, LIFT + body_h / 2), verts=bm.verts)
link("Central", bm, inox)

# ---------- Logo grabado en los laterales ----------
font = bpy.data.fonts.load(os.path.abspath(FONT)) if os.path.exists(FONT) else None
for sx in (1, -1):
    tc = bpy.data.curves.new(f"Logo{sx:+d}", "FONT")
    tc.body = "CAFECITA"
    if font:
        tc.font = font
    tc.size = 0.78
    tc.space_character = 1.12
    tc.align_x = "CENTER"
    tc.align_y = "CENTER"
    ob = bpy.data.objects.new(f"Logo{'D' if sx > 0 else 'I'}", tc)
    scene.collection.objects.link(ob)
    ob.location = (sx * (W / 2 + 0.003), 0, LIFT + body_h * 0.5)
    ob.rotation_euler = (math.radians(90), 0, math.radians(90 * sx))
    select_only(ob)
    bpy.ops.object.convert(target="MESH")
    ob.data.materials.append(grabado)

# ---------- Patas de goma ----------
for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.4, depth=LIFT + 0.05,
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
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True,
                          export_tangents=True)
print(f"✓ Exportado {OUT}")

# ---------- Render de comprobación (opcional) ----------
if PREVIEW:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = 800, 1000
    world = bpy.data.worlds.new("Estudio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.6, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    scene.world = world
    for loc, size, energy in [((-18, 8, 20), (3, 30), 9000), ((20, -6, 14), (2, 24), 6000), ((0, -26, 30), (20, 4), 4000)]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        lt = bpy.context.active_object
        lt.data.shape = "RECTANGLE"
        lt.data.size, lt.data.size_y = size
        lt.data.energy = energy
        lt.rotation_euler = (Vector((0, 0, LIFT + H / 2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200)
    bpy.context.active_object.is_shadow_catcher = True
    bpy.ops.object.camera_add(location=(24, -32, 15))
    cam = bpy.context.active_object
    cam.data.lens = 85
    target = bpy.data.objects.new("Objetivo", None)
    target.location = (0, 0, LIFT + H * 0.48)
    scene.collection.objects.link(target)
    cam.constraints.new("TRACK_TO").target = target
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print(f"✓ Render {PREVIEW}")
