# 02 — Core social loop teardown (iYiYi - Social ID)

Scope: home/Nearby, Discover, Map, Feed, Live/Stream, Camera, profiles (mine/theirs/edit), follow lists, Follow Everywhere, Top/Tagged/Viewers/Activity/History/Recap/Saved, Events, ContentViewer, shared visual system.
Method: code read only (no screenshots). Paths are relative to `app/`. P0 = broken or blocks the core job · P1 = hurts the loop (find a nearby person → view → follow everywhere → come back) · P2 = polish.

---

## 0. Headline verdict

- **The promise is "follow on every platform in one tap." In the code it takes 3 taps to reach the flow, then 2 more taps per platform, and the entry point sits below the posts grid.** No screen in the discovery surfaces (Nearby, Discover, Map, Feed, Camera people sheet) has a Follow Everywhere button. Every card's Follow button is an *iYiYi-internal* follow (`src/components/FollowButton.js:143`, `POST /api/profiles/follow`), and that follow does nothing for the creator's Instagram or TikTok count, which is the only number the target user cares about.
- **Home doesn't answer "who's here and what do I do?" within 10 seconds.** About five rows of chrome come before the first person. Cards show tier ("Nearby"/"Pro"), not distance or the platforms a person is on.
- **There are four "find people" surfaces (Home, Discover, Map, Feed) with the same toolbar copied into each.** Add the camera button and the tab bar has 7 icon-only targets (no labels).
- **Most of the app isn't localised.** 18 of the 20 in-scope screens are hard-coded English, but language is the *first* screen on launch (`App.js:343`).

---

## 1. Shared visual system

**What it is.** It's a silver-blue "silk & glass" look: aura JPG backdrop (`src/components/AuraBackground.js`), real iOS 26 Liquid Glass with a frosted fallback (`src/components/Glass.js:13-55`), periwinkle accent `#5b6cf0` (`src/theme.js:147`), SF Pro at HIG sizes (`src/theme.js:193-203`), and pill buttons. The well-built parts are Glass.js and GlassPanel's `lite` mode for list cells (`GlassPanel.js:18-19`).

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| V1 | P1 | The aura is drawn twice on every tab. `Tabs()` renders `<AuraBackground/>` once, and each of the 6 tab screens is also `withAura(...)`. Tabs stay mounted, so that's 7 full-screen JPGs layered on top of each other. | `App.js:128-131,175`; `AuraBackground.js:21-27` | Drop `withAura` for tab screens; keep the single root aura. |
| V2 | P2 | Old crimson/hot-magenta values are still in the code, even though theme.js says "magenta is gone". `gradients.brandSubtle` = `rgba(179,18,63)`/`rgba(224,21,139)`, used as the MyProfile hero. UserProfile tag chips and social pills use `rgba(224,21,139,…)` fills with periwinkle borders. | `theme.js:170`; `MyProfileScreen.js:356`; `UserProfileScreen.js:419,439` | Replace with `accent` at 0.12–0.2 alpha; delete `brandSubtle`. |
| V3 | P2 | There are 9 surface primitives: Glass, GlassPanel, GlassCard, GlassButton, GlassBackground, Surface, GlowBackdrop (a no-op), AuraBackground, PhotoGridBackground. There are 3 different segmented-tab implementations (PlatformFollows, TopProfiles and Saved each restyle a magenta-fill segment, while Feed uses `Segmented`). History uses the Unicode glyphs `☰ ▦` with no a11y label. ContentViewer uses the emoji/glyphs `♥ 💬 ↗ ⚑` while the rest of the app uses Ionicons. | `GlowBackdrop.js:1-5`; `TopProfilesScreen.js:254-260`; `HistoryScreen.js:81-83`; `ContentViewer.js:301-316` | Consolidate to Glass / Surface / Button / Segmented / Chip. Ionicons only. |
| V4 | P2 | Tier badges are emoji (`👑 ⭐ ★`) and the labels are hard-coded English. For normal users, the card shows a black "+" circle that looks like a button but isn't one. | `UserCard.js:85-97` | Use one Pro badge component (an SF Symbol-style seal). Remove the fake "+". |
| V5 | P1 | Most interactive elements have no accessibilityLabel/role: FollowButton (0 labels), FollowEverywhereSheet (0, and its check targets are 26 px), UserCard (0), the social icon pills on profiles (icon-only, no label). | `FollowButton.js:155`; `FollowEverywhereSheet.js:277`; `UserProfileScreen.js:294-316` | Label every icon-only control with its platform name; make check targets ≥ 44 pt. |

