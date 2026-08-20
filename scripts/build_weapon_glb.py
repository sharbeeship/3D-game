#!/usr/bin/env python3
"""Build first-person-ready weapon GLBs (low-poly game mesh + PBR maps)."""

from __future__ import annotations

import json
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "models", "weapons")
TEX_SIZE = 512


class Mesh:
    def __init__(self) -> None:
        self.positions: list[tuple[float, float, float]] = []
        self.normals: list[tuple[float, float, float]] = []
        self.uvs: list[tuple[float, float]] = []
        self.indices: list[int] = []

    def add_tri(self, a, b, c, uva, uvb, uvc) -> None:
        na = normal_of(a, b, c)
        for point, uv in ((a, uva), (b, uvb), (c, uvc)):
            self.indices.append(len(self.positions))
            self.positions.append(point)
            self.normals.append(na)
            self.uvs.append(uv)

    def add_quad(self, p00, p10, p11, p01, uv_rect) -> None:
        u0, v0, u1, v1 = uv_rect
        self.add_tri(p00, p10, p11, (u0, v0), (u1, v0), (u1, v1))
        self.add_tri(p00, p11, p01, (u0, v0), (u1, v1), (u0, v1))


def normal_of(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.hypot(nx, ny, nz) or 1.0
    return (nx / length, ny / length, nz / length)


def add_box(mesh: Mesh, center, size, uv_rect, bevel=0.0, segments=2) -> None:
    del bevel, segments
    cx, cy, cz = center
    sx, sy, sz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    x0, x1 = cx - sx, cx + sx
    y0, y1 = cy - sy, cy + sy
    z0, z1 = cz - sz, cz + sz
    mesh.add_quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), uv_rect)
    mesh.add_quad((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), uv_rect)
    mesh.add_quad((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), uv_rect)
    mesh.add_quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), uv_rect)
    mesh.add_quad((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), uv_rect)
    mesh.add_quad((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), uv_rect)


def add_cylinder(mesh: Mesh, start, end, radius, segments, uv_rect, cap=True) -> None:
    dx, dy, dz = end[0] - start[0], end[1] - start[1], end[2] - start[2]
    axis_len = math.hypot(dx, dy, dz) or 1.0
    ax, ay, az = dx / axis_len, dy / axis_len, dz / axis_len
    helper = (0.0, 1.0, 0.0) if abs(ay) < 0.9 else (1.0, 0.0, 0.0)
    bx, by, bz = ay * helper[2] - az * helper[1], az * helper[0] - ax * helper[2], ax * helper[1] - ay * helper[0]
    bl = math.hypot(bx, by, bz) or 1.0
    bx, by, bz = bx / bl, by / bl, bz / bl
    cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
    u0, v0, u1, v1 = uv_rect
    rings = max(2, int(axis_len / max(radius * 1.6, 0.018)) + 1)

    def ring_point(t, i):
        ang = (i / segments) * math.tau
        ca, sa = math.cos(ang), math.sin(ang)
        px = start[0] + ax * t + (bx * ca + cx * sa) * radius
        py = start[1] + ay * t + (by * ca + cy * sa) * radius
        pz = start[2] + az * t + (bz * ca + cz * sa) * radius
        u = u0 + (i / segments) * (u1 - u0)
        v = v0 + (t / axis_len) * (v1 - v0)
        return (px, py, pz), (u, v)

    for ring in range(rings):
        t0 = axis_len * ring / rings
        t1 = axis_len * (ring + 1) / rings
        for i in range(segments):
            p00, uv00 = ring_point(t0, i)
            p10, uv10 = ring_point(t0, i + 1)
            p01, uv01 = ring_point(t1, i)
            p11, uv11 = ring_point(t1, i + 1)
            mesh.add_tri(p00, p10, p11, uv00, uv10, uv11)
            mesh.add_tri(p00, p11, p01, uv00, uv11, uv01)

    if cap:
        for origin, inward in ((start, 1), (end, -1)):
            for i in range(segments):
                p0, uv0 = ring_point(0 if inward == 1 else axis_len, i)
                p1, uv1 = ring_point(0 if inward == 1 else axis_len, i + 1)
                center_uv = ((u0 + u1) * 0.5, (v0 + v1) * 0.5)
                if inward == 1:
                    mesh.add_tri(origin, p1, p0, center_uv, uv1, uv0)
                else:
                    mesh.add_tri(origin, p0, p1, center_uv, uv0, uv1)


