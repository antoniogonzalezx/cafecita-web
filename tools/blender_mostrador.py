"""
Modela el servilletero de mostrador (caja baja y larga de inox cepillado con una ranura arriba
y dos extremos negros que hacen de patas) y lo exporta a GLB.

Uso (sin abrir Blender):
  blender -b -P servilletero/tools/blender_mostrador.py -- servilletero/models/mostrador.glb [preview.png]

Medidas en cm, iguales que las constantes del mostrador en main.js (MOSTRADOR: L, D, LIFT, TOP, CAP…).
En Blender: X = largo, Y = fondo, Z = alto. La ranura va en el centro de la tapa, a lo largo.
Materiales (main.js los sustituye por nombre): Inox = cepillado, Tapa = plástico negro mate.
Solo se modela el servilletero: la servilleta que asoma la pone la web porque se deforma.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(argv[0]) if argv else os.path.join(HERE, "..", "models", "mostrador.glb")
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

L = 22.0                     # largo total, de tapa a tapa
CAP = 2.0                    # grosor de cada extremo negro
INSERT = 0.4                 # lo que el inox se mete dentro de cada extremo
DB, HB, LIFT = 9.0, 6.0, 0.9  # fondo y alto del cuerpo de inox, y lo que lo levantan las patas
T = 0.1                      # grosor de chapa
R_BODY = 0.55                # cantos de la chapa doblada
TOP = LIFT + HB              # la tapa: aquí está la ranura
SLOT_L, SLOT_W, SLOT_R = 15.4, 0.8, 0.38
LIP = 0.35                   # la chapa de la ranura se dobla hacia dentro
DC, HC = 9.8, 7.3            # los extremos: algo más anchos y más altos que el cuerpo
CAP_R_TOP, CAP_R_BOT = 1.2, 0.3
FOOT, ARCH = 1.7, 0.5        # patas: el hueco de abajo entre una y otra
LB = L - 2 * CAP + 2 * INSERT

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
tapa = material("Tapa", (0.018, 0.018, 0.02), 0.0, 0.5)


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
    """Proyección cúbica a 1 UV por cm: el cepillado va siempre a lo largo."""
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


def rounded_rect(w, h, r_top, r_bot=None, seg=8):
    """Contorno de un rectángulo centrado con las esquinas de arriba y las de abajo redondeadas aparte."""
    r_bot = r_top if r_bot is None else r_bot
    pts = []
    for cx, cy, r, a0 in [(w / 2 - r_bot, -h / 2 + r_bot, r_bot, 1.5 * math.pi), (w / 2 - r_top, h / 2 - r_top, r_top, 0),
                          (-w / 2 + r_top, h / 2 - r_top, r_top, 0.5 * math.pi), (-w / 2 + r_bot, -h / 2 + r_bot, r_bot, math.pi)]:
        for i in range(seg + 1):
            a = a0 + (math.pi / 2) * i / seg
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def prism(name, pts, plane, a0, a1, mat):
    """Extruye un contorno 2D. plane='xy': contorno en XY y se extruye en Z; 'yz': contorno en YZ, en X."""
    bm = bmesh.new()
    if plane == "xy":
        f = bm.faces.new([bm.verts.new((u, v, a0)) for u, v in pts])
        move = (0, 0, a1 - a0)
    else:
        f = bm.faces.new([bm.verts.new((a0, u, v)) for u, v in pts])
        move = (a1 - a0, 0, 0)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=move, verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, mat)


def boolean(obj, other, op):
    mod = obj.modifiers.new(op.title(), "BOOLEAN")
    mod.operation = op
    mod.solver = "EXACT"
    mod.object = other
    apply_all(obj)
    bpy.data.objects.remove(other)


# ---------- Cuerpo: caja de chapa con los cantos redondeados ----------
body = rounded_box("Cuerpo", LB, DB, HB, (0, 0, LIFT + HB / 2), R_BODY, inox)
sol = body.modifiers.new("Chapa", "SOLIDIFY")
sol.thickness = T
sol.offset = -1
apply_all(body)

# la chapa de la ranura se dobla hacia dentro (como la boca del cubo): de lado se ve gruesa y redonda
lip = prism("Pestana", rounded_rect(SLOT_L + 2 * T, SLOT_W + 2 * T, SLOT_R + T), "xy", TOP - T / 2, TOP - T - LIP, inox)
boolean(body, lip, "UNION")
# la ranura atraviesa la tapa y la pestaña
boolean(body, prism("Ranura", rounded_rect(SLOT_L, SLOT_W, SLOT_R), "xy", TOP - 2, TOP + 1, inox), "DIFFERENCE")
# canto fino y brillante en el borde de la ranura
bev = body.modifiers.new("Canto", "BEVEL")
bev.width = 0.025
bev.segments = 2
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(50)
apply_all(body)
smooth(body, 30)
# normales ponderadas: la tapa y el frente se ven planos aunque el corte deje n-gonos
wn = body.modifiers.new("Normales", "WEIGHTED_NORMAL")
wn.keep_sharp = True
wn.weight = 100
apply_all(body)
cube_uv(body)
# en triángulos, para que el GLB lleve tangentes (el cepillado es anisótropo)
body.modifiers.new("Triangulos", "TRIANGULATE").keep_custom_normals = True
apply_all(body)

# ---------- Extremos negros (hacen de patas) ----------
for s in (1, -1):
    x_in, x_out = s * (L / 2 - CAP), s * L / 2
    cap = prism(f"Tapa{'D' if s > 0 else 'I'}", [(u, v + HC / 2) for u, v in rounded_rect(DC, HC, CAP_R_TOP, CAP_R_BOT)],
                "yz", min(x_in, x_out), max(x_in, x_out), tapa)
    # el hueco de abajo entre las dos patas
    arch_w = DC - 2 * FOOT
    arch = prism("Arco", [(u, v) for u, v in rounded_rect(arch_w, 2 * ARCH, 0.32)], "yz", min(x_in, x_out) - 1, max(x_in, x_out) + 1, tapa)
    boolean(cap, arch, "DIFFERENCE")
    # plástico moldeado: todos los cantos suaves
    bev = cap.modifiers.new("Molde", "BEVEL")
    bev.width = 0.2
    bev.segments = 5
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    apply_all(cap)
    smooth(cap, 35)
    wn = cap.modifiers.new("Normales", "WEIGHTED_NORMAL")
    wn.keep_sharp = True
    wn.weight = 100
    apply_all(cap)

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
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    world = bpy.data.worlds.new("Estudio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.6, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    scene.world = world
    for loc, size, energy in [((-22, 10, 22), (3, 34), 11000), ((24, -8, 16), (2, 28), 7000), ((0, -30, 32), (26, 4), 5000)]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        lt = bpy.context.active_object
        lt.data.shape = "RECTANGLE"
        lt.data.size, lt.data.size_y = size
        lt.data.energy = energy
        lt.rotation_euler = (Vector((0, 0, TOP / 2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200)
    bpy.context.active_object.is_shadow_catcher = True
    bpy.ops.object.camera_add(location=(30, -46, 26))
    cam = bpy.context.active_object
    cam.data.lens = 85
    target = bpy.data.objects.new("Objetivo", None)
    target.location = (0, 0, TOP * 0.45)
    scene.collection.objects.link(target)
    cam.constraints.new("TRACK_TO").target = target
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print(f"✓ Render {PREVIEW}")
