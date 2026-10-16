"""
Modela el servilletero de inox de doble cara y lo exporta a GLB para la web.

Uso (sin abrir Blender):
  blender -b -P servilletero/tools/blender_servilletero.py -- servilletero/models/servilletero.glb [preview.png]

Medidas en cm, iguales que las constantes de main.js (W, H, D, T, LIFT).
En Blender: X = ancho, Y = fondo (caras abiertas en ±Y), Z = alto.
Solo se modela el metal: las servilletas las pone la web porque se deforman.
"""
import math
import os
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(argv[0]) if argv else os.path.join(HERE, "..", "models", "servilletero.glb")
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

W, H, D, T, LIFT = 8.6, 11.0, 9.0, 0.08, 0.16
TAB_H, TAB_OUT, TAB_IN, TAB_TILT = 1.15, W - 1.25, W - 3.4, 0.25

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- Material ----------
inox = bpy.data.materials.new("Inox")
inox.use_nodes = True
bsdf = inox.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.82, 0.83, 0.85, 1)
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.32
for name in ("Anisotropic", "Anisotropy"):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = 0.5


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish(obj, bevel=0.03, segments=3, smooth_deg=35):
    """Bisela, aplica modificadores, suaviza y desenvuelve UVs."""
    obj.data.materials.clear()
    obj.data.materials.append(inox)
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    select_only(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_deg))
    except (AttributeError, RuntimeError):
        bpy.ops.object.shade_smooth()
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(smooth_deg)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66))
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def box(name, sx, sy, sz, loc, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return finish(obj, bevel)


# ---------- Carcasa: una chapa doblada (laterales, techo y base) ----------
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, LIFT + H / 2))
shell = bpy.context.active_object
shell.name = "Carcasa"
shell.scale = (W, D, H)
bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new()
bm.from_mesh(shell.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.y) > 0.9], context="FACES_ONLY")
bm.to_mesh(shell.data)
bm.free()
solid = shell.modifiers.new("Chapa", "SOLIDIFY")
solid.thickness = T * 2
solid.offset = -1
finish(shell, bevel=0.05, segments=4)

# ---------- Chapa central ----------
box("Central", W - 0.3, 0.05, H - 0.3, (0, 0, LIFT + H / 2), bevel=0.01)

# ---------- Patas ----------
for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)]):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.24, depth=LIFT,
                                        location=(sx * (W / 2 - 0.7), sy * (D / 2 - 0.7), LIFT / 2))
    bpy.context.active_object.name = f"Pata{i}"
    finish(bpy.context.active_object, bevel=0.04)


def tab(name, s, top):
    """Pestaña trapezoidal que sujeta las servilletas, doblada hacia dentro."""
    bm = bmesh.new()
    sign = -1 if top else 1  # la de arriba cuelga hacia abajo, la de abajo sube
    pts = [(-TAB_OUT / 2, 0), (TAB_OUT / 2, 0), (TAB_IN / 2, sign * TAB_H), (-TAB_IN / 2, sign * TAB_H)]
    verts = [bm.verts.new((x, 0, z)) for x, z in pts]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, s * 0.05, 0),
                        verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.location = (0, s * (D / 2 - 0.03), LIFT + (H - 0.02 if top else 0.02))
    # el borde libre se mete hacia dentro de la caja
    obj.rotation_euler.x = (-s if top else s) * TAB_TILT
    return finish(obj, bevel=0.02, segments=2)


# ---------- Cada cara abierta: pestañas laterales + superior + inferior ----------
for s in (1, -1):
    side = "A" if s > 0 else "B"
    for sx in (-1, 1):
        box(f"Lateral{side}{sx:+d}", 0.62, T * 2, H - 0.1,
            (sx * (W / 2 - 0.31), s * (D / 2 - T), LIFT + H / 2), bevel=0.03)
    tab(f"PestanaSup{side}", s, top=True)
    tab(f"PestanaInf{side}", s, top=False)

# ---------- Exportar ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True)
print(f"✓ Exportado {OUT}")

# ---------- Render de comprobación (opcional) ----------
if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.device = "CPU"
    scene.render.resolution_x = scene.render.resolution_y = 900
    world = bpy.data.worlds.new("Fondo")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.065, 0.9, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    bpy.ops.object.light_add(type="AREA", location=(-14, 10, 22))
    key = bpy.context.active_object
    key.data.energy = 9000
    key.data.size = 12
    key.rotation_euler = (math.radians(40), 0, math.radians(-125))
    bpy.ops.object.camera_add(location=(16, -30, 14))
    cam = bpy.context.active_object
    cam.data.lens = 70
    track = cam.constraints.new("TRACK_TO")
    target = bpy.data.objects.new("Objetivo", None)
    target.location = (0, 0, LIFT + H * 0.45)
    bpy.context.collection.objects.link(target)
    track.target = target
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print(f"✓ Render {PREVIEW}")
