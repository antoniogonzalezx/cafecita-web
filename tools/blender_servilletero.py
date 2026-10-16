"""
Modela el servilletero de bar (cubo de acero inoxidable cepillado, doble cara) y lo exporta a GLB.

Uso (sin abrir Blender):
  blender -b -P servilletero/tools/blender_servilletero.py -- servilletero/models/servilletero.glb [preview.png]

Medidas en cm, iguales que las constantes de main.js (W, H, D, T, LIFT, FLANGE, WIN_*).
En Blender: X = ancho, Y = fondo (caras abiertas en ±Y), Z = alto.
Materiales (main.js los sustituye por nombre): Inox = cepillado, Goma = patas.
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

W, H, D, T, LIFT = 9.0, 11.8, 8.4, 0.1, 0.25
R_BODY = 0.14                              # cantos casi vivos, de chapa doblada
FLANGE = 0.3                               # la chapa de la boca se dobla hacia dentro
WIN_SIDE, WIN_BOT, WIN_TOP, WIN_R = 0.6, 1.0, 1.1, 0.06
BODY_TOP = LIFT + H

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

win_w, win_h = W - 2 * WIN_SIDE, body_h - WIN_BOT - WIN_TOP
win_zc = LIFT + WIN_BOT + win_h / 2
wpts = rounded_rect(win_w, win_h, WIN_R)


def prism(name, pts, y0, y1):
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y0, win_zc + z)) for x, z in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, y1 - y0, 0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, inox)


# pestaña: la chapa de la boca se dobla hacia dentro (se une y luego se vacía con la ventana)
fpts = rounded_rect(win_w + 2 * T, win_h + 2 * T, WIN_R + T)
for s in (1, -1):
    fl = prism("Pestana", fpts, s * (D / 2 - T / 2), s * (D / 2 - T - FLANGE))
    uni = body.modifiers.new("Pestana", "BOOLEAN")
    uni.operation = "UNION"
    uni.solver = "EXACT"
    uni.object = fl
    apply_all(body)
    bpy.data.objects.remove(fl)

# ventanas: un solo cortador atraviesa las dos caras
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
# canto fino y brillante en el borde de la boca
bev = body.modifiers.new("Canto", "BEVEL")
bev.width = 0.02
bev.segments = 2
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(50)
apply_all(body)
smooth(body, 30)
# normales ponderadas: las caras planas grandes se ven planas aunque el corte deje n-gonos
wn = body.modifiers.new("Normales", "WEIGHTED_NORMAL")
wn.keep_sharp = True
wn.weight = 100
apply_all(body)
cube_uv(body)

# ---------- Chapa central (el muelle que empuja los tacos) ----------
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(W - 0.5, 0.05, body_h - 0.4), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0, LIFT + body_h / 2), verts=bm.verts)
link("Central", bm, inox)

# ---------- Patas de goma ----------
for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.32, depth=LIFT + 0.05,
                                        location=(sx * (W / 2 - 0.8), sy * (D / 2 - 0.8), (LIFT + 0.05) / 2))
    pata = bpy.context.active_object
    pata.name = f"Goma{i}"
    pata.data.materials.append(goma)
    bev = pata.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.08
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
