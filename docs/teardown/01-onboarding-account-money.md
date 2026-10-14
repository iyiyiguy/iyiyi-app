# iYiYi teardown 01: onboarding, account and money

Scope: App shell and tab bars, Language, Auth (+ oauth), Guest Explore/Discover/Feed/Locked, Public Profile, Import Links, Location Consent, Subscription (paywall), Settings, Blocked Users, Crash Logger, Business Dashboard/QR/Team/Promoted, Airdrop, and the pricing model.
Method: code read only (no device). Paths are relative to the app repo. Severity: **P0** = broken, blocks money, or a review risk. **P1** = hurts conversion, retention or clarity. **P2** = polish.

---

## Headline findings

1. **People pay for Business Pro and get nothing they can reach.** `BusinessDashboard`, `BusinessQR`, `BusinessTeam` and `PromotedPlacement` are registered in `App.js:394-397`, but nothing in `src/` navigates to them. A grep for those route names finds only `App.js` and the screens themselves. A $29/mo subscriber has no way in.
2. **If you do reach them, they show made-up data.**
   - Analytics, promotions and team all fall back to hard-coded demo data whenever the API call fails, and they hide the error: `BusinessDashboardScreen.js:84-99` (`setError(null) // clear — we have demo data`), `PromotedPlacementScreen.js:87-91`, `BusinessTeamScreen.js:57-61`.
   - The "QR code" is a fixed decorative pattern that can't be scanned (`BusinessQRScreen.js:21-50`, `QRPlaceholder`). No QR library is installed.
3. **The paywall sells perks the client doesn't implement.**
   - "Premium arcade: exclusive gun skins, premium weapons, bonus loadouts" (`SubscriptionScreen.js:42`): no code anywhere checks Pro status for arcade items. Guns are sold one by one as IAPs.
   - "Game sponsorship" and "Weekly digest" (`:51`, `:54`) have no screen or client code.
   - "Extended discovery" (`:40`) is already free. Guests get 1 mi to Worldwide (`GuestExploreScreen.js:25-32`), Nearby scopes aren't gated (`NearbyScreen.js:212`), and the store description lists wider range as a creator feature.
   - This is a 3.1.2 / 2.3.1 risk (the subscription must give the value it describes) and a refund driver.
4. **The store listing states the wrong offer.** `description.txt` says "$1/month for your first 3 months, then $10/month". The real offer is $0.99 paid once for 2 months, then $9.99 (`scripts/asc_pricing.py:4-6`, `play_products.py:33-41`). Business Pro isn't mentioned in the listing at all.
5. **The QR sign-in feature can't work and leaks a token.**
   - `AuthScreen.js:109` sends the live login-session token to a third party (`api.qrserver.com`) to draw the code.
   - The hint (`auth.js` `qrHint`) tells people to use Settings → "Sign in on another device". That row doesn't exist (`SettingsScreen.js:207-237`), and no code anywhere approves a login session.

---

## Screen by screen

### App shell (`App.js`) and tab bars (`TabBar.js`, `GuestTabBar.js`)
**Purpose:** routes between guest mode, onboarding gates (language → import → location → one-time Pro offer) and the member stack.

**What works**
- Every screen has its own error boundary (`:107`).
- Location explainer state is stored per account (`:258-267`).
- The import step gives up after 4 s so a slow network never blocks the app (`:280-282`).
- The Pro offer moved to the 2nd launch and is skipped for subscribers (`:299-319`).
- Guest mode uses a tab bar that looks like the real one, with a "Sign up free" pill.

**P0**
- Business screens and Airdrop are orphaned routes (see headline 1). `CrashLoggerScreen` isn't registered at all, which is dead code.

**P1**
- **Onboarding gates swap out the whole navigator** (`:343-399`). The import, location and paywall screens replace the member stack. Two consequences:
  - A cold start from a deep link (event `e/:id`, game invite `j/:code`) on the 2nd launch lands on the Pro offer. The link is probably lost, because the linking config resolves before the member stack exists.
  - `InviteListener` is also off while the paywall shows (`:401`). Game challenges get dropped while the paywall is up.
  - Fix: render the paywall as a modal over `Tabs` (`presentation: 'modal'`), not as a navigator swap. Skip it entirely when the launch came from a URL.