**Social vs studio design language.** `src/games/studio.js` is a deliberate opposite of the social side: black panels, radius 3, Chakra Petch / Barlow condensed caps, colour only for role, "no rounded pills, no emoji" (`studio.js:5-7,16-37`). The social side is rounded glass, SF Pro, pastel, with emoji badges. Today the Arcade *tab* (`GamesScreen` imports studio) is wrapped in `withAura` (`App.js:147`), so black HUD panels sit on the silver aura under a glass tab bar. That's the worst of both.
**Recommendation:** don't merge the two into one look. Games are a HUD; social is a lifestyle surface. Instead, **share one set of tokens across both and let each keep its own expression**:
1. A common dark base: move the social dark `ink` `#0c0f1a` toward studio `ground` `#0b0d11` so dark mode reads as one product.
2. One accent family: make social `accent` and studio `friendly` related (e.g. social `#5b6cf0`, studio `#39d5ff`, both listed in theme.js), and pull role colours from the same file.
3. One numeric/display face: borrow Chakra Petch for *numbers only* on the social side (follower counts, recap stats, leaderboard ranks), so Top Profiles, Recap and the game leaderboards feel related.
4. Draw a hard line at the Arcade tab: a studio-styled tab root with no aura, so the switch is intentional rather than accidental.
5. Copy studio's "no emoji in chrome" rule into the social side (it fixes V3/V4).

---

## 2. Tab bar / information architecture

`src/components/TabBar.js:13-20`: **Home · Discover · Map · Feed · Arcade · Profile** as a floating glass pill, plus a separate round camera button. That's 7 targets. They're icon-only (labels exist only as a11y text), at 44 px each, with no unread badge anywhere.

