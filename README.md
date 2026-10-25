# Redmoor: Break Out

A two-player online co-op 3D prison-escape adventure that runs in the browser: phones, tablets and computers. Two friends, Elias and Jax, break out of Redmoor State Correctional Facility, get picked up by Jax's cousin, buy guns from a dealer, make the framer's brother talk, shoot their way into his garage, and escape the police through the forest on his dirt bikes.

Every player controls their own character on their own device. There is no split screen and no AI partner.

**Play:** <https://prisonbreak.okdgames.com> (GitHub Pages, built from `main`).

## Quick start: play with a friend

1. Both open the website. On a phone, landscape gives the biggest view, but portrait works too.
2. One player taps **Create game** and gets a 5-letter room code, plus an **Invite friend** link.
3. The other taps **Join game** and enters the code, or opens the invite link.
4. Pick characters, both press **Ready**, then the host presses **Start**.

No account, server or setup is needed.

The room creator's browser hosts the room. The partner connects to it directly over WebRTC; the free [PeerJS](https://peerjs.com) signalling service only introduces the two browsers. When a direct connection is impossible (some mobile networks), PeerJS's public relay carries the traffic.

## Chapters

| # | Chapter | What happens |
|---|---|---|
| 1 | Prison Life | Arrival, the yard fight, stealing a screwdriver, a co-op boost/pull through the laundry duct, the evening count |
| 2 | The Breakout | Night: vents, the maintenance hatch (lifted together), the steam tunnel, the drain, the searchlit yard, the wall, the river |
| 3 | On the Run | Dawn manhunt in the woods, pushing a dead pine across a ravine, stealing clothes at a farm, Ray's car at dusk, Jax's trailer and his hidden cash (lifted together), a ride out on dirt bikes and the arms deal: each player picks a weapon from the table behind Dutch's car |
| 4 | The Brother | A working construction site in daylight: find Julius Crane in the pit, chase him up the stairs, fight his two biggest workers, drag him out of his car and make him talk in the site office |
| 5 | The Garage | Crane Motors at midnight: two lookouts, an ambush and a shootout, Victor running for the dock, his safe (opened together), and police at the front door |
| 6 | The Getaway | Victor's dirt bikes (each rider controls their own) chased by police through fields, a river, the highway and the forest with plenty of jumps, to the ridge and the ending |

Progress saves at every checkpoint. **Continue** resumes from the last one.

**Optional extras.**

- **Mini-games.** Arm wrestling at a dayroom table in chapter 1 (mash Use), and a shooting contest at the hoop by Jax's trailer in chapter 3 (time the meter, 5 shots each). Both players stand at the two spots and hold Use to start; the game runs on the host and both see the same result.
- **Weapons.** At the end of chapter 3 each player picks one from Dutch's table: M3 Grease Gun or Suomi KP (fast, wide SMGs), AK-47 (hard-hitting), M4A1 (accurate on full auto), pump shotgun (eight pellets, close range), hunting rifle (one shot) or Makarov pistol. Aiming is automatic; hold Shoot for automatic weapons. The pick carries into chapters 4–6.
- **Memories.** Objects to examine in chapters 1–4 (a photo, wall marks, the TV news, a letter, a radio, the river, a site sign and more), each with a short conversation that fills in the story. Either player can trigger one, both hear it, and the found count is shared.

## Controls

**Touch (phones, tablets).** Left side: a fixed joystick (push far to run). Settings → Controls → **Edit HUD & controls** moves and resizes the joystick, every button and the HUD. Right side: drag to look. On-screen buttons change with the situation: Use, Hit, Block, Dodge, Jump, Crouch, Run. On the bike they are Gas, Brake and Boost. Hold anywhere to skip a cutscene.

The button layout, size and opacity can be changed under **Settings → Controls → Edit button layout**. Landscape and portrait keep separate layouts.

**Keyboard + mouse.**

| Key | Action |
|---|---|
| Click the game | Capture the mouse for looking |
| Mouse | Look |
| Wheel | Zoom |
| WASD | Move |
| Shift | Run |
| C | Crouch |
| E | Use (hold for co-op actions) |
| Space | Jump |
| Left click | Hit |
| Right click | Block |
| Q | Dodge |
| Enter | Skip a cutscene |
| Esc | Pause (losing the mouse capture pauses too) |
| W / S / A / D on the bike | Gas, brake, steer |
| X on the bike | Boost |

**Gamepad.** Xbox, PlayStation and most standard USB/Bluetooth pads work.

| Button | Action |
|---|---|
| Left stick | Move |
| Right stick | Look |
| Y / △ | Use |
| A / ✕ | Jump |
| B / ○ | Crouch |
| X / □ | Hit |
| LB / L1 | Block |
| RB / R1 | Dodge |
| L3 | Run |
| RT / LT | Analog gas and brake on the bike |
| Menu / Options | Pause |
| View / Share | Skip |

