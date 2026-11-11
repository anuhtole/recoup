"""Recoup particle coin: Blender designs the shapes, the browser plays them.

Builds the coin (raised rim, chamfered edge) and the raised R from the brand mark, scatters a fixed
set of points over them, and exports that same set of points in five poses:

  coin     the resting coin
  burst    every point thrown outward (found money; idle breathing and pulses use a small share of it)
  swirl    the R and the face as they are, the rim gathered into three streaks around the coin, which
           the browser spins (thinking)
  scatter  a loose cloud (the half-way point between coin and ring)
  ring     the points laid on a ring, ready to fuse into the solid ring the browser draws

Run:   blender -b --factory-startup --python coin_poses.py
Add `-- --save` to also keep coin.blend next to this file for a look at the model.
Writes coin-poses.bin (Int16 x,y,z per point, pose after pose) and coin-poses.json into
src/components/coin, next to the engine.
Timing lives in the browser on purpose: changing how long a state takes should not need a re-export.
"""

import json
import math
import re
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "src" / "components" / "coin"  # next to the engine that plays them
SEED = 7
rng = np.random.default_rng(SEED)

# Coin proportions: the same numbers as the coin mock-ups (coins.mjs).
H = 0.07  # half thickness
RIM = 0.035  # how far the rim stands proud of the face
FACE_R = 0.86  # where the flat face ends and the rim starts
MARK = (
    "M58 46H134C158 46 174 64 174 86C174 104 163 119 144 125L174.5 155.5L178 152L184 194L142 188"
    "L154 176L86 108V164H58ZM86 72H132C141 72 148 78 148 86C148 94 141 100 132 100H86Z"
)
MARK_SCALE = 0.0062  # 240-unit artboard to coin units
MARK_DEPTH = 0.05

# Points per group. The order in the file is mark, face, rim; the browser relies on it.
COUNTS = {"mark": 2600, "face": 1100, "rim": 2600}
RING = {"radius": 0.78, "tube": 0.07}
# Thinking: the rim gathers into streaks that sit around the coin, and the browser spins them clockwise.
# arms: how many streaks. bunch: how strongly points gather at a streak's head (1 = spread evenly).
# fill: the share of its part of the circle a streak covers. radius: where the heads sit.
# pull_in: how far the tail falls in toward the coin. head, tail: the streak's width at each end.
# lift: how far the head spreads in depth.
SWIRL = {"arms": 3, "bunch": 2.2, "fill": 0.94, "radius": 1.05, "pull_in": 0.03, "head": 0.032, "tail": 0.012, "lift": 0.04}


def build_coin():
    """Lathe the coin's profile around Z, so the face looks down +Z like the browser's camera."""
    profile = [
        (0.0, H), (FACE_R, H), (0.9, H + RIM), (0.975, H + RIM), (1.0, H),
        (1.0, -H), (0.975, -H - RIM), (0.9, -H - RIM), (FACE_R, -H), (0.0, -H),
    ]
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new(pair) for pair in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=128)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    mesh = bpy.data.meshes.new("coin")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("coin", mesh)
    bpy.context.collection.objects.link(obj)
    bevel = obj.modifiers.new("soften", "BEVEL")
    bevel.width = 0.008
    bevel.segments = 3
    bevel.limit_method = "ANGLE"
    return obj


def mark_outlines(steps=14):
    """The brand mark's SVG path as closed outlines (only M, H, V, L, C and Z appear in it)."""
    tokens = re.findall(r"[MHVLCZ]|-?\d+\.?\d*", MARK)
    loops, loop, i, x, y = [], [], 0, 0.0, 0.0
    num = lambda k: float(tokens[k])
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd == "M":
            x, y = num(i), num(i + 1)
            i += 2
            loop = [(x, y)]
        elif cmd == "H":
            x = num(i)
            i += 1
            loop.append((x, y))
        elif cmd == "V":
            y = num(i)
            i += 1
            loop.append((x, y))
        elif cmd == "L":
            x, y = num(i), num(i + 1)
            i += 2
            loop.append((x, y))
        elif cmd == "C":
            (x1, y1), (x2, y2), (x3, y3) = [(num(i + k), num(i + k + 1)) for k in (0, 2, 4)]
            i += 6
            for s in range(1, steps + 1):
                t = s / steps
                a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t**3
                loop.append((a * x + b * x1 + c * x2 + d * x3, a * y + b * y1 + c * y2 + d * y3))
            x, y = x3, y3
        elif cmd == "Z":
            loops.append(loop)
            loop = []
    return loops


def build_mark():
    """The R as a filled, extruded curve sitting on the coin's face."""
    curve = bpy.data.curves.new("mark", "CURVE")
    curve.dimensions = "2D"
    curve.fill_mode = "BOTH"
    curve.extrude = MARK_DEPTH / 2
    for loop in mark_outlines():
        spline = curve.splines.new("POLY")
        spline.points.add(len(loop) - 1)
        for point, (x, y) in zip(spline.points, loop):
            point.co = ((x - 120) * MARK_SCALE, (120 - y) * MARK_SCALE, 0.0, 1.0)
        spline.use_cyclic_u = True
    obj = bpy.data.objects.new("mark", curve)
    obj.location.z = H + MARK_DEPTH / 2
    bpy.context.collection.objects.link(obj)
    return obj


