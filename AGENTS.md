# Zotac Lister: handoff notes for the next AI / developer

Electron desktop app (Windows) for selling **Steal a Brainrot** (Roblox) pets on **Eldorado.gg**:
it imports the pets from your Roblox bases, makes listing pictures, lists and reprices offers,
talks to buyers in the order chat and delivers the pets in game with a Lua script that runs in
the player's executor. Repo: `github.com/NUkecodesr/Eldorado-Lister` (branch `main`).

Read this whole file before changing anything. The "Rules" section is not optional.

---

## Rules (learned the hard way)

1. **Bump `"version"` in `package.json` on every push.** Installed and source copies update
   themselves from GitHub and use the version / latest commit to decide (see Updates).
2. **Review before you push.** Re-read the whole diff and walk the real sequence end to end:
   what exists at the moment the code runs (Roblox bases and pets stream in seconds after
   joining), what an empty / partial / failed result does to stored data, name collisions with
   existing code (a CSS class reused by mistake once squashed the whole Auto List page), and what
   re-renders while the user is typing. Say plainly what was not tested.
3. **Never wipe data on an empty or partial result.** A 0-pet scan of a half-loaded base once
   emptied an account's pet list. Imports reject that case (see `importPets` in `main.js`).
4. **Never launch a stock account into a public server.** `launcher.launch` throws `NO_PS` when
   no private server link is set or it can't be resolved. Keep it that way.
5. **No game remotes from the scripts.** The Lua scripts only read what the client already has
   and press the game's own UI buttons (`firesignal` on `Activated` / `FocusLost`). Never
   `FireServer` / `InvokeServer`, never `require` game modules in bulk, never read
   `game.PrivateServerId` (each of those got the user kicked or banned in SAB before).
6. **Test copies must not touch the real autoexec.** Start test instances with
   `ZOTAC_NO_AUTOEXEC=1` (otherwise `syncAutoexec` overwrites the user's real
   `Synapse Z\autoexec` scripts with the test port/token).
7. Write commit messages that describe what actually changed.
8. **No account is special.** Every stock account is an alt; none is "main". Never pick or treat
   an account by its name or its position in a list: choose by state (logged in, in game, pets it
   holds, recent failures). Never hard-code account or buyer usernames in code, defaults or texts.
9. **A trade that happened is always booked.** A job result that arrives late (order stopped,
   cancelled, done by hand) still moves/marks the pets it traded, but never messages the buyer,
   marks the Eldorado order or queues more trades.

---

## Run, build, install

```
npm install
npm start                          # dev / source copy
npx electron . --smoke             # headless self-check
npx electron-builder --win nsis    # -> dist\Zotac Lister Setup <version>.exe
```

