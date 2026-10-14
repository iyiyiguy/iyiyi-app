# 03 — Arcade & games teardown (working tree incl. unpushed "pro studio" redesign)

Scope: Arcade tab + lobbies/shops + every game. I worked from the code only (no device). Paths are relative to `app/`. P0 = broken, unplayable or unfair. P1 = fun, clarity or retention. P2 = polish.

---

## 0. Owner-reported issues (checked in the code)

### 1. Hip fire: the 3D laser bolts fly the wrong way — CONFIRMED
- **Root cause.** `fireShot` only passes a muzzle origin in camera mode: `from = aim.mode === 'camera' ? muzzlePoint(...) : null` (`src/games/LaserTagGame.js:1022`). In hip fire (`topMode`), `addOutgoing` falls back to a gun that isn't drawn, at bottom-right (`screenW*0.7, screenH*0.8`) (`src/games/laser/BattleEffects.js:494-495`). The target is `aimPointRef`. That ref is built from camera markers and `plateMarkers`, and `plateMarkers` returns `[]` in topMode (`LaserTagGame.js:1315`, `1350-1361`). So the target ends up at **screen centre ± random scatter** (`BattleEffects.js:492-493`). Then `LaserBolt` applies the into-the-scene perspective curve, shrinking to 6 % (`BattleEffects.js:202-222`).
- **Result.** In hip fire the screen is a heading-up radar: "me" is the radar centre and the gun is the phone's top edge (`HipFire.js:1-4`). The bolt starts from an invisible bottom-right gun and heads to the screen centre, which is not the radar centre (the radar sits at `hip.top`, `LaserTagGame.js:1460`). It also shrinks "into the distance", which reads as firing down into the floor. It never travels toward the locked enemy diamond or straight up the cone.
- **Fix.**
  1. Have `HipFireRadar` report its centre and the screen position of `lockedId` (same math as `place()`, `HipFire.js:21-25`).
  2. In topMode, call `addOutgoing(..., from = radarCentre, target = lockedDiamond || {x: radarCentre.x, y: radarTop})`.
  3. Add a `flat: true` flag to `LaserBolt` that skips `perspAt`/`shrinkAt`: linear travel at constant scale, with an impact ring on the diamond.
  4. The 'trigger' mode (no gun model) has the same null `from`. Use a bottom-centre origin there.

### 2. Rockets don't explode when they hit a wall or anything else — CONFIRMED (3 causes)
- **(a) A miss sends nothing.** The rocket is an ordinary `hit` action. `fireCompass` returns on "No one in your sights"/"Miss" before `sendHit` (`LaserTagGame.js:1003-1010`). The vision path falls back to compass the same way (`1081-1084`). No explosion is ever drawn, and the engine has no "rocket hits the ground/wall" splash (`engine.js:712-741` runs only inside `applyHit` with a valid target).
- **(b) The shooter sees no blast even on a hit.** The `hit_ok` handler plays `hit` sfx and score pops, but no `battle.addExplosion` (`LaserTagGame.js:493-507`).
- **(c) The direct-hit victim gets `zone: 'body'|'head'`, not `'rocket'`.** `victimMsg.zone = reply.data.zone` (`LaserTagGame.js:808`). So only splash victims hit the `isExplosive` branch (`543-547`).
- **Also.** The rocket's projectile is the same thin laser capsule (`glowFor('rocket')`) with a small flare. It doesn't read as a rocket.
- **Fix.**
  - Client: on every rocket pull, draw an explosion where the bolt lands: `LaserBolt` → `onImpact(toX,toY)` → `addExplosion('Rocket')` positioned at that point. Use the live-tracker box when there is a target. With no target, use a fixed "wall" depth of about 60 % of the way to centre, or LiDAR depth on Pro phones later.
  - Engine: add a `rocket` action carrying `{bearing}`. The host computes the impact point = shooter pos + min(range, first enemy along the bearing, else 20-30 m) and applies `ROCKET_SPLASH_*` around it. Misses then still splash.
  - Send `zone:'rocket'` to the direct victim too.