- **Blank screen during boot** (`:336-337`). The app returns `null` until theme, language and session load, and, once signed in, until the import check finishes (up to 4 s). There's no spinner or splash hold. Fix: keep `expo-splash-screen` visible until ready.
- **Six icon-only tabs plus a 60 pt camera button.** `TabBar.js:13-20`, `:84` (44 pt tabs), `:81-87`.
  - At 375 pt width (iPhone SE, 13 mini) the pill has 273 pt, and the row needs 6×44 + 16 = 280 pt. It overflows, and on 360 dp Android it's about 22 pt short. Verify on device.
  - With no text labels, Discover / Feed / Map are hard to tell apart (sparkles vs albums). Snapchat and BeReal show at most 5 destinations; iOS guidelines expect labels.
  - Fix: cut to 5 tabs (merge Map into Home as a toggle, or move Feed into Discover), add labels, and move Profile to the top-right avatar.
- **No branching by audience.** Business owners, creators and gamers all get the same flow. Bumble asks for intent up front and Instagram has a "Switch to Professional" step. Without that, the paywall can't default to Business Pro for businesses, and players are asked for a Linktree. Fix: one "What brings you here? Business / Creator / Just here to play" screen after sign-up, stored on the profile, which then shapes the import step, paywall default and first tab.

**P2**
- The Pro offer counts only cold launches (`launchCounted` ref, `:302-315`). On iOS that can take days. Consider "2nd session after at least 24 h" or "after first follow received", a value moment.
- `review_notes.txt` still says the paywall is "also shown once after sign-up". Update it, or reviewers will look for a screen that no longer appears.

### LanguageScreen
**Purpose:** pick the language on first run when the device language isn't supported. Also reachable from Settings.

**What works**
- Skipped when the device language is supported (`App.js:240`, `i18n/index.js:50`).
- Native names are shown, rows have `accessibilityState.selected`, and the choice applies instantly.

**P2**
- On first run, Continue sits below 11 languages (`LanguageScreen.js:50-57`). Put it in a sticky footer.
- The back label "Back" is hard-coded (`:23`).
- If no language is supported, pre-select English with its checkmark showing. It already defaults to `en`, which is fine.

### AuthScreen + `lib/oauth.js`
**Purpose:** sign up / log in by email, phone OTP, Apple, Google or QR. A Terms checkbox is required.

**What works**
- Native Apple button with a nonce (`oauth.js:118-151`).
- `ensureProfile` is idempotent with neutral-username fallbacks (`:75-94`).
- Phone numbers are never used as usernames (`AuthScreen.js:169-170`).
- Username is checked against the blocklist before sign-up (`:132`).
- Social proof counter (`:202-207`) and strong copy ("Become a local celebrity", 150 ft).

**P0**
- **Login token goes to a third party** (`:108-110`): `https://api.qrserver.com/...data=<qrToken>`. Anyone who can approve or intercept that token gets a session. Draw the QR on the device (`react-native-qrcode-svg`).
- **The QR flow has no approver.** The hint names a Settings row that doesn't exist, and no code approves `/api/login-sessions`. Hide "Sign in with a QR code" (`:291`) until approval is built.

**P1**
- **No "Forgot password".** There's no `resetPasswordForEmail` anywhere, so email users who forget their password are locked out for good. Add a link under the password field.
- **Sign-up attribution misses social sign-ups.** `logSignup` only fires on the email and phone paths (`:152`, `:171`). Apple and Google sign-ups (`oauth.js`) never log, so ad attribution under-counts the highest-intent channel.
- **The Terms checkbox blocks Apple and Google too** (`:112-117`). The error only appears after tapping. "By continuing you agree to Terms and Privacy" under the buttons is the pattern Snapchat, BeReal and Bumble use. If you keep the checkbox for 1.2, at least disable the buttons visibly until it's ticked.
- **Usernames are picked silently.** Apple sign-ups get their first name (`oauth.js:149`), Google gets the full name or email prefix (`:81`), and phone users get `iyiyi_ab12cd34`. Nothing in onboarding asks for a handle or photo, yet the product is a "Social ID" shown to strangers within 150 ft. The Google email-prefix fallback can also expose part of the person's email address. Fix: add a "Your nametag" step (photo + display name + @handle) before the link import. Snapchat and BeReal both force name and photo.
- **Sign-up form has no inline validation**: no username availability check, no password rules, no "show password". Errors arrive as raw Supabase messages (`:122`).