def smooth_normals(mesh: Mesh) -> None:
    buckets: dict[tuple[int, int, int], list[int]] = {}
    for index, pos in enumerate(mesh.positions):
        key = (round(pos[0] * 4000), round(pos[1] * 4000), round(pos[2] * 4000))
        buckets.setdefault(key, []).append(index)
    for indices in buckets.values():
        sx = sy = sz = 0.0
        for index in indices:
            nx, ny, nz = mesh.normals[index]
            sx += nx
            sy += ny
            sz += nz
        length = math.hypot(sx, sy, sz) or 1.0
        n = (sx / length, sy / length, sz / length)
        for index in indices:
            mesh.normals[index] = n


def tangents_of(mesh: Mesh) -> list[tuple[float, float, float, float]]:
    tan1 = [(0.0, 0.0, 0.0) for _ in mesh.positions]
    tan2 = [(0.0, 0.0, 0.0) for _ in mesh.positions]
    for i in range(0, len(mesh.indices), 3):
        i0, i1, i2 = mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]
        p0, p1, p2 = mesh.positions[i0], mesh.positions[i1], mesh.positions[i2]
        w0, w1, w2 = mesh.uvs[i0], mesh.uvs[i1], mesh.uvs[i2]
        x1, y1, z1 = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        x2, y2, z2 = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        s1, t1 = w1[0] - w0[0], w1[1] - w0[1]
        s2, t2 = w2[0] - w0[0], w2[1] - w0[1]
        denom = s1 * t2 - s2 * t1
        r = 1.0 / denom if abs(denom) > 1e-8 else 0.0
        sdir = (r * (t2 * x1 - t1 * x2), r * (t2 * y1 - t1 * y2), r * (t2 * z1 - t1 * z2))
        tdir = (r * (s1 * x2 - s2 * x1), r * (s1 * y2 - s2 * y1), r * (s1 * z2 - s2 * z1))
        for idx in (i0, i1, i2):
            tan1[idx] = (tan1[idx][0] + sdir[0], tan1[idx][1] + sdir[1], tan1[idx][2] + sdir[2])
            tan2[idx] = (tan2[idx][0] + tdir[0], tan2[idx][1] + tdir[1], tan2[idx][2] + tdir[2])

    out = []
    for n, t, b in zip(mesh.normals, tan1, tan2):
        tx, ty, tz = t
        ndott = n[0] * tx + n[1] * ty + n[2] * tz
        tx -= n[0] * ndott
        ty -= n[1] * ndott
        tz -= n[2] * ndott
        length = math.hypot(tx, ty, tz) or 1.0
        tx, ty, tz = tx / length, ty / length, tz / length
        cx, cy, cz = n[1] * tz - n[2] * ty, n[2] * tx - n[0] * tz, n[0] * ty - n[1] * tx
        w = 1.0 if (cx * b[0] + cy * b[1] + cz * b[2]) >= 0 else -1.0
        out.append((tx, ty, tz, w))
    return out


def uhash(x: int, y: int) -> float:
    n = (int(x) * 374761393 + int(y) * 668265263) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177
    return (n & 0xFFFFFFFF) / 4294967295.0


def noise(x, y) -> float:
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    n00 = uhash(x0, y0)
    n10 = uhash(x0 + 1, y0)
    n01 = uhash(x0, y0 + 1)
    n11 = uhash(x0 + 1, y0 + 1)
    return (n00 * (1 - ux) + n10 * ux) * (1 - uy) + (n01 * (1 - ux) + n11 * ux) * uy