| # | Sev | Issue | Evidence |
|---|---|---|---|
| IA1 | P1 | **Overlap.** Home = people at a scope. Discover = people at a scope (ranked), *same* default scope `local`, *same* search + tags + grid/list + scope chips. Map = people at a scope, on a map. Feed = posts at a scope. A first-time user can't tell Home from Discover; the icons are a house and sparkles. | `NearbyScreen.js:197-212` vs `RecommendedScreen.js:126-164`; both `useState('local')` (`NearbyScreen.js:31`, `RecommendedScreen.js:25`) |
| IA2 | P1 | **Naming mismatch.** The tab says "Discover"; the screen title says "Recommended". The tab says "Home"; the screen says "Hello, name". | `TabBar.js:15`; `RecommendedScreen.js:112`; `NearbyScreen.js:188` |
| IA3 | P1 | Icon-only bar with 6 tabs. At 44 px with `space-between` on a 375-pt phone, with the camera button eating 70 pt, the targets crowd together. Without labels, "sparkles" and "albums" mean nothing. iOS HIG recommends labels and ≤5 tabs. | `TabBar.js:36-62,84` |
| IA4 | P1 | The return loop is hidden. Activity sits behind a bell **with no unread badge** (HeaderButton supports `badge`, but Nearby doesn't pass it). History ("people you crossed paths with", the best follow-later list in the app) is a small chip on Home. | `NearbyScreen.js:193,204`; `BrandHeader.js:44` |
| IA5 | P2 | Events are reachable only from a Map header pill. A business's main tool sits two levels deep. | `MapScreen.js:708-715` |
| IA6 | P2 | "Live" (Feed header) isn't live video: it's a global photo slideshow with a pulsing red dot. That's misleading, and it's global, not local. | `StreamScreen.js:5-19`; `LiveButton.js:7` |

**Proposed restructure (5 tabs, labelled):**
1. **Here**: one people surface with a List ⇄ Map toggle at the top. It merges Home, Discover and Map. Ranking (Recommended/Top) becomes a sort, not a tab. Scope chips stay.
2. **Feed**: local posts. Live becomes a mode inside it, renamed "Just posted".
3. **Camera**: the centre tab (BeReal/Snap model), instead of a 7th floating target.
4. **Arcade**: studio-styled root, no aura.
5. **Me**: profile, with Activity (badged), People I met (History), Follow Everywhere stats, Events I host, and Settings.
Events move to Here (pins and a "Tonight nearby" row) and to Me (hosting).

---

## 3. Home (NearbyScreen): "who's within 150 ft"

**What it's for:** list the people around you and let you follow them.
**What works:** cache-first render (`:34,40`), last-known position then a fresh fix (`:127`), watcher cleanup on blur (`:153-157`), a safe-zone banner, honest empty states for permission/no-match/no-one/scanning (`:257-266`), pull-to-refresh.

**10-second test: it fails.** Above the first card, from the top: "Hello, colin" plus a count → Pro star and bell → search → History / List / Tags chips → 6 scope chips → (safe-zone banner) → (filter line). That's about 5 rows, roughly 330 pt before content on a 6.1" phone, so 2 cards are visible at best. Nothing on screen says "tap to follow them on Instagram/TikTok". The card shows `tierLabel` = **"Nearby"** for every normal user (`UserCard.js:68-71,89`), and shows no distance, no platform icons, and no "on 4 platforms" hint.

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| N1 | P0 (core job) | The card's only CTA is an iYiYi follow. Nothing on the card says the person is reachable on IG/TikTok/YT, and there's no way to start Follow Everywhere from the card. | `UserCard.js:69-77`; `FollowButton.js:143` | Primary card CTA: **"Follow ×4"** with stacked platform icons → opens FollowEverywhereSheet directly (and auto-follows on iYiYi). Show distance ("~40 ft") in place of the tier tag. |
| N2 | P1 | Duplicate polling: `watchPositionAsync` (10 s/20 m) **and** `setInterval` 10 s **and** `onFresh` each call `pushLocationAndFetch`, and each call does `getSession` + `loadSafeZone` + POST location + GET nearby. That's up to about 4 requests per 10 s while the tab is focused, with no in-flight guard. | `NearbyScreen.js:127,132-145`; `:61-88` | One timer; skip if a request is in flight; POST location only when moved > 20 m; send both in one call. |
| N3 | P1 | Scope race: the response is cached under `scopeRef.current` at *response* time. Switch from 150 ft to "World" mid-request and the 150-ft list gets written to the World cache and shown under the World label. | `NearbyScreen.js:35,80-86` | Capture the scope at request start; drop the response if it no longer matches (Feed and Map already use a `seq` guard). |
| N4 | P1 | `useFollowStatuses` refetches whenever the ID list *order* changes. Each 10 s poll can reorder, which means another `/api/follows/status?ids=…` call, unbounded in length at World scope. | `src/lib/useFollowStatuses.js:7-16` | Sort the IDs, and only request the ones not already known; or return follow status inside `/nearby`. |
| N5 | P1 | The empty state "No one's around right now" is grey caption text with no action, and it's the most common first-run state for a new network. | `NearbyScreen.js:257-266`; strings `emptyNoOne` | Empty state = "Be the first here" with **Share my iYiYi link / Show my QR** (for the person in front of you) + "Widen to 5 mi" + "See who's on the map". |
| N6 | P2 | The Pro star sits in the most valuable header slot on the home tab, with a hard-coded English label. | `NearbyScreen.js:192` | Move it to the Me tab; put the bell (badged) and a QR button here. |
| N7 | P2 | The greeting does its own Supabase profile query on every mount; manual refresh calls `requestForegroundPermissionsAsync` directly instead of `ensureLocationPermission`. | `NearbyScreen.js:47-59,93` | Reuse the cached profile; unify the permission path. |
| N8 | P2 | `openProfile` is called without the avatar hint, so UserProfile renders an empty `<View/>` until it loads. | `NearbyScreen.js:248`; `UserProfileScreen.js:173` | Pass `item.avatar_url`; show a skeleton. |

**Competitor bar.** Snapchat Quick Add puts a one-tap "+ Add" on a horizontal row of people with a reason ("in my contacts", "mutual friends"), shown right where you already are ([alphr](https://www.alphr.com/quick-add-snapchat/), [techjury](https://www.techjury.net/blog/what-is-quick-add-on-snapchat/)). iYiYi has a stronger reason ("40 ft from you, right now") but doesn't say it on the card. Bumble BFF / Hinge cards lead with *why this person* (prompt, mutuals); iYiYi's cards lead with a tier.

---

## 4. Follow Everywhere (FollowEverywhereSheet): the core action

**What it's for:** take you through following someone on each linked platform.
**What works:** it's honest about platform limits (comment `:9-13`); the progress counter "2 of 4 done" (`:233`); the "Open next: TikTok" primary (`:255-258`); the gold "Followed them? Tap the check" prompt after opening (`:271,277`); state saved server-side, so you can finish later; the PlatformFollows ledger gives creators proof of followers delivered.

**How many taps it really takes:** Nearby card → profile (1) → scroll past the whole posts grid → "Follow everywhere ›" (2) → sheet. Per platform: "Open next" (3) → native app, follow there (4) → come back → tap the check (5). For 4 platforms, that's **about 2 + 3×4 = 14 taps plus 4 app switches.** "One tap" isn't true, and the store copy promises it (`store-assets/metadata/en-US/description.txt`, "follow you … in one tap").

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| F1 | P0 | The entry point is buried: a small outlined chip **below the posts grid**, and it only appears when `socials.length > 0`. A profile with 30 posts pushes it off-screen; the only filled CTA on the profile is the iYiYi Follow. | `UserProfileScreen.js:255-271,210-215` | Put it in the hero as the **primary filled button** ("Follow everywhere · 4"). Demote the iYiYi follow to secondary, or make it implicit. Also show it on the Map selected card, the camera People sheet, the feed owner row and the event host row. |
| F2 | P1 | The manual check after each platform is the biggest drop-off point. The app already knows the user opened the link (`opened[row.key]`). | `:206-209,271-280` | Listen for `AppState` → active after `open(row)` and show an inline "Followed? ✓ Yes / Not yet" toast, or optimistically mark it done and **auto-advance to the next platform**. Then it's 1 tap + 1 confirm per platform. Deep-link to the native app (`instagram://user?username=`, `snssdk1233://user/profile/`), not the web, so the Follow button is already there. |
| F3 | P1 | Opening the sheet doesn't follow on iYiYi. That's a separate button inside the sheet. | `:242-253` | Follow on iYiYi automatically when the sheet opens (it's the obvious intent). |
| F4 | P2 | The modal calls `onClose` from both `onRequestClose` and `onDismiss`, so it can fire twice. Copy is all hard-coded English. The "Done" text button has no role. | `:227,231-238` | Pick one; localise; add a11y. |
| F5 | P2 | Unchecking a platform deletes the record without confirmation, and the target is 26 px. | `:211-220,307` | 44 pt target; undo toast. |

**Competitor bar.** Linktree solves "all my handles in one place" with a big tap-to-open icon row and a shareable QR ([App Store](https://apps.apple.com/us/app/linktree-link-in-bio-creator/id1593515263?uo=4), [vidpros review](https://vidpros.com/linktree-review-how-to-optimize-your-social-media-bio-links)). Instagram Nametag/QR solves "spelling your @ over loud music" with a scan in the native camera ([TechCrunch](https://techcrunch.com/?p=1619030), [Beebom](https://beebom.com/scan-nametags-instagram/)). iYiYi's edge is the guided multi-platform checklist with a delivered-followers ledger. Linktree and IG have neither, so this sheet *is* the product and should be the hero, not a footnote. There's also **no personal QR** for creators (only the Business Pro QR screen, whose QR is a `QRPlaceholder`, `BusinessQRScreen.js:21-23`). That's the one-tap answer for someone standing in front of you who doesn't have the app.

---

## 5. UserProfileScreen: someone else's profile

**What it's for:** decide whether to follow, then follow.
**What works:** compact hero (96 px avatar + counts), private-account messaging (`:228-234`), Challenge-to-a-game (a nice cross-sell to the Arcade), report/block, a refresh on focus that keeps the grid.

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| U1 | P0 | Follow Everywhere is buried (see F1). The social icon row sits at the very bottom, under the posts, TagLinks and "Latest on YouTube". | `:255-318` | Order: hero → **Follow everywhere** primary + platform icon row → bio → posts. |
| U2 | P1 | **Share link is wrong**: `https://iyiyi.iyiyiguy.workers.dev/iyiyi-app/profile/<u>`. MyProfile shares `https://app.iyiyi.xyz/u/<u>`, which matches deep linking (`App.js:84,93`); Recap shares `${API_URL}/iyiyi-app/profile/…`. Three different URLs, and two of them don't hit the `u/:username` deep link. | `UserProfileScreen.js:143`; `MyProfileScreen.js:200`; `RecapScreen.js:53` | One `profileShareUrl(username)` helper → `app.iyiyi.xyz/u/…`. |
| U3 | P1 | Block takes effect on a single tap with no confirmation; Unfollow also has no confirmation. | `:350,111-118` | Confirm block; long-press or action sheet to unfollow. |
| U4 | P1 | The loading state is a blank screen (`return <View/>`), and an error shows an Alert and then auto-goBack. | `:173,96-101` | Hero skeleton from the passed avatar/username; inline retry. |
| U5 | P2 | The social icon pills have no labels; the 🔗 emoji stands in for websites; there's no distance or "met you at X" context; the "Latest on YouTube" title is fixed even though `social-content` could carry other platforms. | `:277-316` | Labelled chips ("Instagram @x"); add "Nearby now · 40 ft" or "Crossed paths Sat". |
| U6 | P2 | `ContentGrid autoplay` inside a ScrollView mounts video players for the first N tiles even when they're off-screen. | `:260`; `ContentGrid.js:11-36` | Autoplay only visible tiles. |

**Competitor bar.** On Instagram, Follow is the first full-width filled button under the name, and a "Followed by x, y" social-proof line sits next to it. iYiYi should put Follow Everywhere in that slot and use proximity as its social proof.

---

## 6. MyProfileScreen + Edit profile

**What it's for:** your profile, your stats, and editing.
**What works:** stats tappable into Followers, Following and **Profiles followed** (the platform ledger) (`:372-387`); Preview-as-others (`:403`); Import links (Linktree paste); Recap/Viewers links; a "don't clobber unsaved fields on focus" comment that is correct (`:142-146`).

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| M1 | P1 | One 845-line ScrollView: hero → stats → 3 buttons → **GoProBanner** → posts → rows → stats → an *always-open* edit form (username, email, country, bio, profile type, privacy, websites, socials, tags) → **a second GoProBanner** → total-users count. "Edit profile" just scrolls down the same page. | `:91-92,408,474-504,672` | Make Edit Profile a pushed screen with a sticky Save. Keep one Pro banner. Put "Your links" (the thing that powers Follow Everywhere) near the top, with a completeness meter ("Add TikTok to be followable on 4 platforms"). |
| M2 | P1 | No unsaved-changes guard; Save sits both at the top and the bottom of a long form. | `:487,665`; no `beforeRemove` | Dirty state → Save enabled + leave-confirm. |
| M3 | P2 | The avatar renders twice (blurred hero background plus a foreground avatar) over the old magenta `brandSubtle` gradient. | `:355-367` | One avatar; token-based tint. |
| M4 | P2 | Privacy choice (public/private/**ghost**) is buried deep in the form, yet ghost silently removes you from Nearby/Map (the Map shows a long paragraph explaining this: `MapScreen.js:1029-1031`). | `:552-587` | Show the visibility state as a pill in the profile hero, matching the Map pill. |

---

## 7. Discover (RecommendedScreen)

**What it's for:** a ranked list of people at a scope, plus a city search.
**What works:** your own card pinned first ("how you show up", `:38-43,105`); the City/State geocode browse (`:81-97`); the Top button → TopProfiles.

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| D1 | P1 | It duplicates Home: same default scope, same toolbar, same cards. The ranking logic is invisible ("Recommended" for what reason?). | `:25,126-164` | Merge into Here as a sort ("Nearby / Recommended / Top"), or make Discover clearly *not local* (city/state browse, categories like "Coffee shops", "Creators"). |
| D2 | P1 | The cache key `'recommended'` ignores scope, so on a scope switch the old scope's list shows under the new label until the fetch lands. Any of the three fetches (fast fix, fresh fix, place) can land last, with no seq guard. | `:27-28,45-61,73` | Use a per-scope key plus a seq guard, like Feed (`ContentFeedScreen.js:104-107`). |
| D3 | P2 | All copy is hard-coded English; the Top button has no a11y label. | `:112-123,147,210-213` | Localise. |

---

## 8. Map (MapScreen)

**What it's for:** a 3D map of people (penguin avatars), businesses, events and the safe zone.
**What works:** fly-in to a tilted 3D view, 3D/Realistic/Flat looks, "Search this area", country picker, visibility pill (one tap to hide), safe-zone editor with a draggable radius, a `seq` guard on area fetches (`:279,292`), de-duped markers (`:295-297`), animation capped by `MAX_ANIMATED_PENGUINS` (`:653`), `memo` UserPin. Good a11y on the circle buttons (`:930-954`). This is the most delightful screen in the app and the closest thing to Snap Map ([MacStories](https://www.macstories.net/news/snap-map-brings-location-sharing-and-global-discovery-to-snapchat/), [Guiding Tech](https://www.guidingtech.com/how-to-use-snap-map-on-snapchat/)).

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| P1m | P1 | The selected-person card only offers "View profile", so there's no Follow / Follow everywhere straight from the pin. | `MapScreen.js:1112-1137` | Two buttons: **Follow everywhere** (primary) · View. Add platform icons. |
| P2m | P1 | iOS: `tracksViewChanges` is always `true` for every user pin, plus animated penguins, plus no clustering. A busy area at City/State scope will stutter. | `:1077`; `PenguinMarker.js:53-70` | Cluster when more than about 30 pins; on iOS also stop tracking after the image loads unless the pin is animating or selected. |
| P3m | P2 | The safe-zone "pulse" `setInterval` (1.1 s) re-renders the whole 1,217-line screen, map children included, forever while a zone exists. | `:223-228` | Animate the circle with `Animated`/native, not React state. |
| P4m | P2 | First fix uses `getCurrentPositionAsync(High)` (slow cold GPS) when Nearby uses `getPositionFast`; the Map and Nearby watchers both run their own nearby fetch loops. | `:360,388` | Shared location/presence store (one watcher, one `/nearby` cache) feeding Home, Map and Camera. |
| P5m | P2 | Dead code `{true ? … : …}`; hard-coded English everywhere; the ghost-mode message is a 35-word paragraph inside a pill. | `:1117-1121,1029-1031` | Clean up; short copy + "Change" link. |

---

## 9. Feed (ContentFeedScreen) + FeedScroll + MasonryGrid

**What it's for:** posts at a scope, including your own.
**What works:** "You" scope, Country picker, For You/Recent/Popular, your own posts always merged in (`:100-152`), a `seq` guard, optimistic insert/remove via media events (`:86-98`), and MasonryGrid caps video frames at 8 (`MasonryGrid.js:16,40`).

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| FD1 | P1 | Nothing is virtualised. A `ScrollView` wraps a `.map()` grid/list, and Country can load **200** items (`countryFeed.js:72`). In list mode, **every video mounts a player and calls `play()`** at once. | `ContentFeedScreen.js:196-202`; `FeedScroll.js:14-16,38-50` | FlashList / FlatList with `onViewableItemsChanged`; play only the most-visible video. Paginate with a cursor. |
| FD2 | P1 | No follow in the feed. The owner row only opens the profile; posts are the second-best conversion surface after the profile. | `FeedScroll.js:40-44` | "Follow everywhere" chip on the owner row when you don't follow them yet. |
| FD3 | P2 | The header has Live, layout toggle and Saved, plus a scope row with 8 chips (You…Country) and a sort segment, so that's 3 rows of controls. | `:178-194` | Move Saved to Me; Live becomes a sort ("Just posted"). |
| FD4 | P2 | "No content in this range yet. Try a wider range." has no button to do that. | `:213` | Add a "Widen to 5 mi" button. |

**Live / StreamScreen (P2):** a cover-flow slideshow labelled LIVE, built well (native-driven transforms, AppState-aware polling). But it subscribes to **every INSERT on `profile_media` app-wide** and also polls every 10 s (`StreamScreen.js:270-287`). At scale every client gets every upload. Check whether realtime RLS hides private accounts' rows. Scope it to a geohash channel, or drop the 10 s poll while realtime is connected. Rename it "Just posted".

---

## 10. Camera (CameraScreen + components/camera/**)

**What it's for:** take a photo/video with a filter; it auto-posts and tags people nearby.
**What works:** a permission gate that never stacks two system prompts (`:402-405`), city-only location label with an opt-out (`:391-395`), FirstUseTip, ModeSwitcher, burst, timers, a hands-free trim, the "N nearby will be tagged ›" pill that opens a PeopleSheet **with Follow buttons**. That last one is the closest thing to Snapchat Quick Add in the app (`PeopleSheet.js:11-13`; `CameraScreen.js:1122-1131,1277-1283`). Tagging is opt-in for subjects ("who has tagging on").

| # | Sev | Issue | Evidence | Fix |
|---|---|---|---|---|
| C1 | P1 (trust) | Captures **auto-publish after a 5 s hover** and tag *everyone* nearby with tagging on. The photographer can't untag one person or keep a post private. | `CameraScreen.js:54,1301,608` | Default to "Post" being an explicit tap (keep auto-post as an opt-in "Quick post" setting); a per-person untag in the People sheet; an "only me" option. |
| C2 | P1 | The PeopleSheet offers iYiYi Follow only. This is *the* moment people are physically together. | `PeopleSheet.js:13` | Make "Follow everywhere" the primary action in the sheet; add **"Show my QR"** for people without the app. |
| C3 | P2 | Nearby polling every 8 s with `Accuracy.High`, plus a reverse geocode on every poll, while the camera is open. | `:52,384-395,409` | Balanced accuracy; geocode once per 200 m. |
| C4 | P2 | 1,420 lines, all English strings. | file | Split and localise. |

---

## 11. Smaller screens

| Screen | What it's for | Works | Issues (sev, evidence) → fix |
|---|---|---|---|
| **FollowListScreen** | followers / following / requests | Optimistic accept/decline with rollback (`:30-39`) | P1: no Follow-back button on followers (`:49-67`). P2: no loading state, so "Nobody here yet." flashes (`:69-71`), and there's no error state. → Follow-back button; skeleton. |
| **PlatformFollowsScreen** | ledger of IG/TikTok follows via iYiYi | Per-platform filter chips with counts; clear empty copy (`:146-186`) | This is the creator's ROI proof, but it's a plain list with dates. P2: make it a hero ("You gained 37 Instagram followers through iYiYi this month") and link it from Recap. Self-reported (comment `:18-19`), so label it "reported". |
| **TopProfilesScreen** | leaderboard by views/followers | FlatList, rank, follow (`:66-76`) | P2: no time window or locality (global all-time favours incumbents) → "This week · Near you". Use Chakra Petch rank numbers to tie it to the game leaderboards. |
| **TaggedScreen** | posts you were tagged in / shot near you | Clear tab split | P2: ScrollView + MasonryGrid, no pagination (`:50-52`); no "Follow the photographer" CTA. |
| **ViewersScreen** | who viewed you | Clear privacy note in the empty state (`:340`) | P1: a list of warm leads with **no Follow-back or Follow-everywhere button** (`:327-336`). Add one. |
| **ActivityScreen** | follows, views, likes, comments, tags | Today / This week / Earlier sections, type badges, nice empty state (`:43-58,127-137`) | P2 bug: a thumbnail `<Image source={{uri: item.media_url}}/>` renders for *every* row, so follow/view rows show an empty grey 44 px square (`:123`). P1: no unread badge on the entry point (IA4); no inline Follow-back on "started following you". |
| **HistoryScreen** | people you crossed paths with | Business Pro export upsell is clear (`:61-80`) | P1: the strongest "come back" list, and it's hidden on Home as a small chip. Rename "People you met" and surface it in Me; add a "Follow everywhere" batch for the last night out. P2: Unicode toggle glyphs with no label (`:81-83`); TagFilterBar here vs TagDropdown elsewhere. |
| **RecapScreen** | shareable weekly/monthly card | Captured image + share, a sparkline per metric, client-built with "–" for missing data (`:13-75`) | P1: share link is wrong (U2). P2: the comment says "Visual style to be replaced by the redesign" (`:20`); it's an ideal place for the studio display face. Add "followers gained on IG/TikTok via iYiYi" from PlatformFollows. |
| **SavedContentScreen** | saved / liked posts | Simple tabs | P2: ScrollView + MasonryGrid, no pagination (`:48-56`); a third segmented style. |
| **EventsScreen** | upcoming / mine / past | Category chips, counts per tab, error + retry state (`:27,49,169-170`), date badge cards | **P1 bug:** `fetchEvents()` pulls the **oldest 300 events overall**, ordered ascending with no date/area filter (`src/lib/events.js:81-85`). Once more than 300 events exist, upcoming events (and the Map's event pins, `MapScreen.js:334-342`) silently disappear. → Filter `ends_at > now - 1h` server-side, near the user, ordered ascending; fetch Past separately. P2: not sorted or filtered by distance; that's off-job for "events near you". |
| **CreateEventScreen** | host an event | Inline field errors, map picker, "use where I am", capacity chips, duration stepper (`:270-422`) | P2: one long form; no "invite people nearby now" step at the end; double-arrow stepper icons (`play-back`/`play-forward`) read as media controls (`:515,522`). |
| **EventDetailsScreen** | shareable event page | Going/Interested, add to calendar, share with URL, directions, attendee lists → profiles (`:26-27,105-365`) | P2: no "Follow host everywhere" button; that's how a business turns RSVPs into followers. |
| **ContentViewer** | full-screen media | Paged FlatList with `getItemLayout`, only the active video plays (`:248-262,347-349`), confirmed delete/report/untag (`:127,187,197`), good a11y labels (`:290,301-316`) | P2: no follow on the owner row; glyph icons (V3); comments in a non-virtualised ScrollView (`:421-423`). |

---

## 12. Localisation (cross-cutting, P1)

Only `NearbyScreen` and `MyProfileScreen` call `useT` among the 20 in-scope screens (grep `useT(`). 11 languages are shipped (`src/i18n/strings/tabs.js`), and the Language picker is the first screen of the app (`App.js:343-345`). A Spanish speaker gets "Hola, colin" on Home and English on Discover, Map, Feed, profiles, **Follow Everywhere**, Events and Camera. `UserCard` tier labels and `FollowButton` labels are also hard-coded (`UserCard.js:85-90`; `FollowButton.js:12`). Fix: localise the shared components first (FollowButton, UserCard, FollowEverywhereSheet, BrandHeader titles), since they show up on every surface.

---

## Top 10 fixes in this area (impact ÷ effort, best first)

1. **Make Follow Everywhere the hero CTA on UserProfile.** Move it into the action row as the filled primary with platform icons; move the social icons up (`UserProfileScreen.js:210-271`). *S effort, biggest impact.*
2. **Put "Follow ×N" on every person card and pin.** UserCard, Map selected card, camera PeopleSheet, feed owner row, event host. Open the sheet directly and auto-follow on iYiYi (`UserCard.js:73`, `MapScreen.js:1135`, `PeopleSheet.js`). *M.*
3. **Close the per-platform loop in the sheet.** On return to the app (AppState), confirm and auto-advance to the next platform; use native deep links. That takes about 14 taps down to about 6 (`FollowEverywhereSheet.js:206-220`). *S–M.*
4. **Fix share URLs to `app.iyiyi.xyz/u/<username>` with one helper** (`UserProfileScreen.js:143`, `RecapScreen.js:53`). *XS.*
5. **Fix the events query** (upcoming, near you, server-side filter), since it feeds both Events and Map pins (`src/lib/events.js:81-85`). *S.*
6. **Thin out Home.** Show distance and platform icons on cards in place of the "Nearby" tier tag; collapse search/tags/layout into one row; badge the bell; turn the empty state into "Share my link / QR / widen range" (`NearbyScreen.js:187-212,257`). *M.*
7. **Fix Nearby polling and races.** One timer, an in-flight guard, a scope/seq guard, sorted IDs for follow status (`NearbyScreen.js:35,127-145`; `useFollowStatuses.js:7`). *S.*
8. **Virtualise Feed/Saved/Tagged and play only the visible video** (`FeedScroll.js:14-50`, `ContentFeedScreen.js:196`). *M.*
9. **Make camera posting explicit and allow per-person untag** (auto-post becomes opt-in) (`CameraScreen.js:54,608`). *S–M, protects trust.*
10. **Localise the shared social components, then the screens; drop the duplicate aura and the leftover magenta** (`App.js:128-131`, `theme.js:170`). *M.*

## Proposed IA (5 labelled tabs)

**Here** (people near you: List ⇄ Map toggle, sorts Nearby/Recommended/Top, event pins and a "Tonight" row) · **Feed** (local posts, "Just posted" mode in place of Live) · **Camera** (centre tab; the People sheet with Follow everywhere + My QR) · **Arcade** (studio-styled root, no aura) · **Me** (profile, badged Activity, People you met, Followers delivered, Events hosting, Settings). Home, Discover and Map merge into one tab. Pro upsell leaves the home header.

---

Sources: [alphr: Quick Add](https://www.alphr.com/quick-add-snapchat/) · [techjury: Quick Add](https://www.techjury.net/blog/what-is-quick-add-on-snapchat/) · [MacStories: Snap Map](https://www.macstories.net/news/snap-map-brings-location-sharing-and-global-discovery-to-snapchat/) · [Guiding Tech: Snap Map](https://www.guidingtech.com/how-to-use-snap-map-on-snapchat/) · [TechCrunch: Instagram Nametags](https://techcrunch.com/?p=1619030) · [Beebom: scan Nametags](https://beebom.com/scan-nametags-instagram/) · [Linktree App Store](https://apps.apple.com/us/app/linktree-link-in-bio-creator/id1593515263?uo=4) · [vidpros: Linktree review](https://vidpros.com/linktree-review-how-to-optimize-your-social-media-bio-links). Instagram profile layout and the BeReal/Bumble/Life360/Poparazzi comparisons are from general product knowledge and weren't re-checked this session.