### 3. Mines and C4 should be visible in the camera (AR) view — PARTLY BUILT, hidden by the mode switch
- `GroundExplosives` already projects your own C4 and mines into the camera view (`src/games/laser/GroundExplosives.js`, mounted at `LaserTagGame.js:1578-1591`). The owner can't see them because:
  1. **They're hidden in hip fire** (`camPerm?.granted && !topMode`, `LaserTagGame.js:1578`). Tilting the phone down past about 49° counts as "flat" (`useAim.js:51-57`, `STRONG = 0.75`) and switches to hip fire. Hip fire covers the camera with an 86 % black scrim (`LaserTagGame.js:1500`, `1935`). **Looking at the ground is exactly the posture that hides the camera.** Landscape upright also maps to `'top'` (`useAim.js:178`), so in landscape the camera never shows.
  2. **The projection ignores pitch.** `y` assumes the horizon is at screen centre (`GroundExplosives.js:30-31`). A mine at your feet (d≈0-3 m) is clamped to `view.height - 70`, and with phone-to-mine bearing noise inside GPS error (5-15 m) it drifts to an edge chip.
  3. Only *your own* explosives are drawn (`by === meId`, `LaserTagGame.js:1583`). Teammates' mines aren't.
- **Fix.**
  - Keep the camera in a third posture, "looking down" (pitch 20-60°), instead of flipping to hip fire. Switch to hip fire only when it's truly flat (|z| > 0.92).
  - Feed device pitch from the accelerometer into `groundMarkers` (horizon y = centre + pitch/vfov·H).
  - Below about 8 m, stop projecting by GPS. Show a fixed "C4 AT YOUR FEET / 3 m BEHIND" ground ring instead.
  - Best option: on placement, drop an ARKit/ARCore world anchor so the object really sticks to the floor while that session lives. GPS stays the server truth.
  - Show teammates' explosives in their team colour.

### 4. Sticky bombs: place several, then one Detonate — NOT SUPPORTED (single-slot design)
- **Root cause.**
  - Client: one slot, `stickyBombPos.current` (`LaserTagGame.js:1141-1170`), and `placeStickyBomb` returns early if one is already placed (`1143`).
  - Button: a two-state toggle (`Consumables.js:53-86`).
  - Engine: one location per action plus `STICKY_BOMB_COOLDOWN_MS = 3000` (`engine.js:598`), so sending N actions drops all but the first.
- **Security bug in the same code (P0).** The host trusts the client's `lat/lng` for the detonation (`engine.js:599`). Placement is never recorded on the host, so a modified client can detonate a sticky bomb on top of any enemy anywhere.
- **Fix (design).**
  - New host action `sticky_place`. The host stamps the **host-seen** position, stores `state.stickies[from] = [...]` (cap 3-5, decrement inventory server-side), and replies with ids.
  - The tile becomes a split control: tap = place another (count badge `x3`); a separate red **DETONATE (3)** tile appears after the first placement.
  - `sticky_detonate` blows up every stored sticky for that player in one host pass: sum the damage per target, cap at 100, one kill credit each.
  - Draw all of them in `GroundExplosives`. They auto-disarm on death or round end.

### 5. Beside Them: scanning stations vs GPS auto-tasks — the scan step doesn't verify anything today
- **Facts.**
  - Station creation needs a photo + GPS (`beside/StationScanner.js:23-40`) and at least 3 stations (`beside/Setup.js:12,19`).
  - During play, "scanning" is pure ceremony: the player presses **"It matches"** (`beside/ScanTask.js:97`), and nothing compares the frame to the reference photo.
  - The only real gate is GPS: `within(pos, station, 12 m + up to 10 m slack)` (`beside/engine.js:7,15-16,194-195`).
  - So the lobby forces the host to walk the property photographing objects before anyone can play. That is the biggest cold-start barrier in this game.
- **Proposed design: stations default to "Auto", with optional modes.**