def fbm(x, y, octaves=2) -> float:
    total = 0.0
    amp = 0.65
    freq = 1.0
    for _ in range(octaves):
        total += noise(x * freq, y * freq) * amp
        freq *= 2.0
        amp *= 0.5
    return total


def lerp(a, b, t):
    return a + (b - a) * t


def mix_color(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(3))


def build_textures(kind: str):
    n = TEX_SIZE
    color = bytearray(n * n * 3)
    normal = bytearray(n * n * 3)
    mr = bytearray(n * n * 3)
    height = [0.0] * (n * n)

    for y in range(n):
        v = y / (n - 1)
        for x in range(n):
            u = x / (n - 1)
            idx = y * n + x
            nse = fbm(u * 18.0, v * 18.0)
            grain = fbm(u * 22.0, v * 6.0 + u * 2.0)
            scratch = 1.0 if abs(noise(u * 90.0, v * 6.0) - 0.5) < 0.012 else 0.0
            panel = 1.0 if (abs((u * 8.0) % 1.0 - 0.5) < 0.018 or abs((v * 5.0) % 1.0 - 0.5) < 0.02) else 0.0
            rivet = 1.0 if math.hypot((u * 16.0) % 1.0 - 0.5, (v * 10.0) % 1.0 - 0.5) < 0.07 else 0.0

            if kind == "akm":
                wood = mix_color((0.36, 0.2, 0.1), (0.55, 0.34, 0.16), grain)
                metal = mix_color((0.12, 0.13, 0.12), (0.22, 0.23, 0.21), nse)
                base = wood if v < 0.46 else metal
                metallic = 0.08 if v < 0.46 else 0.82
                rough = 0.62 if v < 0.46 else 0.34
            elif kind == "aug":
                polymer = mix_color((0.22, 0.28, 0.16), (0.32, 0.38, 0.2), nse)
                metal = mix_color((0.1, 0.11, 0.1), (0.2, 0.21, 0.2), nse)
                base = polymer if u < 0.62 else metal
                metallic = 0.04 if u < 0.62 else 0.78
                rough = 0.48 if u < 0.62 else 0.28
            else:
                polymer = mix_color((0.1, 0.12, 0.1), (0.16, 0.18, 0.14), nse)
                metal = mix_color((0.14, 0.15, 0.14), (0.28, 0.29, 0.27), nse)
                base = metal if v > 0.55 else polymer
                metallic = 0.7 if v > 0.55 else 0.06
                rough = 0.3 if v > 0.55 else 0.5

            base = mix_color(base, (0.04, 0.04, 0.04), panel * 0.55)
            base = mix_color(base, (0.55, 0.55, 0.5), scratch * 0.35)
            base = mix_color(base, (0.08, 0.08, 0.08), rivet * 0.4)
            height[idx] = nse * 0.45 + panel * 0.35 + rivet * 0.55 - scratch * 0.2
            o = idx * 3
            color[o : o + 3] = bytes(int(clamp(ch) * 255) for ch in base)
            mr[o : o + 3] = bytes(
                (
                    0,
                    int(clamp(rough + nse * 0.08) * 255),
                    int(clamp(metallic) * 255),
                )
            )

    for y in range(n):
        for x in range(n):
            xl = height[y * n + (x - 1) % n]
            xr = height[y * n + (x + 1) % n]
            yu = height[((y - 1) % n) * n + x]
            yd = height[((y + 1) % n) * n + x]
            nx = (xl - xr) * 4.0
            ny = (yu - yd) * 4.0
            nz = 1.0
            length = math.hypot(nx, ny, nz) or 1.0
            o = (y * n + x) * 3
            normal[o : o + 3] = bytes(
                (
                    int((nx / length * 0.5 + 0.5) * 255),
                    int((ny / length * 0.5 + 0.5) * 255),
                    int((nz / length * 0.5 + 0.5) * 255),
                )
            )

    return png_rgb(n, n, color), png_rgb(n, n, normal), png_rgb(n, n, mr)


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def png_rgb(width: int, height: int, rgb: bytearray) -> bytes:
    raw = bytearray()
    row = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * row : (y + 1) * row])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