def triangles(obj):
    """World-space triangles of the object as Blender evaluates it (modifiers and curve fill applied)."""
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    world = np.array(obj.matrix_world, dtype=np.float64)
    tri = np.array([[v.co[:] for v in f.verts] for f in bm.faces], dtype=np.float64)
    bm.free()
    evaluated.to_mesh_clear()
    return tri @ world[:3, :3].T + world[:3, 3]


def sample(tri, n):
    """n points spread evenly over the triangles (bigger triangles get more points)."""
    area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    pick = rng.choice(len(tri), n, p=area / area.sum())
    u = rng.random((n, 2))
    flip = u.sum(1) > 1
    u[flip] = 1 - u[flip]
    return tri[pick, 0] + (tri[pick, 1] - tri[pick, 0]) * u[:, :1] + (tri[pick, 2] - tri[pick, 0]) * u[:, 1:]


def pose_burst(coin):
    """Every point thrown outward from the centre, the flat coin opening up in depth as it goes."""
    aim = coin * np.array([1.0, 1.0, 2.2]) + rng.normal(0, 0.35, coin.shape)
    aim /= np.linalg.norm(aim, axis=1, keepdims=True)
    reach = 0.35 + rng.random((len(coin), 1)) ** 2
    return coin + aim * reach


def pose_swirl(coin, rim_start):
    """The R and the face stay as they are. The rim gathers into streaks around the coin: each part of
    it bunches toward its clockwise end (the head), and the tail thins and falls in toward the coin.
    Each point keeps its order around the rim, so paths do not cross."""
    out = coin.copy()
    rim = coin[rim_start:]
    theta = np.arctan2(rim[:, 1], rim[:, 0])
    sector = math.tau / SWIRL["arms"]
    u = (theta % sector) / sector
    along = u ** SWIRL["bunch"]  # 0 = the head, 1 = the end of the tail
    angle = theta - u * sector + along * sector * SWIRL["fill"]
    lead = (1 - along) ** 2
    width = SWIRL["tail"] + SWIRL["head"] * lead
    r = SWIRL["radius"] - SWIRL["pull_in"] * along + rng.normal(0, 1, len(rim)) * width
    out[rim_start:, 0] = np.cos(angle) * r
    out[rim_start:, 1] = np.sin(angle) * r
    out[rim_start:, 2] = rim[:, 2] + rng.normal(0, 1, len(rim)) * SWIRL["lift"] * lead
    return out


def pose_scatter(coin):
    return coin * 1.15 + rng.normal(0, 0.45, coin.shape)


def pose_ring(coin):
    """Points on the ring's surface. Each keeps its bearing from the centre, so paths do not cross."""
    n = len(coin)
    around = np.sort(rng.random(n) * math.tau - math.pi)
    rank = np.argsort(np.argsort(np.arctan2(coin[:, 1], coin[:, 0])))
    phi = around[rank]
    psi = rng.random(n) * math.tau
    r = RING["radius"] + RING["tube"] * np.cos(psi)
    return np.stack([np.cos(phi) * r, np.sin(phi) * r, RING["tube"] * np.sin(psi)], axis=1)


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    coin_tri = triangles(build_coin())
    mark_tri = triangles(build_mark())
    centre_r = np.linalg.norm(coin_tri.mean(axis=1)[:, :2], axis=1)
    face_tri, rim_tri = coin_tri[centre_r < FACE_R], coin_tri[centre_r >= FACE_R]

    coin = np.concatenate([
        sample(mark_tri, COUNTS["mark"]),
        sample(face_tri, COUNTS["face"]),
        sample(rim_tri, COUNTS["rim"]),
    ])
    poses = {
        "coin": coin,
        "burst": pose_burst(coin),
        "swirl": pose_swirl(coin, COUNTS["mark"] + COUNTS["face"]),
        "scatter": pose_scatter(coin),
        "ring": pose_ring(coin),
    }

    scale = float(max(np.abs(p).max() for p in poses.values()))
    packed = np.concatenate([np.round(p / scale * 32767).astype("<i2").ravel() for p in poses.values()])
    (OUT / "coin-poses.bin").write_bytes(packed.tobytes())

    groups, start = {}, 0
    for name, count in COUNTS.items():
        groups[name] = [start, count]
        start += count
    manifest = {
        "version": 1,
        "blender": bpy.app.version_string,
        "seed": SEED,
        "count": len(coin),
        "scale": scale,
        "poses": list(poses),
        "groups": groups,
        "ring": RING,
    }
    (OUT / "coin-poses.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if "--save" in sys.argv:
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "coin.blend"))
    print(f"coin-poses: {len(coin)} points x {len(poses)} poses, {packed.nbytes} bytes, scale {scale:.4f}")
    print(f"triangles: coin {len(coin_tri)} (face {len(face_tri)}, rim {len(rim_tri)}), mark {len(mark_tri)}")


main()
