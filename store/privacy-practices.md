# Privacy practices tab

Paste these into the Developer Dashboard, **Privacy practices** tab.

## Single purpose

```
Bowerbird helps people keep posts they find on x.com. It adds one button under each post that either makes a clean screenshot image of that post or saves the post's link into folders the user creates, and it gives an extension page to browse and manage those saved posts.
```

## Permission justification

Bowerbird asks for one permission, `storage`, and has no host permissions. Its content script only runs on x.com.

**storage**

```
Keeps the posts the user chooses to save (link, author name and handle, text, picture links and dates), the folder names the user makes, and the screenshot settings in chrome.storage.local on the user's own device, so they are there next time. Nothing is synced or sent anywhere.
```

**Host permission** (the dashboard asks about this because the content script matches `https://x.com/*`)

```
The content script runs only on x.com. It places the Bowerbird button under each post. When the user clicks that button, it reads that one post's visible details (name, handle, text, pictures, date) to draw the screenshot or save the post. It does not run on other sites and reads nothing until the user clicks.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript ships in the package. There is no eval, no remote script and no minified code. `npm run build` checks this.)

## Data usage

**What user data do you plan to collect from users now or in the future?** Tick only:

- [x] **Website content** (text, images, sounds, videos or hyperlinks)

Leave every other box unticked: personally identifiable information, health, financial and payment, authentication, personal communications, location, web history, user activity.

Why tick Website content when nothing leaves the device: Google's guidance counts data an extension handles and stores, even only locally. Bowerbird stores the text, picture links and links of the posts the user saves. Ticking it is the accurate, safe answer. It handles nothing else: it does not log clicks, keystrokes, pages visited or account details.

Prominent disclosure (required for all data handling since 1 August 2026, even local-only): the Bowerbird menu on x.com opens before every screenshot or save, and its last line says "Saved posts and screenshots stay on this computer. Bowerbird sends nothing anywhere." The store description lists what a saved post keeps, and the saved-posts page repeats it under Settings.

**Certifications.** Tick all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy

**Privacy policy URL**

```
https://shirish-ship.github.io/bowerbird/privacy.html
```

The page is `docs/privacy.html` in this repo, served by GitHub Pages from the `docs` folder on `main`. Open the link before you submit to check it loads.

## Test instructions (optional field, helps the reviewer)

```
No account or login is needed, for Bowerbird or for X.
1. Open https://x.com/googlechrome. This public page shows posts without signing in to X. (Signed in, any post on x.com works.)
2. Under a post, click the Bowerbird icon (a small bird). Signed out, X shows fewer buttons, so the icon sits at the end of that row; signed in, it sits just left of Bookmark.
3. Pick Light, Dim or Dark: a PNG of the post is copied to the clipboard and saved to Downloads.
4. Open the menu again, point at Save post, type a folder name and press Enter to save the post into a new folder.
5. Click the Bowerbird toolbar button (pin it from the puzzle-piece menu first) to open the saved posts page: search, folders, Settings, Export and Import.
```