UV_WOOD = (0.02, 0.02, 0.48, 0.44)
UV_METAL = (0.52, 0.02, 0.98, 0.48)
UV_POLY = (0.02, 0.52, 0.48, 0.98)
UV_DARK = (0.52, 0.52, 0.98, 0.98)


def add_rail(mesh: Mesh, z0: float, z1: float, y: float, uv_rect) -> None:
    length = z1 - z0
    teeth = max(6, int(length / 0.018))
    add_box(mesh, (0.0, y, (z0 + z1) * 0.5), (0.022, 0.01, length), uv_rect)
    for i in range(teeth):
        z = z0 + (i + 0.5) * (length / teeth)
        add_box(mesh, (0.0, y + 0.008, z), (0.02, 0.01, 0.008), uv_rect)


def build_akm(mesh: Mesh) -> None:
    add_box(mesh, (0.0, 0.02, 0.06), (0.046, 0.078, 0.26), UV_METAL)
    add_box(mesh, (0.0, 0.03, 0.22), (0.04, 0.05, 0.12), UV_METAL)
    add_cylinder(mesh, (0.0, 0.035, 0.28), (0.0, 0.035, 0.78), 0.009, 48, UV_METAL)
    add_cylinder(mesh, (0.0, 0.035, 0.78), (0.0, 0.035, 0.86), 0.012, 36, UV_DARK)
    add_cylinder(mesh, (0.0, 0.058, 0.18), (0.0, 0.058, 0.62), 0.006, 32, UV_METAL, cap=False)
    add_box(mesh, (0.0, 0.072, 0.12), (0.02, 0.016, 0.16), UV_DARK)
    add_box(mesh, (0.0, 0.09, 0.64), (0.012, 0.034, 0.018), UV_DARK)
    add_box(mesh, (-0.01, -0.02, 0.02), (0.03, 0.09, 0.07), UV_WOOD)
    add_box(mesh, (-0.018, -0.07, 0.03), (0.028, 0.08, 0.055), UV_WOOD)
    add_box(mesh, (0.0, -0.01, 0.14), (0.03, 0.12, 0.045), UV_WOOD)
    for i in range(10):
        z = 0.08 + i * 0.014
        add_box(mesh, (0.0, -0.09 - i * 0.01, z - i * 0.003), (0.028, 0.026, 0.036), UV_METAL)
    add_box(mesh, (0.0, 0.01, -0.16), (0.04, 0.07, 0.2), UV_WOOD)
    add_box(mesh, (0.0, 0.03, -0.3), (0.036, 0.1, 0.08), UV_WOOD)
    add_box(mesh, (0.0, 0.05, 0.34), (0.034, 0.028, 0.22), UV_WOOD)
    add_box(mesh, (0.012, 0.0, 0.08), (0.012, 0.02, 0.05), UV_DARK)
    add_rail(mesh, 0.0, 0.2, 0.068, UV_DARK)
    for i in range(8):
        z = 0.32 + i * 0.04
        add_box(mesh, (0.0, 0.05, z), (0.038, 0.006, 0.012), UV_WOOD)


