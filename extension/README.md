# Freshlog call logger

A Chrome extension for mentors. It times their Google Meet calls and, when a
call ends, opens Freshlog's **Log a session** form already filled in. The mentor
checks it and presses Save. Nothing is logged without them.

## What it does

1. `content.js` runs in every `meet.google.com` tab. Every 5 seconds it reports
   the meeting code, whether the tab is in the call (the Leave call button is on
   screen), and the names it can read off the video tiles and the People panel.
2. `background.js` keeps the live calls in `chrome.storage.session`. A call
   ends when the mentor leaves, closes the tab, moves to another meeting, or the
   tab goes quiet for 2½ minutes (crash, laptop lid). The rules are in
   `tracker.js` and tested in `src/lib/call-tracker.test.ts`.
3. When a call of 3 minutes or more ends, it opens
   `<Freshlog>/sessions/from-call?start=…&end=…&p=…` in the mentor's own
   signed-in browser. (A mentor can switch that off in the popup, and be asked
   **Log it** or **Not a lesson** in a notification instead; Safari has no
   notifications, so there it always opens.) Calls show in the popup for a week.
4. The app works out the student (`src/lib/call-match.ts`):
   - **By email.** Students put the email they sign in to Freshlog with in
     their Meet name: "Aziz Karimov aziz@gmail.com". A match on it, in one
     program, with nothing logged with them that day yet, is logged straight
     away and opened on Sessions for the mentor to correct if need be.
   - **Otherwise** from the mentor's class diary and the names in the call. It
     shows Log a session with the length, date, student, program and attended
     or late filled in, for the mentor to save.

The extension holds no login and talks to no server. It only opens a page in
the browser, so the app's usual session cookie and gates decide what happens.

## Install it for yourself (testing)

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and pick this `extension/` folder.
3. Pin it. Open the popup to point it at a local app (`http://localhost:3000`)
   if you are not testing against `https://www.freshlog.net`.

## Safari

`safari/` at the repo root packages the same code as a Mac app with a Safari
extension inside. Safari differs in three ways (no module service worker, no
`world: "MAIN"`, no notifications), so `node safari/build.mjs` writes a Safari
copy to `safari/extension/` first. Then build `safari/Freshlog Call Logger/` in
Xcode. To hand it out without the App Store, sign it with a Developer ID and
notarize it (Safari 18.4 and later load those).

For a quick local test without signing: Safari → Settings → Developer → tick
**Allow unsigned extensions**, then **Add Temporary Extension…** and pick
`safari/extension/`. Safari forgets both when it quits.

## Install it for every mentor (always on)

Mentors sign in to Chrome with their `@freshman.academy` account, so the
Workspace admin can force-install the extension: mentors cannot remove it or
switch it off.

1. Zip this folder and publish it in the Chrome Web Store as a **Private**
   item, visible only to the `freshman.academy` domain. Private items skip
   public review listing; the one-time developer registration fee applies.
2. Google Admin console → **Devices → Chrome → Apps & extensions → Users &
   browsers** → pick the mentors' organisational unit → **+ → Add from Chrome
   Web Store** → the item → **Force install** (and **Pin to browser toolbar**).
3. It reaches mentors' Chrome profiles within a few hours, or on next restart.

To ship a change, bump `version` in `manifest.json` and upload a new zip. Chrome
updates force-installed extensions on its own.

## When Meet changes

Google changes Meet's page without notice, so being in a call is read two ways:

1. **The Leave call button** (`content.js`), which is exact: it appears the
   moment the mentor is admitted and goes when they leave.
2. **WebRTC** (`rtc-probe.js`), as a backstop. If a page has a live video
   connection for a minute and has never shown the Leave call button, the
   button has been renamed. The call is timed off the connection instead,
   from when the connection came up, and the popup warns that the extension
   needs updating.

So a Meet redesign costs the student guess (names come from the page) but not
the call's length or date. To fix it, update the selectors at the top of
`content.js`, bump `version`, and upload.

## Limits

- **Chromium browsers on a computer only:** Chrome, Edge, Brave, Arc. Meet on
  a phone, Zoom and Telegram calls are not seen. For those, the Classes page
  has **Log session** on every class that has started. It opens the same
  filled-in form and marks the class held on save.
- A student is guessed only from the mentor's own caseload. Two students who
  share a first name and no surname on the tile are not guessed between.
- Signed out: Freshlog asks for Google sign-in, then carries on where the call left off.
