#!/usr/bin/env python3
"""Build first-person anatomical hand GLBs (idle + grip) with smooth skin shading."""

from __future__ import annotations

import importlib.util
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "models", "hands")

spec = importlib.util.spec_from_file_location(
    "weapon_glb", os.path.join(os.path.dirname(__file__), "build_weapon_glb.py")
)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

UV_SKIN = (0.03, 0.03, 0.72, 0.97)
UV_NAIL = (0.78, 0.08, 0.97, 0.42)
SEGMENTS = 32


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub3(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul3(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot3(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross3(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length3(a):
    return math.hypot(a[0], a[1], a[2])


def norm3(a):
    scale = length3(a) or 1.0
    return mul3(a, 1.0 / scale)


def lerp3(a, b, t):
    return (w.lerp(a[0], b[0], t), w.lerp(a[1], b[1], t), w.lerp(a[2], b[2], t))


def rotate_around(vec, axis, ang):
    axis = norm3(axis)
    cos_a, sin_a = math.cos(ang), math.sin(ang)
    return add3(
        add3(mul3(vec, cos_a), mul3(cross3(axis, vec), sin_a)),
        mul3(axis, dot3(axis, vec) * (1.0 - cos_a)),
    )


def catmull_chain(points, steps):
    if len(points) < 2:
        return list(points)
    pts = [points[0], *points, points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5
                    * (
                        2 * p1[k]
                        + (-p0[k] + p2[k]) * t
                        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
                    )
                    for k in range(3)
                )
            )
    out.append(points[-1])
    return out


def sample_uv(rect, u, v):
    u0, v0, u1, v1 = rect
    return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)


def add_quad_uv(mesh, p00, p10, p11, p01, uv00, uv10, uv11, uv01):
    mesh.add_tri(p00, p10, p11, uv00, uv10, uv11)
    mesh.add_tri(p00, p11, p01, uv00, uv11, uv01)


def orthonormal(axis, hint=(0.0, 1.0, 0.0)):
    axis = norm3(axis)
    helper = hint if abs(dot3(axis, hint)) < 0.92 else (1.0, 0.0, 0.0)
    side = norm3(cross3(axis, helper))
    up = cross3(axis, side)
    return axis, side, up


def add_loft(mesh, centers, radii, uv_rect, oval=(1.0, 0.72), deform=None, cap_start=False, cap_end=True):
    frames = []
    for index, center in enumerate(centers):
        if index == 0:
            tangent = sub3(centers[1], centers[0])
        elif index == len(centers) - 1:
            tangent = sub3(centers[-1], centers[-2])
        else:
            tangent = sub3(centers[index + 1], centers[index - 1])
        axis = norm3(tangent)
        side = cross3((0.0, 1.0, 0.0), axis)
        if length3(side) < 1e-5:
            side = (1.0, 0.0, 0.0)
        else:
            side = norm3(side)
        up = norm3(cross3(axis, side))
        frames.append((center, axis, side, up, radii[index]))

    rings = []
    for index, (center, axis, side, up, radius) in enumerate(frames):
        t = index / max(len(frames) - 1, 1)
        ring = []
        for seg in range(SEGMENTS):
            ang = seg / SEGMENTS * math.tau
            width = radius * oval[0]
            height = radius * oval[1]
            if deform:
                width, height = deform(t, ang, width, height)
            offset = add3(mul3(side, math.cos(ang) * width), mul3(up, math.sin(ang) * height))
            ring.append((add3(center, offset), sample_uv(uv_rect, seg / SEGMENTS, t)))
        ring.append((ring[0][0], sample_uv(uv_rect, 1.0, t)))
        rings.append(ring)

    for index in range(len(rings) - 1):
        for seg in range(SEGMENTS):
            p00, uv00 = rings[index][seg]
            p10, uv10 = rings[index][seg + 1]
            p01, uv01 = rings[index + 1][seg]
            p11, uv11 = rings[index + 1][seg + 1]
            add_quad_uv(mesh, p00, p01, p11, p10, uv00, uv01, uv11, uv10)

    if cap_start:
        cap_center = centers[0]
        cap_uv = sample_uv(uv_rect, 0.5, 0.0)
        for seg in range(SEGMENTS):
            p0, uv0 = rings[0][seg]
            p1, uv1 = rings[0][seg + 1]
            mesh.add_tri(cap_center, p0, p1, cap_uv, uv0, uv1)
    if cap_end:
        cap_center = centers[-1]
        cap_uv = sample_uv(uv_rect, 0.5, 1.0)
        for seg in range(SEGMENTS):
            p0, uv0 = rings[-1][seg]
            p1, uv1 = rings[-1][seg + 1]
            mesh.add_tri(cap_center, p1, p0, cap_uv, uv1, uv0)
    return frames


def add_nail(mesh, base, tip, side, up, width, length):
    normal = norm3(up)
    tangent = norm3(sub3(tip, base))
    bitangent = norm3(side)
    center = add3(base, mul3(tangent, length * 0.52))
    center = add3(center, mul3(normal, 0.0018))
    hx, hy, hz = width * 0.5, 0.0012, length * 0.5
    corners = []
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        point = add3(center, add3(mul3(bitangent, sx * hx), mul3(tangent, sz * hz)))
        point = add3(point, mul3(normal, hy * (0.4 if sz < 0 else 1.0)))
        corners.append(point)
    u0, v0, u1, v1 = UV_NAIL
    add_quad_uv(
        mesh,
        corners[0],
        corners[1],
        corners[2],
        corners[3],
        (u0, v0),
        (u1, v0),
        (u1, v1),
        (u0, v1),
    )


def finger_path(origin, direction, up, lengths, curl, twist=0.0):
    pos = origin
    heading = norm3(direction)
    binormal = norm3(cross3(heading, up)) if length3(cross3(heading, up)) > 1e-5 else (1.0, 0.0, 0.0)
    local_up = cross3(binormal, heading)
    points = [pos]
    for index, length in enumerate(lengths):
        amount = curl * (0.22 if index == 0 else 0.46 + index * 0.04)
        heading = rotate_around(heading, binormal, amount)
        heading = rotate_around(heading, local_up, twist * (0.15 if index == 0 else 0.08))
        pos = add3(pos, mul3(norm3(heading), length))
        points.append(pos)
    return points


def add_digit(mesh, origin, direction, up, lengths, radii, curl, twist=0.0, nail=True, bury=0.0):
    joints = finger_path(origin, direction, up, lengths, curl, twist)
    if bury > 0:
        into = mul3(norm3(up), -0.01 * bury)
        buried = (origin[0] * 0.4, origin[1] + into[1], origin[2] - 0.016 * bury)
        mid = (origin[0] * 0.72, origin[1] + into[1] * 0.4, origin[2] - 0.006 * bury)
        joints = [buried, mid, origin] + joints[1:]
        radii = (radii[0] * 0.92, radii[0] * 0.98, *radii)
    centers = catmull_chain(joints, 6)
    radius_samples = []
    for index, _center in enumerate(centers):
        t = index / max(len(centers) - 1, 1)
        scaled = t * (len(radii) - 1)
        slot = min(int(scaled), len(radii) - 2)
        local = scaled - slot
        radius = w.lerp(radii[slot], radii[slot + 1], local)
        if bury <= 0 and 0.18 < t < 0.82 and abs(t * 3.0 - round(t * 3.0)) < 0.08:
            radius *= 1.06
        radius_samples.append(radius)
    tip = centers[-1]
    taper = add3(tip, mul3(norm3(sub3(centers[-1], centers[-2])), radius_samples[-1] * 0.45))
    centers.append(taper)
    radius_samples.append(radius_samples[-1] * 0.22)
    frames = add_loft(mesh, centers, radius_samples, UV_SKIN, oval=(1.0, 0.78), cap_start=bury <= 0, cap_end=True)
    if nail and len(frames) > 8:
        base = frames[-8][0]
        end = frames[-3][0]
        add_nail(mesh, base, end, frames[-5][2], frames[-5][3], radius_samples[-8] * 1.55, length3(sub3(end, base)) * 1.15)


def arm_deform(t, ang, width, height, flatten=0.0):
    palm_t = w.clamp((t - 0.58) / 0.42)
    if palm_t <= 0.0:
        return width, height
    palm_sign = -1.0
    palm_pad = max(0.0, palm_sign * math.sin(ang)) * palm_t
    back = max(0.0, -palm_sign * math.sin(ang))
    thumb_side = max(0.0, -math.cos(ang))
    pinky_side = max(0.0, math.cos(ang))
    thenar = thumb_side * palm_t * (0.28 - flatten * 0.18)
    hypothenar = pinky_side * palm_t * 0.1
    knuckle = back * palm_t * palm_t * 0.1 * (1.0 - flatten * 0.35)
    profile = 1.0 - palm_t * (0.42 + flatten * 0.06)
    dorsal_arch = back * palm_t * 0.14 * flatten
    height_mul = profile + palm_pad * 0.35 * (1.0 - flatten * 0.4) + knuckle + dorsal_arch
    return (
        width * (1.0 + thenar + hypothenar),
        height * height_mul,
    )


def add_arm_and_palm(mesh, flatten=0.0):
    if flatten > 0.5:
        keys = [
            (0.0, -0.055, -0.22, 0.036),
            (0.0, -0.038, -0.15, 0.033),
            (0.0, -0.022, -0.09, 0.031),
            (0.0, -0.01, -0.045, 0.03),
            (0.0, 0.0, -0.012, 0.031),
            (0.0, 0.002, 0.008, 0.033),
            (0.0, 0.003, 0.022, 0.030),
        ]
    else:
        keys = [
            (0.0, -0.12, -0.22, 0.037),
            (0.0, -0.08, -0.15, 0.034),
            (0.0, -0.04, -0.09, 0.031),
            (0.0, -0.012, -0.045, 0.029),
            (0.0, 0.0, -0.01, 0.032),
            (0.0, 0.005, 0.022, 0.04),
            (0.0, 0.008, 0.054, 0.044),
        ]
    centers = []
    radii = []
    steps = 28
    for index in range(steps):
        t = index / (steps - 1)
        scaled = t * (len(keys) - 1)
        slot = min(int(scaled), len(keys) - 2)
        local = scaled - slot
        a, b = keys[slot], keys[slot + 1]
        centers.append((w.lerp(a[0], b[0], local), w.lerp(a[1], b[1], local), w.lerp(a[2], b[2], local)))
        radii.append(w.lerp(a[3], b[3], local))
    cap_end = flatten <= 0.5
    if flatten > 0.5 and centers:
        last = centers[-1]
        axis = norm3(sub3(centers[-1], centers[-2]))
        radius = radii[-1]
        centers.append(add3(last, mul3(axis, radius * 0.16)))
        radii.append(radius * 0.48)
        centers.append(add3(last, mul3(axis, radius * 0.30)))
        radii.append(radius * 0.10)
        cap_end = False
    add_loft(
        mesh,
        centers,
        radii,
        UV_SKIN,
        oval=(1.0, 0.88),
        deform=lambda t, ang, width, height: arm_deform(t, ang, width, height, flatten),
        cap_start=True,
        cap_end=cap_end,
    )


def build_hand(mesh: w.Mesh, curl: float, spread: float, flatten: float = 0.0, fist: bool = False, thumb: bool = True) -> None:
    add_arm_and_palm(mesh, 0.0 if fist else flatten)
    nail = not fist
    if fist:
        back = (0.0, 1.0, 0.0)
        digits = [
            {"origin": (-0.016, 0.008, 0.046), "dir": (-0.04, -0.12, 1.0), "len": (0.026, 0.020, 0.017), "rad": (0.0102, 0.0094, 0.0082, 0.0064)},
            {"origin": (-0.002, 0.010, 0.050), "dir": (0.0, -0.14, 1.0), "len": (0.028, 0.022, 0.018), "rad": (0.0108, 0.010, 0.0086, 0.0066)},
            {"origin": (0.012, 0.008, 0.046), "dir": (0.04, -0.12, 1.0), "len": (0.026, 0.020, 0.017), "rad": (0.0100, 0.0092, 0.0080, 0.0062)},
            {"origin": (0.024, 0.006, 0.040), "dir": (0.08, -0.10, 1.0), "len": (0.020, 0.015, 0.013), "rad": (0.0084, 0.0076, 0.0066, 0.0052)},
        ]
        bury = 0.28
        thumb_origin = (-0.022, 0.008, 0.014)
        thumb_dir = (0.9, -0.2, 0.15)
        thumb_up = back
        thumb_bury = 0.18
        thumb_curl = -1.4
        finger_curl = -curl
        thumb_len = (0.026, 0.020, 0.016)
    elif flatten > 0.5:
        back = (0.0, 1.0, 0.0)
        digits = [
            {"origin": (-0.016, 0.012, 0.030), "dir": (-0.06, -0.05, 1.0), "len": (0.028, 0.022, 0.019), "rad": (0.0100, 0.0090, 0.0078, 0.0060)},
            {"origin": (-0.003, 0.013, 0.034), "dir": (-0.01, -0.06, 1.0), "len": (0.031, 0.025, 0.021), "rad": (0.0106, 0.0096, 0.0082, 0.0062)},
            {"origin": (0.010, 0.012, 0.030), "dir": (0.05, -0.05, 1.0), "len": (0.029, 0.023, 0.019), "rad": (0.0098, 0.0088, 0.0076, 0.0058)},
            {"origin": (0.022, 0.010, 0.026), "dir": (0.10, -0.04, 1.0), "len": (0.022, 0.017, 0.015), "rad": (0.0082, 0.0072, 0.0062, 0.0048)},
        ]
        bury = 0.22
        thumb_origin = (-0.022, 0.006, 0.006)
        thumb_dir = (-0.28, -0.18, 0.88)
        thumb_up = back
        thumb_bury = 0.22
        thumb_curl = -curl * 0.45
        finger_curl = -curl * 0.42
        thumb_len = (0.032, 0.026, 0.022)
    else:
        back = (0.0, 1.0, 0.0)
        lift = 0.05
        origin_y = 0.007
        digits = [
            {"origin": (-0.018, origin_y, 0.048), "dir": (-0.08 * spread, lift, 1.0), "len": (0.028, 0.022, 0.019), "rad": (0.0102, 0.0094, 0.0082, 0.0064)},
            {"origin": (-0.002, origin_y + 0.002, 0.052), "dir": (-0.015 * spread, lift, 1.0), "len": (0.031, 0.025, 0.021), "rad": (0.0108, 0.01, 0.0086, 0.0066)},
            {"origin": (0.014, origin_y, 0.048), "dir": (0.06 * spread, lift * 0.8, 1.0), "len": (0.029, 0.023, 0.019), "rad": (0.01, 0.0092, 0.008, 0.0062)},
            {"origin": (0.029, origin_y - 0.004, 0.042), "dir": (0.16 * spread, lift * 0.4, 1.0), "len": (0.022, 0.017, 0.015), "rad": (0.0084, 0.0076, 0.0066, 0.0052)},
        ]
        bury = 0.0
        thumb_origin = (-0.03, -0.002, 0.004)
        thumb_dir = (-0.72 - 0.18 * spread, -0.08, 0.62)
        thumb_up = (-0.15, 0.9, 0.2)
        thumb_bury = 0.0
        thumb_curl = curl * 0.62
        finger_curl = curl
        thumb_len = (0.032, 0.026, 0.022)
    curls = (finger_curl * 0.88, finger_curl, finger_curl * 1.06, finger_curl * 1.14)
    twists = (0.0, 0.0, 0.0, 0.0)
    for digit, amount, twist in zip(digits, curls, twists):
        add_digit(mesh, digit["origin"], digit["dir"], back, digit["len"], digit["rad"], amount, twist, nail, bury)

    if thumb:
        add_digit(
            mesh,
            thumb_origin,
            thumb_dir,
            thumb_up,
            thumb_len,
            (0.012, 0.011, 0.0094, 0.0072),
            thumb_curl,
            0.0,
            nail,
            thumb_bury,
        )


def build_hand_textures():
    n = 512
    color = bytearray(n * n * 3)
    normal = bytearray(n * n * 3)
    mr = bytearray(n * n * 3)
    height = [0.0] * (n * n)

    for y in range(n):
        v = y / (n - 1)
        for x in range(n):
            u = x / (n - 1)
            idx = y * n + x
            pores = w.fbm(u * 36.0, v * 36.0, 2)
            grain = w.fbm(u * 8.0, v * 6.0, 2)

            if u > 0.75:
                lunula = 1.0 if v < 0.22 and abs(u - 0.88) < 0.07 else 0.0
                tip = w.clamp((v - 0.28) * 2.4)
                base = w.mix_color((0.92, 0.76, 0.74), (0.96, 0.9, 0.86), tip)
                base = w.mix_color(base, (0.94, 0.88, 0.9), lunula)
                metallic, rough = 0.04, 0.32
                height[idx] = 0.04 + lunula * 0.06
            else:
                skin = w.mix_color((0.86, 0.62, 0.5), (0.92, 0.7, 0.56), grain * 0.22 + pores * 0.08)
                base, metallic, rough = skin, 0.0, 0.48 + pores * 0.04
                height[idx] = pores * 0.06

            o = idx * 3
            color[o : o + 3] = bytes(int(w.clamp(ch) * 255) for ch in base)
            mr[o : o + 3] = bytes((0, int(w.clamp(rough) * 255), int(w.clamp(metallic) * 255)))

    for y in range(n):
        for x in range(n):
            xl = height[y * n + (x - 1) % n]
            xr = height[y * n + (x + 1) % n]
            yu = height[((y - 1) % n) * n + x]
            yd = height[((y + 1) % n) * n + x]
            nx = (xl - xr) * 1.8
            ny = (yu - yd) * 1.8
            length = math.hypot(nx, ny, 1.0) or 1.0
            o = (y * n + x) * 3
            normal[o : o + 3] = bytes(
                (
                    int((nx / length * 0.5 + 0.5) * 255),
                    int((ny / length * 0.5 + 0.5) * 255),
                    int((1.0 / length * 0.5 + 0.5) * 255),
                )
            )

    return w.png_rgb(n, n, color), w.png_rgb(n, n, normal), w.png_rgb(n, n, mr)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    images = build_hand_textures()
    poses = (
        ("hand_idle.glb", 0.74, 0.18, 1.0, False),
        ("hand_grip.glb", 0.98, 0.42, 0.0, False),
        ("hand_fist.glb", 2.4, 0.08, 0.0, True),
    )
    for name, curl, spread, flatten, fist in poses:
        mesh = w.Mesh()
        build_hand(mesh, curl, spread, flatten, fist)
        path = os.path.join(OUT_DIR, name)
        w.write_glb(path, mesh, images)

    left_grip = w.Mesh()
    build_hand(left_grip, 0.98, 0.42, 0.0, False, thumb=False)
    w.write_glb(os.path.join(OUT_DIR, "hand_grip_left.glb"), left_grip, images)


if __name__ == "__main__":
    main()
