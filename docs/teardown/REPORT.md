# iYiYi – Social ID: app teardown

October 2026. Mobile app (iOS + Android), current working tree, including the unpushed game redesign.

**Method:** read every screen in code: layout, copy, navigation, states, permissions and accessibility. No device or simulator captures were possible (iPhone Mirroring couldn't connect, the cloud Android emulator wouldn't boot), so visual polish is judged from the code, not pixels. Every finding has file:line evidence in the section files:

- `01-onboarding-account-money.md`: shell, onboarding, auth, guest mode, paywall, Business Pro, pricing
- `02-core-social.md`: Home, Discover, Map, Feed, Camera, profiles, follow-everywhere, events, visual system
- `03-arcade-games.md`: Arcade hub, shops, all 8 games, safety, monetization, owner-reported game bugs

Proposed screens are on the Claude Design canvas "iYiYi App Teardown": 12 boards in three rows (Core loop, Onboarding & money, Arcade fixes).

## Verdict in one paragraph

The idea is strong and distinct: turn the people physically around you into followers on every platform, and give them a reason to meet through real-world games. The app doesn't deliver the core promise fast enough.
- "Follow on every platform in one tap" is really about 14 taps and 4 app switches.
- The home tab shows 5 rows of controls before the first person.
- Six unlabelled tabs split one job (find people near me) across Home, Discover, Map and Feed.
- On the money side, the paywall sells perks that aren't built, the store text has the wrong intro price, and the whole Business Pro tier has no way in.
- The games are ambitious and mostly sound after this week's rule fixes, but have fairness holes (hip-fire auto-hits, the host trusting the phone) and pay-to-win guns.

## P0: fix before the next review submission

1. **The paywall advertises perks that don't exist.** "Premium arcade", "game sponsorship" and "weekly digest" aren't built, and "extended discovery" is already free. This is an App Review 3.1.2 / 2.3.1 risk and invites refunds. (`SubscriptionScreen.js:38-57`)
2. **The store description's intro offer is wrong.** It says "$1/mo for 3 months, then $10"; the real offer is $0.99 for 2 months, then $9.99. Business Pro isn't mentioned. (`store-assets/metadata/en-US/description.txt`)
3. **Business Pro is unreachable.** Its 4 screens are registered but nothing navigates to them. When the API fails they show **made-up demo numbers**, and the QR code is decorative, not scannable. (`App.js:394-397`, `BusinessDashboardScreen.js:84-99`, `BusinessQRScreen.js:21-50`)
4. **QR sign-in sends the live login token to a third-party QR service**, and the approval side doesn't exist. (`AuthScreen.js:108-110`)
5. **The Rocket Launcher shows "Free" in the gun shop** although it's a $9.99 item. (`GunShopScreen.js:383-389`)
6. **Hip fire auto-hits anyone within GPS error, whatever direction you point**, and the host trusts the phone's aim, hit roll, fire rate, weapon ownership and explosive positions. (`LaserTagGame.js:186-207`, `laser/engine.js:595-660`)
7. **Beside Them gives the imposter away.** Kill, Sabotage and "cover task" are visible on the imposter's screen, and the kill reach is effectively up to 20 m with GPS slack. (`BesideThemGame.js:370,431-455`, `beside/engine.js:7`)
8. **Safety:** Laser Tag and Spider have no driving-speed lock (only Royale does). Royale's 2-5 mile areas assume players travel by car.

## The core loop (biggest growth lever)

- **Follow everywhere:**
  - Make it the primary button on every profile.
  - Put **Follow ×N** on every person card, map pin, camera people list, feed post and event host.
  - When you come back from each app, confirm the follow and move to the next platform automatically. That takes about 14 taps down to about 6. (Boards: Here, Profile, Flow)
- **Tabs:** 5 labelled tabs: **Here** (Home + Discover + Map, with a List/Map toggle) · **Feed** · **Camera** · **Arcade** · **Me**. (Board: Tabs)
- **Home:** the first person visible right away, with distance and platform icons on every card. The empty state gets actions (share my QR, widen range), and the bell gets an unread badge.
- **Camera:** stop auto-posting after 5 s with everyone nearby tagged. Show a review step where any tagged person can be removed. (Board: CameraConfirm)
- **Bugs:**
  - Three different profile share URLs exist; only `app.iyiyi.xyz/u/` opens the app.
  - Events load the oldest 300, so upcoming events disappear.
  - Nearby double-polls and races between ranges.
  - Feed list mode plays every video at once.