**P2**
- Cancelling Google sign-in shows "Sign-in cancelled" as a red error (`oauth.js:37`). Treat it like Apple's cancel: say nothing.
- The form opens on "Log in" unless the caller passes `mode: 'signup'`. The guest "Log in" button is fine, but a first install with no guest context should default to sign-up.

### GuestExploreScreen
**Purpose:** logged-out grid of public profiles with range chips, plus four feature cards.

**What works**
- Never looks empty: there are always feature cards and an empty-state message.
- Cached between tab switches, responsive columns, an a11y label on each tile (`:171`).

**P1**
- **This screen spends the one iOS location prompt with no explainer** (`:69-81`). Tapping "1 mi" fires the system prompt raw. If the guest declines, the member `LocationConsentScreen` later runs, Continue calls `requestForegroundPermissionsAsync` (which iOS ignores once denied), and the user lands in the app with location off and no "Open Settings" path (`LocationConsentScreen.js:108-115`). Fix: when guests tap a range, show a short one-line explainer first. In `LocationConsentScreen`, skip the screen if access is already `granted`, and show "Open Settings" if it's `denied && !canAskAgain`.
- **Defaults to Worldwide** (`:46`). That contradicts "See who's around" and the 150 ft promise. Default to the closest range that returns at least 6 people, or show the city when location is known.

**P2**
- The range labels "1 mi" and "5 mi" are imperial only.
- Tiles show only `@username`. Add a category tag ("Coffee shop", "Creator") so businesses stand out.

### GuestRecommendedScreen / GuestFeedScreen / GuestLockedScreen
**Purpose:** read-only Discover and Feed for guests. Camera and Arcade tabs show sign-up cards.

**What works**
- Follow / like / Live open a sign-up sheet (`useGuestPrompt`), the fallback endpoints are good, the feed has pull-to-refresh plus an error state (`GuestFeedScreen.js:109-111`), and the locked tabs list concrete perks.

**P1**
- **Not translated.** All copy on these three screens is hard-coded English ("Discover", "Popular on iYiYi", "Search people or tags", "Follow", "Feed", "Public posts", "No public posts yet", the `PERKS`/`SUBS` text, "Already have an account? Log in"). The app ships 11 languages and these are the first screens a non-English visitor sees.

**P2**
- Tier badges show legacy plans ("👑 Premium", "★ Creator") and miss `business_pro` (`GuestRecommendedScreen.js:17-21`, `PublicProfileScreen.js:11`). Map them to the current Creator Pro ⭐ and Business ✓ badges so the paid badge means something.
- The sign-up sheet should say what happens next: "Sign up to follow @x on Instagram, TikTok… in one tap".

### PublicProfileScreen
**Purpose:** a profile anyone can view without an account. It's also the deep-link target `u/:username` for members.

**What works**
- Gated profiles hide bio and links, there's an error state, and the avatar placeholder speeds first paint.

**P1**
- **Wrong for members.** The member stack routes `u/:username` here (`App.js:363`). The CTA "Create your own iYiYi profile" calls `navigate('SignIn')`, and that route doesn't exist in the member stack (`PublicProfileScreen.js:112`), so the tap does nothing or throws a dev warning. Members never see a Follow button. Fix: when signed in, resolve the username and `replace('UserProfile', { userId })`.
- **The main action is missing.** The product promise is "Follow everywhere in one tap", but guests see a row of unlabeled icons. Add a large "Follow on all N platforms" button (it opens each link, like Linktree), plus a secondary sign-up CTA. This page is also the landing page behind the Business QR, so it's the business funnel's conversion page.
- Social icons have no `accessibilityLabel` (`:86-108`), so VoiceOver reads "button".