Menus can be navigated with the D-pad or stick: A/✕ selects, B/○ goes back. On-screen prompts show the right button names for the device you are using.

## Settings

- **Graphics:**
  - Quality presets Auto, Low, Medium, High and Ultra. Dynamic resolution keeps the frame rate steady.
  - Interface size: the UI also scales automatically to the screen.
  - Performance overlay.
- **Controls:** sensitivity for touch, mouse and gamepad, invert Y, auto camera, touch button size and opacity, and the touch layout editor.
- **Audio:** master, music, sound effects, dialogue and ambience, plus optional spoken dialogue (device voice).
- **Gameplay:** subtitles and subtitle size, vibration, delete saved progress.
- **Network:** leave empty to play by room code (recommended). Only enter an address if you run your own room server.

## Run it locally

Requires Node.js 20+ (22 recommended).

```bash
npm install
npm run build            # client -> dist/, server -> dist-server/
npm start                # http://localhost:8080 (serves the game and WebSocket rooms on /ws)
```

For development with hot reload:

```bash
npm run server           # room server on :8080
npm run dev              # Vite on :5173 (proxies /ws to :8080)
```

A local build uses the WebSocket room server. Add `?net=p2p` to the URL to use peer-to-peer rooms instead.

## Deployment

### GitHub Pages (what prisonbreak.okdgames.com uses)

`.github/workflows/deploy-pages.yml` builds the client in peer-to-peer mode and publishes `dist/` on every push to `main`. It can also be started manually under **Actions → Deploy client to GitHub Pages → Run workflow**. `public/CNAME` keeps the custom domain.

One-time setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**. With "Deploy from a branch", Pages would publish the raw source files and the page would show only text.

### Optional: a dedicated room server

Peer-to-peer needs no server. If you prefer server-hosted rooms (for example on a network that blocks WebRTC):

1. Deploy this repository to any Node host that supports WebSockets, such as Render, Railway, Fly.io or a VPS:
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - The server reads `PORT` and serves both the game and the rooms; `/health` reports status.
2. Optionally set the repository variable **GAME_SERVER_URL** to the server's address, for example `wss://your-server.example.com` (Settings → Secrets and variables → Actions → Variables). Then re-run the deploy workflow. The Pages build then uses that server instead of peer-to-peer.

Players can also point a single device at a server under Settings → Network, or with `?server=wss://…`.

### Mobile app