## Onboarding & money

- **Onboarding:** done this session: language skipped when the phone's language is supported; location asked in context; paywall moved to the 2nd launch; notifications after the first follow. Still to do:
  - Add a "What brings you here? Business / Creator / Player" step.
  - Add a photo + @handle step.
  - Let people type social handles directly; today the only option is pasting a Linktree URL.
  - Add Forgot password.
  - (Board: Onboarding)
- **Paywall** (Board: Paywall):
  - Honest perks only.
  - Monthly/annual plans; there are no annual plans today.
  - A per-tier error state; the Business card currently spins forever.
  - An upgrade path from Creator to Business.
  - Translated copy.
  - Apple's auto-renew disclosure, plus the subscription warning on account deletion.
- **Pricing:** Creator $9.99 sits between Linktree Starter ($8) and Pro ($15), which is fine. Business $29 is cheap next to Yelp's paid upgrades, but Google Business Profile and Instagram's dashboard are free, so Business has to show its own analytics and promotion value. Add annual plans and a cheap starter explosives pack.
- **Business Pro:** add a "Business tools" entry in Me; real empty and error states, never fake numbers; a real QR code with working Save. (Board: Business)

## Arcade

The owner-reported issues, all confirmed in code:

| Issue | Root cause | Fix |
|---|---|---|
| Hip-fire bolts go the wrong way | No muzzle is passed in hip fire, so the bolt starts at an invisible gun bottom-right and flies "into" the screen centre (`LaserTagGame.js:1022`, `BattleEffects.js:494`) | Start from the radar centre toward the locked enemy or the top edge, flat (Board: HipFireFix) |
| Rockets don't explode on walls | A miss returns before reaching the host, the shooter never draws an explosion, and the victim is told "body hit" (`LaserTagGame.js:493,808,1003`) | Explosion at impact on every shot, host-side splash on misses (Board: Rocket) |
| Mines/C4 not visible on camera | AR markers exist (`GroundExplosives.js`), but looking down switches to hip fire, which covers the camera | A "look-down" posture keeps the camera, with tilt-aware ground markers (Board: GroundAR) |
| Only one sticky bomb | The client stores one position; the button is a toggle | Up to 3-5 stickies stored on the host, one DETONATE ALL tile |
| Beside Them scanning | The scan checks nothing (players tap "It matches") | Auto GPS waypoints by default, QR markers indoors, photo stations optional (Board: BesideThem) |
| Instant imposter kill at 10 m | GPS can't measure 1 m; real reach is up to 20 m | 1.5 s hold-to-eliminate at about 4 m (Bluetooth-close if possible); victim gets a "sit down" card |

Other game priorities:
- Remove pay-to-win: guns become side-grades, the UAV a streak reward, explosives capped per match, and paid items cosmetics.
- Cap public Royale at 1 mile (the default match runs about 60-75 min).
- Cold start: bots or "notify me when enough players are nearby" (Heads Up needs 8 players, Mafia 5).
- What's the Word: a daily shared puzzle and a share grid.
- Chess: online games use a rating earned only against the AI.
- Leaderboard stats are written by the phone, so they can be faked.

## Recommended order of work

1. **P0 honesty and review fixes:** paywall perks, store text, Business entry or hide the tier, QR sign-in, Rocket "Free" label.
2. **Follow-everywhere loop:** primary button, Follow ×N everywhere, auto-advancing flow.
3. **Game fairness and safety:** host-side shot validation, hip-fire window, speed lock, Beside Them disguise and hold-to-eliminate.
4. **Owner's game bugs:** bolts, rockets, ground AR, multi-sticky, auto stations, plus the friendlier "code-cracking" task screen with playful pop-ups.
5. **IA:** 5-tab restructure, Home thinning, camera review step.
6. **Money:** annual plans, honest paywall redesign, Business dashboard with real data.
7. **Localization and accessibility** across the social screens; only 2 of 20 are translated.
