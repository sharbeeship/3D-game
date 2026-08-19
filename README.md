# 3D First-Person Shooter

A zero-dependency browser WebGL game.

## Controls

- Click the screen to lock the mouse, `Esc` to release it
- `WASD` to move, `A` / `D` to strafe
- `Shift` to sprint
- `Space` to jump
- `F` to pick up a nearby gun (replaces the gun in hand)
- `E` to drop the current weapon
- `1` / `2` / `Q` to switch weapons, with holster and raise animation
- Left click to shoot when armed, right click to aim down sights
- Left click to punch when unarmed
- Scroll the mouse wheel while aiming to adjust zoom

## Features

- Solid brown ground, cover walls, and obstacles; you cannot walk through them
- Guns and hands are solid too: facing a wall or strafing along one pulls the model back so it does not clip through
- AUG, AKM, and M4A1 spawn on the map; you can carry up to 2 guns
- Each gun has a different fire rate, recoil, and gunshot
- Walking and running use grass footstep sounds synced to the arm swing; footsteps mute while punching
- Bullets leave holes on walls that fade after a while
- Aiming down sights hides the gun and keeps the reticle and scope overlay

## Run

Start a static server in the project folder:

```bash
python3 -m http.server 4174
```

Then open:

```text
http://localhost:4174/?v=38
```

## Remotes

- Cursor Origin (not public): `https://origin.cursor.com/sharbeeship/3D-game.git`
- GitHub: `https://github.com/sharbeeship/3D-game`

This clone keeps both in sync. `git push origin` sends `main` to Origin and GitHub. If the two remotes ever diverge (for example after a GitHub web edit), run:

```bash
./scripts/sync-origin-github.sh
```

That fetches both remotes, merges `main`, and pushes the result to both. It never force-pushes.

Optional cloud sync: add a GitHub Actions secret named `ORIGIN_TOKEN` (an Origin Git HTTPS token, username `x-access-token`). The workflow in `.github/workflows/sync-origin.yml` then copies commits both ways on a schedule and on GitHub pushes.

## License

This project is open source under the [MIT License](LICENSE).