**P2**
- The back control is a text "‹" glyph (`:56-58`). Use the shared `HeaderButton`. On a cold deep link with no history, `goBack` does nothing; fall back to `navigate('Tabs')`.

### ImportLinksScreen (+ `ImportLinksPanel`)
**Purpose:** onboarding step 1 after sign-up. Paste a Linktree-style URL, review the links found, save.

**What works**
- Shown only to people with no links. Review and uncheck before saving, skippable, saves errors inline (`ImportLinksPanel.js:51-65`).

**P1**
- **Only one way in.** People without a link-in-bio page (most local businesses and nearly all players) can only "Skip for now". Then their profile has no socials, and the "follow everywhere" value is gone on day 1. Fix: add one-tap handle fields for Instagram / TikTok / YouTube / Snapchat (prefilled with "@"), with Linktree import as a secondary "Have a Linktree?" link. Life360 and Snapchat get people to their first useful state within one screen.
- **Not translated**: the title, intro, "Works with…", "Find my links", "Skip for now" and "Found N links…" are hard-coded (`ImportLinksScreen.js:16-21`, `ImportLinksPanel.js:84-123`).
- **No progress cue.** Import, location, (missing nametag) and app have no step dots, so "Skip" feels like the safe choice.

**P2**
- `save` re-fetches `/api/profiles/me` before patching (`ImportLinksScreen.js:7-8`). That's fine, but a failure there shows the raw message.

### LocationConsentScreen
**Purpose:** explains how location is used, then Continue triggers the system prompt.

**What works**
- Good explainer pattern: a single "Continue" (no fake Allow/Deny buttons, which 5.1.1(iv) forbids), concrete privacy points (approximate distance, ghost mode, safe zone), translated, and declining is handled gracefully.

**P1**
- See the Guest Explore note: there's no granted, denied or blocked branch. If access is already granted, skip the screen. If it's blocked, show "Turn on in Settings" and a "Not now" option.
- The explainer comes after the import step. For players, location is the primary need. With the audience question in place, show location first for players and links first for businesses and creators.

**P2**
- "150 ft" is imperial only. Localize the unit for non-US languages.

### SubscriptionScreen (paywall)
**Purpose:** pick Creator Pro or Business Pro and subscribe. It also manages an active plan, and appears once from the 2nd launch.

**What works (3.1.2 compliance is mostly good)**
- Prices come from the store and are localized.
- The regular price is the largest text and is repeated on the CTA (`:271`, `:340-341`).
- The intro offer appears smaller, with its length and the price that follows (`:327-328`).
- iOS intro-offer eligibility is checked (`iap.js:88-90`).
- Restore is always visible (`:355-358`), auto-renew disclosure and Terms/Privacy links are present (`:366-378`), "Not now" plus a close button, and a timeout message tells people to tap Restore if they were charged (`:94`).

**P0**
- **Perks that don't exist in the client** (headline 3). Remove or label as "coming soon" anything that isn't live: Premium arcade, Game sponsorship, Weekly digest, and Team / QR until those screens are reachable and real. Apple rejects subscriptions whose perks aren't delivered (3.1.2(a) requires ongoing value, 2.3.1 requires accurate descriptions).
- **Business Pro has no reachable features** (headline 1). Selling it today means taking $29/mo for an unreachable dashboard. Hide the Business card until the screens are linked from My Profile / Settings and backed by real data.

