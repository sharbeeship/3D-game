#!/usr/bin/env python3
"""Build first-person player body GLBs (torso + leg) with tactical clothing."""

from __future__ import annotations

import importlib.util
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "models", "player")

spec = importlib.util.spec_from_file_location(
    "hand_glb", os.path.join(os.path.dirname(__file__), "build_hand_glb.py")
)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
w = h.w

# Origin is the first-person eye. +Y up, +Z forward, +X right.
UV_SKIN = (0.03, 0.03, 0.46, 0.20)
UV_SHIRT = (0.03, 0.24, 0.48, 0.46)
UV_VEST = (0.52, 0.24, 0.97, 0.46)
UV_PANTS = (0.03, 0.50, 0.48, 0.72)
UV_WEB = (0.52, 0.50, 0.97, 0.72)
UV_BOOT = (0.03, 0.76, 0.48, 0.97)
UV_PAD = (0.52, 0.76, 0.97, 0.97)

HIP_Y = -0.96
HIP_X = 0.125
LEG_LENGTH = 0.96


def lerp_keys(keys, steps):
    centers = []
    radii = []
    for index in range(steps):
        t = index / (steps - 1)
        scaled = t * (len(keys) - 1)
        slot = min(int(scaled), len(keys) - 2)
        local = scaled - slot
        a, b = keys[slot], keys[slot + 1]
        centers.append((w.lerp(a[0], b[0], local), w.lerp(a[1], b[1], local), w.lerp(a[2], b[2], local)))
        radii.append(w.lerp(a[3], b[3], local))
    return centers, radii


def torso_deform(t, ang, width, height):
    chest = w.clamp((0.42 - t) / 0.42)
    waist = w.clamp((t - 0.52) / 0.22)
    hips = w.clamp((t - 0.78) / 0.22)
    forward = max(0.0, math.sin(ang))
    back = max(0.0, -math.sin(ang))
    return (
        width * (1.0 + chest * 0.22 - waist * 0.16 + hips * 0.18),
        height * (1.0 + forward * (0.12 + chest * 0.34) - back * (0.18 - hips * 0.08)),
    )


def thigh_deform(t, ang, width, height):
    knee = w.clamp((t - 0.72) / 0.28)
    quad = w.clamp((0.45 - t) / 0.45)
    forward = max(0.0, math.sin(ang))
    return (
        width * (1.0 - knee * 0.12),
        height * (1.0 + forward * quad * 0.18 - knee * 0.08),
    )


def calf_deform(t, ang, width, height):
    belly = math.sin(w.clamp(t) * math.pi)
    forward = max(0.0, math.sin(ang))
    return (
        width * (1.0 + belly * 0.08),
        height * (1.0 + forward * belly * 0.22),
    )


def add_torso(mesh: w.Mesh) -> None:
    keys = [
        (0.0, -0.16, -0.07, 0.046),
        (0.0, -0.20, -0.04, 0.062),
        (0.0, -0.26, 0.00, 0.118),
        (0.0, -0.34, 0.04, 0.168),
        (0.0, -0.44, 0.08, 0.182),
        (0.0, -0.56, 0.09, 0.176),
        (0.0, -0.68, 0.07, 0.158),
        (0.0, -0.80, 0.04, 0.132),
        (0.0, -0.90, 0.03, 0.142),
        (0.0, HIP_Y, 0.03, 0.158),
        (0.0, HIP_Y - 0.05, 0.02, 0.150),
    ]
    centers, radii = lerp_keys(keys, 28)
    h.add_loft(
        mesh,
        centers,
        radii,
        UV_SHIRT,
        oval=(1.14, 0.76),
        deform=torso_deform,
        cap_start=True,
        cap_end=True,
    )

    collar = [
        (0.0, -0.175, -0.05, 0.058),
        (0.0, -0.205, -0.02, 0.078),
        (0.0, -0.235, 0.02, 0.092),
    ]
    cc, cr = lerp_keys(collar, 7)
    h.add_loft(mesh, cc, cr, UV_SHIRT, oval=(1.2, 0.72), cap_start=False, cap_end=True)

    w.add_box(mesh, (0.0, -0.50, 0.12), (0.30, 0.38, 0.09), UV_VEST)
    w.add_box(mesh, (0.0, -0.42, 0.155), (0.24, 0.10, 0.05), UV_VEST)
    w.add_box(mesh, (0.0, -0.62, 0.14), (0.26, 0.08, 0.06), UV_VEST)
    w.add_box(mesh, (0.0, -0.78, 0.08), (0.28, 0.06, 0.08), UV_WEB)

    for x in (-0.09, 0.0, 0.09):
        w.add_box(mesh, (x, -0.50, 0.185), (0.07, 0.15, 0.055), UV_WEB)
        w.add_box(mesh, (x, -0.445, 0.21), (0.062, 0.04, 0.02), UV_PAD)

    w.add_box(mesh, (0.0, -0.36, 0.17), (0.12, 0.05, 0.04), UV_WEB)
    w.add_box(mesh, (-0.155, -0.56, 0.08), (0.07, 0.12, 0.08), UV_WEB)
    w.add_box(mesh, (0.155, -0.56, 0.08), (0.07, 0.12, 0.08), UV_WEB)
    w.add_box(mesh, (-0.14, -0.38, 0.04), (0.05, 0.08, 0.07), UV_PAD)
    w.add_cylinder(mesh, (-0.14, -0.34, 0.04), (-0.14, -0.22, 0.05), 0.008, 8, UV_PAD, cap=True)

    for side in (-1.0, 1.0):
        w.add_box(mesh, (side * 0.12, -0.34, 0.02), (0.05, 0.28, 0.04), UV_VEST)
        shoulder = [
            (side * 0.10, -0.26, 0.01, 0.078),
            (side * 0.16, -0.28, 0.03, 0.070),
            (side * 0.22, -0.30, 0.04, 0.058),
            (side * 0.26, -0.32, 0.05, 0.048),
        ]
        sc, sr = lerp_keys(shoulder, 10)
        h.add_loft(mesh, sc, sr, UV_SHIRT, oval=(1.12, 0.9), cap_start=False, cap_end=True)

    for side in (-1.0, 1.0):
        w.add_box(mesh, (side * 0.16, HIP_Y + 0.04, 0.06), (0.08, 0.07, 0.09), UV_WEB)