def build_aug(mesh: Mesh) -> None:
    add_box(mesh, (0.0, 0.03, 0.08), (0.05, 0.09, 0.42), UV_POLY)
    add_box(mesh, (0.0, 0.04, -0.18), (0.048, 0.1, 0.16), UV_POLY)
    add_box(mesh, (0.0, 0.12, 0.04), (0.03, 0.06, 0.28), UV_DARK)
    add_box(mesh, (0.0, 0.16, 0.0), (0.034, 0.045, 0.16), UV_DARK)
    add_cylinder(mesh, (0.0, 0.04, 0.28), (0.0, 0.04, 0.92), 0.01, 48, UV_METAL)
    add_cylinder(mesh, (0.0, 0.04, 0.92), (0.0, 0.04, 1.0), 0.013, 36, UV_DARK)
    add_box(mesh, (-0.01, -0.03, 0.02), (0.03, 0.1, 0.07), UV_POLY)
    add_box(mesh, (-0.018, -0.08, 0.03), (0.028, 0.08, 0.055), UV_POLY)
    add_box(mesh, (0.0, -0.05, -0.1), (0.03, 0.1, 0.05), UV_DARK)
    for i in range(9):
        add_box(mesh, (0.0, -0.1 - i * 0.01, -0.08 - i * 0.003), (0.026, 0.026, 0.034), UV_METAL)
    add_box(mesh, (0.0, 0.055, 0.48), (0.036, 0.03, 0.26), UV_POLY)
    add_box(mesh, (0.0, 0.08, 0.22), (0.02, 0.02, 0.12), UV_METAL)
    add_box(mesh, (0.018, 0.0, 0.06), (0.01, 0.018, 0.04), UV_DARK)
    add_rail(mesh, -0.08, 0.18, 0.155, UV_DARK)
    for i in range(10):
        z = 0.34 + i * 0.05
        add_box(mesh, (0.0, 0.055, z), (0.04, 0.006, 0.014), UV_POLY)


def build_m4(mesh: Mesh) -> None:
    add_box(mesh, (0.0, 0.025, 0.04), (0.042, 0.07, 0.22), UV_POLY)
    add_box(mesh, (0.0, 0.03, 0.2), (0.038, 0.05, 0.16), UV_METAL)
    add_box(mesh, (0.0, 0.055, 0.08), (0.028, 0.02, 0.28), UV_DARK)
    add_cylinder(mesh, (0.0, 0.03, 0.28), (0.0, 0.03, 0.62), 0.009, 48, UV_METAL)
    add_cylinder(mesh, (0.0, 0.03, 0.62), (0.0, 0.03, 0.7), 0.012, 36, UV_DARK)
    add_box(mesh, (0.0, 0.03, -0.16), (0.036, 0.06, 0.16), UV_POLY)
    add_box(mesh, (0.0, 0.03, -0.28), (0.03, 0.05, 0.1), UV_POLY)
    add_box(mesh, (0.0, 0.03, -0.36), (0.024, 0.08, 0.04), UV_DARK)
    add_box(mesh, (-0.01, -0.02, 0.0), (0.028, 0.09, 0.06), UV_POLY)
    add_box(mesh, (-0.016, -0.07, 0.01), (0.026, 0.08, 0.05), UV_POLY)
    add_box(mesh, (0.0, -0.02, 0.1), (0.028, 0.11, 0.04), UV_DARK)
    for i in range(9):
        add_box(mesh, (0.0, -0.09 - i * 0.01, 0.1), (0.026, 0.024, 0.032), UV_METAL)
    add_box(mesh, (0.0, 0.048, 0.34), (0.032, 0.026, 0.2), UV_DARK)
    add_box(mesh, (0.0, 0.08, 0.06), (0.016, 0.03, 0.04), UV_DARK)
    add_rail(mesh, -0.04, 0.22, 0.068, UV_DARK)
    add_rail(mesh, 0.22, 0.46, 0.052, UV_DARK)
    for i in range(8):
        z = 0.3 + i * 0.035
        add_box(mesh, (0.018, 0.03, z), (0.004, 0.018, 0.018), UV_DARK)
        add_box(mesh, (-0.018, 0.03, z), (0.004, 0.018, 0.018), UV_DARK)


BUILDERS = {"akm": build_akm, "aug": build_aug, "m4": build_m4}