**P1**
- **Business card can spin forever.** `infoFailed` is set only from the Pro fetch (`:115-120`). If the Business product isn't approved yet or fails to load, its card shows an endless spinner and the CTA stays disabled with no reason given. Track failure per tier and show "Not available yet".
- **Business subscribers are shown Creator benefits.** "Your benefits" uses `selectedTier`, which defaults to `'pro'` (`:71`, `:212`, `:290`). Derive the active tier from `current.tier`.
- **No upgrade path.** When a plan is active the picker is hidden (`:243`), so a Creator Pro subscriber can't move to Business Pro in the app. Show the other tier as "Upgrade". Both products are in one subscription group, so StoreKit prorates the change.
- **Not translated.** "Choose your plan", the subtitle, all benefit text, "Subscribe to …", "per", "Price unavailable", "MOST POPULAR", "Cancel anytime in…" and "Welcome to Business Pro" are hard-coded English (`:38-57`, `:234-348`), even though `strings/subscription.js` already holds translated disclosure text for 11 languages. Mixing languages on the payment screen hurts trust and conversion.
- **Disclosure text says "iYiYi Pro"** even when Business is selected (`subscription.js:36-38`). Pass the tier name in.
- **Value isn't framed in the customer's terms.** The hero ("Level up your profile or grow your business") and generic icons don't say what the person gets. Competitors lead with an outcome, such as Tinder Gold's "See who likes you" or Linktree Pro's "Know what's working". For Creator Pro, lead with "Be first in Nearby for everyone within 150 ft" plus a before/after mock of the Nearby list. For Business Pro, lead with "Know how many customers followed you this week", using the user's own real view count.
- **Monthly only.** No annual plan, though Linktree (about 20% off yearly) and the dating apps all offer them (sources below). An annual plan at about $79.99 (Creator) or $249 (Business) anchors the monthly price and cuts churn.

**P2**
- `logSubscriptionPurchase` reports $10 / $29 (`:35`, `:142`) even when the user paid the $0.99 or $9.99 intro, which overstates ad return. Use the store's actual price.
- The Android in-app "Cancel subscription" calls the backend (`:169-184`). Google expects a link to Play subscription management. Use `https://play.google.com/store/account/subscriptions?sku=…&package=com.iyiyi.app`.
- Unused styles (`tierToggle`, `benefit`, `price`… `:416-433`) are dead code.

### SettingsScreen
**Purpose:** appearance, safe zone, privacy switches, language, Pro, blocked users, follow-us links, shop, legal, sign out, delete account.

**What works**
- Account deletion is in the app with a confirmation (5.1.1(v)).
- Optimistic switches roll back when a save fails (`:64-68`).
- Push permission is requested only when the user turns on nearby alerts (`:70-83`).
- The safe-zone setup flow is good.

**P1**
- **Deletion doesn't mention the subscription** (`settings.js:50`). Apple asks apps to tell people that billing continues through Apple and to have them cancel first. For Sign in with Apple accounts, tokens should be revoked through the REST API (see Apple's account-deletion guidance below). Add an "Active subscription: manage before deleting" step that links to `apps.apple.com/account/subscriptions`.
- **Business owners have no entry point.** Add a "Business tools" section (Analytics, QR & poster, Promotions, Team), shown to Business Pro users and as an upsell to everyone else.
- **Rows point to things that don't exist.** There's no "Sign in on another device" row (referenced by the Auth QR hint), and no "Restore purchases" or "Manage subscription" row. Restore lives only in the paywall, though guns and UAVs also need it.

**P2**
- The "⭐ iYiYi Pro" label is hard-coded (`:209`). Show the current plan instead ("Creator Pro · renews 11/2").
- Switches have no `accessibilityLabel` (`SwitchRow`, `:256-269`), so VoiceOver can't link the label text to the switch.
- Eight switches sit in one card. Group them under "Privacy", "Camera" and "Notifications" headers.
- The founder's Instagram in "Follow us" (`:28`) is fine for an indie app, but put the brand accounts first, as they are now.

### BlockedUsersScreen
**Purpose:** list of blocked users with Unblock.

**What works:** load and unblock errors are shown, and there's an empty state.

**P2**
- Hard-coded English ("Blocked Users", "Unblock", "No blocked users.").
- No loading state: "No blocked users" flashes before the data arrives.
- Unblock happens without confirmation and has no a11y label.
- `keyExtractor` uses `u.id` raw; it needs `String()`.

### CrashLoggerScreen
**Purpose:** internal crash viewer.

**P2**
- Not registered as a route, so it's dead code. Delete it, or put it behind a dev flag.
- It emails `support@iyiyi.app`, but the brand domain is `iyiyi.xyz`.
- The `crash_stats` view is granted to every signed-in user (`supabase/migrations/001_create_crash_logs.sql:65-66`). Views ignore row-level security unless `security_invoker` is set, so this may leak other users' error text.