| Mode | How it works | Pros | Cons (indoor GPS 5-15 m) |
|---|---|---|---|
| **A. Auto GPS waypoints (default outdoors)** | Host sets the circle only. The host generates N = 2×players (5-10) points inside it with Poisson-disk spacing ≥ 2×(STATION_RANGE+slack) ≈ 30 m. Snap to walkable spots with a map "is water/road" check where available (or let the host drag/reject pins). Task = "go to beacon 3" → puzzle unlocks on arrival. | Zero setup, instant start, works for strangers in a park. | Indoors and in small (50 m) areas the points sit inside GPS noise: 3 stations in a house are all "here". Points can land on roads or private yards. Needs road/water masking and a "move pin" step. |
| **B. Room-scale / indoor: "Hide a code"** | The app shows N printable or on-screen QR/AprilTag markers (or the host's phone shows each one as the host walks round). Host tapes them up. Arriving = scanning the marker. | Precise to the room and reliable indoors. Scanning *means* something. Cheap: expo-camera barcode scanning exists. | Needs a printer or a few minutes to place markers. |
| **C. Photo station (today's flow, kept optional)** | Keep, but actually verify: on-device image similarity (feature-match/embedding) against the reference, or ARKit `ARReferenceObject`/image anchors. | Flavourful at house parties. | Setup time, lighting fragility, extra model work. |
| **D. Hybrid "proximity + action"** | Auto waypoint (A) for coarse location, plus a phone-motion micro-task on arrival (hold still 5 s, spin 360°, shake to "pump fuel") so tasks still take time and expose the player. | No hardware, adds body language for the deduction. | Still GPS-coarse indoors. |

- **Recommendation.**
  - Outdoors / areas ≥ 100 m: **A + D** as the default, no scanning.
  - Indoors / ≤ 50 m: **B (markers)**. Auto-detect "indoor" from reported accuracy > 12 m or the area preset, and prompt for it.
  - Keep C as "Custom stations".
  - Whatever the mode, start the puzzle only after arrival and require 3-8 s of exposure, like Among Us tasks. That is the window when the imposter can strike.
  - This drops `besideCanStart`'s 3-scan requirement (`Setup.js:19`), so a game can start in under 30 s.

### 6. Imposter kill is instant (tap within 10 m after cooldown) — unfair and unsafe in real space
- **Today.**
  - `KILL_RANGE_M = 10` plus `slack` up to 10 m (`beside/engine.js:7,15-16`), so the effective range is up to **20 m**: through walls, across floors, from the next room.
  - The kill is a single tap on a list row (`BesideThemGame.js:445-453`). The victim gets nothing physical. They just see the ghost banner (`:355`).
  - The host checks only cooldown + GPS (`engine.js:200-209`).
- **Among Us.** Kill distance is Short/Medium/Long, all a few character-widths on one screen, and the cooldown defaults around 25-45 s. The kill is instant, but it needs **line of sight on a shared map**, and bodies are visible to anyone nearby ([kill wiki](https://breezewiki.discard.no/among-us/wiki/Kill), [settings guide](https://www.pcgamesn.com/among-us/settings-best)). GPS has neither.
- **Recommendation.** **Hold-to-eliminate, 1.5-2.0 s,** plus tighter range:
  - Engine: `KILL_RANGE_M = 4` and slack capped at 4 m. Refuse the kill when either player's `acc > 15` m ("signal too weak").
  - Kill flow: `kill_start` → host checks range → `kill_done` after ≥ 1500 ms, still in range (same pattern as S&D plant, `laser/engine.js:13-22`).
  - The victim's phone gives a long buzz and a full-screen "YOU WERE ELIMINATED — sit down where you are, stay silent" card. The body then exists physically, which is what makes "report body" work in real life.
  - Optional "physical tag" variant: the kill completes only when the victim's phone sees the imposter's QR/NFC, or on BLE RSSI. That is the most accurate indoors.
  - The hold creates a counterplay window, a visible "suspicious act" (Among Us's tell is being seen near the body), and prevents mis-taps.
- **Related P0 role leak.** The imposter's screen always shows red **Kill** buttons on every player row, an "Eliminate READY" chip and "Sabotage comms" (`BesideThemGame.js:431-455`). It also shows "Cover tasks · don't count" (`:370`) and "· cover task" in the puzzle header (`ScanTask.js:112`). One glance at a phone ends the game, and the "TAP TO PEEK" role chip (`:338-345`) doesn't help. Fix:
  - Give everyone the same layout.
  - Put imposter actions behind a press-and-hold on the role chip, or a dedicated "covert" sheet.
  - Label tasks identically for everyone.

---

## 1. Arcade hub & shops

### GamesScreen (Arcade tab) — `src/screens/GamesScreen.js`
- **Purpose:** game hub (hero carousel, quick tiles, continue playing, grid).
- **Works:** clean hierarchy, live counts per game, "Continue playing" from stats, search + categories.
- **P1:** heroes are badged `POPULAR` even with 0 live players (`:147`). That's a soft false claim, and an empty hub at cold start looks dead. Show "Be the first nearby", or show solo games first when `live===0`.
- **P1:** no "Play now / quick match" that drops you into whatever is live nearby, or the public Laser Tag arena. Join code is a secondary tile.
- **P2:** footer "Get Laser Tag guns and UAVs in the Shop" (`:192`) pushes sales from the main hub.

### GameLobbyScreen / LaserTagLobbyScreen / JoinGameScreen / GamePlayScreen
- **Works:** nearby room discovery (`JoinGameScreen.js:11-33`), codes, a public sharded arena (`lib/multiplayer.js:229-231`, cap 24).
- **P1 cold start:** minimum players are 8 for Heads Up 7 Up, 5 for Mafia and 4 for Beside (`lib/games.js:80,116,135`). There is no bots-fill, no "notify me when 4 nearby", and no scheduled sessions. Fixes:
  - (a) "Ready-to-play" broadcast: subscribe to push when N people within X km open a lobby.
  - (b) A weekly scheduled "Arena hour" per city.
  - (c) AI fill-ins for Mafia/Heads Up (non-physical games).
  - (d) Let the 2-3-player variants run (Mafia 4 with no detective, Beside 3 with no meetings).
- **P1:** the safety line is one sentence in How-to-play (`lib/multiplayer.js:100`). There is no per-match area-safety confirmation, and Laser Tag has no vehicle detection (only Royale uses `useTransit`).

### GunShopScreen — `src/screens/GunShopScreen.js`
- **P0 (billing bug):** the Rocket Launcher shows as **"Free"** (owned styling) to non-owners. `priceLabel` checks `!gun.unlockPoints` before `price` (`:383-389`), and the rocket has `unlockPoints: 0, iap: true` (`lib/guns.js:89-91`). Check `gun.iap` / `PAID_GUN_IDS` first.
- **P1:** stat bars don't convey real trade-offs: paid guns are strictly better (see monetization).

### ArcadeStoreScreen / UavStore / MyEquipScreen
- **Works:** clear packs, owned counts, equip flow.
- **P1:** explosives at $4.99 for 5 are consumables that directly convert money into kills. See monetization. MyEquip should show the per-match limits once those exist.

### GameLeaderboardScreen / PlayerProfileScreen
- **P1:** stats and points are written by the client (`lib/arcadeStats.js:253-263` `recordWordRace` mutates local stats). Leaderboards can be forged. Laser Tag scores come from a host phone, which is also a client. Validate on the server (Supabase RPC with sanity bounds) before showing global boards.
- **P1:** chess "rating" comes from games vs the built-in AI (`lib/arcadeStats.js:4,53`) and is shown to online opponents (`OnlineChessGame.js:213-235`) as if it were a PvP rating. Label it "vs AI" or keep a separate online Elo/Glicko.

---

## 2. Laser Tag — `src/games/LaserTagGame.js` + `src/games/laser/**`
- **Purpose:** real-world shooter. Camera aim (live body tracking + aim assist, new), hip-fire radar, FFA/TDM/S&D, explosives, UAV, public arena.
- **Works well:** host-authoritative damage (`engine.js:653-744`), S&D hold-to-plant modelled on CoD/CS (`engine.js:13-22`), spawn protection, gun-specific glow/audio, aim-assist rules that are documented (`aimAssist.js:9-17`), kill banner/medals. The live tracker falls back cleanly when the native module is missing (`liveBodies.js`).

**P0**
1. **Hip fire hits anyone within GPS error, wherever you point.** `aimTolerance` returns 180° when `d <= gpsErr` (`LaserTagGame.js:186-189`). `gpsErr` = hypot(acc1, acc2), up to 30 m (`:184`), and the window stays ≥ 90° out to 2×err (`:193`). With typical 8-10 m fixes, everyone within about 13 m is hit at 75-90 % (`hitChance`, `:203-207`) just by tapping, and within 26 m with a 90° cone. Spamming hip fire beats aiming. Fix: in compass mode, cap tolerance at about 35° and lower the chance inside GPS error rather than widening the angle. Camera confirmation should be the only way to get point-blank certainty.
2. **The host doesn't check aim.** `applyHit` validates range, team and protection only (`engine.js:653-667`). The hit roll happens on the client (`LaserTagGame.js:1006-1008`). Weapon and zone come from the client (`engine.js:668-671`, `action.weapon`), with no ownership check. Any modded client can send headshots with the rocket at 55 ms intervals (`HOST_HIT_MIN_MS`, `:210`). Fix:
   - The host recomputes bearing vs the shooter's last heading (send heading with the action).
   - The host rolls the hit.
   - Validate the equipped weapon against a server-side entitlement list.
   - Rate-limit with `minShotGapMs(gun)`.
3. **Fire rate isn't enforced for semi-auto guns.** "Semi-auto has no rate cap" (`weaponFire.js:6-7`, `LaserTagGame.js:1013`). The rocket's `fireRate: 1/3` (`guns.js:90`) is ignored, so it fires as fast as you tap: 2.5× damage, 25 m splash (`engine.js:55`). That's huge next to 5-15 m GPS error. Enforce per-weapon cooldowns on client and host, and cut the splash to about 8-10 m.
4. **Sticky-bomb position is trusted from the client** (see §0.4). Grenades too: the landing `lat/lng` is client-sent (`LaserTagGame.js:1131`). Clamp it to the shooter's host-side pos + `GRENADE_MAX_THROW_M`.
5. **Safety:**
   - No transit/speed lock in Laser Tag (Royale has one, `royale/constants.js:44-48`).
   - The public endless arena (`ARENA_CODES`) puts strangers "shooting" strangers with realistic gun art (`GunViewModel.js`) in public spaces.
   - **Bystander tagging** overlays `@username` on strangers in the camera by fuzzy GPS + compass match (`laser/Bystander.js`, `engine.js:527-542`, 25 pts each, 60 s cooldown per target). That rewards pointing a gun-shaped phone at non-players and can mislabel a non-user as someone's handle.
   - Pokémon GO locks play above driving speed and shows "passenger" prompts ([Inquirer](https://technology.inquirer.net/?p=55398), [Shacknews](https://www.shacknews.com/article/97285/pokemon-go-patch-disables-spawns-while-driving)).
   - Fix: reuse `useTransit` in Laser Tag. Make public arenas opt-in by geofenced venue (parks the host vouches for) with a play-area circle. Drop or rework bystander tagging into a non-weapon "wave" emote. Use cartoon/neon blasters instead of realistic firearms.
6. **GPS spoofing:** positions are self-reported, so a fake-location app wins every GPS game. Add basic heuristics (impossible speed, `mocked` flag on Android `coords.mocked`, constant-accuracy fixes) and a strike policy like Niantic's ([9to5Mac](https://9to5mac.com/2018/07/21/pokemon-go-cheating-policy/)).

**P1**
- Landscape upright is forced to hip fire (`useAim.js:20-23,178`). CoD Mobile and every mobile shooter play in landscape, so players who rotate lose the camera entirely. Allow landscape camera aim.
- Rocket feel (§0.2), explosives in AR (§0.3), multi-sticky (§0.4).
- UAV has no cooldown, only no stacking (`useUavControl.js:4`, 15 s, `lib/uav.js:15`). With 120 UAVs for $7.99, a payer chains permanent radar. In CoD, UAVs are earned scorestreaks ([AFK Gaming](https://afkgaming.com/mobileesports/guide/5255-everything-about-scorestreaks-and-uavs-in-call-of-duty-mobile)). Make UAV a streak reward (e.g. 3 tags), 1 purchased per match max, 60 s cooldown.
- HUD density: hip fire stacks radar + lock + chance + zone + equipment row + status (`LaserTagGame.js:1686-1700`, `1760-1800`). On small phones `zone` is dropped (`:1462`), which loses the "tap anywhere" affordance. Keep the zone and shrink the radar instead.
- Session: endless FFA with no natural end is bad for retention loops. Add a 5-min "rounds" cadence inside the arena with a podium every round.

**P2**
- `muzzlePoint` uses the `view` size while `GunViewModel` uses `useWindowDimensions` (`GunViewModel.js:37-44`). The bolt origin drifts from the barrel when they differ (dual cam / safe areas).
- Kill-feed emoji (`engine.js:691`, `🚀💥`) clash with the studio type system.

---

## 3. Battle Royale — `src/games/royale/**`
- **Purpose:** 1-5 mile GPS battle royale, gas circles, loot pickup within 10 m, up to 100 phones.
- **Works:** well-engineered zone schedule that guarantees a walker can make the next circle on on-foot areas (`zone.js:36-39`), transit lock that disables firing at vehicle speed (`useTransit.js`, `constants.js:44-48`), compact state, absent/no-GPS eliminations.

**P0**
- **Safety:** the 2-5 mi areas assume travel "as passengers" (`constants.js:18-20`, `GAS_SPEED '5mi': 4 m/s` ≈ 9 mph). That design requires vehicles, and gas damage keeps ticking while you're in transit. People will drive and play. Fix: cap public matches at 1 mi. Make the big areas "event mode" with explicit passenger confirmation, and pause gas damage for players in transit (or eliminate them softly with no penalty).

**P1**
- **Match length.** From `zone.js:26-50`, a 1 mi "normal" game is about 6 shrink phases over ~2.5 km of gas travel at 1.1 m/s, plus waits (60 % of each shrink) and a 2.5 min final. That's roughly **60-75 min** and 2-3 km of walking. PUBG/Fortnite run 20-30 min on a map you cross by vehicle. Default to a 400-800 m "Quick" preset (~20 min) and show the estimated duration/distance in the lobby.
- Needs a lot of players. 2 players in a 1 mi circle will never meet. Scale the area by roster size automatically (e.g. r = 150 m × √players).
- Same client-trust issues as Laser Tag (the shared combat path, `royale/weaponsAdapter.js`). Also check rocket splash/fire rate there.

**P2**
- Announcer/feed are good. Make sure the circle map stays readable on small screens (`RoyaleMap.js` caps at 60 dots, OK).

---

## 4. Spider Spider 123 — `src/games/SpiderGame.js`
- **Purpose:** GPS tag; the spider must stay within range for 3 s to convert someone.
- **Works:** the 3 s hold + break margin (`:21-29`) is the right answer to GPS jitter. Head start 15 s, optional timer.
- **P1:** `TAG_RANGE_M 10` + up to 10 m slack (`:33`) → 20 m tags through fences and walls. Require `acc ≤ 15` and cap slack at 5. Add a "physical tag" option (bump phones / QR).
- **P1:** no play-area boundary enforcement (Beside and Laser Tag have areas). Runners will leave the area or cross streets. Add a circle with out-of-bounds warnings and auto-tag at +30 s.
- **P2:** the radar (`:428-434`) is good. Add a heartbeat haptic as the spider closes (best tension tool in tag games).

## 5. Beside Them — `src/games/BesideThemGame.js`, `src/games/beside/**`
- **Purpose:** Among Us IRL.
- **Works:** host-secret imposter, host migration via "whois", Among Us vote rules (`engine.js:121-136`), ghosts keep doing tasks, comms sabotage, stylised terminal puzzles (new `terminal.js`).
- **P0:** role leak on screen (§0.6), instant 20 m kill (§0.6). The setup barrier (3+ photo stations) blocks the game from starting at all (§0.5).
- **P1:** the players list shows every player's live distance to everyone (`BesideThemGame.js:450`). That's a free radar: crew can triangulate who was next to the victim, which spoils the deduction. Show only "nearby / far" for ≤ 1 bucket, or hide it.
- **P1:** a single imposter regardless of player count (`engine.js:58`). Use 2 imposters at 7+.
- **P1:** sabotage = comms only; fix at *any* station instantly (`engine.js:239-244`). Add a two-station simultaneous fix (Among Us reactor) to force crew to split up.
- **P2:** the meeting UI is solid. Add "who was near the body" self-reported alibi chips.

## 6. Mafia — `src/games/MafiaGame.js`
- **Purpose:** classic Mafia/Werewolf with Doctor/Detective, 5-15 players.
- **Works:** everyone taps at night (town "suspects") so no one can tell who has a role (`:512,537`). That matches Werewolf apps. Doctor can't save the same player twice in a row, and host migration recovers roles.
- **P1:** the night hero differs by role in colour and title ("Choose a target" in red vs "The town sleeps", `:510-513,535-537`). A glance across the table leaks it. Use the same colour and title for all roles and put role-specific copy in small text.
- **P1:** there is no narrator mode (one phone in the middle). One Night Ultimate Werewolf's app narrates the night. Add voice/TTS prompts plus an optional "moderator" role for big groups.
- **P2:** more roles over time (Jester, Bodyguard) for replay.

## 7. Heads Up 7 Up — `src/games/HeadsUp7UpGame.js`
- **Purpose:** classroom game. Pickers choose a sitter, and sitters guess who picked them.
- **Works:** the secret stays with the host until the reveal, and the picker count scales.
- **P1:** the "tap" is a list selection (`:395-399`) with a buzz, so the physical thumb-press that makes the game is gone. It also needs 8+ players (`lib/games.js:135`). Make the phone buzz *and* tell the picker to physically tap the shoulder. Allow 6 players with 2 pickers.
- **P2:** there's no face-down detection (accelerometer z < -0.9) to stop peeking. Cheap to add: show "phone up — peeking!" to the room.

## 8. Chess (local + online) — `src/games/ChessGame.js`, `OnlineChessGame.js`, `ChessScreen.js`
- **Works:** chess.js rules, host-referee, Lichess-style clocks (only the side to move runs, from first move, `OnlineChessGame.js:1-6`), draw/resign, abandonment win, rematch colour swap, video call.
- **P1:** rating is vs AI only (above). No pairing outside rooms or nearby, so a solo user can't find a game. chess.com/Lichess's core loop is one-tap "Play 10 min". Add a global quick-pair queue (room pool) and puzzles of the day.
- **P2:** no premoves or move confirmation setting, no post-game analysis link (Lichess export PGN → analysis board).

## 9. What's the Word — `src/games/WordGame.js`
- **Works:** correct two-pass duplicate-letter scoring (`:63-80`), a large guess dictionary (packed list, `lib/wordRaceWords.js`), 636 answer words, good feedback animation, accessibility labels.
- **P1:** it's solo and timed only. NYT Wordle's retention comes from **one shared daily puzzle + a spoiler-free emoji share grid**, and both are missing. Add "Daily Word" (date-seeded from `ANSWERS`) + share card + streak. That is the cheapest retention win in the Arcade, and the share card is a growth surface for the "get followed" story.
- **P1:** client-authored best scores (above).
- **P2:** 636 answers means repeats show up within a week for heavy players. Expand to about 2k.

---

## 10. Cross-cutting

**Real-world safety (P0 overall).** Implement as one shared "Safe Play" module:
- Speed lock in every GPS game.
- Mandatory play-area circle for every GPS game, with exit warnings.
- Night-time warning.
- "Don't enter private property / roads" checkbox on host start.
- Exclusion of roads/water/private parcels when auto-placing anything (§0.5A).
- Non-realistic weapon art in public arenas.
- A report/block for public arena players.

Niantic's playbook here: speed locks, the "be aware of surroundings" splash, and removing points on request ([iPhone Life](https://iphonelife.com/content/updated-pok%C3%A9mon-go-app-now-warns-drivers-not-to-play)).

**Session length.**

| Game | Length |
|---|---|
| Laser Tag rounds | 10 min default (`laser/engine.js:105`): good |
| S&D | 5 × 3 min: good |
| Royale | 60+ min: too long (above) |
| Beside | open-ended: add an optional 15 min cap where the imposter wins at time-out |

**Cold start.** The physical games need 2-8 people in the same place. Recommendations:
- Lead with solo/2-player (Word, Chess, Laser Tag 1v1) on the hub when nobody is live.
- Add "notify me when people nearby are playing".
- Scheduled community sessions.
- Bots in non-physical games.
- Remove setup steps (auto stations).

**Monetization / pay-to-win (P0 for fairness, and an App Store review risk).**
- Paid guns are strictly stronger. Compare the railgun ($4.99: +40 accuracy, 1.6× at 4/s, 140 m) and the rocket ($9.99: 2.5×, 25 m splash, effectively no fire-rate cap) with the free pistol and uzi (`lib/guns.js:59-91`, prices `scripts/play_products.py:56-73`).
- Explosives and UAVs are consumable damage and wallhacks with no per-match cap.
- In real-world PvP among friends, that is straight pay-to-win, and it kills the second session for the non-payer.
- The market standard is Fortnite: cosmetics only. CoD Mobile sells power-neutral blueprints, and its UAV is earned.
- Fix:
  1. Normalise guns to *side-grades* with trade-offs and a DPS/TTK budget (e.g. sniper one-shots but 2 s cycle and no hip fire).
  2. Sell skins, bolt colours, kill effects and emotes. The studio redesign is a perfect cosmetic surface.
  3. Explosives: 1 of each free per match, purchasable cap of +1 per match, or earned by streaks.
  4. UAV as a scorestreak.
  5. A host toggle for "Even loadouts" (default ON in public arenas).
  6. Server-side entitlement checks.

---

## Top 10 fixes in this area (impact ÷ effort)

| # | Fix | Impact | Effort | Where |
|---|---|---|---|---|
| 1 | Fix the Rocket "Free" label (check `iap` before `unlockPoints`) | P0 billing/trust | XS | `GunShopScreen.js:383-389` |
| 2 | Hip-fire tolerance: no 180° point-blank auto-hit; cap at ~35° and lower the chance inside GPS error | P0 fairness | S | `LaserTagGame.js:186-207` |
| 3 | Host-side shot validation: bearing check, host rolls the hit, per-weapon fire-rate cooldown, server entitlement for weapon and consumables; host-recorded sticky/grenade positions | P0 cheat/P2W | M | `laser/engine.js:595-660`, `LaserTagGame.js:780-830` |
| 4 | Beside Them: identical UI for imposter and crew (hide Kill/Sabotage/"cover task") + hold-to-eliminate 1.5 s at 4 m with victim "sit down" card | P0 core game | S-M | `BesideThemGame.js:370,431-455`, `beside/engine.js:7,200-209`, `ScanTask.js:112` |
| 5 | Speed/transit lock + play-area enforcement in Laser Tag & Spider; cap public Royale at 1 mi and pause gas in transit | P0 safety | S (reuse `useTransit`) | `royale/useTransit.js`, `LaserTagGame.js`, `SpiderGame.js` |
| 6 | Auto GPS stations (default) + QR-marker indoor mode; drop the 3-photo requirement | P1 cold start/time-to-fun | M | `beside/Setup.js:16-21`, new generator |
| 7 | Rocket: explosion at bolt impact on every shot + host-side splash on misses + `zone:'rocket'` for the direct victim; cut splash to ~10 m | P1 feel (owner #2) | S-M | `BattleEffects.js:202-247`, `LaserTagGame.js:493,808,1003`, `engine.js:55,712` |
| 8 | Hip-fire bolts from radar centre toward the lock/top edge, flat (no perspective) | P1 feel (owner #1) | S | `LaserTagGame.js:1022`, `BattleEffects.js:488-500`, `HipFire.js` |
| 9 | "Look-down" posture keeps the camera + pitch-aware ground markers + multi-sticky with one DETONATE (host-stored) | P1 (owner #3/#4) | M | `useAim.js:51-57,178`, `GroundExplosives.js:30`, `Consumables.js:53`, `engine.js:595` |
| 10 | De-P2W the store: side-grade guns, UAV as a streak, per-match explosive caps, cosmetics as the paid surface; plus Daily Word + share grid for retention | P1 retention/revenue quality | M-L | `lib/guns.js`, `lib/uav.js`, `WordGame.js` |

Sources: [Among Us kill wiki](https://breezewiki.discard.no/among-us/wiki/Kill) · [PCGamesN Among Us settings](https://www.pcgamesn.com/among-us/settings-best) · [Inquirer – Niantic disables play in vehicles](https://technology.inquirer.net/?p=55398) · [Shacknews – spawns disabled while driving](https://www.shacknews.com/article/97285/pokemon-go-patch-disables-spawns-while-driving) · [iPhone Life – Pokémon GO driver warning](https://iphonelife.com/content/updated-pok%C3%A9mon-go-app-now-warns-drivers-not-to-play) · [9to5Mac – Niantic three-strike cheating policy](https://9to5mac.com/2018/07/21/pokemon-go-cheating-policy/) · [AFK Gaming – CoD Mobile scorestreaks/UAV](https://afkgaming.com/mobileesports/guide/5255-everything-about-scorestreaks-and-uavs-in-call-of-duty-mobile) · [Apple – ARKit saving/loading world data](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data.md) · [Apple – multiuser AR](https://developer.apple.com/documentation/arkit/creating-a-multiuser-ar-experience.md)