- **Install as an app (PWA).** The site has a web manifest and icons. Use "Add to Home Screen" (iOS Safari) or "Install app" (Android Chrome) for a full-screen launcher icon.
- **Native packages.** None are built in this repository. To wrap the game with [Capacitor](https://capacitorjs.com):
  1. Run `npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios`.
  2. Run `npx cap init "Redmoor" com.example.redmoor --web-dir dist`.
  3. Run `npm run build`, then `npx cap add android` (and/or `ios`), then `npx cap sync`.
  4. Open the project in Android Studio or Xcode to sign and build.

  This needs the Android SDK or Xcode and your own signing keys.

## How multiplayer works

- **Rooms.** `shared/rooms.ts` handles rooms:
  - private 5-character codes and 2 seats;
  - character selection (swapped automatically);
  - ready checks and host start;
  - reconnection tokens with a 2-minute grace period;
  - world-authority hand-off.

  The same code runs in the Node server (`server/index.ts`) and inside the host's browser for peer-to-peer rooms (`src/net/p2p.ts`).
- **Game sync.** One player is the world authority. It orders all game events (interactions, co-op actions, NPC hits, checkpoints, cutscenes) and simulates the NPCs; the other client mirrors its state.
  - Player positions and animation are sent at 15 Hz, and NPC states at 10 Hz.
  - Cutscenes and timed events use a shared clock.
  - A player who reconnects gets a full state resync.
- **Co-op actions.** Boosts, pulls, the hatch, the log, the breakers and others only complete when both players hold them at the same time; each player sees the other's progress.
- **Reconnects.** If a player drops, the game pauses for both with a countdown. A reload or a lost connection resumes the same game. If the host of a peer-to-peer room reloads, the room is restored and the partner, who kept the live world, takes over as authority.

## Tests and tools

Each command below runs real, separate browser instances (Chromium with software WebGL), not one player driving two characters.

| Command | What it checks |
|---|---|
| `npm run test:server` | Room server protocol: create, join, full rooms, codes, ready/start, resume, leave, version mismatch |
| `npm run test:e2e [url]` | Two browsers: lobby, invite link, character swap, ready/start, both load and begin together, authority, cutscene skip voting, movement and NPC sync, guest reload resume, socket drop, leaving. `Q='peer=host:port'` runs it over peer-to-peer |
| `node tools/coop.mjs <ch> <checkpoint> @tests/coop/chN.json [url]` | Scripted two-player playthroughs of each chapter's co-op puzzles, fights and chapter ends (`tests/coop/ch1…ch6.json`), plus `minigame-arm.json`, `minigame-hoops.json`, `memory.json` and `p2p-host-reload.json` |
| `node tools/soak.mjs [url] [secs]` | Random play in every checkpoint, reporting crashes, NaNs and long falls. `FPS=8` simulates a slow phone |
| `node tools/cliff.mjs [url] [fps]` | Sprints into the steepest slopes of each level and measures sinking below the ground |
| `node tools/leak.mjs` / `tools/memory.mjs` | Live game objects and GPU textures, geometry and shaders across chapter loads |
| `node tools/tour.mjs` / `tools/shot.mjs` / `tools/play.mjs` | Screenshots and scripted solo sessions for visual checks |
| `node tools/profile.mjs <url>` | CPU profile of the running game |

Developer solo mode (not in the menus): `?dev=solo&ch=3&cp=farm` loads a checkpoint without a partner. `?render=0` skips drawing (logic tests), and `?fps=8` simulates a slow device.

## What has been verified, and what has not

**Verified here** (headless Chromium with software rendering):

- Every chapter and checkpoint loads and plays without script errors.
- The two-player tests pass:
  - Chapter 1: 23/23
  - Chapter 2: 26/26
  - Chapter 3: 38/38 (plus the arms deal on its own: 11/11)
  - Chapter 4: 20/20
  - Chapter 5: 20/20
  - Chapter 6: 12/12 (to the ending)
  - Lobby/reconnect end-to-end: 17/17, over both the WebSocket server and peer-to-peer
  - Server protocol: 11/11
  - Host reload in peer-to-peer: 5/5
  - Mini-games: arm wrestling 8/8, hoops 6/6
  - Memories: 6/6
- No falling through the ground in the steep-slope test at 8 fps. The previous build failed it in chapters 3, 4 and 6.
- Memory stays flat across six chapter loads.
- The UI was checked at phone (portrait and landscape), tablet and 1080p sizes.

**Not verified:**

- Real phones and GPUs: performance numbers from software rendering are not representative.
- iOS Safari specifics.
- Physical gamepads: the mapping follows the standard Gamepad API layout but was not tested with hardware.
- Peer-to-peer through the public PeerJS service and real mobile networks. It was tested with a local copy of the same signalling server, because the public one is not reachable from the build environment.
- Native Android/iOS packages: not built.

## Known limitations

- A peer-to-peer room lives in the creator's browser. If the creator closes the game, the room pauses for the partner and ends if they don't return within about 100 seconds.
- Spoken dialogue uses the device's built-in voices, so quality varies. Subtitles are always available.
- Total play time depends heavily on how players approach stealth and fights. It is shorter than a full commercial co-op game.

## Assets and licences

All characters, story and dialogue are original. Third-party assets are listed with author, source and licence in [CREDITS.md](CREDITS.md) and on the in-game Credits screen. They include:

- **Characters and animations:** Microsoft Rocketbox (MIT).
- **Props:** Sketchfab CC-BY models obtained through a redistributed open-source collection, and Poly Haven CC0 models.
- **Textures:** Poly Haven / ambientCG CC0 textures and HDRIs.
- **Sound:** CC0 sound effects and music.
- **Leaf texture:** from EZ-Tree (MIT).

No asset was taken from behind a paywall or a restricted download.

The asset import tools (`tools/import-assets.mjs`, `tools/build-characters.mjs`, `tools/build-anims.mjs`) document where every file came from. They were run against local clones of public repositories, because these asset hosts are blocked by the build environment's network policy:

sketchfab.com, api.polyhaven.com, dl.polyhaven.org, ambientcg.com, kenney.nl, quaternius.com, opengameart.org, freesound.org, mixamo.com, poly.pizza, huggingface.co, download.blender.org, itch.io, cdn.jsdelivr.net, dl.google.com.

To fetch assets directly from those sites, allow the hosts in the environment's network settings (Claude Code on the web: environment settings → network access → custom allow-list).

## Project layout

```
src/app.ts            app shell: boot, menus, lobby, loading, chapter flow
src/engine/           renderer and quality presets, physics, camera, input, audio, characters, assets
src/game/             game session, players, NPCs, bikes, cutscenes, dialogue, interactions, world
src/levels/           chapters 1–6, level kit, terrain, water, foliage, lights, vehicles
src/net/              network client, peer-to-peer transport
src/ui/               HUD, menus, touch controls, UI scaling, gamepad menu navigation
shared/               protocol and room manager (server and browser)
server/               Node room server
tests/, tools/        automated tests and developer tools
public/assets/        models, characters, animations, textures, audio, credits
```
