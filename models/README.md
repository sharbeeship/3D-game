# Weapon models

Drop Blender exports here. The game loads these GLBs with PBR lighting:

- `aug.glb`
- `akm.glb`
- `m4.glb`

The first-person hands are `models/hands/hand_idle.glb`, `hand_grip.glb`, `hand_grip_left.glb` (rifle support hand, no thumb), and `hand_fist.glb`. Rebuild them with `python3 scripts/build_hand_glb.py`.

The first-person body is `models/player/torso.glb`, `leg.glb`, `head.glb`, and `arm.glb`. Origin is the eye; +Y up, +Z forward. Head and arms are shown in third person. Rebuild with `python3 scripts/build_body_glb.py`.

Starter files in this folder are game-ready stand-ins (hard-surface mesh + 512px maps). Replace them with your high-poly bake for the real look.

## Target

| | Spec |
| --- | --- |
| Game mesh | 8,000–25,000 triangles |
| Textures | 2048×2048 (2K) |
| Format | glTF 2.0 **GLB** |
| Maps | Base Color, Normal (OpenGL +Y), Metallic-Roughness (B = metal, G = roughness) |

Do not put the high-poly sculpt in the game. Bake normals / AO / curvature onto the low mesh.

## Blender export

1. Real-world scale: 1 unit = 1 meter. Rifle length about 0.7–1.0 m.
2. Origin at the grip. Barrel points **+Z**, up is **+Y**, right is **+X**.
3. Apply all transforms. Apply modifiers. Do not export subdivision as render-level.
4. One material using Principled BSDF.
5. File → Export → glTF 2.0 (GLB):
   - Format: GLB
   - Include: Selected Objects only if needed
   - Transform: +Y Up
   - Geometry: Apply Modifiers, UVs, Normals, Tangents
   - Compression: optional, keep the game loader simpler if you skip Draco

Overwrite the matching file in this folder. Hard-refresh with `?v=` bumped in `index.html` if the browser caches the old GLB.

Rebuild the starter stand-ins with:

```bash
python3 scripts/build_weapon_glb.py
```