def add_leg(mesh: w.Mesh) -> None:
    thigh = [
        (0.0, 0.03, 0.02, 0.078),
        (0.0, -0.10, 0.03, 0.074),
        (0.0, -0.24, 0.04, 0.068),
        (0.0, -0.36, 0.04, 0.058),
        (0.0, -0.46, 0.03, 0.052),
    ]
    tc, tr = lerp_keys(thigh, 14)
    h.add_loft(mesh, tc, tr, UV_PANTS, oval=(1.12, 0.92), deform=thigh_deform, cap_start=True, cap_end=False)

    w.add_box(mesh, (0.05, -0.18, 0.04), (0.06, 0.14, 0.05), UV_PANTS)
    w.add_box(mesh, (0.0, -0.44, 0.045), (0.11, 0.12, 0.08), UV_PAD)

    calf = [
        (0.0, -0.46, 0.03, 0.052),
        (0.0, -0.58, 0.02, 0.050),
        (0.0, -0.70, 0.01, 0.046),
        (0.0, -0.80, 0.02, 0.042),
        (0.0, -0.86, 0.03, 0.040),
    ]
    cc, cr = lerp_keys(calf, 12)
    h.add_loft(mesh, cc, cr, UV_PANTS, oval=(1.08, 0.88), deform=calf_deform, cap_start=False, cap_end=False)

    boot = [
        (0.0, -0.82, 0.03, 0.044),
        (0.0, -0.88, 0.04, 0.048),
        (0.0, -0.92, 0.07, 0.050),
        (0.0, -0.945, 0.12, 0.042),
        (0.0, LEG_LENGTH * -1, 0.16, 0.034),
    ]
    bc, br = lerp_keys(boot, 10)
    h.add_loft(mesh, bc, br, UV_BOOT, oval=(1.18, 0.78), cap_start=False, cap_end=True)
    w.add_box(mesh, (0.0, -0.955, 0.09), (0.11, 0.035, 0.20), UV_BOOT)
    w.add_box(mesh, (0.0, -0.94, 0.00), (0.10, 0.06, 0.07), UV_BOOT)
    w.add_box(mesh, (0.0, -0.90, 0.05), (0.09, 0.08, 0.08), UV_PAD)


def add_head(mesh: w.Mesh) -> None:
    face = [
        (0.0, -0.13, 0.02, 0.042),
        (0.0, -0.08, 0.05, 0.068),
        (0.0, -0.02, 0.07, 0.082),
        (0.0, 0.04, 0.06, 0.088),
        (0.0, 0.10, 0.02, 0.086),
        (0.0, 0.14, -0.02, 0.072),
    ]
    fc, fr = lerp_keys(face, 12)
    h.add_loft(mesh, fc, fr, UV_SKIN, oval=(0.92, 1.05), cap_start=True, cap_end=True)
    helm = [
        (0.0, 0.00, -0.02, 0.092),
        (0.0, 0.06, -0.01, 0.098),
        (0.0, 0.12, -0.02, 0.094),
        (0.0, 0.16, -0.04, 0.078),
    ]
    hc, hr = lerp_keys(helm, 8)
    h.add_loft(mesh, hc, hr, UV_PAD, oval=(1.08, 1.12), cap_start=False, cap_end=True)
    w.add_box(mesh, (0.0, 0.04, 0.09), (0.16, 0.05, 0.03), UV_VEST)
    w.add_box(mesh, (0.0, 0.09, 0.08), (0.14, 0.04, 0.04), UV_PAD)
    w.add_box(mesh, (0.0, -0.02, 0.095), (0.05, 0.03, 0.03), UV_SKIN)