def pack_f32(values) -> bytes:
    return b"".join(struct.pack("<f", float(v)) for v in values)


def pack_u32(values) -> bytes:
    return b"".join(struct.pack("<I", int(v)) for v in values)


def bounds(values, stride):
    mins = [min(values[i::stride]) for i in range(stride)]
    maxs = [max(values[i::stride]) for i in range(stride)]
    return mins, maxs


def align4(blob: bytes, pad: bytes) -> bytes:
    extra = (4 - (len(blob) % 4)) % 4
    return blob + pad * extra


def write_glb(path: str, mesh: Mesh, images: tuple[bytes, bytes, bytes]) -> None:
    smooth_normals(mesh)
    tangents = tangents_of(mesh)
    pos = [c for p in mesh.positions for c in p]
    nrm = [c for p in mesh.normals for c in p]
    uvs = [c for p in mesh.uvs for c in p]
    tan = [c for p in tangents for c in p]
    idx = mesh.indices

    color_png, normal_png, mr_png = images
    chunks = [
        pack_f32(pos),
        pack_f32(nrm),
        pack_f32(uvs),
        pack_f32(tan),
        pack_u32(idx),
        color_png,
        mr_png,
        normal_png,
    ]
    aligned = []
    offset = 0
    views = []
    for blob in chunks:
        if offset % 4:
            pad = 4 - (offset % 4)
            aligned.append(b"\x00" * pad)
            offset += pad
        views.append((offset, len(blob)))
        aligned.append(blob)
        offset += len(blob)
    bin_blob = align4(b"".join(aligned), b"\x00")

    def accessor(view, count, type_name, component, mins=None, maxs=None):
        data = {"bufferView": view, "componentType": component, "count": count, "type": type_name}
        if mins is not None:
            data["min"] = mins
            data["max"] = maxs
        return data

    pmin, pmax = bounds(pos, 3)
    doc = {
        "asset": {"version": "2.0", "generator": "3D-game weapon builder"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": os.path.splitext(os.path.basename(path))[0]}],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2, "TANGENT": 3},
                        "indices": 4,
                        "material": 0,
                    }
                ]
            }
        ],
        "materials": [
            {
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicRoughnessTexture": {"index": 1},
                    "metallicFactor": 1,
                    "roughnessFactor": 1,
                },
                "normalTexture": {"index": 2, "scale": 1},
                "doubleSided": False,
            }
        ],
        "textures": [{"source": 0}, {"source": 1}, {"source": 2}],
        "images": [
            {"mimeType": "image/png", "bufferView": 5},
            {"mimeType": "image/png", "bufferView": 6},
            {"mimeType": "image/png", "bufferView": 7},
        ],
        "accessors": [
            accessor(0, len(mesh.positions), "VEC3", 5126, pmin, pmax),
            accessor(1, len(mesh.normals), "VEC3", 5126),
            accessor(2, len(mesh.uvs), "VEC2", 5126),
            accessor(3, len(tangents), "VEC4", 5126),
            accessor(4, len(idx), "SCALAR", 5125),
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": off, "byteLength": length} for off, length in views],
        "buffers": [{"byteLength": len(bin_blob)}],
    }

    json_blob = align4(json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    glb = b"".join(
        (
            struct.pack("<III", 0x46546C67, 2, total),
            struct.pack("<II", len(json_blob), 0x4E4F534A),
            json_blob,
            struct.pack("<II", len(bin_blob), 0x004E4942),
            bin_blob,
        )
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(glb)
    tris = len(idx) // 3
    print(f"{os.path.basename(path)}: {tris} tris, {len(mesh.positions)} verts, {len(glb)} bytes")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for kind, builder in BUILDERS.items():
        mesh = Mesh()
        builder(mesh)
        write_glb(os.path.join(OUT_DIR, f"{kind}.glb"), mesh, build_textures(kind))


if __name__ == "__main__":
    main()