- npm may block Electron's install script: `npm approve-scripts electron` then `npm rebuild electron`.
- electron-builder's `winCodeSign` download can fail with "Cannot create symbolic link". Fix:
  pre-extract the 7z without the macOS `*.dylib` symlinks into
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`, or enable Windows
  Developer Mode.
- The installer is per-user (`%LOCALAPPDATA%\Programs\zotac-lister`) and is built with
  `"asar": false`, so the installed app's files are plain files in `resources\app` and the
  updater can replace them.
- User data: `%APPDATA%\Zotac Lister\zotac-data.json` (+ `art\` cache, Electron session with the
  Eldorado cookies). Dev and installed copies share it and a single-instance lock: run one at a time.
- Roblox cookies are stored encrypted with Electron `safeStorage` (Windows DPAPI). The key lives in
  the userData folder, so move that folder, never recreate it.

---

## Layout

| Path | What |
|---|---|
| `main.js` | Electron main: windows, all IPC handlers (`handle('name', fn)`), services wiring, `importPets`, `syncAutoexec`, Auto Scan, avatar refresh, smoke test |
| `preload.js` | `window.zotac` = `{ call(channel, ...args), on(channel, fn) }` (frozen; tests stub state, not this) |
| `bridge-preload.js` | preload for the hidden eldorado.gg window (TalkJS events back to main) |
| `renderer/app.js` | shell: state `S`, nav, footer (Eldorado account, shop on/off switch), live refresh (`LIVE`), events |
| `renderer/pages.js` | Auto List, Listings, Templates / Image Editor, Roblox Accounts (+ Auto Scan window), Sales, Orders, Chat, Searcher |
| `renderer/pages2.js` | Account, Wallet, Analytics, Reviews, Notifications, Server Scan, Auto Delivery, Video Proof, Settings |
| `renderer/imagegen.js` | listing card renderer (canvas, template layers, mutation recolour) |
| `src/main/eldorado.js` | Eldorado API wrapper + `normalizeOrder` |
| `src/main/bridge.js` | runs every Eldorado request inside a hidden eldorado.gg window (cookies + Cloudflare), 30 s timeout |
| `src/main/delivery.js` | buyer chat flow, trade job queue, Discord delivery cards, chat history |
| `src/main/launcher.js` | Roblox launch from cookie -> auth ticket -> `roblox-player:` URI into the private server; close game |
| `src/main/localserver.js` | 127.0.0.1 HTTP server for the in-game scripts and the Chrome extension |
| `src/main/services.js` | Discord webhook, repricer, order/notification watcher, Roblox user/avatar lookups |
| `src/main/updater.js` | GitHub self-update (source and installed) |
| `src/main/wiki.js` | brainrot pictures from the SAB fandom wiki (`assets/wiki-map.json` is the bundled index) |
| `src/main/art.js`, `rbxmesh.js` | game art / 3D mesh fallback for pictures |
| `src/main/sab.js` | pet import parsing (`normalizePetImport`), templates, gen/s parsing |
| `src/main/store.js` | JSON store, defaults (`DEFAULT_DELIVERY_STEPS`, settings) |
| `scanner/zotac_scanner.lua` | in-game scanner (own base + whole server, optional window) |
| `scanner/zotac_delivery.lua` | in-game delivery agent (does the trade through the game UI) |
| `extension/` | Chrome extension "Zotac Cookie Sync" (MV3) |

---

## Features and where they live

- **Auto List** (`pages.js` Auto List, `src/main/autolist.js`): pets from the scanner or pasted
  JSON, Quick Fill templates, smart pricing (`src/main/pricing.js`), Generate Images (cards saved
  under `art/cards`, row shows the card, or the wiki picture before a card exists), Start Auto List
  (uploads card + creates offers). Exact duplicates in one run (same name, mutation, gen/s,
  traits: `AutoLister.sameKey`) become ONE offer with quantity N; a pet identical to an offer already
  live gets +N quantity on it (Stock detection). A sale of quantity q delivers q of the offer's pets
  (`services.js` sale matching slices by quantity). Pasted-JSON pets and the accounts a paste created are
  **session-only**: removed on restart unless listed/sold or used.
- **Listings** (`pages.js`): Active / Paused / Closed tabs (Eldorado states are `Active, Paused,
  Closed, Inactive, PendingReview`; "Expired" is rejected), per-state error box, repricer.
- **Roblox Accounts** (`pages.js`): every logged-in account (saved cookie), also with 0 pets;
  "Show others" for accounts without a cookie. Removing an account is refused while it has listed
  or sold-not-delivered pets; its unlisted pets go with it. Headshots fetched in batches (`refreshAvatars` in `main.js`).
  Account Settings: private server link (required), executable, auto-launch, multi-instance,
  close after delivery.
- **Auto Scan** (`openAutoScan` in `pages.js`, `autoScan` in `main.js`): choose logged-in
  accounts + batch size; launches each batch into the private server, waits for the scanner's
  import, closes the windows it opened; accounts already in game get a rescan request instead.
- **Server Scan** (`pages2.js`): every base in the server the scanner is in (memory only, last 5 servers).
- **Orders / Chat / Notifications / Reviews / Wallet / Account** (`pages.js`, `pages2.js`):
  Eldorado data, live-refreshed (local data every 5 s, Eldorado every 30 s and on events).
  Chat loads the order's TalkJS history; the buyer's checkout Roblox username is revealed and shown.
- **Auto Delivery** (`delivery.js`, `pages2.js`): see the flow below. Autoexec card shows/adds
  executor autoexec folders. Order simulator for testing without Eldorado.
- **Shop online/offline**: click the sidebar status box (`renderFooter` in `app.js`).
- **Video Proof**: ONE clip per buyer trade (never the hops between stock accounts), from that
  account's own Roblox window (`proof:target` -> HWND of the process Zotac launched). Each frame is
  stamped (order, account, what is happening, clock). On save main writes the WebM duration
  (`src/main/webmfix.js`) and, when ffmpeg is installed, remuxes it for a seek index; `.json`
  sidecar next to each clip; clips are linked in the Trade Log. The page keeps one `<video>`
  element across live refreshes and skips refreshes while it plays.
- **Trade Log** (Auto Delivery tab, `trades` in the store, `delivery.record`): permanent ledger of
  every pet that left an account: `delivered` (to a buyer, test trades too), `gather` (feeder ->
  mother), `gone` (a complete rescan no longer shows it and Zotac did not trade it). The pet comes
  off the account in Zotac at once (`delivered` + sold, or `accountId` = mother).
- **Updates**: Settings -> Updates (see below).

---

## Auto Delivery flow

1. Watcher (`services.js`) sees a new sold order -> `delivery.onSale`.
2. The buyer's Roblox username from checkout is read (`eld.deliveryDetail`). If present and real
   on Roblox: greeting "you entered X" + confirm 1/2 (`greetingKnownUser`, `confirmUsername`).
   Otherwise the normal greeting asks for it and `proposeUsername` parses chat replies.
3. Confirmed -> a trade job per stock account (`jobs` in the store). If that account's agent is
   offline and auto-launch is on, the launcher opens it into the private server.
4. `zotac_delivery.lua` (autoexec) polls `/agent/jobs`, then in game: opens the Trade menu, types
   the buyer into the search box, presses Send, waits for the trade window (150 s, resend every
   25 s), checks the partner, adds the pets (green outline = added), READY (button turns ACCEPT),
   ACCEPT, waits for the window to close, checks the pets left the base. Result -> `/agent/jobs/<id>`.
5. Success: buyer told, order marked delivered (optional), Discord card. Failure: 3 tries, then the
   order is cancelled on Eldorado with the reason (or manual fallback if that is switched off).

Tested live on 2026-10-16 (single-account trade, and three gathered quantity orders of 3-4 pets over
3 accounts with each account once as mother): every step above worked.

- The agent pastes the buyer's name into the trade search box on screen every time (also when the
  row is already listed), so the clip shows who the trade went to.
- Buyer cancels / closes the trade window: the agent re-sends and re-adds by itself, up to 2 more
  rounds per job (`deliverOnce` + `deliver` loop), and posts `/agent/jobs/<id>/event`
  (`buyer_cancelled`): the buyer gets the `buyerCancelled` message and the job timer restarts. Not
  counted as a failed attempt. The mother's `receive` does the same (waits for the re-sent request).
- Right after joining, the agent waits up to 30 s for its base to fill before saying "only 0 in base".
- Eldorado shows an order cancelled/refunded (`Watcher.syncSaleState` -> `orderCancelled`): the
  delivery stops and its undelivered pets go back to listed/available (`releasePets`). Zotac's own
  cancel after 3 failures and the seller's Stop do the same. Listed pets whose offer is no longer on
  Eldorado (Active + Paused) go back to available (`reconcileListed`, at login + every 15 min).
- Orders page "Start auto delivery" = `delivery.startFromOrder`: pets already booked to the order,
  else the bought quantity from the offer's listed pets; never the whole offer's stock.

### Quantity orders and the mother account (gather)

- A sale of quantity N (`purchaseQuantity`) takes N of the offer's listed pets, from as few accounts
  as possible (`pickFewestAccounts` in `services.js`); identical unlisted pets (`sab.petKey`) fill a
  gap. Still short -> `delivery.onSale` stops for the seller (`manual`), it never trades fewer.
- Pets of one order on several accounts (Settings "Gather onto one account", `delivery.consolidate`,
  default on): `startGather` picks the **mother** by state, never by name: must be able to run (in
  game or has a cookie), then most of the order's pets, then already in game, then fewest failed
  jobs in the last 2 h, then least recently mother. Each other account (feeder) gets a pair of jobs:
  `receive` on the mother (accept the incoming request, wait until the feeder's offer holds the
  pets, READY, ACCEPT, check they arrived) and `transfer` on the feeder (normal send with the mother
  as "buyer", `inviteTimeout` 240 s, `closeWhenIdle` = feeder's game closes afterwards). A transfer
  is only handed out once its receive job is running. Either side seeing the pets move counts;
  moved pets get `accountId = mother` (`gatheredFrom` = old). Then ONE `deliver` job from the mother
  to the buyer. Feeders go one at a time: the next one is only queued (= launched) after the
  previous hop ended and its game closed, so at most 2 games are open (user rule). A feeder whose
  hop fails 3 times, or a full mother base ("Your Offer n/cap" with n > cap -> "mother base full"),
  trades the buyer itself after the mother; `gatherFallback` (one trade per account) only when no
  mother can be used.
- A failed side asks the other to stop (`cancelRequested`, agent polls `GET /agent/jobs/<id>` and
  only obeys before a trade window opens); retry waits until both sides reported.
- Incoming trade request on the mother's screen = PlayerGui `DuelsMachinePrompt` (ACCEPT button,
  names the sender). After both READY the game shows "Xs Left" with ACCEPT greyed out (presses
  ignored), then ACCEPT works and your side shows "Confirmed!"; the agent presses only after the
  countdown and stops once Confirmed! (proof video 2026-10-16).
- Launcher maps each launched Roblox process by the launch's `browsertrackerid` in its command line
  (two accounts launched together used to get the same pid).
- Rescans (`importPets`) keep an unlisted pet's id and everything set on it (price, lock, Quick
  Fill text, card) when the scan still shows the exact same pet (`sab.petKey`); they never re-add or
  drop pets of a running delivery or sold-not-delivered pets; a pet id missing mid-delivery stops the
  order for the seller (`needsYou`), never "delivered". Jobs always belong to an account.
Failure reasons the agent reports are listed in its `deliver()` returns; the app adds "the
delivery script never connected from @account" when nobody picked a job up.

---

## In-game scripts

Both start with a load wait (`game.Loaded`, then `PlaceId ~= 0`) and only run in place
`109983668079237`. The app substitutes `local ZOTAC_PORT` / `local ZOTAC_TOKEN` (agent token) when
it serves them (`scannerScript(which)` in `main.js`: `scanner`, `scanner-auto` = no window/no
clipboard, `delivery`). `syncAutoexec` writes `zotac_delivery.lua` and `zotac_scanner.lua` into
Synapse Z's autoexec, AppData executors that exist, and folders from
`settings.delivery.autoexecDirs`, on every start and token change.

**Scanner**: waits until the base's pet models match the game's own count (plot cache via
`getgc`: tables with `Index` + `CacheTable`, `CacheTable.AnimalList`) or stop changing, then posts
the pets (`/scanner/import`, replaces that account's unlisted pets), then art separately
(`/scanner/art`). Every 5 s asks `/scanner/wanted` (Auto Scan rescan), every 30 s heartbeat +
rescan-if-changed + server scan (`/scanner/server`). Gen/s and traits come from the name tag
overheads in `workspace.Debris` (only exist near the player: far bases have gen 0, no mutation).

**Game UI paths used** (PlayerGui): `LeftCenter.LeftCenter.Buttons.TradePlayerList` (Trade
button), `TradePlayerList.TradePlayerList.Sections.Players` (`SearchBox`, `List` rows named
`<user>_<userId>` with `Send`, `Status2`, `Username`), `TradeLiveTrade.TradeLiveTrade`
(`Other.Username` = "@x's Offer", `Your.ScrollingFrame` items `Selection_Brainrot*` -> `Spacer`
button, `Title`, `Cash`, `UIStroke` green when added; `Other.ReadyButton` text READY/ACCEPT;
`Other.Cancel`). Own base: plot whose `PlotSign` shows "YOUR BASE" (or plot cache owner).

---

## Local HTTP server (127.0.0.1, `settings.localPort`, default 47321)

| Route | Auth | Use |
|---|---|---|
| `GET /ping` | - | health |
| `GET /extension/pair` | origin `chrome-extension://` + host 127.0.0.1/localhost | gives the extension token |
| `POST /extension/cookies` | extension token | Eldorado cookies + browser user agent -> hidden window |
| `POST /scanner/import` | agent token | own base pets (`expected` = game's count) |
| `POST /scanner/art` | agent token | pictures / icons / 3D data for pets |
| `POST /scanner/server` | agent token | every base in the server |
| `GET /scanner/wanted?account=` | agent token | Auto Scan wants a fresh scan |
| `POST /agent/heartbeat` | agent token | client alive / closing |
| `GET /agent/jobs?account=`, `POST /agent/jobs/<id>`, `POST /agent/log` | agent token | delivery agent |

## Eldorado endpoints that matter (all via `bridge`, base `https://www.eldorado.gg/api/`)

- Orders: `orders/me/seller/orders` (state is an object: `state.state`; title/picture under
  `orderOfferDetails`; `talkJsConversationId`; cursor paging `cursorValue`, `pageDirection=Next`,
  `nextPageCursor`), `orders/me/{id}` (detail: `deliveryDetailsSubmission.details[{id,type}]`),
  `v1/orders/me/{id}/delivery-details/{fieldId}` (reveals the masked checkout field, e.g. Roblox
  username), `orders/me/{id}/deliver`, `orders/me/{id}/cancel`.
- Chat: `conversations/me/authorize` (TalkJS token, app id `49mLECOW`),
  `v1/conversation-management/me/conversations/order/{id}/quick-reply`; history via TalkJS
  `session.conversation(id).subscribeMessages` (newest first).
- Offers: `v1/item-management/me/offers/me/search` (PageSize max 50), pause/resume/delete/price.
- Reviews: `review` on each seller order; counts `orders/me/reviews?pageSize=1` -> `userOrderInfo`.
- Shop on/off: `GET offerUser/me` (`offlineMode` Online|Offline), `PUT offerUser/me/switchOnline|switchOffline`.
- Profile picture fields vary; `eldPicture()` in `app.js` searches them; public profile fallback.
- Finding more: eldorado.gg is an Angular app; download `main-*.js` and its `chunk-*.js` files and
  grep for the API path or the UI text.

## Updates

`src/main/updater.js`. Never uses the rate-limited REST API (60/h per connection without login):
newest commit from `github.com/<repo>.git/info/refs`, zip from `codeload.github.com/<repo>/zip/<sha>`,
version from that `package.json`. Newer version or a new commit (vs `autoUpdate.installedSha`)
-> copy over the app folder (skips `node_modules`, `.git`), `npm install` if dependencies changed
(`--omit=dev` when installed), relaunch. Checked once at start when "Update automatically" is on,
and from Settings. Only an asar build would need GitHub release installers.

## Chrome extension (`extension/`, MV3, version in its own manifest)

Pairs itself (`/extension/pair`), syncs on browser start, on login-cookie changes (analytics
cookies ignored), every 10 min and on demand; sends the browser's user agent so Cloudflare's
clearance cookie works in the app. `sync.js` is shared by the popup and the worker. After changing
the manifest the user must press reload in `chrome://extensions`.

---

## Testing

- **Isolated app copy with DevTools**: `ZOTAC_NO_AUTOEXEC=1 npx electron . --user-data-dir=<tmp>
  --remote-debugging-port=9223`. Pre-write `<tmp>/zotac-data.json` with
  `{"settings":{"localPort":47399,"agentToken":"t"}}` so its local server doesn't clash with the
  real app on 47321. Drive it over CDP (`Runtime.evaluate`; screenshots with
  `Page.captureScreenshot`). `window.zotac` is frozen: stub page state (`S`, `LS`, `CH`...), not IPC.
- **Main-process logic**: `node -e` with `Module._load` patched to fake `electron`, or pull an object
  out of `main.js` with `new Function` (done for Auto Scan).
- **Live game**: the user runs the MCP bridge `client.lua` in Roblox; relay is
  `relay-server\server.exe` on port 8080 (start it if the call fails with 10061). Use it to
  compile-check Lua (`loadstring(readfile(...))` without calling it) and to drive the game UI.
  Ask the user before doing anything live in SAB.
- No Eldorado login on the dev PC: Eldorado features can only be tested with sample data shaped
  like the real responses; say so when reporting.

## Known gaps / not verified

- Shop online/offline switch, chat history, reviews, buyer username reveal and the extension
  were built from Eldorado's own frontend code and sample data, not run against a logged-in account.
- Other players' bases in Server Scan come through with gen 0 / no mutation when far away
  (overheads not streamed). Fix needs a read-only look at the plot cache data for gen/mutation.
- Auto Scan's 1.12.3 changes (rescan request, partial-base rule) were simulated with fakes, not run live.
- The installed app needs Node/npm on the PC only if an update changes dependencies.