### BusinessDashboardScreen
**Purpose:** Business Pro analytics: impressions, taps, follows, link clicks, daily bars, traffic sources.

**What works:** the layout matches the Instagram Professional Dashboard pattern (period chips, 2×2 KPI tiles with % change, sources list), and there's a lock screen with an upgrade CTA.

**P0**
- **Fake numbers on error** (`:84-99`). A paying customer sees "1,247 impressions" when the API is down. Remove the demo data and show an error with Retry.
- Unreachable (headline 1).

**P1**
- **The data loads before entitlement is known.** It fetches while `isBiz === null`, and nothing renders a loading state for that case.
- **The 90-day chart overflows.** Bars are at least 2 pt wide plus a 3 pt gap, so 90 × 5 = 450 pt, wider than the phone (`:44`). Bucket the 90-day view by week.
- **No link from numbers to action.** Add "Share your QR" and "Boost a promotion" CTAs under the KPIs.

**P2**
- Hard-coded English. KPI tiles have no a11y summaries. Width comes from `Dimensions` once (`:220`), so it breaks on rotation and iPad.

### BusinessQRScreen
**Purpose:** printable poster, QR code and tap link for storefronts.

**P0**
- **The QR code can't be scanned** (`:21-50`). Printed posters won't work. Generate a real QR with `react-native-qrcode-svg` that encodes `https://app.iyiyi.xyz/u/<username>?src=qr`; the source tag also gives "Where people find you" a real QR source.
- **"Save QR" on the QR tab does nothing.** It calls `savePoster`, but `posterRef` is only attached on the poster tab (`:111`, `:245-249`).

**P1**
- "Copy" falls back to the share sheet on native (`:99-106`). Use `expo-clipboard`.
- The poster uses emoji for platforms (`:53-57`) instead of the app's `SocialIcon` set. Printed, that looks amateur. Add a short promo line ("Follow us for 10% off") — Google Business Profile and Yelp both let businesses customize their window stickers or materials.

### BusinessTeamScreen
**Purpose:** invite up to 3 staff by email.

**P0/P1**
- Shows a fake "cafe.luna" owner when the API fails (`:57-61`).
- Unreachable.
- The limit check counts the owner in `members.length` (`:73`, `:117`). That leaves 2 staff seats, but the paywall promises "up to 3 staff accounts".
- No pending-invite state.

**P2**
- The avatar is always 👤 (`:20`, both branches of the ternary are identical).

### PromotedPlacementScreen
**Purpose:** create, pause and resume pinned "promoted" cards by radius and duration.

**P0/P1**
- Demo promotions with real-looking stats appear on error (`:87-91`), and toggling them sends ids `'1'`/`'2'` to the API.
- No preview of how the pinned card will look in Nearby.
- No disclosure that the content is promoted. Viewers should see a "Promoted" label (FTC and Apple 1.x expectations for ads).
- The "Promotion created … now live!" alert (`:113`) promises it's live before the server confirms it was approved.
- Radius stops at 5 mi, while the Pro tier already reaches City and Worldwide.

### AirdropScreen
**Purpose:** "Airdrops are coming!" teaser. It's registered (`App.js:375`), but nothing links to it.

**P2**
- No back button (`BrandHeader` gets no `onBack`, `:9`), so a deep link would strand the user. Delete it until it ships, or link it with a "Notify me" button that stores interest.
- "Airdrop" next to crypto-style wording invites questions in review (Apple 3.1.5 covers crypto). Rename it to "Weekly drops" if you keep it.

---

## Business and pricing

**Free / paid ladder today (from the code)**

