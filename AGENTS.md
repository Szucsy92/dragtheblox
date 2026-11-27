<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Game rules/constants live in `src/game/*` (no React); the 3D scene in `src/components/game/*` only draws and wires input. Why: keeps physics feel tunable via named constants.
- Live physics bodies are tracked in `src/game/registry.ts`, not React state. Why: drag/shake touch bodies every frame without re-rendering.
- The carried block is a dynamic body steered by capped velocity (`carryVelocity`) towards the target from `computeCarry` (hover above the highest block under it or under the finger, magnet onto flat tops, never overlap a neighbour). It touches only the ground, the walls and its passengers (blocks resting on it, `GROUP_PASSENGER`); passengers are carried by friction and are never parented or teleported. Why: direct, shove-free lifting and stacking, while a jerk still leaves the stack behind.
- Fits are precise but soft: `snapAxis` pulls the carried block onto a centre, a flush edge or (on a top) the half-cube grid; exact inside `SNAP_HARD` of the range, eased off smoothly beyond it (no jumps). On the same level it is pulled against a neighbour until the faces touch (`CONTACT_EPS`) and aligned to that neighbour's edge or centre. Why: tidy walls and towers without a rigid, mechanical feel.
- Carrying is lively: the block leans into the motion (`leanFor`, never with passengers, never while magnet-locked, tiny above a support) and a released block that is not magnet-locked keeps `RELEASE_KEEP` of its speed, so it slides a little and settles under friction.
- Releasing over a tower places gently (zero velocity); only a gesture faster than `FLICK_SPEED` throws there, and the lift assistant steps aside during such a flick. Why: building must not turn into accidental throws, throwing at a tower must still work.
- Dev-only `window.__game` exposes snapshots, spawn/clear, screen projections and physics probes; keep these hooks behind DEV. Why: browser checks must use the live physics world rather than duplicate module instances.
- Everything sized to the arena or the blocks derives from `PLAY_AREA` / `BLOCK_SCALE` (walls, rim, spawn, shadow camera, contact shadows, camera framing); never hard-code arena-sized numbers. Why: when the arena doubled and the blocks grew, the shadows stayed sized for the old room.
- Sound reacts to sudden jumps in contact force per mass (`impactStrength`), never to the absolute force. Why: a tall stack presses on its bottom block constantly and must stay silent.
- Per-frame code reads bodies only through `poseOf` / `snapshot` (they drop a freed body instead of throwing), the drag frame is wrapped so an error cancels the drag, and `Keeper` / `AutoFrame` repair NaN bodies and a NaN camera. Why: one exception or NaN in the frame loop freezes the whole game.
- No pointer bookkeeping that can go stale: a second finger is `!isPrimary`, and a drag is cancelled on blur / hidden tab / mouse released outside. Why: a lost pointerup used to leave the drag (and the trash button) stuck and block every later grab.
- Trashing a carried block never gives it its collisions back (it overlaps the castle); only its passengers return to normal.
- The Android app (`native/android`) is a thin Kotlin shell around an OFFLINE bundle of the game: `native-web/` + `vite.native.config.ts` (`bun run build:native`) build the Playroom without SSR/router, the workflow copies it to `assets/www`, and the WebView serves it only from its own `appassets.androidplatform.net` origin; every other request is blocked. Kiosk: `startLockTask` / device-owner Lock Task, immersive, parent menu by 5 taps in the top-right corner, update dialog from GitHub Releases. `.github/workflows/android-build.yml` is the only official Android build; release tags are `native-<date>-<run number>` and the run number is the APK `versionCode`. Why: the game must run with no internet; the in-app updater compares the tag number with the installed `versionCode`.
- The game must never need a URL or the network to play: do not load remote assets (fonts, HDRIs, CDNs) in anything reachable from `native-web/main.tsx`; `src/test/native-offline.test.ts` guards the entry page and the stylesheet. Why: the APK is an offline app and blocks all external requests.
- The Android signing key is created by the first build and lives encrypted on the `signing` branch (never on `main`, never as a committed file); never delete or overwrite that branch, and every release must be signed with that same key. Why: an APK signed with another key cannot update the installed app.
- The carried block never collides with the castle but must not pass through it either: `sweepMove` clips its path against the other blocks (stop at a face, slide along it, rise along a tower until it clears the top). Why: a quick swipe used to jump to the far side of a block.
- A block with a stack on it is moved with a limited acceleration (`loadAccel`, about g / stack height) and without lift-off or yaw alignment. Why: a stack tips when the base is pushed harder than friction and its own width allow.
- On release the block is put down, not dropped: upright, just touching its support (`REST_GAP`), at `rest` (the centre of mass pulled over the support, `SAFE_EDGE`); while carrying, the position follows the finger smoothly. Magnet candidates and the rest spot never put the centre of mass on or beyond a support's edge. Why: tall towers fell from the drop impact and from half-overhanging fits.
- New blocks appear around the middle of what the camera shows (`pickSpawn` with `anchor` / `accept` from the projected view), and the camera frames the whole castle with room above it for the next block (`frameFor` fits width and height separately, each against its own field of view, so a thin tower of any height is framed from a steady distance; a manual zoom is kept as a ratio). The camera NEVER moves while a block is carried. Why: blocks spawned off screen, and a view that zoomed and slid while a high block was being placed made exactly that placement hard.
- Finger speed (flick / throw decisions) is measured on the plane of the carried block's own height and scaled to the default camera distance (`GESTURE_REF_DIST`), and pointing at a block has a tolerance (`pickBlock` margin). Why: measured on the floor plane, a finger at the top of a tall tower looked several times faster and switched the lift assistant off.