def add_arm(mesh: w.Mesh) -> None:
    keys = [
        (0.0, 0.0, 0.00, 0.056),
        (0.0, 0.0, 0.07, 0.050),
        (0.0, 0.0, 0.16, 0.046),
        (0.0, 0.0, 0.23, 0.043),
        (0.0, 0.0, 0.28, 0.041),
    ]
    centers, radii = lerp_keys(keys, 10)
    h.add_loft(mesh, centers, radii, UV_SHIRT, oval=(1.1, 0.92), cap_start=True, cap_end=True)


def add_forearm(mesh: w.Mesh) -> None:
    keys = [
        (0.0, 0.0, 0.00, 0.041),
        (0.0, 0.0, 0.06, 0.039),
        (0.0, 0.0, 0.14, 0.037),
        (0.0, 0.0, 0.21, 0.036),
        (0.0, 0.0, 0.26, 0.036),
    ]
    centers, radii = lerp_keys(keys, 10)
    h.add_loft(mesh, centers, radii, UV_SKIN, oval=(1.02, 0.86), cap_start=True, cap_end=True)


def build_body_textures():
    n = 1024
    color = bytearray(n * n * 3)
    normal = bytearray(n * n * 3)
    mr = bytearray(n * n * 3)
    height = [0.0] * (n * n)

    for y in range(n):
        v = y / (n - 1)
        for x in range(n):
            u = x / (n - 1)
            idx = y * n + x
            weave = w.fbm(u * 36.0, v * 36.0, 3)
            grain = w.fbm(u * 11.0, v * 8.0, 2)
            stitch = 0.55 if (int(u * 42) % 7 == 0 or int(v * 38) % 9 == 0) else 0.0
            if v < 0.22:
                base = w.mix_color((0.84, 0.60, 0.48), (0.92, 0.70, 0.56), grain * 0.28)
                metallic, rough = 0.0, 0.48
                height[idx] = grain * 0.05
            elif v < 0.48:
                if u > 0.5:
                    base = w.mix_color((0.10, 0.12, 0.09), (0.16, 0.18, 0.13), weave * 0.4)
                    base = w.mix_color(base, (0.07, 0.08, 0.06), stitch * 0.35)
                    metallic, rough = 0.06, 0.58
                    height[idx] = 0.10 + weave * 0.14 + stitch * 0.08
                else:
                    base = w.mix_color((0.23, 0.28, 0.18), (0.16, 0.20, 0.13), weave * 0.45)
                    metallic, rough = 0.02, 0.74
                    height[idx] = weave * 0.1 + stitch * 0.05
            elif v < 0.74:
                if u > 0.5:
                    base = w.mix_color((0.18, 0.16, 0.11), (0.28, 0.24, 0.16), grain * 0.35)
                    metallic, rough = 0.04, 0.64
                    height[idx] = 0.08 + grain * 0.12
                else:
                    base = w.mix_color((0.15, 0.17, 0.12), (0.10, 0.12, 0.09), weave * 0.42)
                    metallic, rough = 0.03, 0.78
                    height[idx] = weave * 0.09 + stitch * 0.04
            else:
                if u > 0.5:
                    base = w.mix_color((0.22, 0.20, 0.16), (0.12, 0.12, 0.10), weave * 0.3)
                    metallic, rough = 0.08, 0.52
                    height[idx] = 0.07 + weave * 0.08
                else:
                    base = w.mix_color((0.07, 0.06, 0.05), (0.13, 0.10, 0.08), grain * 0.4)
                    metallic, rough = 0.05, 0.68
                    height[idx] = 0.06 + grain * 0.12
            o = idx * 3
            color[o : o + 3] = bytes(int(w.clamp(ch) * 255) for ch in base)
            mr[o : o + 3] = bytes((0, int(w.clamp(rough) * 255), int(w.clamp(metallic) * 255)))

    for y in range(n):
        for x in range(n):
            xl = height[y * n + (x - 1) % n]
            xr = height[y * n + (x + 1) % n]
            yu = height[((y - 1) % n) * n + x]
            yd = height[((y + 1) % n) * n + x]
            nx = (xl - xr) * 1.7
            ny = (yu - yd) * 1.7
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
    images = build_body_textures()
    torso = w.Mesh()
    add_torso(torso)
    w.write_glb(os.path.join(OUT_DIR, "torso.glb"), torso, images)
    leg = w.Mesh()
    add_leg(leg)
    w.write_glb(os.path.join(OUT_DIR, "leg.glb"), leg, images)
    head = w.Mesh()
    add_head(head)
    w.write_glb(os.path.join(OUT_DIR, "head.glb"), head, images)
    arm = w.Mesh()
    add_arm(arm)
    w.write_glb(os.path.join(OUT_DIR, "arm.glb"), arm, images)
    forearm = w.Mesh()
    add_forearm(forearm)
    w.write_glb(os.path.join(OUT_DIR, "forearm.glb"), forearm, images)


if __name__ == "__main__":
    main()