| | Free | Creator Pro $9.99/mo (intro $0.99 for 2 mo) | Business Pro $29/mo (intro $9.99 for 1 mo) |
|---|---|---|---|
| Nearby / Discover / Map / Feed / Camera / Arcade | yes | yes | yes |
| Wider range (5 mi → World) | **already free** (and open to guests) | sold as "Extended discovery" | included |
| Ranked first / priority | – | claimed; server-side, can't verify | included |
| Badge | – | ⭐ (guest views show legacy labels) | no distinct badge |
| Premium arcade | – | **claimed, not implemented** | "included" |
| Analytics / QR / Team / Promotions | – | – | **screens unreachable; demo data; QR fake** |
| Export history | locked | locked? (`HistoryScreen.js:63` checks Business only) | yes |

**Is the value clear wherever money is asked?**
- No. The Go Pro banner says "Get seen first", which is clear and good (`goPro.js`).
- The paywall then lists six perks, two of them false (range, arcade). Business-only locks ("Business Pro Only") explain the feature but never show its price.
- Guns and UAVs are sold separately, while the paywall says Pro includes "premium weapons". Players are left unsure what Pro gets them.

**Prices vs competitors (US, 2026)**
- **Creator Pro at $9.99** sits between Linktree Starter ($8) and Linktree Pro ($15; analytics are in Pro). It's priced against link-in-bio tools, but today it delivers less (no analytics for creators at all). Sensible if it adds basic "who viewed / followed you" analytics. Dating-app boosts (Tinder Gold about $29.99, Bumble Premium about $32.99) show that "get seen first" sells at higher prices, but only with visible proof such as "3× more profile views".
- **Business Pro at $29** is cheap next to Yelp upgrades (about $75–$300/mo) and Yelp ads (from about $150/mo), and roughly Linktree Premium's ~$35. Google Business Profile and the Instagram Professional Dashboard are free, so the analytics alone won't justify $29. Promoted placement plus verified foot-traffic follows will. The price is fine, but only after the features are real.
- **The intros are generous**, which suits a discovery product with few users. The listing must match them exactly.

**IAP catalogue sanity** (`scripts/asc_iaps.py:26-44`, `play_products.py:56-73`)
- **UAV ladder** 5/$0.99 → 20/$1.99 → 50/$3.99 → 120/$7.99. Per-unit price drops cleanly (19.8¢ → 6.7¢), and "Most popular" sits on the $1.99 pack. Healthy, though the "Most popular" ribbon is a hard-coded claim (`iap.js:267`).
- **Explosives are flat**: 10 grenades $4.99 (50¢ each), 5 sticky bombs $4.99 ($1), 5 land mines $4.99 ($1). There's no small entry pack and no bundle, so a first-time spender has to pay $4.99. Add a $0.99 starter pack and a $9.99 "Loadout bundle" (UAV 50 + grenades + mines).
- **Guns** run $0.99 → $9.99 (rocket launcher). `product.md` says $2.99–$9.99, which is out of date. A $9.99 permanent gun equals a full month of Pro, and "Sniper: one-hit tag" is pay-to-win in PvP with real people nearby. Expect bad reviews. Consider cosmetic skins as the paid layer with stat parity, or matchmaking by loadout.
- **Pro vs IAP conflict**: if Pro is meant to include "premium weapons", either grant guns to subscribers (and say so on the Gun Shop) or remove the claim.

**Conversion risks**
1. False or unbuilt perks lead to refunds and possible rejection (3.1.2 / 2.3.1).
2. No intent capture means businesses see Creator Pro first, while Business Pro's real buyer is never asked.
3. Profiles start empty (no photo, no handle choice, no socials if no Linktree), so there's no value to sell on the 2nd launch.
4. The paywall is untranslated for 10 of 11 languages.
5. Monthly-only, with no annual anchor or social proof ("1,240 creators are Pro").

**5 prioritized recommendations**
1. **Make the paywall honest this week.** Drop Premium arcade, Game sponsorship, Weekly digest and Extended discovery (or gate range for free users at 1 mi, as guests already get, and say so). Fix the store description offer text. Hide Business Pro until (2) ships.
2. **Ship Business Pro for real.** Add a "Business tools" hub (My Profile + Settings), a real QR with a `?src=qr` tag, remove every demo-data fallback, label promotions as "Promoted", and fix team seats (3 staff + owner).
3. **Capture intent at sign-up** (Business / Creator / Player), then tailor the steps: nametag (photo + @handle) → socials (manual handles first, Linktree second) → location → app. Default the paywall tier from intent.
4. **Trigger the paywall on proof, not on launch count.** Show it after the first "N people saw you nearby today" moment, with the person's real view count as the hero ("12 people saw you today. Pro puts you first for all of them."). Add annual plans.
5. **Restructure arcade spending.** Starter packs at $0.99, a bundle at $9.99, cosmetic-first guns, and a clear "Pro includes X" link from the Gun Shop (or none at all).

