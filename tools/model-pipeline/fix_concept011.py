"""Repairs "Free Concept Car 011" (Sketchfab, CC0) for DriveDeck and exports a clean GLB.

The Sketchfab download has a broken door rig (doors lie rotated under the car), ~200 loose parts
and a right tyre parented under the left wheel. This script:

- puts the doors back into their openings and drops the armature,
- joins all parts into body, four wheels and two doors (few draw calls on the T-Box GPU),
- assigns wheel parts to the nearest hub by position,
- decimates for the Snapdragon 665,
- wraps wheels and doors in pivot empties at hub and hinge, so later mesh compression
  (which moves mesh node transforms) can never shift a pivot.

Usage:
    Blender -b --python fix_concept011.py -- <input.glb> <output.glb> [preview_prefix]
"""
import math
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SOURCE, TARGET = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None

WHEELS = {
    "Empty_FL_Wheels": "wheel-front-left",
    "Empty_FR_Wheels": "wheel-front-right",
    "Empty_FL_Wheels.001": "wheel-back-left",
    "Empty_FR_Wheels.001": "wheel-back-right",
}
WHEEL_ROOTS = ("Empty_frontWheels", "Empty_rearWheels")
DECIMATE = {"body": 0.3, "door-left": 0.4, "door-right": 0.4}
DECIMATE_DEFAULT = 0.4

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SOURCE)


def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return (Vector([min(p[i] for p in pts) for i in range(3)]),
            Vector([max(p[i] for p in pts) for i in range(3)]))


def unparent(o):
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw


def descendants(o):
    out = []
    for c in o.children:
        out.append(c)
        out.extend(descendants(c))
    return out


def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        if o.data.users > 1:
            o.data = o.data.copy()
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


# Doors: skinned to an armature whose exported rest pose is rotated by -90 degrees about X.
doors = []
for o in scene.objects:
    if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers):
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            o.modifiers.remove(m)
        doors.append(o)
for o in doors:
    unparent(o)
for o in [o for o in scene.objects if o.type == 'ARMATURE']:
    bpy.data.objects.remove(o, do_unlink=True)

fix = Matrix.Rotation(math.radians(90), 4, 'X')
for o in doors:
    o.matrix_world = fix @ o.matrix_world

left_parts = [o for o in doors if (bbox([o])[0].x + bbox([o])[1].x) > 0]
right_parts = [o for o in doors if o not in left_parts]
hinges = {}
for parts, name in ((left_parts, "door-left"), (right_parts, "door-right")):
    door = join(parts, name)
    lo, hi = bbox([door])
    # scissor hinge: front edge of the door (the nose is towards -y), a third up the door
    hinges[name] = Vector(((lo.x + hi.x) / 2, lo.y + 0.05, lo.z + (hi.z - lo.z) * 0.35))

for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# Wheels: assign parts to the nearest hub, the source hierarchy mixes up one tyre.
hubs = {name: scene.objects[src].matrix_world.translation.copy() for src, name in WHEELS.items()}
wheel_parts = {name: [] for name in hubs}
roots = [scene.objects[n] for n in WHEEL_ROOTS]
for root in roots:
    for o in descendants(root):
        if o.type == 'MESH':
            lo, hi = bbox([o])
            centre = (lo + hi) / 2
            wheel_parts[min(hubs, key=lambda n: (hubs[n] - centre).length)].append(o)
for root in roots:
    for o in descendants(root):
        unparent(o)
for o in roots + [scene.objects[src] for src in WHEELS]:
    bpy.data.objects.remove(o, do_unlink=True)
for name, parts in wheel_parts.items():
    join(parts, name)

# Body: everything else. Helper geometry without materials is not part of the visible car.
keep = set(hubs) | set(hinges)
rest = [o for o in scene.objects if o.type == 'MESH' and o.name not in keep and len(o.data.polygons)]
for o in rest:
    unparent(o)
join(rest, "body")
for o in [o for o in scene.objects
          if o.type != 'MESH' or not len(o.data.polygons) or not len(o.data.materials)]:
    bpy.data.objects.remove(o, do_unlink=True)

# Decimate, then rebuild normals so the paint stays smooth.
total = 0
for o in list(scene.objects):
    select_only(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mod = o.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = DECIMATE.get(o.name, DECIMATE_DEFAULT)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="Decimate")
    if o.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    total += sum(len(p.vertices) - 2 for p in o.data.polygons)
print("TRIANGLES", total)

# Pivot empties: the app rotates these, the meshes hang below them.
pivots = dict(hubs)
pivots.update(hinges)
for name, pivot in pivots.items():
    mesh_obj = scene.objects[name]
    mesh_obj.name = name + "-mesh"
    empty = bpy.data.objects.new(name, None)
    empty.location = pivot
    scene.collection.objects.link(empty)
    bpy.context.view_layer.update()
    mw = mesh_obj.matrix_world.copy()
    mesh_obj.parent = empty
    mesh_obj.matrix_world = mw
print("PIVOTS", {k: [round(c, 2) for c in v] for k, v in pivots.items()})

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=TARGET, export_format='GLB', export_apply=True, export_animations=False)

if PREVIEW:
    import os
    hdri = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../app/src/main/assets/web/env/studio.hdr")
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri)
    world.node_tree.links.new(env.outputs["Color"], world.node_tree.nodes["Background"].inputs["Color"])
    scene.world = world
    meshes = [o for o in scene.objects if o.type == 'MESH']
    lo, hi = bbox(meshes)
    centre, size = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.location = centre + Vector((0.8, -0.55, 0.3)) * size
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 640, 360
    for state, angle in (("closed", 0), ("open", 70)):
        for door in hinges:
            scene.objects[door].rotation_euler = (math.radians(angle), 0, 0)
        scene.render.filepath = f"{PREVIEW}_{state}.png"
        bpy.ops.render.render(write_still=True)
