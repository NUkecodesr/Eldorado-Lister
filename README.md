# Zotac Lister

Desktop app (Electron) for selling Steal a Brainrot pets on Eldorado.gg.

- **Auto List**: import pets from your bases, generate listing images, post offers
- **Listings / Orders / Wallet / Reviews / Notifications / Chat**: Eldorado seller dashboard, refreshes itself
- **Auto Delivery**: reads the buyer's Roblox username from the order chat, launches the stock account and trades the pet in game, then reports to a Discord webhook (cancels the order if delivery fails)
- **Roblox Accounts**: stock accounts with cookies stored encrypted (Windows DPAPI via Electron safeStorage); browser login captures the cookie
- **Image Editor**: listing card templates; brainrot art from the SAB wiki, trait and mutation icons from the game
- **Video Proof**: records deliveries

In-game scripts are in `scanner/` (`zotac_scanner.lua` scans your base, `zotac_delivery.lua` is the delivery agent). The app fills in its local port and agent token when you copy them from the app.

## Run

```
npm install
npm start
```

Build the Windows installer:

```
npx electron-builder --win nsis
```

User data (accounts, settings, pets) lives in `%APPDATA%\Zotac Lister\zotac-data.json` and is only ever stored locally