---

## Top 10 fixes in this area (impact ÷ effort)

| # | Fix | Evidence | Effort |
|---|---|---|---|
| 1 | Remove unbuilt or false perks from the paywall and correct the store description's intro text | `SubscriptionScreen.js:38-57`; `description.txt` last paragraph | S |
| 2 | Delete all demo-data fallbacks in the Business screens; show error + Retry | `BusinessDashboardScreen.js:84-99`, `PromotedPlacementScreen.js:87-91`, `BusinessTeamScreen.js:57-61` | S |
| 3 | Draw the login QR on the device and hide QR sign-in until approval exists | `AuthScreen.js:108-110`, `:291` | S |
| 4 | Add a "Business tools" entry (My Profile + Settings), or hide the Business tier until it exists | `App.js:394-397` (no navigators) | S |
| 5 | Real scannable QR (`react-native-qrcode-svg`) + fix "Save QR" | `BusinessQRScreen.js:21-50`, `:245-249` | S |
| 6 | Add Forgot password; log sign-ups for Apple/Google | `AuthScreen.js` (none); `:152`, `:171` vs `oauth.js` | S |
| 7 | Paywall: per-tier failure state, benefits from the active tier, upgrade path, translate all copy | `SubscriptionScreen.js:115-120`, `:212`, `:243`, `:234-348` | M |
| 8 | Show the paywall as a modal over Tabs and skip it on deep-link launches; hold the splash screen during boot | `App.js:336-358`, `:401` | M |
| 9 | Onboarding: intent question + nametag (photo/handle) + manual social handles before the Linktree import; location permission branches (granted / blocked) | `ImportLinksScreen.js`, `LocationConsentScreen.js:104-116`, `GuestExploreScreen.js:69-81` | M |
| 10 | Tab bar: 5 labelled destinations (fits 375 pt / 360 dp); translate guest screens; fix PublicProfile for members (→ UserProfile, add "Follow everywhere") | `TabBar.js:13-20,84`; `GuestRecommended/Feed/Locked`; `PublicProfileScreen.js:112` | M |

---

## Sources
- Linktree tiers and prices (Starter $8, Pro $15, Premium $35; analytics in Pro): [u2l.ai Linktree pricing 2026](https://u2l.ai/blog/linktree-pricing), [toolradar](https://toolradar.com/tools/linktree/pricing). Note: u2l.ai is a Linktree competitor; check against Linktree's own pricing page.
- Tinder Gold about $29.99, Bumble Premium about $32.99, Hinge+ $32.99; all offer multi-length plans: [unstar.app dating paywalls 2026](https://unstar.app/blog/tinder-gold-bumble-premium-hinge-plus-dating-paywalls-2026)
- Yelp for Business: upgrades about $75–$300/mo, ads from about $150/mo (third-party estimates): [costbench Yelp for Business](https://costbench.com/software/review-management/yelp-for-business/hidden-costs/), [G2 Yelp pricing](https://g2.com/products/yelp-for-business/pricing)
- App Review 3.1.2: subscription title, length, price and working Terms/Privacy links required in the binary: [Apple Developer Forums 768364](https://developer.apple.com/forums/thread/768364), [3.1.2 ongoing value](https://community.revenuecat.com/general-questions-7/app-review-rejection-guideline-3-1-2-ongoing-value-6617), [3.1.2 reference](https://ptkd.com/app-store/guidelines/3-1-2)
- 5.1.1(v) account deletion: tell users billing continues and have them cancel first; revoke Sign in with Apple tokens: [Apple, Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app), [App Review Help 5.1.1](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
