# Bowerbird

A Chrome extension for x.com with two jobs:

1. **Screenshots.** A clean image of any post in Light, Dim or Dark. It is copied to the clipboard and saved as a PNG. Settings add the like, repost and view counts, or padding on a soft background.
2. **Folders.** Save a post into one or more folders you make. Browse them on Bowerbird's own page: search, rename, merge and delete folders, remove posts, export and import a JSON file.

Everything stays in the browser on your computer. Bowerbird has no server, no account, no analytics and no remote code. It asks for one permission, `storage`.

Bowerbird is an independent tool. It is not made by, endorsed by or affiliated with X Corp.

- Privacy policy: https://shirish-ship.github.io/bowerbird/privacy.html
- Store listing text and images: [`store/`](store/)

## How to use it

On x.com, click the Bowerbird icon (a small bird) just left of Bookmark under any post.

- Pick **Light**, **Dim** or **Dark** for a screenshot.
- Click **Save post** to save it, or point at it to open the folder list. Type a name and press Enter to make a folder.
- Click the Bowerbird toolbar button, or **Open saved posts**, to see everything you saved.

Keyboard: Tab to the icon and press Enter. Arrow keys move through the menu, Right opens the folder list, Esc steps back.

## Try it from this folder

You need Node 22 or newer.

```powershell
cd "$env:USERPROFILE\Desktop\x-kit-public"
```

```powershell
npm run build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist\bowerbird` folder.

## Tests

The end-to-end test loads the built extension in headless Microsoft Edge with a throwaway profile. A local https server stands in for x.com and pbs.twimg.com (a fake timeline with made-up people), so the real sites are never contacted. It checks the icon placement, keyboard and mouse use, the three screenshot themes, the clipboard, downloads, saving and folders, the whole saved-posts page (search, rename, merge, delete with Undo, export, import, settings), dark mode, phone width, and that nothing logs an error.

```powershell
npm test
```

Screenshots from the run land in `tests\out`. Set `BROWSER_PATH` to use another Chromium build. Branded Google Chrome can't be used, as it ignores `--load-extension`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Checks the package (permissions, no remote code or eval, every file present) and writes `dist\bowerbird-<version>.zip` |
| `npm run icons` | Redraws `icons\*.png` from the mark |
| `npm run store-images` | Remakes the store screenshots and promo tiles in `store\` (run `npm run build` first) |

## What's where

| Path | |
| --- | --- |
| `manifest.json`, `background.js` | The extension's manifest and its small background worker (opens the saved-posts page) |
| `src/` | The content script for x.com: `post.js` reads a post, `shot.js` draws the screenshot, `store.js` keeps saved posts, `content.js` adds the button and menus |
| `page/` | The saved-posts page (`folders.html`), its fonts and styles |
| `icons/` | Extension icons |
| `docs/` | The GitHub Pages site: home page and privacy policy |
| `store/` | Store listing text, privacy answers, screenshots, promo tiles |
| `scripts/` | Build, icons and store images |
| `tests/` | End-to-end test, the fake timeline and a small browser driver |

Only the files the extension needs go into the zip. Tests, docs, store assets and scripts stay out.

## Publishing to the Chrome Web Store

You do steps 1 and 2 yourself: Google needs your account, your payment and your click on Submit.

### 1. Make a developer account (once)

1. Turn on **2-Step Verification** for the Google account you will publish with: https://myaccount.google.com/signinoptions/twosv. The store needs it before you can publish.
2. Open the Developer Dashboard: https://chrome.google.com/webstore/devconsole
3. Accept the developer agreement and pay the one-time registration fee. The page shows the amount.
4. In **Account**, set a publisher name and verify your contact email.
5. In **Account**, declare whether you are a **trader** (the EU asks every publisher). A free extension made as a personal project is usually **non-trader**. A trader must show a legal name, address and phone number on the listing.

### 2. Build the zip

```powershell
cd "$env:USERPROFILE\Desktop\x-kit-public"
```

```powershell
npm run build
```

The upload file is `dist\bowerbird-1.0.0.zip`. Open the folder with:

```powershell
explorer dist
```

### 3. Upload and fill in the tabs

1. In the dashboard, click **New item** and upload `dist\bowerbird-1.0.0.zip`.
2. **Store listing:** paste the description, category and links from [`store/listing.md`](store/listing.md). Upload the icon, the five screenshots and the small promo tile from `store\` (the marquee is optional).
3. **Privacy practices:** copy the single purpose, the two justifications, the data usage ticks and the privacy policy URL from [`store/privacy-practices.md`](store/privacy-practices.md). Remote code: **No**.
4. **Distribution:** Free, Public, all regions.
5. Open https://shirish-ship.github.io/bowerbird/privacy.html and check that it loads.

### 4. Submit

Click **Submit for review**. You can let it publish automatically once approved, or choose to publish it yourself later. A staged item must be published within 30 days of approval. Review often takes a few days and can take longer.

If Google rejects it, the email names a reason code (for example Purple Potassium for permissions, Yellow Zinc for listing details, Purple Lithium or Purple Nickel for privacy). Fix that one thing, then resubmit.

### Updating later

1. Raise `"version"` in `manifest.json` (for example `1.0.1`).
2. Run `npm run build` and `npm test`.
3. In the dashboard, open the item, go to **Package**, upload the new zip and submit.

## License

MIT, see [LICENSE](LICENSE). The bundled fonts (Syne, Onest, JetBrains Mono) are under the SIL Open Font License 1.1; their licenses are in `page/fonts/`.
