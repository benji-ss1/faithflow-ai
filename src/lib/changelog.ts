// Version changelog — the "What's New" modal reads this at mount and shows
// any entries newer than the operator's last-seen version.
//
// Add a new entry at the TOP whenever you tag a release. Keep highlights
// operator-facing (what THEY see change), not internal refactors.

export type Highlight = string | { text: string; tryItHref?: string; tryItLabel?: string; highlightParam?: string };

export type ChangelogEntry = {
  version: string;
  date: string; // ISO YYYY-MM-DD
  headline: string;
  highlights: Highlight[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.379",
    date: "2026-09-04",
    headline: "Lower third for everything — songs, images and video, not just verses",
    highlights: [
      { text: "The lower / upper / mid third band now works for SONGS too, not only Bible verses. Set it once and your lyrics come up in the band automatically — same as your verses.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "New “Layout” tab in the song editor (and in the image editor): pick Full screen or a Lower / Upper / Mid third, set the band height, text size, push and colour. It saves as your default and applies to every slide going forward — verses, songs, images and video.",
      "Images and videos follow the same setting — when your default is a third, they sit neatly in the band with your theme showing above and below (instead of full screen).",
      "Careful under the hood: your existing look is untouched unless you choose a third, held slides never flicker, and everything is checked before it reaches the screen.",
    ],
  },
  {
    version: "0.1.378",
    date: "2026-09-04",
    headline: "Your stream now shows your themes — plus a dead-simple OBS setup",
    highlights: [
      { text: "Fixed: your live stream now shows the SAME look as the projector — your fonts, colours and theme. Before, the stream could get stuck on the plain black-and-white default even after you'd changed the theme, because the styling frame occasionally dropped and never came back. The stream (and the stage display) now re-check every few seconds and self-heal, exactly like the projector already does.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "New guided setup: Hardware → Screens now walks you through putting lyrics on your stream in 3 baby steps — pick the look, copy one link, paste it into OBS — with a live status that turns green the moment OBS connects. No OBS knowledge needed.",
      "Choose the look: “Over your camera” (see-through words on the live camera) or “Full projector look” (your theme background + words, exactly like the screen).",
      "New: LAN mode for a separate streaming computer on the same WiFi/Ethernet — the most reliable option, with no internet needed for the live words and a live “devices connected” count. An internet link is still there for anywhere else.",
    ],
  },
  {
    version: "0.1.377",
    date: "2026-09-04",
    headline: "OBS lyrics overlay now connects across two computers",
    highlights: [
      { text: "Fixed the OBS Browser Source overlay for two-computer setups (operator on one PC, OBS on another). The cross-device connection was silently disabled — it now works, so your lyrics/scripture composite over the camera in OBS.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "New: the overlay page shows a clear connection status while you set it up — “Connecting…”, “Connected ✓ — send a slide to test”, or “Reconnecting…” — so you can confirm it's live before the service instead of guessing. It hides itself once a slide is on screen.",
      "In OBS, remember to UNCHECK “Shutdown source when not active” and “Refresh browser when scene becomes active” on the Browser Source — those two settings drop the live connection.",
    ],
  },
  {
    version: "0.1.375",
    date: "2026-09-03",
    headline: "Scripture band: put it in any third, bigger and higher",
    highlights: [
      { text: "The scripture band can now go in the UPPER, MID or lower third — so on a high-mounted screen the verse sits where people can actually read it, not stuck at the very bottom.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "New controls: Push up/down to nudge it past your screen's edges/overscan, Text size to make the verse much bigger, and Height to size the band. Or just drag the band up and down right in the preview.",
      "The reference now sits neatly inside the band at any position, and the preview stays exactly true to what hits the projector.",
    ],
  },
  {
    version: "0.1.374",
    date: "2026-09-03",
    headline: "New: Lower-third scripture — big verses in a bottom band",
    highlights: [
      { text: "Edit a scripture slide and pick “Lower third” to project the verse as a big caption in a bottom band instead of a full screen — perfect when you're running your own camera or graphics behind it. Short verses go large; long verses split into readable cards.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Choose the band look: a solid or gradient colour with adjustable opacity, or “None” for a clean transparent caption with a shadow. It defaults to a black band at ~70% — the safest, most readable choice over anything.",
      "It's a per-church preset: set it once and every verse — whether you tap it, or the AI fires it, or you say “next verse” — comes up in the lower third automatically. Switch back to “Full screen” any time.",
      "The editor shows a live, true-to-projector preview as you tune the band, so what you see is exactly what the congregation gets.",
      { text: "Windows + OBS: the NDI settings now guide you straight to the transparent Browser Source overlay — so your lyrics and lower-third scripture composite over your camera in OBS with no capture card and no extra software. Pair it with a “Lower third” verse set to a transparent band for a clean broadcast caption.", tryItHref: "/operator", tryItLabel: "Open operator" },
    ],
  },
  {
    version: "0.1.373",
    date: "2026-09-02",
    headline: "Rock-solid audio setup on Windows",
    highlights: [
      "On Windows, PresentFlow now defaults to the proven audio-capture path (the same getUserMedia/WASAPI route that works everywhere), so a mixer over USB is picked up reliably out of the box. Mac keeps its native path unchanged — the two never interfere.",
      "New setup help: “Capturing this computer's audio instead of a mixer?” walks you through a loopback route on Windows (VB-Audio Virtual Cable or Stereo Mix) or Mac (BlackHole), then it appears in the input list like any other device.",
      "Clearer wording throughout audio setup for Windows churches — no more Mac-only phrasing.",
    ],
  },
  {
    version: "0.1.372",
    date: "2026-08-31",
    headline: "Simpler, steadier AI behaviour",
    highlights: [
      "We've pulled back two experimental detection behaviours (the “hold while you're driving” pause and the “contextual awareness” beta) to keep AI projection simple and predictable. The AI now behaves exactly as it did before those experiments.",
      "Everything else stays: smarter song matching, the new fonts, faster media library, voice “continue to the next verse”, and verse ranges going live one verse at a time.",
    ],
  },
  {
    version: "0.1.371",
    date: "2026-08-31",
    headline: "Verse ranges go live one verse at a time — like the preview",
    highlights: [
      { text: "When a range like “Exodus 3:10–12” is detected, it now goes LIVE one verse at a time — exactly the separate, per-verse slides you see in the preview — instead of cramming all three verses onto one crowded slide. Advance through them with “next verse”.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "This is consistent everywhere now — auto-detection, tapping a chip, or a spoken command all project the range verse-by-verse.",
      "Voice nav also understands the misheard word going backwards now (“previous verse” as well as “next verse”).",
    ],
  },
  {
    version: "0.1.370",
    date: "2026-08-31",
    headline: "Media library opens instantly",
    highlights: [
      { text: "The Media library no longer reloads from scratch every time you open it. Switch to Media and it appears immediately from what it loaded before, then quietly refreshes in the background — no more waiting on a spinner mid-service.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Faster underneath too: media now loads via an indexed query, so it stays quick as your library grows.",
    ],
  },
  {
    version: "0.1.369",
    date: "2026-08-31",
    headline: "“Continue to the next verse” now actually advances",
    highlights: [
      { text: "Fixed voice verse-nav: saying “continue to the next verse, please” (or “can you go on to the next verse”) now advances the verse. Before, the polite wording pushed the command just over the length limit and it silently did nothing — so only the terse “go back to verse 7” worked.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Better with accents: when speech-to-text mishears “verse” as “wrist”, “1st” or “Esther” in “the next ___”, we now understand it as “next verse” and advance anyway.",
      "Ordinary preaching that happens to contain “…in the next verse” still won't move the screen — only a real, terse command does.",
    ],
  },
  {
    version: "0.1.367",
    date: "2026-08-31",
    headline: "Songs match what you're actually singing — plus 5 beautiful new fonts",
    highlights: [
      { text: "Song detection is smarter. It no longer jumps to the “next song in the plan” just because the last one finished — it only pre-stages the next song on a real quiet gap, and while you're singing it finds the song you're actually singing. Repeated worship phrases (“glory to glory to glory”) now match their song properly instead of scoring too low to surface.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "The “next in plan” prompt no longer shows a misleading “100%” — a percentage now only appears for a real lyric match.",
      { text: "5 beautiful new slide fonts to choose from — Playfair Display, Cormorant Garamond, Fraunces, Spectral, Montserrat (and DM Serif Display). Pick them per slide in the editor or per theme.", tryItHref: "/library/themes", tryItLabel: "Open Themes" },
      "Tidy now also fixes the standalone “i” → “I” when cleaning up song lyrics.",
    ],
  },
  {
    version: "0.1.366",
    date: "2026-08-30",
    headline: "No more invalid verses, smarter references, and NKJV on command",
    highlights: [
      "Invalid verses can't project anymore. A reference that doesn't exist — like “Romans 8:80” (Romans 8 ends at 39) or a mis-heard “2 John 4:7” — is now recognised as invalid across all 66 books and never goes to the screen or gets stuck in the preview.",
      "Smarter reference reading: when a sentence ends on a number before a new book (“…be like 2. John 4:7”), it now reads the correct John 4:7 instead of gluing it into “2 John”.",
      { text: "Say the translation you want and it switches — even right after another one. “NLT… actually NKJV” now both project (a cooldown used to swallow the second), and “MKJV” is understood as NKJV.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "The Contextual awareness (beta) toggle is now easy to find — it's in the right-hand Settings (⚙) under the Bible tab.",
    ],
  },
  {
    version: "0.1.365",
    date: "2026-08-30",
    headline: "Preview follows the live verse — plus Contextual awareness (beta)",
    highlights: [
      { text: "The center preview now stays in sync with what's LIVE. Before, when the AI fired a new verse to the projector, the preview panel could stay stuck on the previous verse — now it follows to the live verse (while a repeated verse still won't churn your staged panel).", tryItHref: "/operator", tryItLabel: "Open operator" },
      { text: "New — Contextual awareness (beta): turn it on in Settings → Audio. It understands the moment, so a prayer/sermon that just uses worship words (“in the mighty name of Jesus”) won't auto-fire a song, and an ambiguous “continue” mid-story won't step the verse. On by your choice; off by default.", tryItHref: "/operator", tryItLabel: "Open Settings" },
      "The service-mode switch (Auto / Worship / Preacher) is now honest: it biases detection, but verses auto-project via the AUTO toggle — the toast nudges you to turn AUTO on when it's off.",
    ],
  },
  {
    version: "0.1.364",
    date: "2026-08-30",
    headline: "Sharper scripture detection — repeated numbers and the right book",
    highlights: [
      "When a preacher restates a verse and stutters the number — “Romans four four eighteen” — it now lands on the right verse (Romans 4:18) instead of the wrong one, and a correct verse already on screen won’t get bumped to a wrong one.",
      "The right book stays on screen: a passage about “Revelation” is no longer occasionally shown as “Romans”.",
    ],
  },
  {
    version: "0.1.363",
    date: "2026-08-30",
    headline: "Repeated verses stay put — no preview churn, no accidental skip",
    highlights: [
      { text: "When a preacher repeats a verse that's already on screen — “John 3:16… let's go to John 3:16… John 3:16” — the app now leaves it completely alone: it won't re-shuffle your center/preview panel, and it won't jump ahead to the next verse just because the current one was already up. Moving to a different verse, a real “next verse”, and translation switches all still work exactly as before.", tryItHref: "/operator", tryItLabel: "Open operator" },
    ],
  },
  {
    version: "0.1.362",
    date: "2026-08-29",
    headline: "Translation switch now reaches the projector, not just the preview",
    highlights: [
      { text: "Switching the Bible translation on a verse that's already live now re-projects it on the real screen — previously the preview and the LIVE box updated but the projector could stay on the old version. It now uses the same instant, reliable path a fresh verse uses.", tryItHref: "/operator", tryItLabel: "Open operator" },
    ],
  },
  {
    version: "0.1.361",
    date: "2026-08-29",
    headline: "Readable song themes, working Blank, tidier verse footer",
    highlights: [
      { text: "Applying a theme to a song can no longer produce unreadable text — if the theme’s text and background are too close in tone, the text is auto-adjusted so it always stays legible on the projector.", tryItHref: "/operator", tryItLabel: "Open a song" },
      "“Blank” is now a proper toggle — press it (or B) again to bring the exact slide that was live right back, instead of being stuck on a black screen.",
      "On long Bible verses, the reference at the bottom no longer overlaps the last line — the verse now shrinks to sit neatly above it.",
    ],
  },
  {
    version: "0.1.360",
    date: "2026-08-29",
    headline: "More reliable verse projection",
    highlights: [
      "Auto-advance now works even through repeated-line passages (e.g. a refrain where every verse reads the same), and recognises verses projected from a phrase match or the verse bank — so it keeps moving with the reader.",
      "Auto verse-advance recovers faster after you touch a control (the pause after a manual action is now shorter), so hands-free reading isn’t stalled during a busy service.",
    ],
  },
  {
    version: "0.1.359",
    date: "2026-08-29",
    headline: "Auto verse-advance & voice translation switches project again",
    highlights: [
      "Auto “next verse” now actually moves the verse on the projector as the reading continues (an internal check was comparing the wrong slide format and silently skipping every advance).",
      "Saying a translation (e.g. “New King James”) now re-projects the live verse in that translation immediately — previously it only worked from the dropdown, and only when the reference showed the translation code.",
    ],
  },
  {
    version: "0.1.358",
    date: "2026-08-28",
    headline: "Theme & template backgrounds now show on songs",
    highlights: [
      { text: "Big fix: your theme background AND moving templates (like Gradient Waves) now actually appear behind song lyrics on the projector. Song slides carried a hidden black background that was blocking every theme/template — that’s removed, so the look you pick now shows on the big screen.", tryItHref: "/operator", tryItLabel: "Open Themes" },
    ],
  },
  {
    version: "0.1.357",
    date: "2026-08-28",
    headline: "Themes stay on the projector — reliably now",
    highlights: [
      "Your theme’s background now reaches the projector and stays there — if the projector ever missed the themed background, it now heals itself within a few seconds instead of showing a plain screen for the rest of the service.",
      { text: "Tidy now works on songs you’ve styled — it re-breaks the lines into cleaner slides while keeping your background, font and colour. (Songs with images or shapes are still left untouched.)", tryItHref: "/operator", tryItLabel: "Open a song" },
      "Tidied up the operator buttons: removed a couple that didn’t do anything yet, and the “Open Screens panel” button now actually opens Screens.",
    ],
  },
  {
    version: "0.1.356",
    date: "2026-08-28",
    headline: "Bible verse & song text uses your theme colour",
    highlights: [
      "Continues the theme fixes: verse and song text now take your theme’s colour on the projector (and auto-picks a readable colour on light themes), so nothing shows white-on-white.",
    ],
  },
  {
    version: "0.1.355",
    date: "2026-08-28",
    headline: "Scrolling messages (ticker) on the projector",
    highlights: [
      { text: "Turn any message into a moving ticker: in Messages, switch on “Scroll across”, pick the direction (Right→Left or Left→Right) and the speed. It keeps moving across the band you chose (e.g. lower third) — great for standing announcements during worship.", tryItHref: "/operator", tryItLabel: "Open Messages" },
    ],
  },
  {
    version: "0.1.354",
    date: "2026-08-28",
    headline: "Theme colours on verses & songs, working uploads, and fixes",
    highlights: [
      { text: "Your theme’s text colour now applies to Bible verses and song lyrics on the projector — not just plain text. A colour you set on a specific slide still wins.", tryItHref: "/operator", tryItLabel: "Open Themes" },
      "Adding an image in the Themes editor now opens the file picker (clicking “upload” was doing nothing).",
      "“Clear Lower Third” now actually clears it off the projector, and Copy buttons (sync code, OBS URL) reliably report success only when the copy really worked.",
      "The OBS overlay link is now reachable in the browser too, and NDI output now sends the real live picture to your broadcast computer.",
    ],
  },
  {
    version: "0.1.353",
    date: "2026-08-28",
    headline: "Themes now reach the projector",
    highlights: [
      { text: "Your theme’s background now shows on the actual projector, not just in the app. Applying a theme that has its own background automatically turns off any Background Template that was covering it — pick one background at a time.", tryItHref: "/operator", tryItLabel: "Open Themes" },
      "The little “what the projector shows” preview in the top-right is now honest: it shows exactly what’s on the projector, including an active Background Template, so preview and projector always match.",
    ],
  },
  {
    version: "0.1.352",
    date: "2026-08-28",
    headline: "Lyrics over camera: no more cut-off, and you can move them",
    highlights: [
      { text: "When lyrics sit over a live camera, they no longer grow so large the bottom line is cut off — they now keep a safe margin and always fit the frame.", tryItHref: "/operator", tryItLabel: "Open Video Input" },
      "New Position control in Video Input (full-screen overlay): place the words at the Top, Centre, or Bottom over your camera. Combine with the size slider for exactly the look you want.",
    ],
  },
  {
    version: "0.1.351",
    date: "2026-08-27",
    headline: "In-app help: how to stream your lyrics to OBS",
    highlights: [
      { text: "The Video Input panel now has a “Stream this to OBS?” guide with steps for both setups — camera inside PresentFlow (OBS just captures the output window) or camera inside OBS (PresentFlow sends only the words). No more hunting for how to wire up the livestream.", tryItHref: "/operator", tryItLabel: "Open Video Input" },
    ],
  },
  {
    version: "0.1.350",
    date: "2026-08-27",
    headline: "Media previews match the projector exactly",
    highlights: [
      "The slide grid now shows media images with their saved framing and blur-fill — so the preview you see is exactly what goes live. Clicking a media slide projects that same framed look.",
    ],
  },
  {
    version: "0.1.349",
    date: "2026-08-27",
    headline: "Blur-fill that actually sticks — and a fuller Themes editor",
    highlights: [
      { text: "Blur-fill now shows right in the image editor (1:1 with the projector) and it SAVES — turn it on once and the flyer stays blurred everywhere it plays: the media library, the playlist, and live. The toggle sits up front now, not hidden behind Auto-fill.", tryItHref: "/operator", tryItLabel: "Open Media" },
      "Media images are editable from more places: double-click a slide in the grid, or use the Edit image button — the same crop/frame/blur editor, wherever you are.",
      { text: "The Themes editor got the full refresh: the new warm look, and a proper drop zone to upload your church logo or a background image (drag it in or click). It always had a live preview — now it's obvious and consistent with the rest of the app.", tryItHref: "/library/themes", tryItLabel: "Open Themes" },
    ],
  },
  {
    version: "0.1.348",
    date: "2026-08-27",
    headline: "Live camera now shows through your theme — full-screen lyrics over video",
    highlights: [
      { text: "Using Video Input? Your camera now appears behind the lyrics even when a background theme/template is set — previously an animated theme could hide the camera completely. Turn the camera on and it takes over; clear it and your theme returns.", tryItHref: "/operator", tryItLabel: "Open Video Input" },
      "Lyrics and verses now fill the whole screen over the camera by default (they used to sit in a small bottom strip). Prefer the broadcast lower-third look? Pick it from the Overlay dropdown in Video Input.",
    ],
  },
  {
    version: "0.1.347",
    date: "2026-08-27",
    headline: "Edit any image, from anywhere",
    highlights: [
      { text: "The full image editor — crop, frame, pan/zoom, and blur-fill — is now reachable from the playlist too: right-click an image inside a media group and choose “Edit image”, or hit “Edit image” in the toolbar when a media group is open. Same editor, same powers as the Media library.", tryItHref: "/operator", tryItLabel: "Open operator" },
    ],
  },
  {
    version: "0.1.346",
    date: "2026-08-27",
    headline: "Blur-fill for portrait flyers",
    highlights: [
      { text: "Projecting a tall flyer or phone photo? Open it in the image editor, choose Fit, then turn on “Blur fill the bars” — the black letterbox fills with a soft, blurred copy of the same image, so the flyer looks like a designed full-screen slide instead of a thin strip on black.", tryItHref: "/operator", tryItLabel: "Open Media" },
    ],
  },
  {
    version: "0.1.345",
    date: "2026-08-27",
    headline: "OpenFlow remembers your conversations",
    highlights: [
      { text: "OpenFlow now saves your chats. Tap the history icon in the OpenFlow header to see past conversations — pinned first, then most recent — and click any one to pick up right where you left off.", tryItHref: "/operator", tryItLabel: "Open OpenFlow" },
      "Rename a conversation, pin the ones you reuse, or delete the ones you don't — right from the list. History is shared across your church's team.",
    ],
  },
  {
    version: "0.1.344",
    date: "2026-08-27",
    headline: "OpenFlow keeps its face while you talk",
    highlights: [
      { text: "OpenFlow now has a permanent header — its logo and name stay with you the whole conversation instead of vanishing the moment you send a message. There's a “New chat” button up top to start fresh and jump back to the welcome screen.", tryItHref: "/operator", tryItLabel: "Open OpenFlow" },
      "The look is calmer and more alive: one soft ambient glow sits behind the whole panel (bold on the welcome screen, gentle once you're chatting) and the harsh full-screen sweep between modes is gone.",
    ],
  },
  {
    version: "0.1.343",
    date: "2026-08-27",
    headline: "OpenFlow is back, and “Save to all slides” in the editor",
    highlights: [
      { text: "OpenFlow can talk to the AI again — the underlying model had been retired by our provider, so it's now on a current, more capable one. Ask it anything about your church.", tryItHref: "/operator", tryItLabel: "Open OpenFlow" },
      { text: "In the slide editor there's now a “Save to all slides” button: change the font, size, colour or any styling on one slide, hit it, and every slide in the song gets the same look in one go (your words stay untouched, and you can undo).", tryItHref: "/operator", tryItLabel: "Open the editor" },
    ],
  },
  {
    version: "0.1.342",
    date: "2026-08-27",
    headline: "The design refresh reaches every corner",
    highlights: [
      "The AI On/Off and Auto/Manual switches now lift and glow like the Worship/Auto/Preacher control, and the whole bottom transport bar — play, blank, skip, verse nav, speed — has real weight and motion.",
      "The Cmd+K search, the Bible reference toolbar, the Audio/Screens/Video panels, the Media library, and the scripture-slide editor all got the same lift, depth, and ember accents. Stray blue sliders and purple badges are gone — replaced with proper icons.",
      "AI detections and the live transcript read bolder and cleaner, the left sidebar carries more weight, and the little buttons (undo/redo, the + buttons, view switches) all feel deliberate now.",
    ],
  },
  {
    version: "0.1.341",
    date: "2026-08-27",
    headline: "A bolder, warmer look across the whole app",
    highlights: [
      "New charcoal foundation — deeper, calmer, and warmer without the muddy brown. Panels, cards, playlist rows and slide previews now sit on real depth and lift as you hover.",
      "Buttons carry weight now: primary actions ride a warm ember gradient with a soft glow, and every button lifts on hover and presses in on click — including the toolbar, the Play button, and the view switches.",
      "The Worship / Auto / Preacher switch is redrawn with proper icons (no more emoji), a lit active pill, and motion. Section headers, the search bar, and the Media / Hardware lists all read stronger.",
      "Serif headings, refined focus rings, ember scrollbars and smoother motion throughout — a bigger design refresh still rolling out screen by screen.",
    ],
  },
  {
    version: "0.1.340",
    date: "2026-08-27",
    headline: "OBS overlay setup steps now live inside Sync devices",
    highlights: [
      { text: "Setting up the transparent lyrics overlay in OBS is now guided in-app: open Sync devices, and under the OBS overlay link tap “How to set up in OBS” for the exact steps — copy the URL, add a Browser source at 1920×1080, drag it above your camera — plus a quick pre-service test.", tryItHref: "/operator", tryItLabel: "Open operator" },
    ],
  },
  {
    version: "0.1.339",
    date: "2026-08-27",
    headline: "OpenFlow plans now show real slide previews",
    highlights: [
      { text: "When OpenFlow builds a service, every block shows a real preview of the slides it will create — in your church's actual theme, exactly like the projector. Click a block to expand and see every slide.", tryItHref: "/operator", tryItLabel: "Open OpenFlow" },
      "Scripture and song suggestions preview in your theme too, and switching modes now has a smooth animated transition.",
    ],
  },
  {
    version: "0.1.338",
    date: "2026-08-27",
    headline: "OpenFlow can now build your whole service",
    highlights: [
      { text: "Open OpenFlow and switch to Service Builder — ask for a Sunday, a convention, whatever — and it drafts a full running order from your real song library. Drag the blocks to reorder, then hit Apply to build the playlist in one click.", tryItHref: "/operator", tryItLabel: "Open OpenFlow" },
      "Scripture mode looks up any verse in your translation (the real text, straight from your Bible) so you can Project it or add it to the service. Songs mode suggests from your own library and adds them with one tap.",
      "It only ever uses songs you actually have and never makes up verse text — anything it can't find, it tells you.",
    ],
  },
  {
    version: "0.1.337",
    date: "2026-08-27",
    headline: "Livestream lyrics overlay for OBS — no capture card needed",
    highlights: [
      { text: "Put your song and scripture words straight over your camera in OBS as a transparent overlay. In the operator, open Sync devices → “Copy OBS URL”, then in OBS add a Browser source and paste it — the lyrics appear over your live camera and follow every slide automatically.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "The overlay shows only the words (with a soft shadow so they stay readable over any background) — no black box, no operator controls. When nothing is live, it's fully clear. Works from any machine on your network using your sync code.",
    ],
  },
  {
    version: "0.1.336",
    date: "2026-08-27",
    headline: "Reorder any slides, PowerPoint imports, and a movable Quick Edit",
    highlights: [
      { text: "You can now drag to reorder the slides inside a grouped item — images, an imported PowerPoint, any media group — and the new order shows in both the grid and the playlist. No more “item has no reorderable slides”.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "PowerPoint (.pptx) imports into Media now work on the desktop app — the conversion request was being blocked before.",
      "Quick Edit can be moved: grab the “Drag to move” bar to slide it aside so it never blocks the slides behind it, and it's a bit smaller now.",
      { text: "Add your church logo to a theme right from the Background section — it shows on every slide with that theme (fine-tune its spot under Layout).", tryItHref: "/library/themes", tryItLabel: "Open Themes" },
    ],
  },
  {
    version: "0.1.335",
    date: "2026-08-26",
    headline: "Drop PowerPoints straight into Media — and a much faster media grid",
    highlights: [
      { text: "You can now import PowerPoint (.pptx / .ppt) right into Media — no need to export to PDF first. Each slide becomes a projectable picture, just like a PDF deck.", tryItHref: "/operator", tryItLabel: "Open Media" },
      "The media grid loads much faster: it now shows small thumbnails instead of downloading every full-size image, and imported decks render and upload their pages in parallel. Projection still uses the full-resolution original.",
    ],
  },
  {
    version: "0.1.334",
    date: "2026-08-26",
    headline: "Quick Edit: type right on the slide — in its real fonts, over any design",
    highlights: [
      { text: "Right-click a song slide → Quick Edit and the slide pops out so you can type directly on the actual words — the cursor sits on the real letters, in the slide's own fonts and size, over its real theme, background and logos. No more misaligned box or jumbled text.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Save now just saves your change — it doesn't fling it to the projector. Hit “Send this slide live” when you're ready. And you can keep clicking other slides live while you edit this one.",
      "“Tidy” is now also on the playlist header next to “Add slide”, and tidying does a bit more grammar clean-up (spacing around commas).",
    ],
  },
  {
    version: "0.1.333",
    date: "2026-08-25",
    headline: "Smarter scripture detection — catches quoted phrases, not just references",
    highlights: [
      { text: "The AI now spots scripture even when the preacher doesn't say the reference — quote a famous line like “the author and finisher of our faith” or “I am that I am” and it suggests the verse as a chip.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Works in everyday language too — “in the Bible it says iron sharpens iron” is recognised just like the older “sharpeneth” wording. Suggestions only (it never auto-projects a guessed verse), and it won't fire on ordinary worship words.",
    ],
  },
  {
    version: "0.1.332",
    date: "2026-08-25",
    headline: "3-digit chapters spoken digit-by-digit now detect correctly",
    highlights: [
      "When a speaker spells out a longer chapter — “Psalm 1… 4… 3, verse 9” — the AI now understands that’s Psalm 143:9, instead of getting confused by the gaps and landing on the wrong verse. Same for Psalm 150, 119, 107, and the rest of the 100s.",
    ],
  },
  {
    version: "0.1.331",
    date: "2026-08-25",
    headline: "Cleaner song slides — fewer words per slide, easier to sing",
    highlights: [
      { text: "New songs you import now break into clean, easy-to-read slides (about two lines each) instead of one crammed block — so the congregation can actually follow along.", tryItHref: "/library/songs", tryItLabel: "Open Songs" },
      "Already have clunky songs? Open a song and hit “Tidy slides”, or use “Tidy all songs” on the library to fix your whole library at once. Custom-styled songs are left untouched.",
    ],
  },
  {
    version: "0.1.330",
    date: "2026-08-25",
    headline: "Quick Edit is back — and saving sends it live in your style",
    highlights: [
      { text: "Right-click any song slide → Quick Edit to make a fast text change. (The little box had gone missing behind the paste menu — fixed.)", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Saving a Quick Edit now updates the slide AND sends it straight to the projector — in the slide's own fonts, size and styling, not a plain default. Works whether the song is plain lyrics or fully designed, and your layout is kept.",
    ],
  },
  {
    version: "0.1.329",
    date: "2026-08-25",
    headline: "Import slide decks (PowerPoint, Google Slides, PDF) into Media as pictures",
    highlights: [
      { text: "Import slide decks as media — drop a PDF into Media and every page becomes a slide image you can project, looking exactly like the original. Making a deck in PowerPoint, Google Slides, or Gemini? Export it as a PDF (one click) and drop it in.", tryItHref: "/operator", tryItLabel: "Open Media" },
      "Big decks are handled gracefully — slides render and upload one at a time with live progress, and if a deck is very long you're told exactly how many pages came in.",
    ],
  },
  {
    version: "0.1.328",
    date: "2026-08-25",
    headline: "Auto-detected verses now project in your saved style",
    highlights: [
      "Fixed: when the AI detected a verse (or you advanced by voice), the projector showed it in a plain default style — not the font, size and casing you set up — so you had to click it again to fix it. Now every auto-detected verse projects exactly like your styled preview, no click needed.",
    ],
  },
  {
    version: "0.1.327",
    date: "2026-08-25",
    headline: "Phrase search now nails exact quotations",
    highlights: [
      { text: "Type or paste a quote — “the Lord is my shepherd, I shall not want” — and the exact verse ranks first, not a vaguely-similar one. A loose paraphrase still resolves too.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Works with modern wording too — a quote like “love is patient, love is kind” now finds 1 Corinthians 13 (not just the older “charity” phrasing).",
      "Churches on a licensed translation (NIV/NKJV/NLT) now get phrase search at all — results project in your own translation when you tap them.",
    ],
  },
  {
    version: "0.1.326",
    date: "2026-08-25",
    headline: "Bible references are easier to type and understand",
    highlights: [
      { text: "Type a reference more freely — once a chapter is on screen you can just type “verse 16”, “:16”, or “3:16” to jump to it, without retyping the book. Verse ranges like “5:5-7” work too.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "No more dead ends — a mistyped or partial reference now offers a “Did you mean…?” or falls back to a phrase search instead of just saying “Couldn’t parse reference”.",
      "“Matthew 5 to 7” and other chapter ranges now load the chapter instead of silently jumping to verse 1.",
      "Multi-verse call-outs read correctly — “verses 1 and 2” now shows both verses (even said out of order), not just the first.",
      "Better with accents — heavily-accented or misspelled book names (e.g. an accented “Zechariah”) are recognised on the typed reference bar.",
    ],
  },
  {
    version: "0.1.325",
    date: "2026-08-25",
    headline: "Media editor, playlist groups, and the theme now shows inside every slide box",
    highlights: [
      "New image editor — double-click any image in Media (or use the new “Edit” button) to crop, pan, zoom, and reframe it so it fills the screen properly, even portrait/phone photos. Your framing is saved and reused every time you project it.",
      "“Logo on background” mode — put a logo centred over a solid colour, the live theme, or a gradient, instead of black bars, so wide logos look intentional.",
      { text: "Group images into the playlist — select several images (e.g. a set of slides) and add them as ONE collapsible playlist entry instead of a long list of separate rows. Expand it to jump to any image.", tryItHref: "/operator", tryItLabel: "Open operator" },
      "Reorder your Media library — drag images into the order you want; it sticks.",
      "The team/theme now shows inside each slide box in the main section — every preview card is a true 1:1 match of what the projector shows, while the panel stays clean and black.",
      "Live-output reliability: the projector can no longer flash a white/blank background while a theme loads or when you change theme mid-service — it always shows your theme.",
      "Scripture slides keep their reference (e.g. “John 3:16 KJV”) on screen, and the verse-styling editor is now scoped to your church.",
    ],
  },
  {
    version: "0.1.324",
    date: "2026-08-23",
    headline: "Resize projected images — Fit, Fill, or Stretch",
    highlights: [
      "Images and videos from Media used to always letterbox (black bars) on the projector with no way to change it. In the Media panel there's now a “Projected size” control: Fit (whole image, letterboxed), Fill (fills the screen, crops the overflow), or Stretch (fills exactly). Your choice is remembered.",
      "Changing the size also updates whatever is ALREADY on the projector instantly — a clean hard cut, no flicker or fade — so you can adjust live.",
    ],
  },
  {
    version: "0.1.323",
    date: "2026-08-22",
    headline: "Cleaner dashboard, real AI health check, and your full sermon transcripts",
    highlights: [
      "The admin dashboard's four separate readiness cards are now one calm panel that cycles through what's left to set up. Anything we can detect ticks itself off; anything set up on the desktop (audio, projector) you can tick yourself — and each item disappears once it's done, so a ready church sees a simple “you're all set”.",
      "AI Health now runs a REAL check when you open the dashboard (Groq, database, media storage) instead of just linking away — green when healthy, and it comes back if something breaks.",
      { text: "Sermon Archive now shows the FULL transcript of each service, not just the summary — open any past service and expand “Full transcript” (with one-click copy). If a service has no transcript, it now tells you why.", tryItHref: "/archive", tryItLabel: "Open archive" },
      "Team invites: if an invite email can't be delivered, you're now warned right away (instead of a false “sent”) so a real invitation never goes quietly missing.",
    ],
  },
  {
    version: "0.1.322",
    date: "2026-08-21",
    headline: "Stability fix: reverts the audio-engine change that broke connections",
    highlights: [
      "The previous desktop update (0.1.321) changed the native audio engine to try isolating a mixer channel, but on some setups it destabilised the AI connection (the WebSocket kept dropping). This update reverts that change so the AI connects and stays on reliably again. We'll re-approach mic isolation more carefully. If you ever hit this mid-service, opening faithflow-ai.vercel.app in Chrome is an instant fallback.",
    ],
  },
  {
    version: "0.1.321",
    date: "2026-08-21",
    headline: "Desktop: unlocks true multi-channel mic isolation (X32 / XR18 / SQ)",
    highlights: [
      "The native audio engine that can isolate ONE channel of a multi-channel mixer (so the AI hears only the lead vocal, not the whole band) was being blocked on the church's Mac by macOS security and silently falling back to a 2-channel engine — which is why singing wasn't being picked up. The app now unblocks its own audio helper on launch, so isolation works.",
      "When a mixer channel can't be reached, the app now tells you clearly instead of going silent, and the mic-board meters reflect the device's real channels.",
      "Requires the new desktop version (DMG) to take effect.",
    ],
  },
  {
    version: "0.1.320",
    date: "2026-08-21",
    headline: "Major fix: AI stays on, and the transcript keeps up with the room",
    highlights: [
      "Fixed the AI “switching off” mid-service: the app was opening duplicate listening connections that fought each other and kept resetting. It now keeps one clean, stable connection, so the AI stays on.",
      "Fixed the transcription lag: the live transcript now tracks speech much more closely (faster audio delivery + words no longer held back to format numbers). If the AI briefly drops, it reconnects to transcription on its own instead of going silent.",
      "Reload the app once to pick this up — you should notice the AI staying on and the transcript keeping pace.",
    ],
  },
  {
    version: "0.1.319",
    date: "2026-08-21",
    headline: "Worship singing no longer clutters the Bible detections with false psalms",
    highlights: [
      "During worship, generic sung phrases (“…at the right hand”, “holy you are holy”) were popping up as false Psalms suggestions. They're now filtered out — a phrase only surfaces as a scripture suggestion when it carries a distinctive, quotable word — while genuine spoken quotes (“the Lord is my shepherd…”) still detect normally.",
    ],
  },
  {
    version: "0.1.318",
    date: "2026-08-21",
    headline: "Fixed: the book of Mark now projects (was being heard as “Micah”)",
    highlights: [
      "The AI was mishearing accented “Mark” as “Micah”, so Mark references either showed the wrong book or (for Mark 8–16) didn't project at all. Mark now resolves correctly, and real Micah references (chapters 1–7) still work.",
    ],
  },
  {
    version: "0.1.317",
    date: "2026-08-21",
    headline: "Smoother projector output + steadier voice verse-nav",
    highlights: [
      "The projector now only re-syncs its full look when it actually (re)connects, instead of every few seconds — less background work on the projector machine for smoother playback.",
      "Voice “next verse” / “go back” now always advances from the verse that's actually on the screen, even when you're not on the Bible panel.",
    ],
  },
  {
    version: "0.1.316",
    date: "2026-08-21",
    headline: "Verses project faster — much less delay after they're spoken",
    highlights: [
      "Big latency fix: the app now loads the whole chapter the instant it hears a reference, so the verse hard-cuts onto the screen with no network wait — and every following verse in that chapter is instant too. Before, most verses had to fetch over the network first, which was the delay you were seeing.",
      "It also pre-loads the scripture chapters in today's plan when the service opens, so your planned verses are ready to project the moment they're read.",
    ],
  },
  {
    version: "0.1.315",
    date: "2026-08-21",
    headline: "Switching Bible translation now updates the projector instantly",
    highlights: [
      "Fixed: changing the translation (e.g. NLT → NKJV) while a verse is live updated the preview but left the big screen on the old translation. The currently-live verse now re-projects in the new translation immediately — both when you pick it from the dropdown and when it's switched by voice.",
    ],
  },
  {
    version: "0.1.314",
    date: "2026-08-21",
    headline: "Cleaner top bar — less clutter around the AI controls",
    highlights: [
      "Removed the redundant bits from the top bar: the “Show current” play button, the “Screen” picker, the A−/AUTO/A+ text-size control, and the Live/Audience/Stage status chips — so the AI controls (AI On, Worship/Auto/Preacher, Auto-approve, mic level) sit together without noise around them.",
      "Nothing was lost: screen/display assignment still lives in the Screens panel (bottom-left), the Play button on each panel still projects what you're viewing, and Bible text/reference sizing is still on the Bible toolbar.",
    ],
  },
  {
    version: "0.1.313",
    date: "2026-08-21",
    headline: "Projector now shows your background too (matches the preview)",
    highlights: [
      "Fixed: the animated / themed background looked perfect in the operator preview but the projector screen stayed black. When a projector (or stage / livestream) window opens or reconnects, it now instantly receives the full look — background, theme, zone and text size — so what you see in the preview is what the room sees.",
    ],
  },
  {
    version: "0.1.312",
    date: "2026-08-20",
    headline: "Worship auto-projects your setlist + voice “next verse” now works anywhere",
    highlights: [
      "In Worship mode, a genuine match to a song in today's plan now goes live on its own — you don't have to push it — and this now works WHILE the band/choir is playing (the music no longer holds your setlist songs back). Songs not in the plan still surface as a one-tap chip so nothing spontaneous is ever locked out.",
      "Pure mishears can't trigger it: a song only auto-projects on a real, distinctive lyric match, and if two of your setlist songs match the words almost equally it waits for you to choose.",
      "Fixed: saying “next verse” / “continue” / “go back” now advances the verse on the projector even when you're not looking at the Bible panel (e.g. you're on the Songs or slides view). Before, it only worked while the Bible lookup was open, so during a sermon it often did nothing.",
    ],
  },
  {
    version: "0.1.311",
    date: "2026-08-20",
    headline: "New: Worship / Preacher mode — tell the AI what part of the service you're in",
    highlights: [
      "A new Worship / Auto / Preacher switch sits next to the AI pill in the top bar. Flip it as the service moves from worship into the sermon.",
      "Worship mode focuses detection on TODAY'S worship set — it only listens for the songs in your plan, so the choir actually gets picked up (surfaced as a one-tap chip, and clear matches auto-project) instead of being missed, and it holds Bible verses back so a sung lyric can't flash a wrong verse. Tip: keep today's plan's songs complete for the best pick-up.",
      "Preacher mode prioritises scripture and holds songs back — so the sermon's speech can never auto-project a song by mistake.",
      "Either way, nothing is ever locked out: both modes only change what AUTO-projects. A verse in Worship mode, or a song in Preacher mode (a spontaneous unplanned song, a preacher singing in the spirit, a worshipper who starts preaching), still shows as a one-tap chip — and you can always fire any verse or song manually from the library at any time.",
      "Auto (the default) is unchanged — songs and scripture both detect exactly as before.",
    ],
  },
  {
    version: "0.1.310",
    date: "2026-08-20",
    headline: "Reload button now refreshes the projector too + steadier backgrounds",
    highlights: [
      "The top-bar reload now also reloads the projector / stage / livestream windows \u2014 so they can\u0027t get stuck on an old version showing a plain gradient instead of the animated background.",
      "Animated backgrounds now recover automatically if the projector\u0027s graphics context drops (which was causing the glitch and the static-gradient look).",
    ],
  },
  {
    version: "0.1.309",
    date: "2026-08-20",
    headline: "Backgrounds: livelier animations + they show in the preview & all outputs",
    highlights: [
      "Reworked the animated backgrounds so they actually MOVE \u2014 Gentle Waves flows, Stained Light drifts, Deep Breath pulses + drifts, and Holy Fire is fuller. The projector now looks like the thumbnail.",
      "The active background now shows in the operator preview (WYSIWYG) and on the stage + livestream/NDI outputs \u2014 so what you set is what every screen shows, and the speed/intensity/colour settings update live in the preview.",
    ],
  },
  {
    version: "0.1.308",
    date: "2026-08-20",
    headline: "One-click \"clear cache & reload\" in the top bar",
    highlights: [
      "A refresh button in the top nav clears the caches that pin a stale build (offline cache + service workers) and reloads fresh \u2014 so you always pull the latest version without hunting through menus. Confirms first so it can't be hit mid-service by accident.",
    ],
  },
  {
    version: "0.1.307",
    date: "2026-08-20",
    headline: "Upload your own image & video backgrounds",
    highlights: [
      "In Themes \u2192 Backgrounds you can now upload your own images and video loops as backgrounds \u2014 they project behind the text just like the built-in templates.",
      "Tune each: image blur + fit, video playback speed, and a readability overlay. Uploaded backgrounds show as thumbnails you can delete, and stay valid across services.",
    ],
  },
  {
    version: "0.1.306",
    date: "2026-08-20",
    headline: "Reference size now goes up to 400%",
    highlights: [
      "The scripture reference size control now goes all the way to 400% (was 250%) so you can make the reference at the bottom as large as you want.",
    ],
  },
  {
    version: "0.1.305",
    date: "2026-08-20",
    headline: "Backgrounds are in the Themes editor now \u2014 with live previews + settings",
    highlights: [
      "Open Themes (top bar) and the Backgrounds gallery is right at the top: pick a template from LIVE animated thumbnails.",
      "Tune each template yourself \u2014 speed, intensity, primary/secondary colours, and a readability overlay dim \u2014 all applying live to the projector. Reset to default any time.",
    ],
  },
  {
    version: "0.1.304",
    date: "2026-08-20",
    headline: "Removed the bottom media-library strip",
    highlights: [
      "The \"Media Library / Recent\" strip at the very bottom of the operator screen is gone \u2014 the surface now ends cleanly at the play/pause transport bar.",
    ],
  },
  {
    version: "0.1.303",
    date: "2026-08-20",
    headline: "Reference size now applies on the projector + set its colour",
    highlights: [
      "Fixed the reference-footer size not tracking on the big screen: it was measured against the window, not the scaled 1080 canvas, so the projector ignored your Ref-size change. It now sizes identically on the projector and the preview.",
      "New reference-colour control in the Bible bar \u2014 pick any colour for the scripture reference at the bottom (or clear it to use the theme colour).",
    ],
  },
  {
    version: "0.1.302",
    date: "2026-08-20",
    headline: "Background templates now animate live on the projector",
    highlights: [
      "The 5 background templates (Gentle Waves, Holy Fire, Stained Light, Deep Breath, Clean Slate) now render as live GPU animations behind your text on the projector \u2014 not just a flat colour.",
      "Falls back to a static gradient if a machine can't run WebGL, and freezes for reduced-motion. Your own image/video uploads + per-template settings are next.",
    ],
  },
  {
    version: "0.1.301",
    date: "2026-08-20",
    headline: "Background templates \u2014 first look (behind the text)",
    highlights: [
      "New Backgrounds section in the Themes panel: pick a template and it projects behind your scripture/lyrics on the real screen. \"None\" keeps the plain background exactly as before.",
      "This is the foundation \u2014 the 5 templates show their colour now; live animated (WebGL) versions and your own image/video uploads are coming next.",
    ],
  },
  {
    version: "0.1.300",
    date: "2026-08-20",
    headline: "Size the scripture reference at the bottom, on its own",
    highlights: [
      "A new \"Ref\" size control in the Bible bar sizes the reference footer (Book Chapter:Verse) independently of the verse text \u2014 make it as big or small as you like.",
    ],
  },
  {
    version: "0.1.299",
    date: "2026-08-20",
    headline: "Translation switches the live verse instantly + update prompt",
    highlights: [
      "Changing translation (KJV → NKJV/NLT/NIV) now re-projects the verse that's ON THE SCREEN immediately, in the new translation — no more waiting for the next verse, and it matches the operator preview.",
      "When a new version is deployed, you'll get a one-tap \"Reload now\" prompt so you always pick up the latest fixes (no more stale cached build).",
    ],
  },
  {
    version: "0.1.298",
    date: "2026-08-20",
    headline: "Size and reorder Bible verses yourself",
    highlights: [
      "A verse text-size control now sits right in the Bible bar (−/AUTO/+) — size the projected verse without leaving the Bible view. The reference footer scales with it.",
      "Reorder loaded verses: hover a verse card and use the up/down arrows to change the order they appear in (the Bible text itself is never altered).",
    ],
  },
  {
    version: "0.1.297",
    date: "2026-08-20",
    headline: "Native Mic Board: trim the lead mic's gain",
    highlights: [
      "On the native (pro mixer) Mic Board, the Lead strip now has a gain slider — boost a quiet preacher mic or cut a hot one so the AI hears it cleanly. Applies when you let go of the slider.",
    ],
  },
  {
    version: "0.1.296",
    date: "2026-08-20",
    headline: "Cleaner Bible Options panel",
    highlights: [
      "Reskinned the Bible slide Options popover to match the app — brand-coloured toggles, clearer labels, full-row clickable rows.",
      "Removed the leftover Theme box, the dead Import Library dropdown, and the redundant Bibles tab. The reference control now plainly says \"Show on every verse / last verse only / Hide\".",
    ],
  },
  {
    version: "0.1.295",
    date: "2026-08-20",
    headline: "Scripture reference is now pinned to the bottom of the screen",
    highlights: [
      "The reference (e.g. \"John 3:16 (KJV)\") now sits in its own fixed footer at the bottom of every scripture slide, so it's ALWAYS visible — it can never be shrunk away or pushed off-screen by a long verse. Works for AI-detected verses, voice-advanced verses, and manually loaded ones.",
    ],
  },
  {
    version: "0.1.294",
    date: "2026-08-20",
    headline: "Mic Board now works for pro USB mixers (native capture)",
    highlights: [
      "The Mic Board is now available in native capture mode too — for the big USB mixers (X32, XR18, Allen & Heath SQ) that need the desktop app's direct capture.",
      "See live levels for every channel, label each mic, and set the Lead the AI listens to. (Per-mic mute/gain for native mixers is coming in a follow-up.)",
    ],
  },
  {
    version: "0.1.293",
    date: "2026-08-20",
    headline: "The scripture reference always shows on the projector again",
    highlights: [
      "Long verses were being split across pages on the projector — and since the projector can't be paged, the end of the verse and its reference (e.g. \"Genesis 4:22 (KJV)\") were stranded off-screen. Live outputs now fit the whole verse and reference on one screen.",
    ],
  },
  {
    version: "0.1.292",
    date: "2026-08-20",
    headline: "New Mic Board — see every mic, pick the one the AI listens to",
    highlights: [
      "For multi-channel mixers (X32, XR18, Allen & Heath SQ, and more), open the Mic Board from Audio settings to see every mic as a live strip with its own level meter.",
      "Label each mic (Lead / BG singer / Keys…), set the Lead so the AI listens to just the preacher's mic, and mute or duck background singers — with 🎤/🎶 hints showing which mics are speech vs singing.",
    ],
  },
  {
    version: "0.1.291",
    date: "2026-08-20",
    headline: "Verse cards show their reference again, smarter voice nav",
    highlights: [
      "Every Bible card now shows its reference (e.g. \"John 3:24 (KJV)\") on a always-visible chip — it no longer gets hidden when a long verse wraps.",
      "Voice: \"go to verse 17\" / \"go back to seven\" now jump straight to that verse number.",
      "When a spoken command is plausible but not certain, you now get a one-tap \"Did they say…?\" confirmation instead of it firing or being ignored.",
    ],
  },
  {
    version: "0.1.290",
    date: "2026-08-20",
    headline: "Spoken \"next verse\" / \"go back\" respond faster",
    highlights: [
      "Voice verse-navigation now fires on the live in-progress transcript instead of waiting for the finalised phrase, so \"next verse\" and \"go back\" advance noticeably sooner — with a guard so the same command can't double-advance.",
    ],
  },
  {
    version: "0.1.289",
    date: "2026-08-20",
    headline: "Theme colours now show in the slide grid and previews too",
    highlights: [
      "Apply a theme and every slide box, the Stage mirror, and the song/Bible previews now show the real theme background and text colours — matching the live projector instead of showing black/white.",
    ],
  },
  {
    version: "0.1.288",
    date: "2026-08-20",
    headline: "The AI listening switch now turns on and off reliably",
    highlights: [
      "Fixed the AI on/off toggle doing nothing when clicked — its click was being swallowed by the tooltip wrapper. It now flips every time, and the choice sticks across reloads.",
    ],
  },
  {
    version: "0.1.287",
    date: "2026-08-20",
    headline: "Catches verses even with a stutter or hesitation",
    highlights: [
      "\"1 Corinthians, um, 2:4\" or \"sorry, I meant… first Corinthians two four\" now resolve correctly — hesitation fillers no longer break the reference.",
    ],
  },
  {
    version: "0.1.286",
    date: "2026-08-20",
    headline: "Themes now actually colour the song \u2014 slides and projector",
    highlights: [
      "Applying a theme to a song now colours every slide box AND paints the projector with the theme\u2019s background (gradient) and text colour \u2014 not just white/black.",
      "Still fully reversible with Undo.",
    ],
  },
  {
    version: "0.1.285",
    date: "2026-08-20",
    headline: "Context-aware voice nav + AI toggle confirmation",
    highlights: [
      "\"Next verse\" / \"go back\" / \"continue\" now only fire as real terse commands \u2014 not when the preacher says them in a sentence or reads them inside a verse.",
      "The AI on/off toggle now shows a confirmation, and (with the earlier fix) reliably switches in every mode.",
    ],
  },
  {
    version: "0.1.284",
    date: "2026-08-20",
    headline: "AI on/off toggle now works reliably in every mode",
    highlights: [
      "Fixed the AI toggle blinking on then straight back off in Manual mode \u2014 you can now switch AI on and off at will, in any autopilot mode.",
    ],
  },
  {
    version: "0.1.283",
    date: "2026-08-20",
    headline: "The verse transition now plays exactly once \u2014 never repeats",
    highlights: [
      "A verse\u2019s fade/transition now happens once and stays put, even under rapid verse calling and background changes \u2014 no more the transition replaying multiple times on the projector.",
    ],
  },
  {
    version: "0.1.282",
    date: "2026-08-20",
    headline: "No more projector glitch on verse clicks or repeats",
    highlights: [
      "Clicking a verse now switches cleanly in one motion \u2014 the \"cut, then float a second later\" glitch is gone.",
      "Saying or clicking a verse that\u2019s already on the screen no longer re-flashes it \u2014 it stays put.",
      "Undo/Redo now confirm with a toast showing exactly what\u2019s on the projector.",
    ],
  },
  {
    version: "0.1.281",
    date: "2026-08-20",
    headline: "Projector Undo/Redo buttons + Show confirmation",
    highlights: [
      "New back/forward (undo/redo) buttons in the top bar step the projector through what you have shown \u2014 one click to recover from a wrong slide.",
      "Pressing Show in the slide editor now gives you a confirmation so you know it reached the projector (the editor covers the live view).",
    ],
  },
  {
    version: "0.1.280",
    date: "2026-08-20",
    headline: "Applying a theme now restyles the whole song (and you can undo it)",
    highlights: [
      "Pressing a theme while a song is selected now restyles EVERY slide of that song \u2014 all the previews \u2014 not just the live screen.",
      "It overwrites existing slide colours so the theme actually shows, and an Undo button reverts the whole song to exactly how it looked before.",
    ],
  },
  {
    version: "0.1.279",
    date: "2026-08-20",
    headline: "Fixed verses being detected but not projecting",
    highlights: [
      "During rapid verse changes, a verse the AI heard could fail to project because an earlier verse\u2019s slower lookup finished late and overwrote it. Now only the most-recent verse drives the projector.",
    ],
  },
  {
    version: "0.1.278",
    date: "2026-08-20",
    headline: "\"Mark 4 by 7\" now detects as Mark 4:7",
    highlights: [
      "The AI now understands \"Micro 4 by 7\" as Mark 4:7 — a common mishearing of the book name and the verse separator.",
    ],
  },
  {
    version: "0.1.277",
    date: "2026-08-20",
    headline: "The editor's Show button now actually projects your edits",
    highlights: [
      "In the slide editor, pressing Show now projects exactly what's on the canvas — text, background and design — to the projector.",
      "Edits never go live on their own; they only appear on the projector when you press Show.",
    ],
  },
  {
    version: "0.1.276",
    date: "2026-08-20",
    headline: "Instant scripture projection + a real Transitions OFF switch",
    highlights: [
      "AI-projected verses now hard-cut instantly — no fade flicker when a spoken verse lands.",
      "Removed the brief \"reference-only\" flash before the verse; the full verse appears directly (instant when the chapter's already loaded).",
      "The transition picker has an OFF toggle that actually turns off all transitions (instant cut everywhere), and it's remembered.",
    ],
  },
  {
    version: "0.1.275",
    date: "2026-08-20",
    headline: "No more verse re-flash + Load Chapter lands on your verse",
    highlights: [
      "Re-hearing a verse that's already on screen (\"did I say John 3:16?\") no longer re-projects it — the projector stays steady instead of flashing.",
      "After Load Chapter the preview now jumps straight to the verse you were on and centres it, so you don't have to scroll the chapter to find it.",
    ],
  },
  {
    version: "0.1.274",
    date: "2026-08-19",
    headline: "Smarter AI model for the assistant features",
    highlights: [
      "The AI helper features now run on a stronger Groq model (gpt-oss-120b). Live speech→scripture detection is unchanged and just as fast.",
    ],
  },
  {
    version: "0.1.273",
    date: "2026-08-19",
    headline: "Load Chapter stays put when the preacher calls a verse",
    highlights: [
      "After Load Chapter, saying a verse of that same chapter now just moves the highlight to it and projects it — the whole chapter grid stays on screen instead of collapsing to one box.",
      "It only switches to a single box when a genuinely new scripture (different chapter) is called.",
    ],
  },
  {
    version: "0.1.272",
    date: "2026-08-19",
    headline: "Fixed the projector scripture fade-pulse",
    highlights: [
      "A held Bible verse no longer fades out and back in on a loop while the AI keeps hearing it preached — the transition now plays once per verse and stays put.",
      "The AI no longer re-projects a verse that's already on screen (it only projects a new/changed reference).",
    ],
  },
  {
    version: "0.1.271",
    date: "2026-08-19",
    headline: "Font slider now actually resizes song/designed slides",
    highlights: [
      "The Projection-Zone Font slider (and A-/A+) now scales text on song and designed slides too — previously it only affected plain scripture/lyric slides, so it looked like it did nothing.",
      "The change shows live on the projector, the operator live-preview, and the editor.",
    ],
  },
  {
    version: "0.1.270",
    date: "2026-08-19",
    headline: "Font-scale preview in the slide editor",
    highlights: [
      "The editor now previews the Projection-Zone Font slider live — text grows or shrinks on the canvas to match the projector as you drag it.",
    ],
  },
  {
    version: "0.1.269",
    date: "2026-08-19",
    headline: "See the projection zone update live in the editor",
    highlights: [
      "The slide editor now draws a live \"Projection area\" box that moves and resizes as you drag Size / Margins / Center — so you can see exactly where content lands on the projector.",
      "This mirrors what the live screen and the projected output already show in real time.",
    ],
  },
  {
    version: "0.1.268",
    date: "2026-08-19",
    headline: "Drag a slide into any song in the playlist",
    highlights: [
      "Hover a slide in the preview to reveal a drag handle — drag it onto a song in the playlist to add it to the end of that song.",
      "Copy/paste slides still works within a song via right-click.",
    ],
  },
  {
    version: "0.1.267",
    date: "2026-08-19",
    headline: "Songs load again + rename items anywhere",
    highlights: [
      "Fixed songs loading as a single blank slide — stale song references now re-link by title so lyrics preview and project again.",
      "Rename any playlist item (double-click or right-click → Rename), including blanks — not just songs.",
      "Rename the current item straight from the top-bar title (double-click it).",
    ],
  },
  {
    version: "0.1.266",
    date: "2026-08-19",
    headline: "Faster voice nav, redesigned transitions, and fixes",
    highlights: [
      "Spoken \"next verse\" / \"go back\" / \"continue\" now projects almost instantly — it no longer waits out the manual-action cooldown.",
      "Redesigned the transition picker with live animated previews of each effect (Fade, Slide, Wipe, Iris and more).",
      "The copy button on the live reference now works reliably in the desktop app (with the tick confirmation).",
      "Scripture is now read-only — removed the verse-edit pencil from the Bible panel.",
      "If the AI can't connect, it now tells you why instead of silently switching back off.",
    ],
  },
  {
    version: "0.1.265",
    date: "2026-08-19",
    headline: "Removed the floating Projection Zone button",
    highlights: [
      "The draggable circular Projection Zone button no longer floats over the operator screen.",
      "Projection zones still apply to the projector output exactly as before.",
    ],
  },
  {
    version: "0.1.264",
    date: "2026-08-19",
    headline: "In-app confirmations for templates & backgrounds",
    highlights: [
      "Applying a template over a slide that already has content now shows the styled in-app confirmation instead of the browser pop-up.",
      "\"Apply background to all slides\" uses the same styled confirmation.",
    ],
  },
  {
    version: "0.1.263",
    date: "2026-08-19",
    headline: "In-app \"Apply to all slides\" confirmation",
    highlights: [
      "\"Apply to all slides\" now shows a styled in-app confirmation instead of the plain browser pop-up (Enter to confirm, Esc to cancel).",
    ],
  },
  {
    version: "0.1.262",
    date: "2026-08-19",
    headline: "Media Pro strip + polished slide-editor Add panel",
    highlights: [
      "The Media section now shows a permanent animated PRO strip instead of a pop-up banner.",
      "Slide editor: cleaner tab labels, refreshed Text/Rect/Ellipse/Image/Video buttons and a bolder \"Apply to all slides\".",
      "Removed the unused \"Default\" output selector from the top bar.",
    ],
  },
  {
    version: "0.1.261",
    date: "2026-08-19",
    headline: "Dock-style icons + integrations cards",
    highlights: [
      "The right-panel icons (Bible, Songs, Cross-refs, Settings) now gently magnify as you hover, like a dock.",
      "New \"Works with your tools\" integration cards on the Pro page — Drive, ProPresenter, PowerPoint, OBS and more.",
    ],
  },
  {
    version: "0.1.260",
    date: "2026-08-19",
    headline: "Dot-grid on the songs list & themes, new feature cards",
    highlights: [
      "The songs browser and the theme picker now sit on the same subtle drifting dot-grid texture.",
      "New graph-paper feature cards (on the Pro page) with icon, big title and description — clean and premium.",
    ],
  },
  {
    version: "0.1.259",
    date: "2026-08-19",
    headline: "Living backgrounds + a Pro flourish",
    highlights: [
      "The slide area now has a subtle, slowly-drifting dot-grid texture behind it, so the empty space feels alive instead of flat black.",
      "The Pro Plan upsell now has an animated ribbon flourish, giving the premium content a bit of special sparkle.",
    ],
  },
  {
    version: "0.1.258",
    date: "2026-08-19",
    headline: "Polished dropdowns in the panels",
    highlights: [
      "The Screens (Role, Preset), Video Input (camera, Overlay, Fit) and Themes (Font) pickers are now the same clean dropdowns as the Bible version picker — with a tick on your current choice — instead of plain browser menus.",
      "Those panels also pick up the new deeper black and richer orange automatically.",
    ],
  },
  {
    version: "0.1.257",
    date: "2026-08-19",
    headline: "Slides pop in smoothly",
    highlights: [
      "When you open a song, its slides now gently pop in one after another instead of appearing all at once — a smoother, more polished reveal.",
    ],
  },
  {
    version: "0.1.256",
    date: "2026-08-19",
    headline: "A richer, deeper orange",
    highlights: [
      "PresentFlow's accent is now a deeper, richer burnt-orange across the whole app — selection, buttons, the AI chips, sliders, section outlines and highlights all share the new colour.",
    ],
  },
  {
    version: "0.1.255",
    date: "2026-08-19",
    headline: "Nicer verse buttons, fade slider & AI chips",
    highlights: [
      "The Bible ‹ Verse / Verse › buttons are now one clean segmented control with arrows.",
      "The fade / speed slider has a smoother rounded track and a polished orange knob.",
      "The AI chips are now glassy rounded bubbles with a soft glow, easier to read at a glance.",
    ],
  },
  {
    version: "0.1.254",
    date: "2026-08-19",
    headline: "Listening waveform + one-tap copy",
    highlights: [
      "The live transcript now shows an animated waveform while the AI is listening, so you can see at a glance it's hearing.",
      "The live verse now has a copy button that flips to a tick when you've copied it.",
    ],
  },
  {
    version: "0.1.253",
    date: "2026-08-19",
    headline: "Sliding switches + a What's-new bell",
    highlights: [
      "AI On/Off and Auto/Manual are now smooth sliding switches — green when the AI is on, orange when Auto is on — with the live-status dot kept right beside them.",
      "A new bell in the top bar lets you reopen \"What's new\" any time to browse recent features, even after you've dismissed the pop-up.",
    ],
  },
  {
    version: "0.1.252",
    date: "2026-08-19",
    headline: "Fluid tabs + a nicer version picker",
    highlights: [
      "The Songs / Bible / Media switcher up top now has a smooth sliding highlight that glides between tabs.",
      "The Bible version picker is now a proper dropdown — each translation shows its code and full name, with a clear tick on the one you're using.",
    ],
  },
  {
    version: "0.1.251",
    date: "2026-08-19",
    headline: "Deeper, cleaner black",
    highlights: [
      "The operator's dark background is now a deeper, neutral black — the slight purple tint is gone, so panels read cleaner and the surface tiers are clearer.",
    ],
  },
  {
    version: "0.1.250",
    date: "2026-08-19",
    headline: "Tabbed What's New + announcement bar",
    highlights: [
      "The \"What's new\" popup is now tabbed — pick any recent version on the left to see exactly what changed in it.",
      "Added an announcement bar we can switch on across the top of the app for big updates and news.",
      "The right-panel section headers (Live Transcript, Bible/Song Detections) now carry the same subtle fading rule as the sidebar, so the whole console matches.",
      "The \"Slide deleted\" message is now a neutral note instead of green — green stays for things that saved or applied.",
    ],
  },
  {
    version: "0.1.249",
    date: "2026-08-19",
    headline: "Delete works, edits stay centred, smarter toasts",
    highlights: [
      "\"Delete Slide\" now removes the slide immediately (and works on designed slides too).",
      "Double-clicking a text box to edit no longer jumps the text to the top — it stays centred where it belongs.",
      "Bible detection now understands \"Matthew 5 or 7\" as Matthew 5:7 (\"or\" was being misheard for \"verse\"), on top of the existing \"Machu\" → Matthew fix.",
      "Notifications now use colour: green when something saves/applies, blue for heads-ups, red for failures — so you can tell at a glance.",
      "Removed the extra \"Blank slide\" button from the top toolbar (Add slide and the editor's Blank slide still cover it).",
    ],
  },
  {
    version: "0.1.248",
    date: "2026-08-19",
    headline: "A fresher operator console",
    highlights: [
      "The console now has real depth — the sidebar, cards and hover states sit on clearly stepped surfaces instead of one flat black, so panels feel solid and distinct.",
      "The selected slide now has a warm ember glow (instead of a hard border), and slide number badges clearly show which slide is selected.",
      "Section headers (Library, Playlist…) get a subtle fading rule to mark their territory, and the empty slide area has a cleaner prompt.",
    ],
  },
  {
    version: "0.1.247",
    date: "2026-08-19",
    headline: "Add slide without leaving the grid",
    highlights: [
      "\"Add slide\" now adds a new slide straight onto the end of the song in the main grid — it no longer pushes you into the editor. (Use \"Edit slide\" or \"Blank slide\" when you want the editor.)",
      "Fixed the big empty gap that appeared between slide rows (e.g. slide 6 sitting way below slides 1–5) — rows now pack neatly under each other.",
      "Removed the duplicate \"New slide\" button from the playlist panel; the \"+\" menu there still offers Blank / Song / Bible / Media.",
    ],
  },
  {
    version: "0.1.246",
    date: "2026-08-19",
    headline: "A crisper operator console",
    highlights: [
      "The operator panels now have a bit more depth and cleaner edges, so the library, stage and live areas read as distinct surfaces instead of blending into the black.",
      "Labels and secondary text are a touch brighter and easier to scan at a glance.",
      "Fixed the small Stage preview thumbnails clipping long lyrics — they now shrink text to fit like the main slides do.",
    ],
  },
  {
    version: "0.1.245",
    date: "2026-08-18",
    headline: "Video stays in sync with the projector",
    highlights: [
      "Video now plays in step on your screen and the projector instead of drifting apart — the operator preview acts as the clock and the projector keeps itself lined up to it.",
      "Videos start faster and smoother thanks to earlier buffering.",
    ],
  },
  {
    version: "0.1.244",
    date: "2026-08-18",
    headline: "Faster translation switches on the projector",
    highlights: [
      "Switching version (e.g. NKJV → NIV) now updates the projected verse much faster — the live verse is fetched and shown first, and the rest of the Bible panel refreshes quietly afterward instead of holding up the screen.",
    ],
  },
  {
    version: "0.1.243",
    date: "2026-08-18",
    highlights: [
      "A new verse box now appears only when a genuinely new scripture is spoken — the same verse being detected a few times in a row (as you read it) no longer keeps spawning fresh boxes.",
      "\"Load full chapter\" now keeps you on the verse you were viewing even in long chapters like Psalm 119, and no longer flickers/jumps when it loads.",
    ],
    headline: "Steadier Bible boxes + smoother full-chapter load",
  },
  {
    version: "0.1.242",
    date: "2026-08-18",
    headline: "Voice \"next verse\" projects instantly again",
    highlights: [
      "Saying \"next verse\", \"continue\" or \"go back\" now puts the verse on the projector immediately, as a clean cut — no more waiting or flicker.",
      "The manual Verse ◀ / ▶ buttons stay preview-only on purpose: they move the verse in your Bible panel without sending it live, so you click the slide when you're ready.",
    ],
  },
  {
    version: "0.1.241",
    date: "2026-08-18",
    headline: "Editor now fully matches the Projection Zone look",
    highlights: [
      "The slide editor's selection handles, guides and highlights are now the same warm orange as the Projection Zone — no more mismatched teal.",
      "Your slides list on the left is now collapsible: hide it for a bigger canvas and pop it back with one click. Your choice is remembered.",
    ],
  },
  {
    version: "0.1.240",
    date: "2026-08-18",
    headline: "The edit-slide layout you asked for",
    highlights: [
      "Edit slide now has your slides listed down the LEFT (1, 2, 3, 4…), a big Projection-Zone-style canvas in the middle, and all your tools — fonts, text, image, lower third, templates — on the RIGHT.",
      "The simple Size / Font / Margins / screen-resolution bar now sits right under the canvas, unchanged, so you can tune where text lands while you design.",
      "New \"Add slide\" button next to Edit slide and Blank slide, so you can add a slide straight from the song toolbar.",
      "Copy and paste now work with ⌘C / ⌘V / ⌘X in the editor — copy an object and paste it onto any slide.",
    ],
  },
  {
    version: "0.1.239",
    date: "2026-08-18",
    headline: "One-tap blank slide",
    highlights: [
      "There's now a \"Blank slide\" button right next to \"Edit slide\" at the top of a song — one tap drops you into the editor on a fresh empty slide, ready to build.",
      "Nicer error and \"page not found\" screens that match PresentFlow's look instead of a raw browser error.",
    ],
  },
  {
    version: "0.1.238",
    date: "2026-08-18",
    headline: "The slide editor, reborn in the Projection Zone look",
    highlights: [
      "\"Edit slide\" now opens the same sleek full-screen editor as the orange Projection Zone — a big checkerboard stage with your slide front and centre, instead of the old cramped, cluttered panel.",
      "All your tools live in clean tabbed drawers on the right — Design, Add, Templates, Background, Layers — so you only ever see what you need. Add or click a text box, shape, image or video and its Design panel (font, size, colour, rotation, shadow, position — everything) opens automatically.",
      "The slide filmstrip now runs along the bottom with Add, Blank, Copy and Delete right there. Templates, Apply-to-all and backgrounds are all still here — just tidier and easier to find.",
      "Everything is orange and consistent now, and every change still saves exactly as before.",
    ],
  },
  {
    version: "0.1.237",
    date: "2026-08-18",
    headline: "A bigger, friendlier slide editor",
    highlights: [
      "Edit slide now opens full-screen with a cleaner, easier layout — the same big live canvas, drag-to-move, templates, text/shapes/media, layers and backgrounds, just roomier and simpler to use.",
      "New \"Apply to all slides\" button: set a background or style one text box the way you want, then apply it to every slide in the song at once. It only copies the look — never your lyrics — and you can undo it.",
      "New \"Blank slide\" button adds a genuinely empty slide to build from scratch.",
      "The Songs / Bible / Media / Themes switcher up top is now a cleaner pill.",
    ],
  },
  {
    version: "0.1.236",
    date: "2026-08-17",
    headline: "Your service is remembered offline",
    highlights: [
      "Your current service (all its songs, slides and edits) is now continuously saved to your machine, so if the operator screen ever reloads with no internet it comes back exactly where you left it instead of blank. Groundwork for running a whole service fully offline.",
    ],
  },
  {
    version: "0.1.235",
    date: "2026-08-17",
    headline: "The whole Bible, ready offline",
    highlights: [
      "PresentFlow now quietly downloads every public-domain translation (KJV, ASV, WEB and more) to your machine in the background, so ANY verse — not just ones you've already opened — projects instantly with no internet. It runs when nothing's live and pauses itself during a service, so it never slows your projection. Licensed translations (NIV/NKJV/NLT) still cache the chapters you actually open.",
    ],
  },
  {
    version: "0.1.234",
    date: "2026-08-17",
    headline: "Scripture keeps working when the internet drops",
    highlights: [
      "Bible chapters you've opened are now saved on your machine, so they load instantly, survive an app restart, and keep projecting even if your connection drops mid-service — the operator can carry on with scripture offline. (Public-domain translations like KJV; licensed ones such as NIV/NKJV still need a connection.) This is the next step in the offline-resilience work.",
    ],
  },
  {
    version: "0.1.233",
    date: "2026-08-17",
    headline: "Clearer status when something's offline",
    highlights: [
      "The operator screen now tells you honestly when a service is degraded: a quiet bottom strip appears if the database can't be reached (you keep running from your saved service, and changes sync when the connection returns). This is the first piece of the bigger offline-resilience work.",
    ],
  },
  {
    version: "0.1.232",
    date: "2026-08-17",
    headline: "Load Chapter keeps you on your current verse",
    highlights: [
      "When you press \"Load Chapter\" while viewing a verse (e.g. Psalm 91:5), the grid now stays selected on that verse instead of jumping back to verse 1 — so you're never scrolled out of scope of the slide you're on. Loading the chapter just widens the surrounding context around where you already are.",
    ],
  },
  {
    version: "0.1.231",
    date: "2026-08-16",
    headline: "Paste slides into any song, move the Projection Zone button, sharper verse hearing",
    highlights: [
      "Copy a slide, then right-click a song in your playlist (or right-click anywhere in the slide grid) and choose \"Paste slide\" — the copied slide drops straight into that song. Copy from one song and paste into another.",
      "The amber Projection Zone button can now be dragged anywhere on your operator screen — park it wherever suits you and it stays there across restarts.",
      "Voice detection now understands \"John Trever 17\" as \"John 3 verse 17\" (John 3:17) — a common mishearing of \"3 verse\" in worship, now corrected automatically.",
    ],
  },
  {
    version: "0.1.230",
    date: "2026-08-16",
    headline: "New: Projection Zone Customizer — place & size content on your screen",
    highlights: [
      "There's a new amber button (bottom-right of the operator screen) that opens a Projection Zone editor: drag and resize a content zone over a preview of your projector, adjust size, font scale and margins, and everything moves live on the projector and stage as you go.",
      "Save named profiles (e.g. \"Main Hall\", \"Youth Room\") and switch between them instantly — they persist across restarts and adapt to any resolution. This gives you direct control when auto-sizing can't match your exact screen/overscan.",
    ],
  },
  {
    version: "0.1.229",
    date: "2026-08-16",
    headline: "Right-click copy/paste everywhere + live lyrics on the livestream",
    highlights: [
      "Right-click now gives Copy / Cut / Paste / Select All on every text field across the app — renaming songs, editing themes, new-slide text, Bible search, anywhere — and it works with content copied from your browser or other apps. (Requires the new desktop app update.)",
      "Livestream lower-third now shows the current live lyrics/verse as a caption for your stream (choose full-screen or lower-third under Hardware → Screens → Livestream).",
    ],
  },
  {
    version: "0.1.228",
    date: "2026-08-16",
    headline: "Projector slide transitions are back + a New Slide button",
    highlights: [
      "Slide transitions (fade/cut/etc.) work on the projector again — they'd been disabled as a side-effect of the big text-sizing fix. Now that text sizes against the fixed canvas, the transition wrapper is safely restored, so the projector animates slide changes just like the stage screen.",
      "New \"+ New slide\" button at the bottom of the playlist to quickly create a blank slide (the small + still offers From Songs / Bible / Media).",
    ],
  },
  {
    version: "0.1.227",
    date: "2026-08-16",
    highlights: [
      "Load Chapter no longer collapses to one verse: with a whole chapter loaded, jumping to a verse (spoken or clicked) now just moves the preview to that verse and keeps the rest of the chapter loaded.",
      "The Bible search box now stays pinned at the top of the panel, so you can look up a verse without scrolling all the way back up a loaded chapter.",
    ],
    headline: "Bible panel: keep the chapter loaded + a sticky search bar",
  },
  {
    version: "0.1.226",
    date: "2026-08-16",
    headline: "Songs stop popping up while the preacher is just talking",
    highlights: [
      "Much more context-aware song detection: a song now only surfaces on an explicit call to worship (\"let's sing…\", \"next song is…\") or a near-exact title — an ambient \"sing\" mid-sentence or a common worship phrase (\"thank you Lord\", \"his faithfulness\") no longer pulls a song up while someone is preaching. Fewer, more accurate suggestions.",
      "Also fixed: a verse already on screen no longer flickers/re-projects when the preacher repeats it.",
    ],
  },
  {
    version: "0.1.225",
    date: "2026-08-16",
    headline: "Verse ◀/▶ previews instead of projecting; \"from\" no longer misread",
    highlights: [
      "The Verse ◀ / ▶ buttons at the bottom now PREVIEW the next/previous verse in the centre panel instead of pushing it straight to the projector. Once it's the right verse, click the slide to go live — nothing changes on screen until you do.",
      "\"from\" (and a few other common words) can no longer be misheard as a Bible book (it was turning into Romans and corrupting scripture calls).",
    ],
  },
  {
    version: "0.1.224",
    date: "2026-08-16",
    headline: "Hover a scripture chip to preview the verse before projecting",
    highlights: [
      "AI scripture chips (and the purple \"Whisper\" correction chips) now show a small bubble on hover with a bit of the actual verse text — so you can confirm the reference is right before you click it live. Same idea as the song chips.",
    ],
  },
  {
    version: "0.1.223",
    date: "2026-08-16",
    headline: "Songs no longer trigger off the sermon; Bible tab doesn't auto-project",
    highlights: [
      "Song detection is now much stricter so a preacher's speech can't be mistaken for a song: a song only auto-projects at ≥90% confidence (was 85%), and song suggestion chips only appear at ≥80% (was 70%). Nothing below 80% surfaces at all.",
      "Clicking \"Bible\" in the top bar no longer projects a verse instantly — it just opens the Bible panel. To go live, click the verse slide in the centre (same as songs/playlist). Navigating never goes live on its own now.",
    ],
  },
  {
    version: "0.1.222",
    date: "2026-08-16",
    headline: "Playlist clicks never go live, a cleaner Stage screen, bigger reference",
    highlights: [
      "Fixed for good: clicking a song in the playlist (e.g. \"Steadfast Love of the Lord\") no longer sends it to the projector — even in AUTO mode. It only previews in the centre; to go live, right-click → Send to live, click a slide in the centre, or let the AI fire it.",
      "Stage screen redesigned for the platform: the time-of-day clock is gone, the current lyrics/verse now fill the screen big, and the next slide sits in a strip below so singers and preachers can see what's coming. A sermon timer only shows as a small corner chip when one is set.",
      "Scripture reference line (e.g. \"2 Kings 4:7 (NKJV)\") is a little bigger again on the projector.",
    ],
  },
  {
    version: "0.1.221",
    date: "2026-08-16",
    headline: "Translation switches reach the projector reliably + tidier AI chips",
    highlights: [
      "Translation switches (NIV, NKJV, NLT — any version) now reliably reach the projector, and the current verse changes over immediately. The projector re-checks the operator's live slide every few seconds and self-heals if an update was ever missed — so it stays in sync through a full 2-3 hour service instead of drifting.",
      "AI chips: hover a song chip to see its opening line + the words that were heard, so you can tell near-identical songs apart (two \"Great Is Thy Faithfulness\") before sending it live.",
      "AI chips can now be cleared — an × on each chip dismisses it, and a \"Clear\" button empties the row. New detections still appear normally.",
    ],
  },
  {
    version: "0.1.220",
    date: "2026-08-16",
    headline: "AUTO now stays on across restarts + a cleaner bottom bar",
    highlights: [
      "AUTO now persists when you close and reopen the app — no more re-arming it every service. Combined with AI auto-resuming your last session, the console starts hot instead of cold.",
      "Removed the duplicate grid/list/text view buttons from the bottom bar (they're still in the panel header).",
    ],
  },
  {
    version: "0.1.219",
    date: "2026-08-16",
    highlights: [
      "Songs no longer auto-advance. When a song goes live you'll get a clear notice — advance the slides yourself with → or by clicking the next slide. Worship is too spontaneous (repeated lines, leaders jumping stanzas) for reliable auto-advance, so this prevents wrong jumps mid-song. Scripture still auto-advances as the preacher reads on.",
      "Fixed live lyrics being corrupted by Bible detection: \"Sing like never before\" was turning into \"Song of Solomon / Luke\". Common worship words (sing, like, song, sons…) can no longer be mistaken for a book name — but a genuine \"Song of Solomon\" is still detected.",
      "\"Matthew\" now recognised even when the transcript hears it as \"Machu\"/\"Matchu\" (common with African-accented speech).",
      "Scripture reference line (e.g. \"1 Kings 9:6 (NKJV)\") is now a bit larger and easier to read on the projector.",
      "The \"AI staged\" song panel got a cleaner look — a premium dark card matching the rest of the UI instead of the heavy orange box.",
    ],
    headline: "Manual song advance, no more lyric corruption, and detection fixes",
  },
  {
    version: "0.1.218",
    date: "2026-08-15",
    headline: "Projector text is now big on EVERY slide — the tiny-song bug is fixed",
    highlights: [
      "Root-caused and fixed the last sizing bug: some songs/verses were projecting as one tiny line. The text engine now sizes against the fixed 1920×1080 presentation canvas directly, instead of re-measuring a slide box that could momentarily collapse on screen-change — which was starving long lyrics of the space to grow. Every song and verse now fills the screen big and clean, wrapping across multiple lines as needed.",
      "This applies identically to the operator preview and the projector, so what you see stays exactly what the congregation sees.",
    ],
  },
  {
    version: "0.1.217",
    date: "2026-08-15",
    headline: "Fixed: some songs projecting tiny — plus a cleaner notification style",
    highlights: [
      "Fixed the last projector-sizing bug: some song slides (and long verses) were rendering tiny while single words looked huge. The text engine was occasionally measuring the slide before its box had finished laying out and crushing multi-line text to fit a sliver of height. It now always sizes against the full presentation canvas, so every song and verse fills the screen the same big, clean way.",
      "New notification style: on-screen messages (added, removed, undo, saved, errors) now all use one clean, strong dark card with a crisp action button — no more mismatched loud colours.",
    ],
  },
  {
    version: "0.1.216",
    date: "2026-08-15",
    headline: "Clicking a playlist item no longer projects it live",
    highlights: [
      "Clicking a song/item in the playlist now just opens it in the centre to preview — it no longer sends it straight to the projector, so an accidental click can't change what the congregation sees.",
      "To go live: right-click the playlist item → \"Send to live\", or single-click any slide inside the centre panel.",
    ],
  },
  {
    version: "0.1.215",
    date: "2026-08-15",
    headline: "Projector now exactly matches the preview — big, ProPresenter-style text",
    highlights: [
      "Major rework: PresentFlow now composes every slide on a fixed 1920×1080 presentation canvas and scales that same canvas to each surface — so the operator preview and the projector show the identical layout, just at different physical sizes. What you see is truly what the congregation sees.",
      "Text is sized ProPresenter-style — it grows as large as it can while fitting cleanly: short scripture/lyrics become very large, longer passages step down only as much as needed, with professional safe margins and no clipping.",
      "Because everything is measured against the same fixed canvas, the size is consistent and stable — no more preview/projector mismatch and no shrinking to tiny on slide changes.",
    ],
  },
  {
    version: "0.1.214",
    date: "2026-08-15",
    headline: "Consistent projector text size across all slides",
    highlights: [
      "Projector text now uses one consistent, big size for every slide based on how many words are on it — so a verse, the next verse, and song slides all look the same size, instead of each one being sized differently (which sometimes dropped to tiny). Longer passages step down just enough to fit; nothing goes randomly small.",
    ],
  },
  {
    version: "0.1.213",
    date: "2026-08-15",
    headline: "Big projector text now stays big when you change slides",
    highlights: [
      "Fixed: the projector text was correctly big when a verse/song first appeared, but shrank to a tiny size when you moved to the next slide (auto-advance, next/previous verse, or a song slide). It now keeps the big screen-filling size on every slide change.",
    ],
  },
  {
    version: "0.1.212",
    date: "2026-08-15",
    headline: "No more slide ping-pong on repeated worship lines",
    highlights: [
      "Fixed the projector flipping back and forth between two slides on its own during repetitive worship (songs where consecutive slides share most of the same words, e.g. \"lifted high, lifted high\"). When it detects that bouncing, it now holds the slide still and pauses auto-advance briefly so you can move with the ← → keys.",
    ],
  },
  {
    version: "0.1.211",
    date: "2026-08-15",
    headline: "Projector text now fills the screen (big, wrapped, no clipping)",
    highlights: [
      "Fixed the big one: verses and lyrics were projecting as a single tiny line clipped at the edges, even though they looked perfect in the app. They now wrap and fill the screen on the projector — large and readable from the back — matching the operator preview.",
      "Also added a bit more safe-area margin so projectors that crop the edges (overscan) no longer cut off the first and last words.",
    ],
  },
  {
    version: "0.1.210",
    date: "2026-08-15",
    highlights: [
      "You can now say \"can we go to the NIV\" (or any version) to switch, and \"switch back\" / \"go back to the previous translation\" to return to the version you had before — it re-renders the live verse too.",
      "Careful guards: \"go back to your seats\" during a sermon won't switch anything, and \"go back to KJV\" goes straight to the KJV.",
    ],
    headline: "Say \"can we go to…\" and \"switch back\" for translations",
  },
  {
    version: "0.1.209",
    date: "2026-08-15",
    headline: "AI-detected non-existent verses show the notice too",
    highlights: [
      "When the AI hears a reference that isn't a real verse (e.g. a slip like \"Genesis 1:102\"), it now shows the \"this verse isn't in the Bible\" notice on the projector instead of a bare reference with no text — the same friendly message as a manual lookup.",
      "It's careful: the notice only appears when the chapter genuinely exists but the verse number is out of range, so a garbled mishearing never projects it.",
    ],
  },
  {
    version: "0.1.208",
    date: "2026-08-15",
    headline: "\"IV\" now means NIV, and non-existent verses are flagged",
    highlights: [
      "Voice: the booth's natural phrasing for the NIV now works even when it's misheard as \"IV\" — \"do you have IV?\", \"can we get IV\", \"IV please\" all switch to the NIV (with medical/roman-numeral phrases still ignored).",
      "If someone calls a verse that isn't in the Bible (e.g. Genesis 1:102), it no longer shows a blank slide — the operator gets a warning and the screen shows a gentle \"this verse isn't in the Bible\" notice instead.",
      "Switching translation now correctly re-renders the verse that's already live (this was tied to the licensed-verse fix above).",
    ],
  },
  {
    version: "0.1.207",
    date: "2026-08-15",
    headline: "Fixed: NIV/NKJV/NLT verses now show their actual text",
    highlights: [
      "Critical fix — licensed verses (NIV, NKJV, NLT) were projecting with only the reference label and no verse text. They now show the full verse correctly, for single verses, ranges and whole chapters, verified live against every version.",
    ],
  },
  {
    version: "0.1.206",
    date: "2026-08-15",
    headline: "NIV/NKJV/NLT now actually show in the Bible picker",
    highlights: [
      "The Bible translation dropdown was hardcoded to KJV/WEB/ASV — it now loads the full list your church can use, so NIV, NKJV and NLT appear there and can be picked for lookups and going live.",
      "The Settings → Bible tab now shows NIV/NKJV/NLT as included (unlocked) for your church, with your own API key optional.",
    ],
  },
  {
    version: "0.1.205",
    date: "2026-08-15",
    headline: "NIV, NKJV & NLT now on for every church — no setup",
    highlights: [
      "The NIV, NKJV and New Living Translation are now available to every church automatically — no API key to enter. They show up in the translation picker beside KJV/WEB/ASV, and you can switch to them by voice while preaching (\"switch to the NIV\").",
      "A church can still add its own API.Bible key to use its own quota, but it's no longer required.",
    ],
  },
  {
    version: "0.1.204",
    date: "2026-08-15",
    headline: "NIV, NKJV & NLT — add your API.Bible key to unlock them",
    highlights: [
      "You can now project the NIV, NKJV and New Living Translation. In Settings → Bible, paste your free API.Bible key and these versions turn on for your church — verses are fetched live and cached, so voice-detection and the translation switcher work with them too.",
      "Fixed the version wiring so each translation now returns its correct text (an earlier build had NKJV/NLT pointing at the wrong Bibles).",
    ],
  },
  {
    version: "0.1.203",
    date: "2026-08-14",
    headline: "Smarter: knows a spoken Bible verse from a sung song",
    highlights: [
      "When someone reads or announces a scripture (e.g. 'turn to Psalm 23'), the AI no longer fires a coincidental song just because the verse words happen to overlap a song's lyrics. It still detects songs from the lyrics being sung — no one has to say 'let's sing', spontaneous worship is caught the same as before.",
      "It never hides a real song: during a spoken verse a song is held as a tap-to-go-live chip rather than auto-projected, and the moment real singing continues it projects as normal.",
    ],
  },
  {
    version: "0.1.202",
    date: "2026-08-14",
    headline: "Lyrics fill the projector again — big and crowd-readable",
    highlights: [
      "Fixed: song lyrics that had been edited or imported were projecting small (they were rendering at their saved font size instead of filling the screen). Lyric slides now auto-size to fill the projector — big and readable from the back — exactly like the operator preview shows, and they never run off-screen.",
      "Deliberately designed slides with multiple elements (e.g. a title over an image) keep their exact layout as before.",
    ],
  },
  {
    version: "0.1.201",
    date: "2026-08-14",
    headline: "Songs: calmer suggestions, higher bar before auto-projecting",
    highlights: [
      "Song detection is now more conservative so it stops flooding you with low-confidence suggestions. A song only auto-projects on its own at 85%+ (was 70%). The 70–84% band now shows as a chip you tap to send live yourself; anything below 70% no longer pops up at all.",
      "New: when the words match two similar songs almost equally, it no longer guesses — it holds back and shows a chip for you to pick the right one, instead of risking the wrong song on screen.",
      "Bible verse auto-projection is unchanged (still 75%). This only makes songs stricter.",
    ],
  },
  {
    version: "0.1.200",
    date: "2026-08-14",
    headline: "See who the AI hears at a glance (multi-mic)",
    highlights: [
      "The multi-mic Channel strip now shows a live 'who's who' line — 🎤 next to the mic it hears preaching/praying and 🎶 next to the worship mic — so you can tell at a glance which channel the AI thinks is the speaker vs the singers.",
      "This is powered by the speech-vs-singing detection now tuned on real prayer and sermon audio. Tip: pick any one channel for your mixer in Settings › Audio, then turn on 'Auto-follow' — it will move to whichever mic is speaking.",
    ],
  },
  {
    version: "0.1.199",
    date: "2026-08-14",
    headline: "Auto-follow now reliably tells prayer/preaching from singing",
    highlights: [
      "Tuned the speech-vs-singing detection on real JPD service audio — including a full worship → prayer → worship recording. It now correctly spots when the band drops out and someone prays or preaches (even a quieter single voice over the room), instead of treating it the same as singing.",
      "The channel badges are steadier too: sung worship stays 🎶, spoken prayer/preaching shows 🎤, and genuinely in-between moments show no badge rather than guessing wrong.",
    ],
  },
  {
    version: "0.1.198",
    date: "2026-08-14",
    headline: "Auto-follow now tells singing from preaching",
    highlights: [
      "The multi-mic Auto-follow is now speech-aware: it favours the mic that's actually being spoken into (a preacher's voice) over a mic carrying sustained singing — so during worship it won't chase the loudest choir mic, and when the preacher comes in over the music it follows them.",
      "Each channel now shows a small live badge — 🎤 for the speaking (preacher) mic and 🎶 for the worship/singing mic — so you can see at a glance who the AI thinks is who. This is early and tuned for African-gospel accents and vocals; it'll keep improving.",
    ],
  },
  {
    version: "0.1.197",
    date: "2026-08-14",
    headline: "'Edit slide' now opens the song you're looking at",
    highlights: [
      "Fixed: in the Songs Library, 'Edit slide' opened the wrong song (the current playlist item) instead of the song you had selected. The button now lives beside the selected song's title and always opens that exact song — with all its real fonts, layout and backgrounds intact.",
    ],
  },
  {
    version: "0.1.196",
    date: "2026-08-14",
    headline: "Auto-follow the speaking mic (multi-mic)",
    highlights: [
      "New 'Auto-follow' toggle on the Channel strip: with several mics on a mixer, the AI now listens to whichever channel carries the strongest sustained voice — so the preacher's mic wins even while the choir sings on other channels.",
      "It won't jump around mid-sentence (it waits for a clear, sustained lead before switching), and clicking a channel pins it manually. Off by default; your transcription is otherwise unchanged.",
    ],
  },
  {
    version: "0.1.195",
    date: "2026-08-14",
    headline: "Separate looks for songs vs Bible verses",
    highlights: [
      "In the Themes panel you can now set a default style for Songs and a different one for Bible verses — the projector, stage and livestream automatically switch looks based on what's live, so worship and scripture can each have their own design.",
      "A specific item can still override it, and the church default applies when nothing is set.",
    ],
  },
  {
    version: "0.1.194",
    date: "2026-08-14",
    headline: "One-click 'Edit slide' next to the song title",
    highlights: [
      "A clear 'Edit slide' button now sits beside the song title in the center panel — click it to open the full-screen style editor (fonts, layout, backgrounds, objects). No more needing to double-click a slide to find it.",
      "All edits save and persist as before.",
    ],
  },
  {
    version: "0.1.193",
    date: "2026-08-14",
    headline: "Voice translation switching handles mis-hearings",
    highlights: [
      "Saying a translation now works even when the AI mis-hears it — 'do you have IV?' or spelled-out 'N I V' resolves to NIV, and the same for ESV, KJV, NLT, NASB, CSB. It's carefully gated so ordinary speech ('give her an IV') never switches anything.",
      "This activates automatically the moment a translation is licensed/added — ready for when your Bible licenses come through.",
    ],
  },
  {
    version: "0.1.192",
    date: "2026-08-14",
    headline: "AI stays on across reloads",
    highlights: [
      "If you leave AI listening turned on, it now stays on after a refresh or app restart — even in Manual autopilot mode (before, it only auto-resumed in Auto mode). A toast reminds you it resumed so the mic is never secretly live.",
    ],
  },
  {
    version: "0.1.191",
    date: "2026-08-14",
    headline: "Media: bulk delete",
    highlights: [
      "Hover a media tile and tick its checkbox (or Select all), then delete any number of images/videos at once — no more deleting one at a time.",
    ],
  },
  {
    version: "0.1.190",
    date: "2026-08-14",
    headline: "Scripture always fits — no more text off-screen",
    highlights: [
      "Fixed long verses (e.g. Revelation 1:20) running off the edge of the screen. Projected text now auto-sizes so it's as big as possible while GUARANTEEING it fits — long passages shrink just enough to stay fully on screen, never clipped.",
      "The reference line at the bottom (e.g. JOHN 11:4 (KJV)) is now larger and easier to read.",
    ],
  },
  {
    version: "0.1.189",
    date: "2026-08-14",
    headline: "Songs: bulk select, add & delete",
    highlights: [
      "Tick multiple songs (or Select all) in the Songs library, then add them all to the playlist in one click — no more adding one at a time.",
      "Bulk delete too: select any number of songs and remove them together. Right in the operator, no need to leave for the web library.",
    ],
  },
  {
    version: "0.1.188",
    date: "2026-08-14",
    headline: "Slide editor: Layers panel with lock & hide",
    highlights: [
      "New Layers panel lists every object on the slide (top layer first) — click to select, tap the eye to hide it from the projector, tap the lock to protect it from accidental drags or resizes.",
      "Locked objects can't be moved, resized or deleted on the canvas; hidden objects show dimmed in the editor but never appear on the projector, stage or livestream.",
    ],
  },
  {
    version: "0.1.187",
    date: "2026-08-14",
    headline: "Projected text much bigger",
    highlights: [
      "Raised the projected-text size floor (6% → 9% of screen height) and ceiling, and bumped the size targets, so scripture, lyrics and the reference line all fill the screen far more — no more small text stranded in the middle with empty space around it.",
      "Long passages still shrink to fit and paginate; applies to the projector, stage and livestream.",
    ],
  },
  {
    version: "0.1.186",
    date: "2026-08-14",
    headline: "Bigger scripture & lyrics on every screen",
    highlights: [
      "Projected scripture and song text is noticeably larger and fills more of the screen — tighter line spacing and a slimmer safe-area let the auto-fit grow the text, while still shrinking long passages so they always fit.",
      "The livestream output was rendering text too small (it wasn't using the projector's fill-the-screen sizing) — now the main projector, stage display and livestream all size text the same way.",
    ],
  },
  {
    version: "0.1.185",
    date: "2026-08-14",
    headline: "Large song imports now go through",
    highlights: [
      "Fixed imports reporting '0 songs imported' — the library cap was blocking every song once you hit 50. Paid/Max and demo accounts now have an effectively unlimited library, so full ProPresenter imports (500+ songs) go straight in.",
      "Free accounts keep the 50-song starter limit (add a bundle to grow it), and if a limit is ever hit it now tells you clearly instead of skipping in silence.",
    ],
  },
  {
    version: "0.1.183",
    date: "2026-08-14",
    headline: "Slide editor: richer text styling",
    highlights: [
      "Text boxes now have ProPresenter-style controls: line spacing, letter spacing, UPPERCASE, a text-shadow toggle, and a text outline (colour + width) for readability over busy backgrounds.",
      "Everything scales with the output so it looks identical in the editor and on the projector at any resolution.",
    ],
  },
  {
    version: "0.1.182",
    date: "2026-08-14",
    headline: "Theme backgrounds & logos no longer expire",
    highlights: [
      "Fixed a long-standing issue where a theme's background image, video or logo could stop showing after a few hours. Theme media links are now refreshed automatically every time themes load, so your look stays intact through the whole service.",
    ],
  },
  {
    version: "0.1.181",
    date: "2026-08-14",
    headline: "Bible AUTO: no more low-confidence verses projecting themselves",
    highlights: [
      "Fixed the big one: while reading scripture, low-confidence verses (and ones you never said) could auto-project. Auto-projection now needs 75%+ confidence — and that floor is hard, so a repeated or mis-heard detection can no longer push itself live.",
      "Verses in the 65–74% band now only SUGGEST — you get a 'we think we heard John 3:16 — put it live?' prompt to accept or ignore. Below 65% does nothing, and nothing below 75% ever projects on its own.",
      "'Go to verse X' voice commands and next/back/continue navigation are unchanged, and detection speed, transcription and hearing are untouched.",
    ],
  },
  {
    version: "0.1.180",
    date: "2026-08-14",
    headline: "Themes: tap to go live, like ProPresenter",
    highlights: [
      "The Themes button now opens a compact panel with a grid of theme previews. Tap any theme and it goes live on the projector, stage and livestream instantly — the live one is marked with a red LIVE badge.",
      "Each card has an Edit button that opens the full-screen designer. Creating a new theme or saving an edit applies it live right away.",
      "Removed the separate 'Change theme' top-bar button — the Themes panel now does everything in one place.",
    ],
  },
  {
    version: "0.1.179",
    date: "2026-08-14",
    headline: "Big ProPresenter imports now actually work",
    highlights: [
      "Importing large ProPresenter libraries (500+ songs) no longer fails with a server error — the import is now processed in small batches so a big library can't overload the server.",
      "You get a live progress bar showing exactly what's happening — chunking, reading songs, and importing — batch by batch, so you can see it working the whole way through.",
      "Resilient: if a batch has trouble it retries automatically, and if anything is skipped you're told clearly instead of songs silently going missing.",
    ],
  },
  {
    version: "0.1.178",
    date: "2026-08-14",
    headline: "Themes: quick switcher + use any media as logo/background",
    highlights: [
      "New 'Change theme' button in the top bar — switch the live projector/stage/livestream look in one click, no editor needed.",
      "Right-click any image in the Media library to instantly set it as the current theme's background or logo. You can also drag a library image straight onto the Logo/Background slots in the theme editor.",
    ],
  },
  {
    version: "0.1.177",
    date: "2026-08-14",
    headline: "Slide editor: type on the canvas, duplicate & distribute groups",
    highlights: [
      "Double-click any text box on the slide canvas to edit the words right there — no more hunting for a side field. Enter commits, Shift+Enter adds a line, Esc cancels.",
      "With several objects selected you can now Duplicate the whole group in one click, and Distribute 3+ objects into perfectly even horizontal or vertical spacing.",
    ],
  },
  {
    version: "0.1.176",
    date: "2026-08-13",
    headline: "Theme editor polish",
    highlights: [
      "The theme design editor now opens truly full-screen instead of being boxed inside the Themes window, and the Default badge and accents render correctly in the operator.",
    ],
  },
  {
    version: "0.1.175",
    date: "2026-08-13",
    headline: "Full theme design studio in the operator",
    highlights: [
      "The Themes button now opens the complete theme designer — edit any theme's fonts, text colour, background (solid, gradient, image or video), animated backgrounds, and logo overlay, with a live 16:9 preview of exactly what the projector will show.",
      "Create, duplicate, rename, reorder, export and delete themes right from the operator. Setting a theme as default (or saving an edit to the current one) updates the live projector, stage and livestream instantly.",
    ],
  },
  {
    version: "0.1.174",
    date: "2026-08-13",
    headline: "Themes opens as a full-screen manager",
    highlights: [
      "The Themes button in the top bar now opens a proper full-screen manager instead of a cramped side panel — big theme previews, one-click Apply, Import, Quick Swatches and Blank Slides, all with room to breathe.",
    ],
  },
  {
    version: "0.1.173",
    date: "2026-08-13",
    headline: "Slide editor: select and move multiple objects at once",
    highlights: [
      "Drag a box around several objects — or Shift-click to add them one by one — and move, nudge (arrow keys), or delete them all together.",
      "New group Align buttons snap the whole selection's left/centre/right and top/middle/bottom edges into line in one click — perfect for tidying stacked lyric lines or a row of logos.",
    ],
  },
  {
    version: "0.1.172",
    date: "2026-08-13",
    headline: "Slide editor: opacity for every object",
    highlights: [
      "Any object — text, image, or video, not just shapes — can now be made semi-transparent with the Opacity slider. Perfect for faded watermarks, subtle logos, and text or images layered over a background.",
    ],
  },
  {
    version: "0.1.171",
    date: "2026-08-13",
    headline: "Designed slides project cleaner — smoother transitions, crisper detail",
    highlights: [
      "Switching between designed slides (including image- or shape-only slides) now crossfades and replays their entrance animations, instead of the new slide popping in place.",
      "Shape borders and rounded corners now scale with the screen, and the editor matches the projector even more closely (text shadow) — so what you design is what projects, at any resolution.",
    ],
  },
  {
    version: "0.1.170",
    date: "2026-08-13",
    headline: "Slide editor: gradient fills for shapes",
    highlights: [
      "Shapes can now be filled with a gradient — turn on Gradient, pick a second colour and an angle, and it projects exactly as designed. Great for accent bars, banners, and lower-third backgrounds.",
    ],
  },
  {
    version: "0.1.169",
    date: "2026-08-13",
    headline: "Slide editor: save your own templates",
    highlights: [
      "Designed a slide layout you love? Hit “Save current as template,” give it a name, and it joins the template list — apply it to any slide with one click. Your templates live under “Your templates” alongside the built-in ones, and you can delete them anytime.",
    ],
  },
  {
    version: "0.1.168",
    date: "2026-08-13",
    headline: "Preview now matches the projector — and scripture is bigger",
    highlights: [
      "The operator preview is now a true 16:9 mirror of the projector and sizes text exactly the same way, so what you see in the app is what the congregation sees on screen — same proportions, same line breaks. Your A−/A+ size changes now show in the preview too.",
      "Scripture is noticeably larger by default (sanctuary-readable), while long passages still auto-fit down and paginate rather than ever going tiny.",
    ],
  },
  {
    version: "0.1.167",
    date: "2026-08-13",
    headline: "Slide editor: rotate objects",
    highlights: [
      "Any object — text, shape, image or video — can now be rotated. Select it and use the new Rotation slider in the editor; the angle projects exactly as designed and plays nicely with entrance animations.",
    ],
  },
  {
    version: "0.1.166",
    date: "2026-08-12",
    headline: "Auto-detected songs open the full song",
    highlights: [
      "When the AI auto-projects a detected song, it now opens the whole song in your workspace — all slides visible and ready to navigate or edit — and adds it to your playlist if it wasn't already there. Previously it only sent the first slide live without opening the song.",
      "This matches how clicking a song chip or confirming one with the keyboard already worked — all three now behave the same.",
    ],
  },
  {
    version: "0.1.165",
    date: "2026-08-12",
    headline: "Navigating no longer changes your theme",
    highlights: [
      "Clicking Playlist, a Song-Detection chip, or moving around the console no longer switches the projector's theme. The theme now follows what's actually LIVE (or your applied default) — so browsing never disturbs the screen.",
      "Section themes still apply per service part when that part goes live, and picking a theme yourself still works exactly as before.",
    ],
  },
  {
    version: "0.1.164",
    date: "2026-08-12",
    headline: "Verses appear cleanly on the projector — no flash or jump",
    highlights: [
      "Fixed the projected scripture slide briefly appearing, blinking out, and fading back in. The verse now fades in cleanly in one motion — no flash of an intermediate state for the congregation to see.",
      "Also fixed the very first slide of a session momentarily showing in the wrong font before snapping to the right one — it now re-fits to the correct font the instant it loads.",
    ],
  },
  {
    version: "0.1.163",
    date: "2026-08-12",
    headline: "Catches badly-misheard book names and translation requests",
    highlights: [
      "The AI now recognises book names even when speech-to-text mangles them into other words — \"first salvo\" → 1 Samuel, \"habba cook\" → Habakkuk, \"fill a man\" → Philemon — as long as a chapter and verse follow, so ordinary speech is never mistaken for a reference.",
      "Translation requests survive mis-hearings too: \"can we read it in cage v\" → KJV, \"use knive\" → NIV, \"give me easy v\" → ESV. These only trigger when you clearly ask to switch, so words like \"naive\" in normal speech won't change your Bible version.",
    ],
  },
  {
    version: "0.1.162",
    date: "2026-08-12",
    headline: "Slide editor: edit text, undo/redo, and full controls",
    highlights: [
      "You can now edit a text object's words directly in the editor — type into the Text box in the inspector. (Previously you could add text but not change it.)",
      "Undo and Redo — with ⌘Z / ⌘⇧Z, or the buttons in the editor's top bar. A whole drag counts as one undo step.",
      "More precise controls: italic & underline, shape border colour + thickness, an exact X / Y / width / height for any object, and a background image per slide from your media library.",
    ],
  },
  {
    version: "0.1.161",
    date: "2026-08-12",
    headline: "Big ProPresenter libraries import — for real this time (both import screens)",
    highlights: [
      "Fixed ProPresenter imports failing on large .probundle libraries. The earlier fix only covered one of the two import screens — the Import Wizard was still uploading the raw bundle (hundreds of MB of backgrounds) and choking. Both screens now strip the media in-app and import just the lyrics, so a 500+ song library (a real one was 171 MB → 5 MB of lyrics) imports cleanly.",
      "Made the extraction rock-solid: it no longer depends on a background worker that some setups block — so it works reliably in the installed app.",
    ],
  },
  {
    version: "0.1.160",
    date: "2026-08-12",
    headline: "Slide editor: copy an object to another slide",
    highlights: [
      "Select an object and hit the new copy button, then move to any other slide and paste it — reuse a styled text box, logo, or shape across your whole song without rebuilding it each time.",
    ],
  },
  {
    version: "0.1.159",
    date: "2026-08-12",
    headline: "Slide editor: start from a template",
    highlights: [
      "New “Start from template” buttons in the editor lay down a professional layout in one click — Title, Scripture, Announcement, Two-column, or Lower third — then just edit the text. No more building every slide from a blank canvas.",
    ],
  },
  {
    version: "0.1.158",
    date: "2026-08-12",
    headline: "Slide editor: entrance animations for objects",
    highlights: [
      "Give any object an entrance — fade, slide in from any direction, or zoom — that plays once when the slide goes live, with an optional delay so elements can appear in sequence.",
      "The motion is brief and settles exactly onto your design: it never changes an object's final position, size, or font, existing slides are unaffected, and it respects “reduce motion” accessibility settings.",
    ],
  },
  {
    version: "0.1.157",
    date: "2026-08-12",
    headline: "Slide editor: smart alignment guides",
    highlights: [
      "As you drag an object, it now snaps to line up with the slide's edges and centre AND with your other objects' edges and centres — with a teal guide line showing the match. Building tidy, aligned layouts is now effortless.",
    ],
  },
  {
    version: "0.1.156",
    date: "2026-08-12",
    headline: "Repeated verses project every time they're preached",
    highlights: [
      "Fixed verses not re-projecting when the preacher comes back to one. Saying \"John 10:10\", then \"Mark 11:2\", then \"John 10:10\" again now projects John 10:10 the second time too — a verse can be shown as many times as it's spoken. The old behaviour treated a repeated reference as \"already used\" and buried it.",
      "Same-utterance duplicates are still collapsed to one projection (a single \"John 10:10\" doesn't fire three times as the AI refines what it heard) — only genuine restatements re-project.",
    ],
  },
  {
    version: "0.1.155",
    date: "2026-08-12",
    headline: "Slide editor: nudge with arrows + one-click align",
    highlights: [
      "Select an object and use the arrow keys to nudge it into place — hold Shift for pixel-precise moves.",
      "New Align controls: snap the selected object to the left / centre / right and top / middle / bottom of the slide with one click.",
    ],
  },
  {
    version: "0.1.154",
    date: "2026-08-12",
    headline: "Slide editor: duplicate objects + snap-to-centre",
    highlights: [
      "Select any object and hit the new copy button to duplicate it in place — great for repeating a design element or reusing a styled text box.",
      "Dragging an object now snaps cleanly to the centre of the slide (with a guide line), so titles and verses line up perfectly without fiddling.",
    ],
  },
  {
    version: "0.1.153",
    date: "2026-08-11",
    headline: "Slide editor: videos, and layer ordering",
    highlights: [
      "Add videos to a slide the same way as images — “Add media → Video” pulls from your church's uploaded clips; they play on the projector muted-and-looping by default, and you can toggle sound or looping per clip.",
      "New layer controls: select any object and send it to back, backward, forward, or to the front — so text can sit cleanly over images and video.",
    ],
  },
  {
    version: "0.1.152",
    date: "2026-08-11",
    headline: "Import huge ProPresenter libraries — hundreds of songs at once",
    highlights: [
      "Fixed importing large ProPresenter bundles that failed with an unexpected error. A single exported .probundle can secretly be a whole library — one was 171 MB holding 559 songs, but 158 MB of that was just background media. PresentFlow now strips the media in-app and imports only the lyrics (5 MB instead of 171 MB), so 500+ song libraries import in one go.",
      "Backgrounds inside the bundle are skipped (you re-theme in PresentFlow anyway), and one malformed song can no longer stop the whole import — the rest still come in.",
    ],
  },
  {
    version: "0.1.151",
    date: "2026-08-11",
    headline: "Verses detected even when the AI mis-hears the numbers",
    highlights: [
      "The AI now corrects the number mistakes speech-to-text makes on verse references — \"Judges eleven floor\" becomes Judges 11:4, \"John ten tree\" becomes John 10:3, \"Mark five nine\" is heard even as \"nein\", \"Romans eight twenty ate\" becomes Romans 8:28. So verses fire correctly even when the transcription of the numbers isn't perfect.",
      "This only kicks in right after you say a book name and a number — so it never changes ordinary speech. \"Open the door\" or \"Romans 8, for us who can be against us\" are left exactly as spoken; no false verses.",
    ],
  },
  {
    version: "0.1.150",
    date: "2026-08-11",
    headline: "Add images from your media library, inside the slide editor",
    highlights: [
      "In the slide editor, “Add image → From media library” opens your church's uploaded images — pick one and it drops straight onto the slide. No re-uploading, no pasting URLs (though you still can).",
    ],
  },
  {
    version: "0.1.149",
    date: "2026-08-11",
    headline: "Design slides right in the operator console",
    highlights: [
      "Double-click any song slide on the desktop to open a full slide editor — add and position text boxes, shapes and images, set fonts, colours, sizes and per-slide backgrounds, and manage the slide deck, all inside the console.",
      "What you design projects exactly on the live screen, stage, and livestream. Quick text edits are still one right-click away for fast tweaks.",
      "Designed slides are protected: the quick grid actions won't accidentally flatten a slide you've laid out — they send you to the editor instead.",
    ],
  },
  {
    version: "0.1.148",
    date: "2026-08-11",
    headline: "Designed slide layouts now project exactly as designed",
    highlights: [
      "The live projector, stage, and livestream can now show rich slide layouts — multiple text boxes, fonts, colours, shapes, images and per-slide backgrounds — positioned exactly where you placed them, instead of collapsing everything to centred text.",
      "Groundwork for the full in-app slide editor coming next: what you design is now what projects, pixel-faithful across the projector, stage screen, and livestream. (Plain lyric/verse slides are unchanged.)",
    ],
  },
  {
    version: "0.1.147",
    date: "2026-08-11",
    headline: "Preview matches projector · one clean fade per verse · transcription recovery",
    highlights: [
      "The operator preview now renders with the exact same theme font as the projector — no more picking a font that looks right in the app but shows up as an unexpected serif on screen. Theme fonts also degrade safely: if a font isn't available on the output machine, it falls back to a clean font of the same style instead of old-fashioned serif.",
      "Fixed verse slides fading in 4-6 times in a row: as the AI refines what it heard (partial → final → double-checked), those rapid updates now hard-cut invisibly and only the FIRST appearance of a verse gets the smooth fade. One verse, one fade.",
      "If transcription stopped working after today's earlier update loop issue: fully quit and reopen Present Flow once — it self-heals on that restart. Also hardened the update mechanism so this can't recur on logged-out machines.",
    ],
  },
  {
    version: "0.1.146",
    date: "2026-08-11",
    headline: "Put your church logo on announcements",
    highlights: [
      "The announcement composer now has a “Church logo” section — paste a logo image URL and place it anywhere on the announcement: any of the nine corners/edges, dead center, or an upper-third / lower-third band.",
      "Set the logo's size and opacity, preview it live, and save it into your announcement presets so it comes back next time.",
    ],
  },
  {
    version: "0.1.145",
    date: "2026-08-11",
    headline: "Edit slides the obvious way + What's New is back",
    highlights: [
      "Double-click any lyric slide to edit its text right there — no more hunting through the right-click menu.",
      "The slide Delete option now actually deletes the slide (it was doing nothing before).",
      "Rename a song from the playlist: double-click its name, or right-click → Rename.",
      "This “What's New” screen now shows up for every update again — it had been silently hidden on smaller releases.",
    ],
  },
  {
    version: "0.1.144",
    date: "2026-08-11",
    headline: "Animated theme backgrounds for verses & lyrics",
    highlights: [
      "Themes with a solid or gradient background can now gently move behind your words. In the theme editor's Background section, pick a Motion preset — Drift, Aurora, or Pulse — and the projector, stage, and livestream all show it live.",
      "The motion is deliberately subtle and smooth: it's GPU-drawn so it won't slow down your projector machine or the livestream, and it automatically turns off for anyone who has “reduce motion” switched on.",
    ],
  },
  {
    version: "0.1.143",
    date: "2026-08-11",
    headline: "Theme editor: reuse your media, export & share themes",
    highlights: [
      "In the theme editor, every background and logo picker now has a “Choose from media library” button — pick any image or video you've already uploaded, right inside the app, instead of re-uploading it.",
      "Each theme card has a new download button that exports the theme as a file you can back up or hand to another PresentFlow church.",
      "New “Import file” button at the top of Themes brings an exported theme back in — so you can copy a look between churches or restore one you saved.",
    ],
  },
  {
    version: "0.1.142",
    date: "2026-08-11",
    headline: "Safer editing when you're offline",
    highlights: [
      "If your connection drops mid-service, PresentFlow now stops you from re-ordering, adding, removing, duplicating, or re-theming service items until you're back online — so a dropped wifi signal can never quietly scramble your live plan.",
      "You'll get a clear “You're offline — reconnect to change the service plan” message instead of a silent failure. Projecting slides you already have keeps working the whole time.",
    ],
  },
  {
    version: "0.1.141",
    date: "2026-08-11",
    headline: "One-click theme colours from your logo",
    highlights: [
      "In the theme editor, once you've added a logo, hit “Auto-colourway from logo” — PresentFlow reads your logo's main colour and builds a matching gradient background with automatically readable text, so a new church theme takes seconds.",
      "The text colour is always picked for contrast (dark text on light, white on dark), so your scripture and lyrics stay legible.",
    ],
  },
  {
    version: "0.1.140",
    date: "2026-08-11",
    headline: "Run a whole service offline",
    highlights: [
      "Your themes now work offline too — colours, fonts, and gradients keep applying to the projector even without internet.",
      "Theme background images/videos, logos, and media slides are cached as you use them, so they still show on screen if the connection drops mid-service.",
      "A small “Offline — presenting from your saved service” badge appears when you lose connection, so you always know what's happening. (Live AI listening resumes automatically when you're back online.)",
    ],
  },
  {
    version: "0.1.139",
    date: "2026-08-11",
    headline: "Offline resilience — the app opens even if wifi drops",
    highlights: [
      "The desktop app now caches its interface, so it opens and keeps running even if the internet or our servers are briefly unreachable — pages you've already visited load from the local cache.",
      "Your current service plan is also saved locally as you work, as a safety net against a mid-service outage. (Live AI listening still needs internet; the present-and-project loop keeps working offline.)",
      "First step of a larger reliability upgrade — full offline presenting of media and Bible verses is coming next.",
    ],
  },
  {
    version: "0.1.138",
    date: "2026-08-11",
    headline: "Section themes — a different look per service part",
    highlights: [
      "You can now give any item in your service plan its own theme: right-click it → “Section theme” → pick a theme (or “Default”). Worship can look different from the sermon, announcements different again.",
      "As you move through the plan, the projector, stage, and livestream automatically switch to each item's theme; items without one use your church default exactly as before.",
    ],
  },
  {
    version: "0.1.137",
    date: "2026-08-11",
    headline: "Theme editor now matches the projector (opacity + gradients)",
    highlights: [
      "The theme editor's Opacity slider now actually affects the projector — it dims the background (not your text) for readability, and the editor preview shows the same result you'll get on screen.",
      "Gradient theme backgrounds now render at the same angle in the editor and on the projector.",
    ],
  },
  {
    version: "0.1.136",
    date: "2026-08-11",
    headline: "Theme video backgrounds + church logo overlay",
    highlights: [
      "Themes can now use a looping video background behind your lyrics and scripture — it keeps playing smoothly as you change slides, with a dimming control for readability.",
      "Themes can also place your church logo on the output (any corner or centred, with size and opacity), shown across the projector, stage, and livestream.",
      "Both apply live the moment you Apply the theme — part of the ongoing themes overhaul. Per-section themes (a different look for worship vs sermon) are coming next.",
    ],
  },
  {
    version: "0.1.135",
    date: "2026-08-11",
    headline: "Live Video Input — camera behind your lyrics & scripture",
    highlights: [
      "New “Video Input” in the Hardware panel (bottom-left): pick a connected camera or USB HDMI capture card, preview it, and Activate — the live feed becomes the projector background with your lyrics/Bible composited over it as a lower third.",
      "The camera stays running while you change slides, switch verses, or change songs — only the overlay text updates. Clear removes the video without touching your current slide.",
      "Requires the latest PresentFlow app update (for camera permission) and a one-time approval in macOS System Settings › Privacy & Security › Camera. Professional SDI/NDI inputs come in a later update.",
    ],
  },
  {
    version: "0.1.134",
    date: "2026-08-11",
    headline: "Themes now change the projector",
    highlights: [
      "Applying a theme (Themes tab → Apply) now actually restyles the live output: background colour, gradient, or image, plus text colour, font, weight, and alignment — on the projector, stage, and livestream together, instantly.",
      "Text auto-sizing and ALL-CAPS readability still apply on top of any theme, and text can never run off the screen.",
      "This is the first step of the bigger themes overhaul — background video, logo, lower-thirds, per-section themes, and a full theme editor are coming next.",
    ],
  },
  {
    version: "0.1.133",
    date: "2026-08-11",
    headline: "Undo for adding & deleting songs and slides",
    highlights: [
      "Removing a song from the service plan, or deleting a slide in the editor, now shows an “Undo” — one click puts it back (a removed song returns to its original position).",
      "Adding a song, a blank item, or a slide from the playlist is also one-click undoable.",
      "Deletes no longer feel risky: everything you add or remove in the plan is recoverable, so you can work faster during setup.",
    ],
  },
  {
    version: "0.1.132",
    date: "2026-08-11",
    headline: "Slide delete fixed · add slides & rename songs from anywhere",
    highlights: [
      "Fixed slide deletion in the editor: right-clicking a slide and choosing Delete now removes exactly that slide (it previously removed the wrong one). Click Save to keep the change.",
      "You can now add a slide straight from the playlist — right-click a song in the service plan and choose “Add slide”.",
      "Songs can now be renamed, including imported ones: click a song's title in the library (or in the operator's song preview) to edit it, and the new name updates everywhere it's used.",
    ],
  },
  {
    version: "0.1.131",
    date: "2026-08-11",
    headline: "Smooth transitions on auto-advanced slides",
    highlights: [
      "Slides that advance automatically — a detected song going live, or a spoken scripture auto-projecting — now ease in with a quick, gentle fade instead of a hard cut, matching the polished look of your manual transitions. It's deliberately fast (a fifth of a second) so it never lags behind live speech.",
      "Your own configured transition still applies to slides you advance by hand, and instant Bible verse clicks stay instant — nothing you already do gets slower.",
    ],
  },
  {
    version: "0.1.130",
    date: "2026-08-11",
    headline: "Proclaim & PowerPoint import order · text-size syncs to paired screens",
    highlights: [
      "Proclaim service exports now import their songs in the order the service was arranged, not alphabetical file order.",
      "PowerPoint (.pptx) imports now attach each slide's text to the correct slide, improving AI detection and search on imported decks (the visible slides were already in order).",
      "The manual text-size setting (A− / AUTO / A+) now also carries to a paired second screen over the network, so a separately-connected projector matches your chosen size too.",
    ],
  },
  {
    version: "0.1.129",
    date: "2026-08-11",
    headline: "Manual projector text-size control (A− / AUTO / A+)",
    highlights: [
      "New text-size control in the top bar: AUTO keeps the automatic best-fit sizing, while A− and A+ let you make the projected text a notch smaller or larger to taste. It shows the current size (e.g. 120%) and one click on AUTO snaps back to automatic.",
      "Your choice applies instantly to the projector, stage, and livestream outputs together, and text still can never run off the screen — A+ grows it as large as still fits cleanly, A− makes everything smaller.",
    ],
  },
  {
    version: "0.1.128",
    date: "2026-08-11",
    headline: "ALL-CAPS projected lyrics + ProPresenter 7 imports in correct order",
    highlights: [
      "Projected lyrics and verses now display in bold ALL-CAPS for maximum crowd readability at a distance, matching the ProPresenter look. The auto-sizing accounts for it, so text stays as large as it can while fitting cleanly.",
      "ProPresenter 7 songs (.pro files and .probundle) now import in the exact order they're arranged to be sung — reading the real arrangement (including repeated choruses) straight from the file, verified against real ProPresenter files. Re-import any Pro7 songs added before this update to fix their order.",
    ],
  },
  {
    version: "0.1.127",
    date: "2026-08-10",
    headline: "Transcription stays in real-time on busy church wifi",
    highlights: [
      "Fixed the biggest cause of slow, laggy, or missing captions during a service: when your internet uplink gets saturated (very common when the same PC is also pushing a livestream), the live audio to our transcription engine used to pile up and fall further and further behind — so words arrived late, in bursts, and got dropped, and it got worse the longer the service ran.",
      "PresentFlow now keeps the transcription close to real-time: if the uplink genuinely can't keep up, it holds the delay to a few seconds instead of drifting minutes behind and getting worse all service. On a healthy connection nothing changes — this only kicks in when the network is the bottleneck.",
      "This is especially important on a clean board/NDI feed, where the audio itself is perfect — the lag was purely the network, and now it's handled.",
      "You'll now also get a clear on-screen warning if this computer's uplink is the bottleneck, so you instantly know the lag is a network issue (not the AI) — with the fix: wire this PC to Ethernet and keep the livestream upload off its connection.",
    ],
  },
  {
    version: "0.1.126",
    date: "2026-08-10",
    headline: "ProPresenter imports: correct song order + no garbled characters",
    highlights: [
      "Songs imported from ProPresenter (.pro6) now come in the order they're actually meant to be sung — following the song's arrangement, including repeated choruses (Verse 1 → Chorus → Verse 2 → Chorus…), instead of the scrambled editing order.",
      "Fixed garbled characters on import — smart quotes, dashes, and accented letters (é, ', —) now come through correctly instead of as odd symbols.",
      "Note: this applies to newly imported songs. Anything imported before this update can be re-imported to pick up the corrected order and characters. (Pro7 .pro files still import approximately — that format needs a separate fix, coming soon.)",
    ],
  },
  {
    version: "0.1.125",
    date: "2026-08-10",
    headline: "Much bigger, crowd-readable slide text — auto-sized to each slide",
    highlights: [
      "Projected text is now dramatically larger and sized for the back of the room. Every slide automatically uses the biggest font that cleanly fits — a short line like \"Jesus Saves\" fills the wall, while a long passage shrinks only as much as it needs to, then splits across pages rather than ever becoming tiny.",
      "Bible verses now show the verse itself at full size with the reference (e.g. \"John 3:16\") in a smaller secondary size beneath — so the words people are reading stay as large as possible.",
      "This adapts to any screen — projector, stage display, livestream, 720p/1080p/4K — using the actual output size, so it always looks right.",
    ],
  },
  {
    version: "0.1.124",
    date: "2026-08-10",
    headline: "Projector never blanks — auto-recovers from glitches & network drops",
    highlights: [
      "The projector, stage, and livestream output screens now heal themselves. If the network hiccups, a screen reloads, or its display process ever crashes mid-service, the output falls back to a clean black screen (never a browser error page in front of the congregation) and automatically reconnects the moment it can — then your current slide snaps right back.",
      "The operator window recovers the same way: if it loses the connection it shows a calm \"reconnecting…\" screen and keeps retrying on its own until it's back, instead of getting stuck. No more needing to quit and reopen after a blip.",
      "This is the first of several reliability upgrades aimed at making PresentFlow rock-solid on unreliable church wifi.",
    ],
  },
  {
    version: "0.1.123",
    date: "2026-08-10",
    headline: "Smarter during worship · warns on hot audio · cleaner mixer sound",
    highlights: [
      "PresentFlow now recognises when it's hearing worship/choir/music rather than speech, and pauses zero-click song auto-projection during those stretches so it won't push a song off the choir singing. Detected songs still show — press your confirm key to project. A subtle \"MUSIC\" chip appears while this is active, and it clears itself the moment clear speech returns.",
      "New \"AUDIO TOO HOT\" warning: if the feed coming in is clipping (peaking at maximum), a red chip tells you to turn the send level down from the desk. A clipped feed transcribes badly, so this helps catch a common cause of missed/garbled words.",
      "NDI multi-channel feeds now show a \"detecting channels\" note while connecting, then reveal the full channel grid automatically so you can pick the vocal channel.",
      "The AI Listening diagnostic now shows a live one-screen readout — input, type (incl. NDI), sample rate, channels, level, confidence, music/clipping/latency — so a screenshot tells the whole story if something's off.",
    ],
  },
  {
    version: "0.1.122",
    date: "2026-08-08",
    headline: "Receive service audio over the network with NDI",
    highlights: [
      "PresentFlow can now receive your mixer audio over the network via NDI — no more needing a USB cable from the desk into the PresentFlow computer. That frees the USB audio interface for your broadcast/livestream machine while PresentFlow listens to the same feed over the LAN.",
      "NDI sources on your network are discovered automatically and appear right in the audio picker (Settings › Audio), badged \"NDI\", exactly like a USB input. They pop in and out of the list live as senders come online — just like OBS. Pick one and the AI listener starts transcribing it immediately.",
      "Works with any NDI sender — a mixer with NDI output, an NDI-enabled console, ProPresenter, OBS/DistroAV, or the free NDI Tools test patterns. Channel selection and gain work the same as for USB devices.",
    ],
  },
  {
    version: "0.1.114",
    date: "2026-07-30",
    headline: "Drag songs/media → playlist · .pro6/.pro7 in media wizard",
    highlights: [
      "Drag any song from the Songs panel directly onto the Playlist sidebar — a blue drop zone appears when you hover. Release to add. No more needing to right-click → Add to Playlist.",
      "Drag any media card from the Media Library directly onto the Playlist sidebar the same way.",
      "The Media Import wizard now also accepts ProPresenter files (.pro6, .pro7, .pro7x, .pro5) — drop them alongside images and videos. ProPresenter files run through the full parse pipeline and their songs are imported to your library. The Done step shows separate counts for media files and songs.",
    ],
  },
  {
    version: "0.1.113",
    date: "2026-07-30",
    headline: "Media Import Wizard · smarter rename · rename-to-playlist sync",
    highlights: [
      "Import button now opens a full 4-step wizard (Select → Preview → Upload → Done) instead of a bare file picker. Drag-drop files into the zone, review thumbnails before committing, watch per-file upload progress, and see the final count. Matches the song import wizard style.",
      "Rename is now much easier — a pencil icon appears on the right of the filename bar whenever you hover a media card. One click opens the inline rename input. The old double-click-on-10px-text flow is gone.",
      "When you rename a media file, the new name instantly appears everywhere — the media grid AND any playlist items that were already added from that file update in one server call.",
    ],
  },
  {
    version: "0.1.112",
    date: "2026-07-30",
    headline: "Media: one-click project + import button + rename · Playlist drag-to-reorder · AI provider resilience",
    highlights: [
      "Media library now projects in ONE CLICK — click any thumbnail to send it live immediately. Right-click for options (Send to Live / Add to Playlist / Rename). Previously required a double-click which operators kept missing during live services.",
      "Import button is now in the Media browser itself — no need to leave the operator console and go to the library page. Click 'Import', pick a file (JPG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV), and it uploads and appears in the grid immediately.",
      "Rename any media file inline — right-click → Rename, or double-click the filename label at the bottom of the thumbnail. Press Enter to save, Escape to cancel. Works directly in the operator panel.",
      "Playlist items can now be dragged to any position — grab the grip handle on the left of each item and drag it where you want. The order is saved to the server immediately. Right-click still works for Move Up/Down, Remove, and Duplicate.",
      "Groq AI outage resilience: when Groq is fully down (not just rate-limited), the system can now fall back to xAI as an emergency provider. Enable by setting GROQ_XAI_FALLBACK=true in your environment — rate-limit degradation is unchanged.",
      "PPTX conversion now shows a clear message on the cloud version ('not available here — use the desktop app') instead of a confusing LibreOffice spawn error. Nothing changed for desktop users.",
    ],
  },
  {
    version: "0.1.111",
    date: "2026-07-30",
    headline: "That empty black column with an X on the left of the sidebar — fixed",
    highlights: [
      "HardwarePanel (Audio + Screens slide-out drawer) was ALWAYS mounted in the DOM with a CSS transform hiding it off-screen when closed. Under certain measurement timing / CSS specificity conditions the transform failed to apply on mount, leaving the panel visible over the center area with only an X close button showing — the 'empty black column blocking the sidebar'. Now the panel only mounts when you actually click Audio or Screens, so the phantom render is physically impossible.",
    ],
  },
  {
    version: "0.1.110",
    date: "2026-07-30",
    headline: "What's New modal + update banner: stop nagging on every patch, add dismiss ×",
    highlights: [
      "What's New modal no longer auto-pops on patch bumps (0.1.109 → 0.1.110 etc). Only minor rolls (0.1.x → 0.2.x) auto-open it now — shipping many patches per hour was throwing the modal over the sidebar on every reload. Patches are still recorded silently; open Help → What's New to view them any time.",
      "Update banner now has an × button — click to dismiss for the current tag. Dismissal persists in localStorage; the banner stays hidden until a genuinely NEWER DMG tag lands on GitHub. Combines with the 0.1.108 shell-caught-up clear and the 0.1.109 three-tier open ladder into one banner that's actively useful when there IS an update and silent when there isn't.",
    ],
  },
  {
    version: "0.1.109",
    date: "2026-07-30",
    headline: "Update banner click now ACTUALLY opens the download page (was a silent no-op)",
    highlights: [
      "Clicking the violet 'Update available' banner did nothing on the current shell. Root cause: the IPC that opens external URLs has a hostname allowlist that didn't include github.com, so the call was silently rejected. Three-tier fix: (1) try the IPC path (works on future shells that include github.com in the allowlist — added), (2) fall back to window.open which routes through main's window-open handler and bypasses the allowlist (works on the current v0.1.102 shell TODAY), (3) if both fail, the URL is copied to your clipboard with a toast telling you to paste it in your browser",
      "Also added github.com + objects.githubusercontent.com (the release-asset CDN) to the Electron shell's URL allowlist for future DMG installs — same click, same result, but via the primary IPC path once you're on a newer shell",
      "Cmd+R gets the fix on your current shell — no DMG needed. Once you install the next DMG the IPC path just works without the fallback",
    ],
  },
  {
    version: "0.1.108",
    date: "2026-07-30",
    headline: "Two field bugs squashed: search palette falling off-screen + stale 'Update 0.1.102 available' banner that never cleared",
    highlights: [
      "Search palette (⌘K / the top-right search) was rendering off the right edge of the screen — the transform-based centering (`left: 50% + translateX(-50%)`) was being clobbered by Radix Dialog's own animation transform, leaving the palette anchored at 50% with no offset. Fixed by switching to margin-auto centering — no transform involved, works with any ancestor",
      "The violet 'Update 0.1.102 available — click to download the new DMG' banner was persisting FOREVER after you'd already installed 0.1.102. Root cause: the update-check poll only ever SET the banner state; when the shell caught up to the latest release on a subsequent poll, nothing cleared it. Now the poll actively resets to idle when you're up-to-date, and refreshes to the true latest version if a new release has landed since the banner first showed",
      "Both fixes are web-only — Cmd+R gets them",
    ],
  },
  {
    version: "0.1.107",
    date: "2026-07-30",
    headline: "Bible sermon repeats + voice translation-switch + resizable left panel + fatter transcript panel with the rich highlights back",
    highlights: [
      "Same verse re-cited later in the sermon now RE-PROJECTS reliably. Field report: preachers who kept saying 'Psalm 23:4' throughout a message only saw the first fire — the second, third, fourth citation silently dropped. Fixed: the anti-replay window is now a 3-second micro-cooldown per reference (was 5 minutes). 3s absorbs Deepgram's interim-then-final duplicate detections for a single utterance, but never blocks a real repeat 20 seconds or 20 minutes later. Bible only — songs keep the 5-minute policy since a worship set doesn't come back mid-service. Also hardened against two fast interims sneaking past the guard in the same tick — a synchronous in-memory ref now backs the sessionStorage map so the check is race-free",
      "Voice-driven Bible translation switching goes to 100%: every recognisable translation now triggers a switch when mentioned. Full 25-code list is understood — KJV, NKJV, NIV, ESV, NLT, NASB, ASV, WEB, AMP, MSG, CSB, HCSB, RSV, NRSV, CEV, GNT, ISV, NET, NCV, YLT, DRA, WBS, BBE, DARBY (plus GEN1599 Geneva). Unambiguous names like 'Holman', 'Contemporary English', 'New International', 'King James' now fire on ANY mention — no need for switch-intent phrasing. New GNT gospel-phrase guard: 'good news of the gospel', 'the good news is coming', 'good news that Jesus saves' no longer false-fire a GNT switch (mirrors the existing 'back in King James' day' guard). Bare 'GNT' abbreviation and 'the Good News Translation' both still fire correctly. The 'caught in a web of sin' / 'the message of hope' false-positive protection still catches ambiguous names (WEB, AMP, MSG, ASV, NET, 'the message', 'amplified' — those still need clear switch phrasing)",
      "Left panel is now resizable — drag the right edge to widen or narrow. Default width is now 250px (was landing at 160px on first launch which sat below the enforced minimum, so titles clipped). Width persists per machine. Fixed a drag-storm bug where the persist-on-change effect was writing to localStorage 60+ times per second while you dragged — now it writes ONCE at pointer-up",
      "Media library moved to the left sidebar as a proper section (click to open the Media browser in the center; click again returns to slides). Removed the redundant Media button from the topbar and the redundant Screens tab from the right sidebar — Screens + Audio now live only in the left Hardware section where you already set them up",
      "Live transcript panel: the fixed-height, resizable, minimize-to-a-bar chrome is back — and this time the RICH renderer is inside it. Yellow auto-correction highlights (with hover showing the original word), orange trigger-phrase highlights showing WHICH words fired a detection, mm:ss timestamps on every chunk, 30-second window, interim/final distinction, Clear button. Minimizing does NOT stop capture. Height persists per machine",
      "When you ask for a translation your church doesn't have loaded, PresentFlow still says so out loud: 'NLT not available — showing KJV instead' instead of silently doing nothing. Session translation stays on whatever's currently working so the projector never lies about what it's showing",
      "Cmd+R (web reload) picks up ALL of the above — no new DMG required. Electron shell code is unchanged in this release",
    ],
  },
  {
    version: "0.1.106",
    date: "2026-07-29",
    headline: "Desktop shell allowlist: added /api/themes, /api/sermon/ask, /api/pptx/convert, /api/health/{ai,deepgram} — same class of bug as 0.1.105",
    highlights: [
      "After 0.1.105 unblocked songs/media/imports, the shell was STILL 403ing on /api/themes (RightInspector's theme picker fires on every open), /api/sermon/ask, /api/pptx/convert, /api/health/ai and /api/health/deepgram. Any one of these throws the 'not available in desktop shell' toast because the fetch handler surfaces the response error verbatim. Added them all to the desktop allowlist.",
      "If you still see the toast: right-click the shell → Reload (Cmd+R may not be enough if the Electron page process is stale). If it survives that, open View → Toggle Developer Tools → Network tab, then reproduce — the failing URL tells us exactly which API path to add.",
    ],
  },
  {
    version: "0.1.105",
    date: "2026-07-29",
    headline: "Desktop shell can see its own songs, media, and imports again — the 'not available in desktop shell' toast fixed",
    highlights: [
      "Root cause: v0.1.99 removed /api/songs/list, /api/songs/library, /api/media/list, /api/imports/list, /api/media/presign, /api/audio/session-metrics, /api/bible/translations/status, and /api/bible/chapters from the desktop-only forced list (so admin web could use them too), but forgot to add them to the DESKTOP allowlist. Result: every operator component that fetched a song, a media asset, or a pptx import list got a silent 403 with a toast saying 'not available in desktop shell'. Songs library showed 0 songs. Media library was empty. Imports panel was empty. Now fixed by adding those paths back to the desktop allowlist — they were always meant to work on both surfaces.",
      "This unblocks the new ProPresenter 4-step import dialog end-to-end in the desktop shell — files can be uploaded via presign, songs land in the library, and the library refresh actually shows them.",
    ],
  },
  {
    version: "0.1.104",
    date: "2026-07-29",
    headline: "ProPresenter import in the desktop operator too — no more 'nothing works' on Pro7 drops",
    highlights: [
      "The operator console's Songs library Import button now opens the same polished 4-step ProPresenter dialog as the admin web page. Previously it ran a legacy path that read every file as UTF-8 text — which silently mangled Pro7 binaries and rejected .proBundle ZIPs, showing '0 songs imported' with no useful error. Now Pro7 / .proBundle / .pro7x / .pro / .pro6 / .pro5 all route through the same pipeline in both surfaces.",
      "Drag-and-drop onto the operator's Songs library now also detects .proBundle / .pro7 / binary .pro drops and opens the dialog pre-loaded with those files. Legacy .pro6 / .pro5 XML drops still take the fast one-shot path.",
    ],
  },
  {
    version: "0.1.103",
    date: "2026-07-29",
    headline: "One-click ProPresenter migration — songs and backgrounds, .proBundle + Pro7",
    highlights: [
      {
        text: "Import from ProPresenter is now a real 4-step flow: drop your .proBundle, scan → preview every song with an expandable lyric preview and duplicate badges, select what to bring in, watch it land. Available from the Songs library toolbar (top right of /library/songs).",
        tryItHref: "/library/songs",
        tryItLabel: "Try it",
      },
      "Pro7 (.pro / .pro7 / .pro7x) files are supported for the first time. Uses a pragmatic RTF+string-extraction parser that always produces something usable rather than the previous 'export as Pro6' skip — no more failed imports because a church is on the current version of ProPresenter.",
      ".proBundle ZIPs are unzipped in the pipeline: every .pro/.pro6 inside is parsed as a song, every image/video is uploaded to your Media library, and songs are linked to their matching background automatically (matched by filename hints inside the source file).",
      "Images now ship with a 320x180 JPEG thumbnail generated server-side, so the Media browser and per-song preview don't fetch full-res backgrounds. Requires the schema migration in docs/migrations/2026-07-29-add-song-background-and-media-thumb.sql — run it in Supabase before deploying.",
      "songs.default_background_asset_id column added — each song can now point to a media asset as its default projected background. Wired up during ProPresenter import; will be surfaced in the slide editor as a 'Change background' picker in a follow-up.",
      "Web-only deploy — Cmd+R gets everything.",
    ],
  },
  {
    version: "0.1.102",
    date: "2026-07-29",
    headline: "Quote a verse and PresentFlow finds it — plus a new native audio engine for rock-solid mixer capture (NEW DMG)",
    highlights: [
      "Phrase search is live: the preacher QUOTES a familiar line — 'for God so loved the world', 'the Lord is my shepherd' — without saying the reference, and a suggestion chip appears with a violet ✦ badge. The ✦ means 'quoted text, not a spoken reference' so you always know it's the AI's best guess. Phrase matches can NEVER auto-project (hard-capped below the auto-fire threshold at three separate layers) — tap the chip to load it, Shift-click to send live. 233 curated phrases covering the most-quoted verses plus African/RCCG staples",
      "Phrase search also works in the ⌘K palette and the Bible panel input — type part of a quote, pick the hit, the verse loads with related-verse cross-references",
      "New native audio engine (desktop app, needs this DMG): a dedicated macOS audio helper now captures your mixer via CoreAudio directly — stable device identity that survives USB replugs (no more 'wrong input after reconnect'), instant channel/gain changes without restarting capture, and hot-plug detection the moment a device appears. The proven ffmpeg engine from v0.1.80 stays as an automatic fallback — if the helper ever fails, capture switches over by itself and keeps running",
      "Zero configuration: the app picks the best engine automatically. Everything you already set up (input choice, channels, vocabulary, guardian) works identically on both engines",
      "Existing testers auto-update within the hour; fresh installs: right-click → Open on first launch (unsigned build)",
    ],
  },
  {
    version: "0.1.101",
    date: "2026-07-29",
    headline: "Error tracking (Sentry) + GitHub Actions CI — the two red items from the security review",
    highlights: [
      "Sentry wired in for client + server + edge runtimes with graceful no-op when SENTRY_DSN isn't set. To activate: create a free Sentry project, add NEXT_PUBLIC_SENTRY_DSN + SENTRY_DSN + SENTRY_ORG + SENTRY_PROJECT + SENTRY_AUTH_TOKEN to Vercel env vars, redeploy. Until then it's dormant weight — no runtime cost, ready when you are",
      "GitHub Actions CI now runs on every PR to main: typecheck (tsc --noEmit) is required, lint is soft-warning-only until the legacy noise gets cleaned up. Would have caught the last_active_at DB drift before it hit prod",
      "Rate limiting audit result: login (peekLoginIp + chargeLoginIp), signup (5/hr per IP), password reset (3/hr per IP + 3/hr per email), and /api/media/presign (60/min per user) are ALREADY rate-limited. My earlier claim that auth wasn't gated was wrong — the codebase is in better shape than I flagged",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.100",
    date: "2026-07-29",
    headline: "Desktop defaults dark, real brand mark in sidebar, layout fixes",
    highlights: [
      "Desktop shell now defaults to dark mode (booth / stage environments favour it), while the web admin keeps light as its default. Users can still opt out either way — the theme toggle stores their choice and the ff_theme cookie wins over the surface default",
      "Sidebar now uses the real PresentFlow brand mark (/brand/pf-logo-mark.png) in place of the generic sparkle. Wordmark stays visually consistent whether the panel is ivory or charcoal — 'Present' picks up the header text token, 'Flow' stays terracotta",
      "Settings page (web) layout fix — the 'Get the desktop app' card was rendering as two narrow vertical bars because the Link element was inline; added block class so the rounded border wraps the whole tile properly",
      "Subscriptions page (Billing in the sidebar) is now full-width. The BillingPanel had a max-w-3xl wrapper making the pricing cards look cramped on wider screens",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.99",
    date: "2026-07-29",
    headline: "Edit & delete on Media and PPTX imports, editable worship defaults",
    highlights: [
      "Media library: every media card now has a three-dot menu with Download, Rename, and Delete. Rename is inline — click Rename, edit the filename, press Enter (or click away) to save. Empty state got a friendlier message + clear CTA pointing to the upload button",
      "Imports (PowerPoint): every import row now has a trash icon to delete both the source file AND the converted slides from storage in one action. Church-scoped: you can only delete your own imports",
      "Church Profile: Default Bible translation and Blank screen color are now inline-editable on the Church Profile page (previously read-only display). One save button covers both, updates in a single round-trip",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.98",
    date: "2026-07-29",
    headline: "Light mode default, cleaner Settings, ad-hoc cleanup, beta notice",
    highlights: [
      "Light mode is now the default for first-time visitors. The web admin panel spends most of its time as a daylight planning surface — the warm ivory palette reads better as the first-visit experience than the dark stage look. Existing users who explicitly picked dark keep dark",
      "Sidebar branded header now respects light mode. Previously the top block stayed dark-gradient in light mode with white text on cream — hard to read. Now flips to a warm cream→terracotta wash with dark ink in light mode; keeps the near-black gradient in dark mode. The church logo/monogram tile adapts too",
      "Services page: every row now has a delete button (trash icon on the right). When you have multiple leftover 'Ad-hoc service' plans from prior operator sessions, a banner appears at the top with a 'Clean up ad-hocs' button that keeps the most recent one and removes the rest in a single click",
      "Settings landing (web) is no longer a duplicate link hub. Church Profile, Billing, Team, and Devices already live in the sidebar; the Settings page now just points to the desktop-app download and a note directing you to the sidebar for the rest",
      "Billing page: added a Beta notice at the top of the pricing card ('Your current plan is our beta / pilot access — no card required'), and fixed the layout so the RECOMMENDED badge no longer clips into the 'Pricing that fits your Sunday' heading at narrower widths",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.97",
    date: "2026-07-29",
    headline: "Billing goes premium — Pro tier now visibly stands out",
    highlights: [
      "Billing page is now full-width — the three pricing cards span the whole content area instead of being squeezed into a max-w-2xl column",
      "Pro tier gets Apple-style differentiation: taller card (extends above and below the other two via negative-margin/deeper padding), gradient border (terracotta → gold → terracotta), warmer glow shadow, larger price (5xl vs 3xl), and a bolder Recommended badge in filled terracotta",
      "PowerPoint (.pptx) import now works from the web too — /api/pptx/convert was on the desktop-only allowlist by accident; unblocked and still auth-gated + church-scoped",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.96",
    date: "2026-07-29",
    headline: "Collapsible sidebar sections + honest dashboard status",
    highlights: [
      "The Content and Admin sidebar sections are now collapsible with a chevron on the group label. Content defaults open, Admin defaults collapsed; state persists per-user in localStorage — so if you like Admin folded away, it stays folded",
      "Dashboard: Audio Input, Projector Setup, and AI Health cards no longer show orange warning pills for things you can't fix from the web. They now read 'Configure in desktop' as neutral info — the desktop app is where those actually get set up",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.95",
    date: "2026-07-29",
    headline: "Web admin can actually upload logos, media, songs, and themes now",
    highlights: [
      "Fixed the 'This action is only available in the Present Flow desktop app' toast that fired when admins tried to upload a church logo or open the media library on web. Root cause: the middleware had /api/media/*, /api/imports/*, /api/themes, /api/songs/library|list, /api/bible/*, /api/search all listed as desktop-only surfaces — but every one of those is an admin surface too. Removed them from the desktop-only list; they stay auth-gated at the server-action level, so no security surface was widened",
      "Only /api/pptx/convert and /api/sermon/match remain restricted (both are genuinely heavy / desktop-triggered flows)",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.94",
    date: "2026-07-29",
    headline: "Cross-device sync now covers songs, plans, branding & team — plus Vercel Analytics wired on prod",
    highlights: [
      "The web admin's Realtime bridge (the thing that keeps two open tabs on two machines in step) now watches songs, service plans, service items, branding/logo settings, and team member role/name changes — not just themes. Edit a song title on your laptop and the admin open on the church desktop refreshes within a Realtime hop, no F5 needed. Chatty item edits are debounced to 500ms so a burst of drag-reorders coalesces into one refresh",
      "Same-machine BroadcastChannel (the zero-latency operator path) is untouched — Realtime is strictly additive fan-out for cross-device. If Supabase Realtime env is missing (local dev without keys), the bridge quietly no-ops and nothing breaks",
      "Vercel Web Analytics + Speed Insights now enabled on the production deployment (skipped on preview and local so noise stays out). The Vercel dashboard should flip both from 'Not Enabled' to green after this deploys",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.93",
    date: "2026-07-29",
    headline: "Softer admin palette — warm ivory instead of stark white, deeper terracotta instead of bright orange",
    highlights: [
      "The admin panel background moved from pure #FFFFFF to a warm ivory (#F5F1EA) so the surface reads as premium paper rather than a lit lightbox — easier on the eyes for a Sunday-morning setup session and it lets the brand accent breathe instead of fighting the background",
      "Brand accent dropped from #E8742A to #B85826 (deeper terracotta). Same warm orange family, but calmer and more mature — reads as a considered brand mark rather than a look-at-me CTA. Applied across the sidebar wordmark, onboarding splash, buttons, focus rings, and the signature brand gradient",
      "Also fixed the /dashboard 500 that hit prod earlier — root cause was the users.last_active_at column missing from prod Supabase (Bucket 5 migration only ran locally). Applied via SQL to the live DB; no code change needed",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.92",
    date: "2026-07-29",
    headline: "New roles: Volunteer and Viewer",
    highlights: [
      "Volunteer role: can operate services (run playlists, fire slides live, add scripture/song/media to a plan) and view the whole library — but CANNOT edit or delete songs, upload media, or change themes. Perfect for the Sunday-morning helper who runs the desk but shouldn't be reshaping the song library",
      "Viewer role: read-only across services, songs, media, themes, and sermon archive. Good for a pastor's assistant or an oversight account that needs visibility without any write access anywhere",
      "Capability-based gating is now enforced on the server: every song/media/theme write action checks the caller's capability, and Viewer is blocked from touching service plans too. The new roles are real permissions, not cosmetic labels — a Viewer or Volunteer trying to delete a song gets bounced with an insufficient-role redirect",
      "Supabase security checklist added under docs/ — practical steps to close the dashboard security-email findings (leaked-password protection, OTP expiry, MFA methods, function search_path) and an honest explainer of why we enforce tenant isolation at the app layer, not via RLS",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.91",
    date: "2026-07-29",
    headline: "Say 'read that in NLT' and it switches — plus Screens/Audio in the left sidebar and ProPresenter import",
    highlights: [
      "Bible translation by voice: the preacher says 'switch to NIV', 'let's read the King James Version', or even 'make we read am for NLT' (pidgin understood) — and PresentFlow switches. In AUTO mode it also re-renders the verse currently on the projector in the new translation (same verse, new text) and toasts what happened; in co-pilot mode you get a tap-to-confirm prompt. Every verse detected afterwards uses the new translation, and the Bible panel dropdown follows",
      "Built carefully so sermon talk can't false-fire: 'caught in a web of sin' will NOT switch to the WEB translation, 'the message of hope' will NOT switch to MSG, 'back in King James' day' does nothing — ambiguous names need clear switch phrasing ('read', 'switch', 'version', 'translation'). Unambiguous codes like NIV/KJV/NLT work bare. 10-second cooldown between switches. 34 automated language tests",
      "HARDWARE section in the left sidebar: Screens and Audio now open as roomy 360px slide-out panels from the left — the once-per-service hardware setup no longer hides in the right-sidebar popover (which still works too; same settings, two doors)",
      "ProPresenter import: Import button + drag-and-drop in the Songs browser accepts .pro6/.pro5 files, decodes the lyrics with sections intact (Verse/Chorus), skips duplicates, respects your song limit with an honest message, and tells ProPresenter 7 users exactly what to do (export as Pro6). Imported songs are immediately available to the AI song detector",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.90",
    date: "2026-07-28",
    headline: "Timers & messages now ACTUALLY show on the projector — plus the app reopens exactly where you left off",
    highlights: [
      "Timers on screen for real: Settings › Timers now has 'Show on screen' with a position picker (corners, lower-third, center). The countdown renders live on the projector AND stage display, ticks every second, survives closing the settings popover, and re-appears within 1 second if the output window reloads mid-service. Wall-clock anchored — a laptop sleep doesn't freeze it behind",
      "Messages on screen for real: type a message, pick a position, Show — it overlays ON TOP of the current verse/lyric with a dark readable panel. Auto-dismiss after a set duration or hide manually. If the operator machine dies, outputs clear stuck overlays within 5 seconds instead of pinning them on the projector all service",
      "'Allow on web' is now honest: messages only reach the public livestream output when that box is checked — private operator notes ('wrap up', 'collect child #14') stay in the building",
      "Reopen where you left off: quit and relaunch → same playlist (was already saved), same preview position (item + slide, restored to PREVIEW only — nothing fires to live by itself), same sidebar tab, AI resumes with the existing visible toast. Saturday-night prep now survives to Sunday morning (36-hour window, plan-matched)",
      "Nothing auto-fires on restore, stale overlays can't resurrect from a previous session, and all overlay messages are validated end-to-end (51 automated checks pass)",
      "Web-only deploy — Cmd+R gets everything",
    ],
  },
  {
    version: "0.1.89",
    date: "2026-07-28",
    headline: "Default themes + last-active on the team page",
    highlights: [
      "You can now mark one theme as the church default from /library/themes — click the star icon on any card. The default gets an amber 'Default' pill in the corner and its border tints amber. Setting a new default automatically unsets the previous one (transactionally, church-scoped). Downstream: new songs will apply this theme on creation once the operator projector picks up the flag",
      "Team page rows now show 'Active Nm ago' next to each member — bumped on every authenticated request (throttled to one write per 5 min per user, so no hot-write on prefetch). Was: no visibility into who's been logging in and who's stopped. Members who've never signed in since this rolled out show 'Never'",
      "Schema note: two additive columns went live — users.last_active_at (nullable timestamp) and themes.is_default (boolean default false). Both default-safe so existing rows keep working without backfill. Migration already applied to the production Supabase database",
    ],
  },
  {
    version: "0.1.88",
    date: "2026-07-28",
    headline: "JPD post-session fixes — clicks always land, projector text never tiny, and AI never LOOKS like it turned off",
    highlights: [
      "Song/slide clicks are now bulletproof: the old go-live debounce silently DROPPED a click on a different slide within 250ms of the last one (click verse 1, quickly click verse 2 → verse 2 highlighted but never went live). Now only a same-slide repeat is suppressed. Also fixed: slightly-shaky clicks turning into dead drags (drag threshold widened), and clicks right after reordering slides accidentally firing to live (now they select but don't fire for 120ms)",
      "Projector text is NEVER tiny anymore: the output had a fixed 24-pixel minimum that ignored screen size — 2% of a 1080p projector, unreadable from the back. Now the floor is 3% of the actual display height (~32px on 1080p, scales up on 4K), sizes step down in bands by text length, and body text is always bold. If a slide is SO long it can't fit even at the floor, it renders at the readable floor and the console suggests splitting the slide",
      "The 'AI turned off' mystery solved: AI never actually turned off — after 15 seconds of silence (prayer, communion) the status dot went RED with 'AI pipeline down', so operators toggled it. Silence now shows an amber 'quiet' dot with 'AI is still ON — the room is silent right now. It will resume the moment speech returns.' Red is reserved for a genuinely dead pipeline",
      "Real bug found underneath: the audio bridge was quietly restarting its transcription connection every ~30 seconds during silent stretches (a stall-detector misreading silence as a wedged connection), which clipped the first words when the preacher resumed. It now only declares a stall when actual voiced audio was flowing, recognizes ANY response from the transcription engine as alive, and won't restart more than once per 5 minutes",
      "Audio Guardian tuned for liturgy: mere silence no longer triggers input-switching — a 10-minute communion won't make PresentFlow hunt for a different microphone. Full self-heal (including auto-switching inputs) still fires instantly on real capture errors and device loss",
      "Auto-pause is now strictly opt-in and honestly labeled ('Auto-pause capture during long silence — not recommended for live services')",
      "Web + audio-bridge deploy — Cmd+R gets everything, no reinstall",
    ],
  },
  {
    version: "0.1.87",
    date: "2026-07-28",
    headline: "Sync indicator in the topbar — green/amber/red dot with 'last synced' status",
    highlights: [
      "New small pill in the topbar (right side, next to theme toggle) that reads 'Synced · Nm ago' with a coloured dot: green when everything's fresh, amber when actively syncing, red when the browser reports offline. Hover for the full tooltip. First slice of the web ↔ desktop sync work — the UI surface is in place today, real Supabase Realtime hooks will drive the state in a later commit",
      "For now the state auto-reacts to browser online/offline events, so if your Wi-Fi drops you'll see the pill flip to red immediately without a page reload. Any component can dispatch window.dispatchEvent(new CustomEvent('presentflow:sync-state', { detail: { state: 'syncing' } })) to drive it — the wiring surface is documented in SyncIndicator.tsx",
    ],
  },
  {
    version: "0.1.86",
    date: "2026-07-28",
    headline: "Theme editor now supports video backgrounds + inline image/video upload",
    highlights: [
      "Themes › Background: new 'Video' type joins Solid / Gradient / Image. Autoplay-muted-loop video backgrounds render in the live 16:9 preview and (once the operator projector picks up the field) on real slides. Silent by design — a projector never wants audio",
      "New shared BgAssetPicker in the editor: paste a presigned URL OR upload a new image/video directly from the theme editor without leaving to the Media library first. Uploads land under {churchId}/media/... via the existing /api/media/presign flow, so they're immediately reusable from anywhere else in the app",
    ],
  },
  {
    version: "0.1.85",
    date: "2026-07-28",
    headline: "Import wizard streams real parse progress + lists duplicate titles up front",
    highlights: [
      "The migration wizard now shows a real per-file progress bar during parse. Three stages stream from the server as they happen — Parsing files, Uploading media, Checking for duplicates — with the current filename shown below the bar. Was a static 'Parsing…' spinner with no visibility. Under the hood, /api/imports/parse now streams NDJSON progress events (one JSON per line) and the client reads them via fetch().body.getReader()",
      "Review step now surfaces the exact list of duplicate titles that finalize will skip, not just a count. New 'Duplicates' stat tile in the summary + an amber-tinted expandable card listing every duplicate title with a note explaining that finalize won't overwrite existing lyrics. If you want a second copy, rename in your source file and re-import",
    ],
  },
  {
    version: "0.1.84",
    date: "2026-07-28",
    headline: "Custom Vocabulary — teach the AI your pastor's name, Nigerian names, and song titles it keeps mishearing",
    highlights: [
      "New 'Custom Vocabulary' section in Settings › Audio (plus a quick-add row in the sidebar Audio popover): add up to 100 names, places, and song titles the AI keeps getting wrong — pastor names, your church's name, Yoruba/Igbo names, anything Deepgram mangles. Terms are sent to the speech engine as keyterm prompts when the listener starts, so it HEARS them correctly instead of us correcting after the fact",
      "This attacks the mishears at the source: overnight field logs showed corrections like 'Psalm 82' → 'Psalm 23' happening AFTER detection. With the right terms in your vocabulary, the first transcript comes out right. Terms apply on the next listener (re)start — adding a term schedules one automatically",
      "Multi-word terms supported ('Pastor Adeboye', full song titles). Case-insensitive dedupe, 100-term cap (the speech engine's limit). Your list stays on this machine",
      "Under the hood: AI helper calls now auto-switch to a fast fallback model the moment the primary hits a rate limit, remember when the limit resets, and route straight to the fallback until then — no more silent AI-assist dropouts during heavy sessions. If both models are limited, features degrade gracefully exactly like before",
      "Web + audio-bridge deploy — Cmd+R gets you everything, no reinstall",
    ],
  },
  {
    version: "0.1.83",
    date: "2026-07-27",
    headline: "Faster speech-to-screen projection — live transcription and AI-detected verses now reach the output sooner and recover cleanly from audio interruptions",
    highlights: [
      "Verse detection now runs on Deepgram's live interim transcript stream instead of waiting for the speaker to pause and a final transcript to arrive. The Live Transcript panel shows the first interim immediately, so operators can see that PresentFlow is hearing the room in real time",
      "Audio now travels to the bridge as fixed 10 ms binary PCM packets, removing base64 conversion and large-buffer delays. Native ffmpeg capture also uses low-buffer and low-delay flags",
      "AI-detected verses use an immediate one-shot output transition while preserving the operator's configured transition for manual slides. Repeating the same reference republishes it correctly to local and paired outputs",
      "Deepgram sessions now use supported VAD and utterance-end signals, a 3–5 second keepalive cadence, bounded connection setup, faster reconnect backoff, and safe cancellation of stale reconnects",
      "Electron operator and projector windows no longer throttle in the background, and the audio watchdog resumes a suspended AudioContext every second",
    ],
  },
  {
    version: "0.1.82",
    date: "2026-07-27",
    headline: "Follow Mac system input — PresentFlow now captures whatever input the Mac itself is using, and tracks it live when you change it",
    highlights: [
      "New pinned option at the top of the input list: '🖥 Follow Mac system input' (orange SYSTEM tag). When active, PresentFlow captures whatever input is selected in macOS System Settings → Sound → Input — SQ over USB, NDI, Blackmagic, Bluetooth, any interface. Change the input in Mac Settings and PresentFlow follows within seconds, automatically rebuilding capture onto the new device. The subtitle always shows what it's currently resolved to",
      "Auto-pick upgraded: on a fresh setup, if the Mac's system input is already a mixer or NDI feed, PresentFlow defaults to follow-mode — so a correctly-configured Mac Studio needs ZERO clicks in PresentFlow. If the system default is just the built-in mic, the ranked direct pick (mixer first) still applies",
      "New setup guide: 'Playback apps (Logic Pro, Spotify, QLab…)' — capturing audio from apps requires BlackHole (free loopback driver): create a Multi-Output Device so you still hear playback, point the app's output at it, then pick BlackHole in PresentFlow or set it as the Mac input and use follow-mode. Also added a Blackmagic/ATEM program-audio guide",
      "Setup guides now surface for native-mode device picks too (previously browser-only) — select the SQ natively and the Allen & Heath USB routing guide appears right below",
      "Resilience: if the system default can't be matched to a native device (transient enumeration failure, device just unplugged), capture falls back to the last-known device rather than dying — and the Audio Guardian's self-heal ladder from v0.1.81 covers a truly dead source",
      "All web-deployed — Cmd+R on the v0.1.80 desktop app gets everything. No reinstall",
    ],
  },
  {
    version: "0.1.81",
    date: "2026-07-27",
    headline: "Audio Guardian + unified input list — PresentFlow now picks the best input itself, watches it constantly, and self-heals when it goes silent",
    highlights: [
      "Confirmed at JPD: v0.1.80's native capture works with the Allen & Heath SQ over USB. This release builds on it: in the desktop app, the input list is now the NATIVE Mac-level list — every input macOS sees (SQ, NDI, Blackmagic, BlackHole, mics, Bluetooth) shows up ranked and tagged: MIXER (green), NDI (purple), VIRTUAL (gray), BT (blue)",
      "Auto-pick on launch: if you've never chosen an input, PresentFlow picks the best one automatically (mixers first, then NDI, then virtual, then mics, Bluetooth last) and toasts what it chose and why. An AUTO-PICKED badge shows on the selection until you manually click a different one. Your choice is remembered per device name and survives USB replugs",
      "Audio Guardian — a watchdog that never lets audio stall silently. If the signal goes quiet for 20 seconds it works a ladder: (1) restart capture on the same device, (2) rescan devices and re-resolve yours by name, (3) probe every OTHER input for live signal and switch to the best one that's actually producing sound (with a toast telling you it switched), (4) only if ALL of that fails, a red ⚠ AUDIO chip appears — clicking it takes you straight to the audio settings. When signal recovers, the chip clears and you get an 'Audio recovered' toast",
      "Native channel auto-detect: for multi-channel devices (like the SQ's 32 USB channels), the Auto-detect vocal button runs a 10-second scan and recommends the strongest active channel with one-click accept. If no clear winner (nobody was speaking), it says so and shows a manual channel grid right there — click the channel that lights up",
      "Guardian never fights the operator: it stands down for 30 seconds after any manual input change, runs at most one full recovery ladder per 5 minutes, and only arms in native mode — browser mode (web app) is unchanged",
      "All of this is web-deployed — if you're on the v0.1.80 desktop app, Cmd+R gets you everything. No reinstall needed",
    ],
  },
  {
    version: "0.1.80",
    date: "2026-07-27",
    headline: "Native audio capture (ffmpeg) — bypasses Chromium's getUserMedia entirely for pro USB mixers like Allen & Heath SQ. REQUIRES NEW DMG INSTALL.",
    highlights: [
      "Root diagnosis after multiple JPD field sessions with a Mac Studio + Allen & Heath SQ-5 mixer: OBS Studio, Logic Pro, and macOS System Settings all captured audio from the SQ successfully. Only PresentFlow got silence. That's a Chromium problem, not a PresentFlow bug — Chromium's audio input backend is documented as unreliable with pro multi-channel USB audio interfaces (>2 channels, non-consumer sample-rate/channel-map combos). No amount of getUserMedia constraint tweaking will fix it",
      "The fix: PresentFlow's Electron desktop app now captures audio via a NATIVE ffmpeg subprocess in the main process, using macOS CoreAudio (avfoundation) or Windows DirectShow directly. Same code path native apps use. PCM bytes stream from ffmpeg's stdout → IPC → renderer → Deepgram WebSocket. Chromium's audio stack is not involved at all",
      "New Capture Mode toggle in the sidebar Audio settings: Auto / Native / Browser. Auto = native when the Electron shell supports it, else browser. Native shows a separate 'Native input device' picker listing devices exactly as OBS sees them (via ffmpeg's device enumeration, not Chromium's filtered view). Includes ffmpeg-static binary bundled with the app (~50MB unpacked)",
      "Auto-restart on subprocess crash with exponential backoff (2s, 4s, 8s, 16s, 30s, 5 attempts). Silent recovery — chunks resume flowing after gaps. If the native path fails entirely (missing binary on unsupported OS, permission denied), automatic fallback to browser mode preserves v0.1.79 behavior — no regression",
      "Web app users (chrome.faithflow-ai.vercel.app) see 'browser active' — native capture is only available in the desktop app because it requires bundling a native binary. Web users get the existing browser-mode path unchanged",
      "IMPORTANT: this requires a new DMG install (electron main process + native binary change). Web changes alone can't ship native capture. Grab the v0.1.80 DMG when it's cut and reinstall on the Mac Studio at JPD — then the SQ will finally work",
    ],
  },
  {
    version: "0.1.79",
    date: "2026-07-27",
    headline: "Mixer detection now matches by USB Vendor ID (not just label) — SQ, X32, TF etc. detected even without vendor drivers, and 'No audio' toast is now actually diagnostic",
    highlights: [
      "Field bug from JPD live: the auto-mixer-mode fix shipped in v0.1.78 didn't fire for the Allen & Heath SQ because macOS labeled it 'Default - SQ - Audio (22f0:0019)' — the regex was looking for 'sq-' (SQ immediately followed by hyphen) which doesn't match 'SQ - Audio' (spaces around the hyphen). Broadened to word-boundary `\\bsq\\b` so 'SQ', 'SQ-5', 'SQ 5', 'SQ - Audio' all match. Same fix for Qu-series",
      "Deeper engineering: mixer detection now also matches on USB Vendor ID prefix, which is UNIVERSAL across a manufacturer's product line and doesn't depend on how macOS names the device or whether the vendor's driver is installed. Added VIDs: 22f0 (Allen & Heath — SQ, dLive, Qu, ZED), 1397 (Behringer/Midas — X32, XR18, M32, MR18, UMC), 0499 (Yamaha — TF, MG, DM, AG), 194f (PreSonus — StudioLive, AudioBox), 05fc (Harman/Soundcraft — Ui, Signature), 1a19 (SSL). If your device label contains a VID prefix like (22f0:...) PresentFlow will treat it as a mixer regardless of the rest of the label",
      "The 'No audio detected for 15s' toast used to say 'check the mixer channel isn't muted, cable is plugged in, and you've picked the right input' — three generic checks. Now it's DIAGNOSTIC: 'SQ - Audio: 32ch @ 48kHz negotiated, 0 signal. PresentFlow IS receiving multi-channel audio but every channel is silent. Most likely: your mixer isn't routing anything to USB Sends. Open the mixer's USB Send menu (Home → Setup → I/O → USB on Allen & Heath SQ) and route your vocal mic to USB.' The message branches on the negotiated channel count — 1ch guidance differs from >1ch guidance because the fix path differs",
      "Combined effect: on the JPD SQ, opening PresentFlow will now (a) auto-detect it as a mixer via the 22f0 VID, (b) auto-switch Source Type to Mixer/Interface, (c) negotiate 32 channels, (d) sum them all to mono via the v0.1.77 worklet. If your SQ has ANYTHING routed to a USB Send, PresentFlow will hear it. If your SQ has nothing on USB, the diagnostic toast now tells you that explicitly instead of generic 'check the cable'",
    ],
  },
  {
    version: "0.1.78",
    date: "2026-07-27",
    headline: "Per-channel USB mixer picker — click the exact channel carrying the pastor's vocal, with live meters and auto-detect",
    highlights: [
      "Field-critical from JPD live: an Allen & Heath SQ was selected as the input device but no audio was reaching the AI listener. Root cause: 'Source Type' was stuck on 'Microphone' (forcing DSP ON + channelCount:1), so out of 32 SQ USB channels only channel 1 came through — silent, because the vocal isn't on channel 1 by default. PresentFlow now auto-switches Source Type to 'Mixer / Interface' when the picked device matches a known mixer (SQ, X32, TF, StudioLive, TouchMix, XR18, Ui, etc.) and toasts to explain why",
      "New channel-grid picker: when you pick a multi-channel device, an inline grid appears with a live meter for every channel (updated 20fps). Click the channel that lights up when the pastor speaks — that's the one PresentFlow will send to Deepgram. Orange border = SELECTED, green dot = active signal in the last 200ms. Sidebar popover shows 2 per row, full /settings page shows 4 per row with peak + vocal-ratio readouts",
      "'Auto-detect vocal channel' button: opens a 10-second scan that samples every channel with an FFT and ranks them by vocal-band energy (300-3400Hz) + how consistently active they are. At the end you get a recommendation ('Ch 3 looks like your vocal') with a one-click accept. If none of the channels had usable signal (e.g. no one was speaking), it says so and lets you retry",
      "Mixer setup guides built-in: pick your SQ / X32 / Yamaha TF / Soundcraft Ui / PreSonus StudioLive / QSC TouchMix / Behringer XR18 / M32 / BlackHole / NDI Virtual Input and PresentFlow shows the exact steps to route your vocal mic to a USB channel it can see. Sidebar defaults collapsed (space-constrained), settings page defaults open",
      "Modes: 'Sum all' (current v0.1.77 fallback — combines every channel to mono, catches signal on ANY routed channel), 'Mono' (one specific channel), 'Stereo' (a channel pair for LR bus / stereo interface). Per-device gain slider (-24 dB to +24 dB) writes only on release — mid-service slider drags won't churn the pipeline",
      "Per-device persistence: your channel choice, mode, and gain are remembered per mixer. If your SQ gets a new deviceId after a USB power-cycle or hub renumber (macOS/Windows behavior), PresentFlow now falls back to matching by device LABEL and migrates the pref forward — you don't lose your channel pick after a reconnect",
      "Sum-all fallback preserved: if you don't pick a channel, behavior is identical to v0.1.77 — all channels summed to mono. Multi-channel capture is only opened when the grid is visible, so the picker doesn't burn CPU when you're just opening the audio menu to check device names. Device-list refresh now listens for USB plug/unplug events so a mixer you plug in mid-service shows up in the picker without needing a manual Refresh click",
    ],
  },
  {
    version: "0.1.77",
    date: "2026-07-26",
    headline: "Multi-channel mixer USB support — Allen & Heath SQ, Behringer X32, Yamaha TF etc. now capture audio on ANY routed channel",
    highlights: [
      "Field-critical from JPD live: Allen & Heath SQ mixer connected via USB was showing as selected in PresentFlow but no audio was reaching Deepgram. Root cause: professional digital mixers (SQ, X32, TF, StudioLive, Soundcraft Ui, QSC TouchMix, Midas M32) send up to 32 channels over USB, and Chromium defaults to `channelCount: 1` which captures channel 1 only — usually silent because the main mix / vocal bus is routed to a different USB channel",
      "Fix: when Source Type is 'Mixer / Interface' (the default), PresentFlow now requests up to 32 channels via `getUserMedia({channelCount: {ideal: 32}})`. The browser negotiates down to whatever the device actually supports — 1 for a mic, 2 for a stereo interface, up to 32 for an SQ. All received channels get summed to mono in the audio worklet BEFORE downsampling/quantizing, so we catch signal on ANY routed channel without the operator having to know which USB channel carries the vocal. Signal is normalized by 1/sqrt(N) to prevent clipping",
      "For 'Microphone' source type (bare room mic), we keep `channelCount: 1` because DSP paths (echo cancellation, noise suppression, auto-gain) get confused by ambiguous multi-channel negotiation. Single-channel USB mics and Bluetooth devices unaffected — they still receive 1 channel and the sum is a no-op",
      "Trade-off: on a multi-channel mixer where the vocal is on ONE specific channel, this sum-all approach also includes any instruments/room sounds routed to other channels. Fine for most preacher-mic setups; if you need per-channel selection (only vocals, ignore band mix), that's coming in a follow-up ship with a proper channel picker UI",
    ],
  },
  {
    version: "0.1.76",
    date: "2026-07-26",
    headline: "Right-sidebar Settings › Audio popover is REAL now — was a 'coming soon' placeholder for months",
    highlights: [
      "Field-critical for JPD: the Audio tab in the right-sidebar Settings popover (⚙ icon → Audio) was a 'Audio playlist — coming soon' stub. Operators mid-service kept opening it expecting to find their audio-input picker and finding nothing. That was a bug — the popover was showing the wrong AudioTab component (the audio-playlist-feature placeholder instead of the audio-settings surface). Fixed",
      "The popover now has: Input device dropdown with NDI/MIXER/BT tags and sort order (NDI first, MIXER second, Bluetooth third, everything else last), Source Type toggle (Mixer / Interface ↔ Microphone) with an inline explanation of what the DSP toggle does, Run diagnostics button, ↻ Restart button, and an NDI helper if no NDI device is detected. Same visual language as the full Settings page picker",
      "Bluetooth devices (AirPods, Beats, Jabra, Bose, Sony WH-1000, Sennheiser Momentum, Galaxy Buds) now get a blue BT tag so the operator knows they'll work but with 100-300ms latency — verse detection will be slightly delayed. Not blocked, just labeled",
      "Advanced audio settings (voice commands, mic boost slider, auto-pause, hold-during-song) still live in the full /settings page — link at the bottom of the popover for anyone who wants them",
    ],
  },
  {
    version: "0.1.75",
    date: "2026-07-26",
    headline: "MIXER tag in audio picker + diagnostics — instantly spot USB interfaces, mixer USB-outs, and BlackHole",
    highlights: [
      "The Audio Input picker and Audio Diagnostics scanner now show a green MIXER tag next to any device that looks like a clean feed source: Focusrite Scarlett / Clarett, Behringer UMC / U-Phoria / X32 / XR18, PreSonus AudioBox / StudioLive, MOTU, Apollo, Universal Audio Volt, Audient, RME, Apogee, Steinberg UR-series, Mackie Onyx, Roland Rubix, Zoom LiveTrak / H-series, Yamaha TF / MG, Allen & Heath SQ / DLive / Qu, Midas M32 / MR18, Soundcraft Ui, QSC TouchMix, generic 'USB Audio CODEC' (typical mixer USB out) — AND BlackHole (loopback bridge)",
      "Same purple NDI tag from v0.1.74 continues to identify NDI Virtual Input devices. Combined: at a glance you can see which item is your church's mixer feed vs which is a bare mic that would give you room echo + HVAC noise",
      "MIXER-tagged devices sort ahead of untagged ones in the picker (NDI first, MIXER second, then everything else). If you plug in a USB interface, it lands near the top of the list — no scrolling to find it in a long device list",
    ],
  },
  {
    version: "0.1.74",
    date: "2026-07-26",
    headline: "NDI audio support — real detection + tag + install helper; killed the misleading placeholder NDI options",
    highlights: [
      "The Audio Input picker's old 'NDI Audio (Routed) (Default)' + hardcoded NDI entries (JPDBROACASTCOMP etc.) have been removed. They were UI theater — selecting one silently captured the DEFAULT mic instead of NDI audio. Anyone at a church that thought they were using NDI through PresentFlow via those entries was actually just capturing whatever mic macOS defaulted to. Fixed",
      "Real NDI audio path: install NDI Tools (free, from ndi.video/tools) → open NDI Virtual Input → pick your church's NDI source. It'll appear in PresentFlow's Audio Input picker as a real device labeled 'NDI …' with a purple NDI tag next to it. Picker sorts NDI devices to the top. Audio Diagnostics scanner shows the same tag, so operators immediately know which entry is the NDI feed vs a mic",
      "If no NDI device is present in the list, both the picker and the diagnostics scanner now show a helpful 'Using NDI at your church?' hint with a link to ndi.video/tools. Was previously silent — operators had no way to know NDI support existed",
    ],
  },
  {
    version: "0.1.73",
    date: "2026-07-26",
    headline: "'Failed to fetch' toast fixed — actionable message + auto-dismiss on recovery, no more sticky-forever",
    highlights: [
      "When the audio-ticket call couldn't reach Vercel (brief network flap, deploy mid-swap), the raw native `TypeError: Failed to fetch` was surfacing as a bare 'Failed to fetch' toast that stuck on screen forever. Fixed: transient network errors now show 'AI listener can't reach the server — check your internet, will retry automatically' with a 10s auto-dismiss, AND the pipeline schedules a reconnect automatically",
      "Any audio error toast now auto-dismisses the moment the underlying state clears (reconnect succeeded, operator fixed the thing). Actionable errors (permission denied, no audio device, etc.) still stick indefinitely because they need operator action; transient errors clear themselves",
    ],
  },
  {
    version: "0.1.72",
    date: "2026-07-26",
    headline: "New-version notice banner — you'll now get pinged the moment a fresh DMG is out",
    highlights: [
      "Unsigned tester builds can't use the built-in macOS auto-updater (Squirrel refuses signature-less swaps at the OS level — pending Apple Developer enrollment). Until then, the app now polls GitHub every 30 min and shows a violet banner at the top of the operator when a newer release is available: 'Update X.Y.Z available — click to download the new DMG'. Click opens the release page in your browser; download the DMG for your Mac, right-click → Open on first launch, done",
      "No behavior change if you're already on the latest version — banner only appears when GitHub actually has something newer than the version you're running",
      "Ships to every existing tester on next Cmd+R / app relaunch (this is a web change served from Vercel, not a shell change — no reinstall required to get the banner itself)",
    ],
  },
  {
    version: "0.1.70",
    date: "2026-07-26",
    headline: "Docs cut — surfaces the Bible parser fuzzy spoken-form fix that quietly shipped in v0.1.69",
    highlights: [
      "No new code in this DMG — v0.1.70 is a documentation bump so the What's New modal correctly credits the parser fuzzy spoken-form fallback ('filippians four thirteen' → Philippians 4:13) that landed in v0.1.69's binary but wasn't listed in v0.1.69's release notes. See the v0.1.69 entry below for the full details of both fixes now attributed to that release",
      "If you're upgrading from ≤0.1.68 straight to 0.1.70, you'll see three real fixes in the modal: the song hard-debounce (v0.1.69), the parser fuzzy spoken-form fallback (also v0.1.69, now properly credited), and this docs bump (v0.1.70). No behavior change vs v0.1.69",
    ],
  },
  {
    version: "0.1.69",
    date: "2026-07-26",
    headline: "Song auto-fire hard debounce — final fix for the 'GTF → LIVE' repeat toast loop",
    highlights: [
      "v0.1.68's freshness + id-dedup checks in the outer effect weren't enough — Deepgram's interim → final → whisper cascade produces 3-5 new suggestion IDs for a single utterance, each with a genuinely fresh ts + new id, so both outer gates let them through and autoLiveSong got called repeatedly. Now: hard 5s debounce PER SONG at the entry of autoLiveSong itself. Doesn't matter how many times the outer effect calls in for the same song — only the first one in a 5s window actually proceeds",
      "Different-song swaps are unaffected (the debounce map is keyed by songId). Real back-and-forth after 5s+ works normally. This layer is a belt-and-braces on top of every other guard, and it survives even if the effect-at-line-969 accidentally clears liveSongRef mid-fire (which was another way the toast could re-appear)",
      "Bible verse detection — new fuzzy spoken-form fallback: 'filippians four thirteen' now resolves to Philippians 4:13, the same way 'filippians 4:13' already did. Sits at low confidence + semantic-fallback (below both the 70 context-trust floor and the 85 Bible auto-fire floor), so it can never auto-project on its own — you just get a chip to click. This is the specific fix v0.1.65's changelog promised; that DMG shipped the 787-case audit suite but was missing this fallback, so it's landing now",
    ],
  },
  {
    version: "0.1.68",
    date: "2026-07-26",
    headline: "Song auto-fire stale-echo fix — v0.1.67's 3s floor let old detections re-fire every few seconds",
    highlights: [
      "Fixed: after dropping the cross-song refire floor 60s → 3s to enable back-and-forth, songs started auto-projecting REPEATEDLY when the user wasn't singing them. Root cause: suggestions persist in the array and get replaced-in-place by songId — my 3s floor let the same stale detection re-fire every 3s. Now: only fire when the suggestion is fresh (ts within last 8s) AND we haven't already fired for that specific suggestion id. New detection events bump the id + ts, so real back-and-forth still works; stale echoes don't",
      "Belt-and-braces: 200-entry LRU cap on the fired-suggestion-id set prevents unbounded growth over long sessions. The 3s outer refire floor from v0.1.67 stays as a redundant chatter guard",
      "Net result vs v0.1.67: same back-and-forth capability (Song A → Song B → Song A → Song B all fire on real re-detection), but no more phantom re-fires when you stop singing",
    ],
  },
  {
    version: "0.1.67",
    date: "2026-07-26",
    headline: "Songs can now go back-and-forth without a 60s brick wall — fires reliably on each swap",
    highlights: [
      "Fixed: singing Song A → Song B → back to Song A within a minute got blocked on the third detection because a 60s 'quick-refire floor' in the outer song-candidates effect treated the previous handling as an anti-chatter guard. Real preacher/worship-leader back-and-forth needs seconds, not a minute. Floor dropped to 3s (just enough to swallow per-transcript-word chatter within ONE ongoing song, doesn't touch cross-song swaps)",
      "The 5-minute same-song-already-live echo suppression stays put (it's the actual anti-double-fire guard). autoLiveSong's own 800ms min-gap + same-song-live short-circuit + 5-min replay map continue to prevent real chatter. What went away was a redundant outer gate that also happened to break the swap use case",
      "Combined with v0.1.66's AUTO/MANUAL decoupling: songs at ≥70% now fire reliably in either mode, on every legitimate swap, no matter how many times you go back and forth. Test verified: A→B→A→B→A→B all fire",
    ],
  },
  {
    version: "0.1.66",
    date: "2026-07-26",
    headline: "Song auto-fire no longer gated on AUTO/MANUAL toggle — ≥70% policy applies unconditionally",
    highlights: [
      "The AUTO/MANUAL toggle in the top bar now ONLY controls Bible auto-approve (its original purpose). Song auto-fire runs based purely on the confidence policy: ≥70% auto-projects, 60-69% stages with G-key confirm, <60% chip-only. Field report from JPD test: operator was in MANUAL mode, Amazing Grace hit 87%, but the entire song path silently no-op'd because the AUTO toggle blocked it. Fixed",
      "What this means: if you leave AI ON in MANUAL mode, Bible detections still just show as chips (require click), but songs at 70%+ will project themselves. If you want the old 'nothing auto-fires' behavior, turn AI OFF entirely",
      "CLAUDE.md rule 7 updated with the sign-off + rationale. The chip-click carve-out from v0.1.63 (direct operator click always fires slide 1 live regardless of confidence) remains in effect",
    ],
  },
  {
    version: "0.1.65",
    date: "2026-07-26",
    headline: "Bible verse detection — 787-case audit, 100% pass rate, three targeted parser fixes",
    highlights: [
      "New automated Bible detection test suite covers all 66 books across 7 formats (spoken-full, spoken-short, abbreviated, conversational, partial, tricky collisions, and Deepgram mishearings) — 787 total cases. Every book now sits at 100% detection; every format at 100%. Prior baseline was 99.24% (6 failures). Suite lives at src/tests/bibleDetection/ and runs via `npx tsx src/tests/bibleDetection/detectionTestRunner.ts`",
      "Fixed 1 Chr / 2 Chr abbreviation — previously '1 Chr 16:11' silently returned no match because the variant list stopped at '1 chron' / '1 ch'. Added '1 chr' and '2 chr' so testers using the standard SBL abbreviation now resolve",
      "Fixed Philemon (and other single-chapter books) with explicit chapter notation — 'Philemon 1:6' was parsing as Philemon 1:1 because the single_chapter_book_verse regex greedy-ate the '1' as the verse and dropped ':6'. Now: when the shape is Book 1:N, N is the verse; other cases still map correctly. Applies to Obadiah, Philemon, 2 John, 3 John, Jude",
      "Fixed fuzzy book-name match for SPOKEN form — 'filippians four thirteen' now resolves to Philippians 4:13. Previously only the colon shape (filippians 4:13) fuzzy-matched. New pattern requires a ≥6-char candidate + validates chapter so it can't drift into ordinary English speech",
      "Psalm 46:10 gate — all six required phrasings ('Psalm 46:10', 'Psalm forty six verse ten', 'Psalm 46 verse 10', 'Psalms 46:10', 'Be still and know that I am God Psalm 46:10', 'Turn to Psalm 46 verse 10') now pass",
    ],
  },
  {
    version: "0.1.64",
    date: "2026-07-26",
    headline: "Songs now auto-project at 70% confidence (was 85%) — product-owner sign-off after field test",
    highlights: [
      "SONG_AUTOLIVE_CONFIDENCE lowered from 85 → 70. At/above 70%, an AI-detected song now zero-click auto-projects to LIVE. Between 60-69%, songs continue to STAGE (orange banner + G to fire). Below 60%, chip only. Rationale from JPD field test data: at 85% the auto-live band was so narrow most real detections landed in the stage-only band and operators frequently missed the G keypress. The 60-69% stage band is preserved as the intermediate 'operator confirms' tier",
      "Same anti-replay + min-gap guardrails apply at the new 70% floor (5-min per-song replay suppression + 800ms min-gap between auto-fires, both with the different-song-live bypass). Copyright rule 7 is now updated in CLAUDE.md with the new threshold + the sign-off recorded",
      "This complements v0.1.63's chip-click carve-out (direct operator click ALWAYS fires slide 1 to live regardless of confidence). Together: the AI handles ≥70% by itself, 60-69% ask you to confirm, and clicking any chip is the manual override for anything else",
    ],
  },
  {
    version: "0.1.63",
    date: "2026-07-26",
    headline: "Song chip click now fires slide 1 to LIVE (direct operator intent) + adds to playlist",
    highlights: [
      "Clicking a song chip in the AI chips bar at the bottom now fetches that song and pushes slide 1 to the projector immediately, plus adds it to the playlist if it wasn't already there. Previously the click only added-to-playlist (or scrolled to it) — never projected. Direct operator intent is trusted per CLAUDE.md rule 7's carve-out, same policy the SongsBrowser click uses. Success toast confirms the fire. 10-second per-song cooldown so a jittery double-click can't double-fire (second click within cooldown scrolls to the playlist row instead)",
      "Empty-lyric songs (song row with slides but no text yet) show an actionable toast on click ('open in library to add lyrics') instead of silently projecting a blank slide. This is the same hasLyrics safety gate v0.1.62 added to the AI title-trigger path — now consistent between AI detection and manual chip click",
      "Note on the 60-84% band: AI-detected songs at 60-84% confidence still STAGE (orange banner appears with a 'GO LIVE →' button; press G to fire). Zero-click auto-project stays at ≥85% per the copyright-safety product policy. If you want a lower auto-project threshold, that needs a separate product signoff — clicking the chip is the manual override in the meantime",
    ],
  },
  {
    version: "0.1.62",
    date: "2026-07-26",
    headline: "Audio reliability pass — heartbeat dot, AI auto-start, mic boost + high-pass, cache-clear menu, empty-song safety, more homophone repairs",
    highlights: [
      "New heartbeat dot next to the AI ON pill in the top bar — green pulses while Deepgram is actively transcribing, amber when speech has paused, red when the socket has failed, grey when off. Answers the 'is the AI actually listening right now?' question at a glance without opening DevTools",
      "AI listening intent now persists — if AI was ON when you last closed the app, the next launch auto-resumes listening (with a toast so a surprise hot mic is never a surprise). Manual-mode / auto-approve state does NOT auto-hydrate (security fix — an XSS-planted localStorage key can no longer arm zero-touch mic → detect → auto-live). Combined with a 600ms defer + resume() preference, no more mic flap on every load for manual-mode users",
      "10s health watchdog resumes a suspended AudioContext (Chromium sometimes suspends it silently on tab throttle) and kicks a reconnect when the WebSocket is wedged with no backoff pending. Sustained audio-input-changed spam now has a 5s floor between actual pipeline restarts so a device-swap avalanche can't churn Deepgram connections",
      "New Settings › Audio Mic Boost slider (1x–3x, capped at 2x for mixer/interface sources to avoid clamp distortion) and a 'Reduce low-frequency rumble' toggle (100Hz high-pass) — helps distant-mic pickup in echoey rooms. Defaults follow Source Type: microphone gets 1.5x + filter ON; mixer stays unity. The old decorative Input Gain slider (which persisted a key nothing read) is retired",
      "New View menu → 'Clear Cache and Reload' (Cmd+Shift+R) — nukes HTTP cache, Service Workers, and CacheStorage without wiping localStorage or cookies, so you stay signed in. Fixes the 'my app is showing an old version even after Cmd+R' cases",
      "AI safety: an exact-title trigger phrase ('let's sing Amazing Grace') can no longer surface a song candidate whose slides carry NO lyric text — the Priority-6 title-trigger path now respects the same hasLyrics gate that the fuzzy matcher enforces. Prevents a one-click-projects-blank-screen footgun in libraries with placeholder-slide songs",
      "Bible parser: extended the `N is M → N:M` repair to also catch `N was M`, `N has M`, `N and M`, `N at M`, `N of M`, `N are M`, `N were M` — Deepgram consistently mangles the word 'verse' between two digits into these short function words, especially in African-accented speech. 'Nehemiah 2 was 1' now parses as Nehemiah 2:1 on the first Deepgram pass instead of waiting for Whisper canonical correction",
    ],
  },
  {
    version: "0.1.61",
    date: "2026-07-26",
    headline: "Team page polish — avatar initials, unified list with Pending pills, real empty state",
    highlights: [
      "Team members now show a proper amber-initials avatar next to their name (was: bare text). Pending invites got a muted grey initials avatar and a small 'Pending' pill, and got merged into the same team list instead of living in a separate section below — one scannable roster instead of two",
      "New empty state when the church has no team members yet: 'No team members yet. Invite the person who runs your screen on Sunday.' with a Users icon on the amber-tint background. Was: bare list that just rendered nothing",
      "Buttons + inputs retokenised to the admin palette — Send invite is now amber primary (was old bg-foreground/text-background dark tokens), inputs focus with the amber ring, remove buttons hover-tint red without shifting the row height. Confirm-remove dialog got a clearer message about what preserving the audit trail means",
      "You still can't change your own role or remove yourself (belt-and-brace: server action requireRole guards + client disabled buttons with 'You can't remove yourself' tooltip)",
    ],
  },
  {
    version: "0.1.60",
    date: "2026-07-26",
    headline: "Import wizard polish — prominent drop zone, per-file remove, tokenised chrome",
    highlights: [
      "Migration wizard (Songs → Import) now leads with a big full-width drop zone as the primary interaction. Was 'or drop files here' buried under two small file-input labels; now: dashed dropzone that lights up amber on drag-over, upload icon centered, buttons for folder/file/Electron pickers below. All input paths add to the same accumulator, so you can drop one file, then add more via the folder picker, without losing the first",
      "Selected-files list is now itemised — each file shows the name, size, and an X to remove that specific file (was: pick a whole new set to change anything). Also added a 'Clear all' link and a running total-size counter. Duplicate detection by name+size prevents adding the same file twice",
      "Stepper across the top now uses named steps (Source / Files / Review / Done) with checkmarks on completed steps and admin-palette colors — instead of numeric 'Step 1 · Step 2' pills in the old primary/muted tokens. Confirm-import button uses the amber admin accent, review-step Stat cards tint per tone (green for songs found, amber for skipped)",
      "Review step now explains what 'skipped' means: duplicate detection (matched by title against existing songs in your church) auto-skips rather than overwriting. Nothing you've already got gets clobbered by a re-import",
    ],
  },
  {
    version: "0.1.59",
    date: "2026-07-26",
    headline: "New upgrade landing pages — Pro cinematic hero + Starter/Church detail pages",
    highlights: [
      "Clicking a tier's CTA on the billing page now opens a dedicated /upgrade/[tier] landing page instead of jumping straight to Stripe. The upgrade pages live outside the admin shell (no sidebar/topbar) so they read as full-page marketing surfaces — dark background with the amber accent palette shared with the billing page",
      "Pro (/upgrade/pro) gets the cinematic treatment: a hero with a mocked MacBook + stage-display side-by-side, five scroll-triggered feature sections (AI that follows the room · One-click service build · Stage display · Your library · Themes that look designed) with alternating layouts, and a final CTA card with $29/mo + all 6 Pro features + Start free trial. Scroll-in fades use a small IntersectionObserver-based Reveal wrapper — no framer-motion dep",
      "Starter (/upgrade/starter) and Church (/upgrade/church) get simpler detail pages: hero + feature list + pricing card + CTA. Starter → Stripe test-mode trial. Church → mailto for a 30-min discovery call (no self-serve Stripe for multi-campus deals). Both pages cross-link to Pro so admins can compare",
      "Shared /upgrade/layout.tsx wraps everything with a sticky top nav (back-to-billing + PresentFlow mark). Every upgrade page's 'Start free trial' button hits the same createCheckoutSession server action as the billing page's cards — one shared checkout path",
    ],
  },
  {
    version: "0.1.58",
    date: "2026-07-26",
    headline: "Billing page rebuilt — dark amber-glow pricing island with 3 tiers + animated monthly/yearly toggle",
    highlights: [
      "The billing page has been redesigned as a dark 'marketing island' distinct from the light admin dashboard: deep-charcoal background with three drifting amber aurora blobs (CSS-only, zero JS cost). Current plan summary is now a single sleek banner (was three separate cards competing for the same eye) with the plan name, status, trial/renewal date, and a green 'Free' badge during pilot",
      "Three pricing tiers laid out side-by-side: Starter ($14/mo · 50 songs, 5 themes, single campus), Pro ($29/mo · unlimited songs+themes, multi-output, stage display, Planning Center — FEATURED with amber glow + 'RECOMMENDED' badge), Church ($49/mo · multi-campus, sermon archive, historical analytics, API). Prices are placeholders until pilot pricing validates. Each tier hover-lifts, features rows use amber check icons",
      "Monthly/Yearly toggle above the tiers with a real animated switch (grey track, amber knob that slides on click) and a 'Save 20%' badge on the yearly side. Prices update instantly when toggled. The toggle sends the selected cycle to Stripe checkout — for the pilot phase both cycles go through the same test-mode Stripe price ID; separate monthly/yearly Stripe price IDs will land when real prices ship",
      "'Explore (test mode)' CTA is now 'Start free trial' on Starter + Pro and 'Contact us' on Church. Every click goes through Stripe test mode during the pilot — no card is ever charged. A clear inline notice at the bottom reminds admins that prices are placeholders and Stripe is in test mode",
    ],
  },
  {
    version: "0.1.57",
    date: "2026-07-26",
    headline: "Theme editor rebuilt — full-screen 2-panel with live 16:9 preview + 4 preview modes",
    highlights: [
      "Themes at /library/themes → clicking a card (or 'New theme') now opens a full-screen 2-panel editor: left panel is collapsible control groups (Typography, Background, Layout, Lower third, Scripture, Transitions), right panel is a live 16:9 preview that updates instantly on every change. Preview mode toggles at the top let you switch between Lyrics, Scripture, Sermon point, and Blank + logo so you can check every content type against the theme in one place",
      "Typography controls: headline font (Inter, Sora, Plus Jakarta, Georgia, Helvetica, Arial, Times New Roman), separate lyrics vs scripture size, weight 300–900, text color picker, alignment, text-shadow toggle. Background: solid / gradient (two colors) / image URL, plus opacity slider. Layout: 3×3 logo-placement grid + None, logo size slider, church-name toggle with top/bottom position. Lower third: enable + style (bar / gradient-fade / minimal) + color. Scripture: reference show/hide, position (above/below/inline), translation label toggle. Transitions: effect (fade/slide/none) + duration slider",
      "Theme cards on the list view now render a real 16:9 preview thumbnail using the same live preview component — you can eyeball a theme before opening it. Duplicate + delete stay in the bottom-right of each card. Empty state (no themes yet) has a proper 'Create your first theme' CTA with an explanation of what a theme is",
      "Under the hood: expanded the ThemeConfig type + server-side sanitizer to accept all the new fields (fontSizeScripturePx, bgType, bgColor2, bgOpacity, logoPosition, logoSizePx, lowerThird*, scripture*, transitionType, etc.). The operator projector will pick these up as it wires each field on its own timeline — the editor UI is ready today",
    ],
  },
  {
    version: "0.1.56",
    date: "2026-07-25",
    headline: "Cleaner Organization + Songs pages — fewer cards, less noise",
    highlights: [
      "Organization page now shows Church details + Worship defaults in a single card separated by a subtle divider (was two side-by-side cards competing for attention). The internal-only 'Onboarding status' row is gone — it wasn't user-facing signal. Church branding stays as its own card on the right",
      "Songs page: the 'Song licensing and copyright' and 'Import warning' cards are merged into one card, with the amber import warning surfaced as an inline callout at the bottom. Same information, less visual weight",
      "Detection testing panel (the AI-song-match tuning tool volunteers never needed to see on their way to the songs list) is now collapsed behind an 'Admin · Debug' toggle at the bottom of the Songs page. One click away for the admin who tunes it, out of the way for everyone else",
    ],
  },
  {
    version: "0.1.55",
    date: "2026-07-25",
    headline: "Church logo now shows in the topbar badge + tighter image upload rules",
    highlights: [
      "The top-right 'Church' badge in the web admin now shows your uploaded church logo next to the church name (28px circular thumbnail). If you haven't uploaded a logo yet, you get a clean monogram of the first letter of the church name on the muted admin background. Loading a logo fades in from a subtle skeleton shimmer; a broken/expired URL silently falls back to the monogram rather than showing a broken-image icon. The sidebar workspace pill now uses the same shared avatar component for visual consistency",
      "Logo upload now accepts AVIF in addition to PNG, JPG, and WebP (native browser support, better compression than WebP on the same 2 MB budget). SVG stays intentionally excluded — an SVG can carry inline scripts and would be an XSS surface without a server-side sanitize step (queued for a separate commit). HEIC (iPhone default) also queued — needs libheif conversion server-side",
      "Under the hood: the /api/media/presign route now enforces purpose-aware size caps (2 MB for logos, 500 MB for media/pptx) instead of a shared 500 MB cap for everything. Logo uploads also can't slip a video MIME through anymore — the new 'logo' purpose only accepts image content types. Client and server caps now match exactly",
    ],
  },
  {
    version: "0.1.54",
    date: "2026-07-25",
    headline: "Bible verses in playlist now render + < Verse / Verse > push to live + re-detected verse re-fires when a song is on screen",
    highlights: [
      "Bible verses added to the playlist (via the + on a verse card, or Add to Playlist) NOW render as real slide cards in the center grid when clicked. Root cause: BibleMode stored `{reference, verses: [{verse, text}]}` in the item payload but the server-side plan expander only read `payload.slides` / `payload.text` — every scripture playlist item was landing as a blank fallback. Fixed in services.ts: also builds slides from `payload.verses` with the reference label appended, mirroring the Bible panel's own verse-card format",
      "The < Verse and Verse > transport-bar buttons now PUSH the target slide to live instead of only moving the preview cursor. Previously they called `onJumpSlide` (which just changes preview + only fires live under AutoSend). Now: jumps preview AND explicitly fires the target slide via `onSendSlideToLive`, matching what clicking a card in the grid does. Also applies to SkipBack / SkipForward icons",
      "Re-detected Bible verse now re-fires to live even when the currently-live content is a song lyric / message / image / blank. Root cause: the 5-minute replay guard had a bypass 'skip if a DIFFERENT reference is currently live' but the bypass only fired when currentLive was itself Bible-verse-shaped text. Song lyrics don't match the Bible regex, so re-detecting a previously-shown verse got blocked even though the projector was clearly on a different piece of content. Now: permissive default — the guard only blocks when the SAME Bible verse is already on screen (true stale-echo case). Every other live state (song / empty / different verse / image) is treated as a legitimate content swap and allows the re-fire",
    ],
  },
  {
    version: "0.1.53",
    date: "2026-07-25",
    headline: "Branded welcome splash on first sign-in",
    highlights: [
      "First-time admins now see a ~2.6s PresentFlow welcome splash (deep-charcoal background with soft brand glows and the pulsing play-button mark) when they first land on /onboarding — a small brand moment before the setup wizard opens. Skipped for returning users mid-flow so it doesn't add friction. Sidebar clicks between admin pages stay instant with inline skeletons",
    ],
  },
  {
    version: "0.1.52",
    date: "2026-07-25",
    headline: "Onboarding wizard rebuilt — 6 focused steps with branding + hymn library one-click",
    highlights: [
      "New church admins now walk through a 6-step onboarding: Welcome hero → Church profile (name/city/country/denomination/congregation size, timezone auto-detected) → Church branding (drag-drop logo upload right in the wizard, reuses the same uploader the Organization page uses) → Songs setup (import from ProPresenter/EasyWorship, one-click add all 50 built-in public-domain hymns, or skip) → Team invites (multi-email with role picker per invite: Operator/Admin/Pastor) → Download desktop app + finish. The old 4-step 'use case' wizard is retired",
      "'Start with built-in hymns' one-click seeds all 50 hand-verified public-domain hymns into the church's library in a single action — no more running `npm run db:seed:hymns` on the CLI. Idempotent + church-scoped: safe to click twice, safe if you already have some seeded (skips duplicates by title). Reports 'Added X' to confirm",
      "The wizard's branding step doesn't just say 'upload later' — it embeds the same ChurchBrandingUploader component the Organization page uses, so admins can drop a logo mid-flow and see it in the sidebar workspace pill immediately when they land on the dashboard",
      "Every step after the profile is skippable (branding, songs, team, download all have 'Continue' with no required action) so no admin gets stuck. Returning users who partially completed onboarding land at the branding step (skipping welcome + already-done church profile). Role picker on invites lets you send Operator/Admin/Pastor invitations in a single flow instead of everyone defaulting to Operator",
    ],
  },
  {
    version: "0.1.51",
    date: "2026-07-25",
    headline: "Admin topbar + dashboard rebuild — clean light-mode SaaS surface, no more dark ribbon over white",
    highlights: [
      "The web admin topbar has been rebuilt to match the new sidebar language: 64px tall (was 88px), clean white bar with a single bottom border in light mode instead of the previous heavy dark gradient. The ⌘K global search dropdown now renders as a clean white popover with orange-tinted hover rows, the church badge is a small pill in the neutral palette, and the user avatar dropdown pulls the same clean card treatment — profile, settings, and sign out all sit inside a light popover in light mode",
      "Dashboard cards rebuilt (DashboardCard component): white 1px-bordered surfaces with no shadows, 10px radius, tokenised so light mode reads as a proper SaaS panel and dark mode stays deep charcoal. Removed the leftover FaithFlow-teal glow on the 'Next scheduled service' banner — now a subtle orange-accented card. Status pills retinted (green success, amber warning, red danger, orange brand) using the admin palette instead of the old teal-based tokens",
      "Dashboard checklist rows are now flat + minimal: no boxy borders, just a subtle hover state, with the arrow chevron appearing only on hover. Icons use the new green/amber/orange palette. Action buttons ('Open services' and 'Manage organization') use the new admin button treatment — 40px tall, 6px radius, orange primary with focus ring instead of the previous 44px rounded-2xl brutalist buttons",
      "PageHeader retooled to use the admin tokens across every page that uses it (Dashboard, Songs, Library/*, Organization, Settings, Analytics) — cleaner type scale (28px headline, 14px description), tighter spacing, no more display-font italic tilt on titles",
    ],
  },
  {
    version: "0.1.50",
    date: "2026-07-25",
    headline: "Admin sidebar rebuild — branded gradient header, tighter 240px width, regrouped nav, light-mode clean",
    highlights: [
      "The web admin sidebar has been rebuilt from the ground up: 240px wide (was 302px), a signature dark gradient header at the top with the PresentFlow logo (Present in ivory, Flow in orange) and church workspace pill inside it, a 2px purple→orange→pink brand gradient stripe separating that header from the neutral nav below. In light mode the nav body is now a clean off-white with subtle borders instead of the previous forced-dark gradient; in dark mode it stays deep charcoal",
      "Nav restructured into four focused groups per the new brief: Workspace (Overview, Services) / Content (Songs, Bible, Media, Imports, Themes, Sermon Archive, Analytics) / People (Team, Devices) / Admin (Church Profile, Billing, Settings). The old 'Library' sub-menu is flattened. The 'AI Assistant' dead-row is retired. The disabled duplicate 'Account' card at the bottom is gone",
      "Active-state indicator changed from a wide dark-tile look to a 3px orange left rail + soft orange tint on the row — reads cleaner in light mode and matches the new SaaS-quality visual language. Icons pick up the orange when active. Cmd/Ctrl+/ still toggles collapse; sidebar and content chrome are now scoped under a `.pf-admin-scope` class so operator surfaces (which never opt into that scope) render unchanged",
      "Desktop-shell users (Electron) are unaffected — desktop sidebar/nav still use their own layout and this rebuild only touches the web admin chrome",
    ],
  },
  {
    version: "0.1.49",
    date: "2026-07-25",
    headline: "Church logo upload + it shows in the sidebar workspace pill",
    highlights: [
      "Admins can now upload a church logo from Organization → Church branding (drag-drop or click, PNG/JPG/WebP up to 2 MB). The logo appears immediately in the sidebar workspace pill below the PresentFlow branding — no hard reload needed. Fallback when no logo is uploaded: a monogram of the church name's first letter",
      "Under the hood: logo upload is admin-role gated (operators/pastors can't change branding on their own), the stored S3 key is validated to belong to your own church (belt-and-brace so no crafted request from a friendly UI can plant another church's key), and the previous blob URL is revoked on replace so repeat uploads don't leak memory. Sidebar image now sets width/height (no layout shift) and referrerPolicy=no-referrer",
      "Browser tab now shows the PresentFlow play-button logo as the favicon (was Next.js default) — applies to both regular tabs and the Apple touch icon",
    ],
  },
  {
    version: "0.1.48",
    date: "2026-07-25",
    headline: "Admin portal hardening — 50 hymns, editable church profile, real Themes page, Songs table with search + delete, security sweep landed",
    highlights: [
      "Built-in public-domain hymn library grew from 10 to 50 titles — Christmas set (Silent Night, O Come All Ye Faithful, Hark! the Herald, Joy to the World, O Little Town of Bethlehem, Away in a Manger, What Child Is This, The First Noel, Angels We Have Heard on High, We Three Kings, It Came Upon the Midnight Clear, God Rest Ye Merry), Easter set (Christ the Lord Is Risen Today, Low in the Grave He Lay, The Old Rugged Cross), and 26 more worship classics (Blessed Assurance, Rock of Ages, Just As I Am, Sweet Hour of Prayer, What a Friend, Nearer My God to Thee, Abide With Me, Turn Your Eyes Upon Jesus, Jesus Loves Me, Onward Christian Soldiers, and more). Every hymn has full slide-formatted verses, individually PD-verified with author + publication citations",
      "Songs page now has a real data table — client-side search by title/artist, sortable columns, one-click delete per row with confirm dialog, and a proper empty state with '+ Add a song' and 'Import library' CTAs. Previously a bare list with no search and no way to delete from the UI (backend action existed since day one, just wasn't wired)",
      "Library → Themes was a 'coming soon' placeholder — now a full CRUD: create/duplicate/delete themes, edit modal with live preview, controls for background color, text color, font family (Inter/Sora/Plus Jakarta/Georgia/Helvetica/Arial), font size, weight, and alignment. Apply from any song's editor. Empty state with 'Create your first theme' CTA",
      "Organization page was read-only — now a proper editable form: church name, timezone, city, country, congregation size, denomination all save via a new admin-only updateChurch server action. Dirty-state hint + toast confirmation. The dashboard's 'Church profile' checklist item finally leads somewhere that lets you finish it",
      "Notifications bell in the top bar was decoration (no click handler, no data source) — removed. No more dead clicks",
      "Bible library empty state no longer shows a raw `npm run db:seed:bible` shell instruction to church admins. Replaced with a 'Library is warming up' message pointing to support if it persists",
      "Cross-tenant hardening (invisible but load-bearing): two cross-church leaks closed — service-item payloads referencing another church's song/media/pptx IDs are now rejected at write AND filtered out at read (defense-in-depth two-hop by church_id in getExpandedServicePlan), and the dashboard's aiSuggestions query no longer returns every church's suggestions on every load. Login now rate-limits failed attempts (5/15min per IP + per email, constant-time bcrypt so unknown emails don't reveal existence). Password-reset flooding limited (3/hour per IP + per email, silent success to preserve anti-enumeration). 2FA is fail-closed: if totpEnabled is ever set, password-only login is refused until the TOTP challenge ships. New 'Attempt 12' adversarial test writes poisoned service items and asserts they render as blank slides — 12/12 pass",
    ],
  },
  {
    version: "0.1.47",
    date: "2026-07-25",
    headline: "Audio Diagnostics scanner + Live Transcript Clear + Media PRO lock + Logs tab hidden",
    highlights: [
      "New Audio Diagnostics scanner in Settings › Audio → 'Run diagnostics'. Enumerates every audio input on the machine, opens each one (4-step constraint fallback so weird interfaces don't get rejected), listens for 3 seconds, and reports live signal + level + sample rate. One-click 'Use' button selects a device as the AI input. Purpose: at JPD with a Mac Studio + mixer + Logic + maybe Dante + spare USB mic, the volunteer sees at a glance which of 6 devices is actually carrying the preacher's mic",
      "Live transcript now has a 'Clear' button in the panel header that hides everything transcribed so far without stopping the AI listener — new speech continues to land. Useful for resetting the visible panel between service segments without a full pipeline restart",
      "Media section now shows a PRO badge and locks Cinematic / Creators / Intro Videos categories behind a Pro plan gate. 'Free' remains accessible. Clicking a locked category opens an inline banner with an Upgrade button ('coming soon' toast on beta) and a Dismiss link",
      "Logs icon in the right sidebar bar has been hidden (the popover was a placeholder pointing at DevTools console). Kept the underlying logging code intact for the follow-up dismissed-detections history view",
    ],
  },
  {
    version: "0.1.46",
    date: "2026-07-25",
    headline: "Bible verse cards fit longer text + separate Load-Chapter/Add-to-Playlist buttons + transitions actually animate",
    highlights: [
      "Bible verse cards in the reference grid now use the same 14px readability floor as the SlideGrid instead of the sanctuary-facing 24px default — long verses (John 3:18, Psalm 119 subsections) no longer clip mid-word in the thumbnail. Full verse text is available as a tooltip on hover regardless. Projector output unchanged (still uses 24px min for sanctuary readability)",
      "'+ Add all verses' button split into two clear actions: 'Load Chapter' (secondary ghost) loads every verse of the current chapter into the grid, and '+ Add to Playlist' (primary orange) adds the currently displayed verse cards to the service plan. Previously the single button conflated both semantics and operators guessed wrong",
      "Transition picker actually animates the projector now. Root cause: the picker labels ('Cut', 'Fade', 'Slide (L→R)') never matched the effect IDs the projector renderer expects ('fade_in', 'slide_right'). Every picked transition silently fell through as unknown → no animation. Added the mapping so Cut, Fade, Dissolve (cross-fade), Slide L→R (slide_right), Slide R→L (slide_left), Wipe (wipe_right), Amoeba, Dispersion Blur, Color Burn, Iris, Push all resolve to real keyframes. Duration slider now affects transition time — 0s = instant, 3s = slow",
    ],
  },
  {
    version: "0.1.45",
    date: "2026-07-25",
    headline: "Live preview panel — wider + taller so long verses don't clip mid-word",
    highlights: [
      "Right sidebar bumped from 300px → 360px (60px more width) and the Live preview box from 220px → 280px tall (60px more height). Combined that's ~35% more visible area — long verses like John 3:18 no longer cut off at 'the name of the only [begotten Son of God]' mid-word. Center panel gives up 60px of width but operator's primary focus is the live preview",
    ],
  },
  {
    version: "0.1.44",
    date: "2026-07-25",
    headline: "▶ Play button now context-aware (Bible / Songs / Slides) + < Verse / Verse > give visible feedback",
    highlights: [
      "The ▶ Play button in the center header + the ▶ Show button in the top bar were silently doing nothing when you were in Bible or Songs mode. Root cause: both buttons read from `plan.items` (the playlist), so if you loaded a Bible reference or selected a song from the library WITHOUT adding it to the playlist first, they had nothing to send. Now both buttons are context-aware: in Bible mode they fire the currently selected verse card, in Songs mode they fire the selected song's slide 1, in Slides mode they fire the playlist item's slide 1 (existing behavior)",
      "< Verse / Verse > transport-bar buttons now show 'Type a Bible reference and press Lookup first' when pressed with nothing loaded, and 'Already on the first/last slide' when at the edge of a playlist item. Previously silent no-op",
      "Every play / verse-nav click is now logged in DevTools ([center-play], [topbar-play], [bottom-bar], [verse-nav], [bible-play-current], [songs-play-current] prefixes) so you can grep DevTools console to trace exactly why a button 'didn't work'",
      "Successful actions now toast — 'Luke 15:11 → LIVE', 'Playing Amazing Grace' — so you can tell at a glance the click was received even if the projector window is off-screen",
    ],
  },
  {
    version: "0.1.43",
    date: "2026-07-25",
    headline: "Song click-to-live: playlist song items now fire on click + visible toast confirmation + click tracing",
    highlights: [
      "Clicking a SONG item in the left playlist now actually sends slide 1 to the projector immediately, and shows a 'Playing \"[title]\" — slide 1' toast so you know the click was received. Previously this only fired when AUTO was on, leaving operators clicking a playlist song and seeing no visible change. Bible items still don't auto-fire on playlist click (operators pick a specific verse first)",
      "Clicking a slide in the Songs Library view (center panel) now shows a 'Sent to LIVE: \"[first words]\"' toast confirming the click reached the live pipeline. If the toast fires but nothing appears on the projector, the bug is on the projector side (check that a Live Screen is assigned in Settings › Screens)",
      "Empty song slides (no lyrics yet) now show an 'add lyrics with the pencil first' toast on click instead of silently no-op'ing — the previous behavior read as 'the button is broken'",
      "DevTools tracing added at every send-to-live entry point ([live] and [songs-browser] and [playlist] prefixes) so if a click still fails to project, opening Cmd+Opt+I → Console reveals exactly which step dropped the payload",
    ],
  },
  {
    version: "0.1.42",
    date: "2026-07-25",
    headline: "Church-mixer audio fix (DSP OFF), Mac Studio no-mic path, and visible audio-failure toasts",
    highlights: [
      "Mixer / Interface vs Microphone toggle in Settings › Audio. This is a real fix, not a preference: PresentFlow was hard-coding echo cancellation + noise suppression + auto-gain-control ON for every input, which actively DEGRADES a clean mixer feed (gates speech, pumps the level, smears consonants). The default is now Mixer / Interface (DSP OFF) — the setting churches actually need. Bare-mic-in-the-room use flips it to Microphone",
      "'No audio detected for 15s' toast now surfaces when the input is truly silent — most likely cause is the wrong device is picked or the mixer channel is muted. Previously the RMS silence was measured but never shown, so a stuck-muted volunteer stood there wondering why AI wasn't firing",
      "Audio start failures are now VISIBLE. When AI listening can't start (Mac Studio with no USB device, permission denied, device busy in another app), an actionable error toast appears with the specific fix. Previously the error state existed in the pipeline but was never rendered anywhere in the Pro shell — a silent failure",
      "Mac Studio no-mic setup flow is friendly: the audio setup wizard now specifically detects the 'zero audio inputs' case (Mac Studio + nothing plugged in) and shows a plain-English message with a Refresh button, instead of the confusing 'permission denied — click the mic icon in your address bar' message that fired before",
      "Live audio level meter now sits directly next to the AI ON pill in the top bar — a 60px green/amber/red bar that bounces with real-time input. If the bar is flat while the preacher is talking, you know immediately (without opening Settings) that PresentFlow isn't hearing your mixer",
      "Windows-specific 'device locked by another app' message now explains ASIO exclusive mode (Ableton / Reaper / Cubase / ASIO control panel → turn off Exclusive Mode) instead of the generic 'close Zoom' copy. Detected via navigator.platform so macOS still gets the macOS-appropriate copy",
      "New OverconstrainedError copy covers audio devices that refuse the requested 16kHz sample rate — most common on old FireWire interfaces + a few Bluetooth headsets. Falls back to the device's native rate transparently, with a clear message if the retry also fails",
    ],
  },
  {
    version: "0.1.41",
    date: "2026-07-25",
    headline: "Parser accent-fixes, typed shortcuts (EX 2 1 / John1010), Settings tabs no longer overlap, no interrupt while typing",
    highlights: [
      "'Route 4 is 1' now parses as Ruth 4:1 — Deepgram often mishears 'Ruth' as 'route' in African-accented speech, and it also renders the ':' between chapter and verse as the word 'is' ('4 is 1'). Both mishearings are now auto-repaired before pattern matching",
      "'DEUTEROMY' / 'DEUTERONOMAY' now detect as Deuteronomy — the transcript kept dropping the second N or drifting to '-nomay'. Both variants added to the alias table",
      "Typed 'COLO 3 1' now looks up Colossians 3:1 (added 'colo' and 'colos' as short forms). 'EXODOUS' also detects as Exodus (very common typo when in a rush)",
      "Typed 'EX 2 1', 'AM 1', 'AC 2', 'RE 21' etc. in the reference field now looks up the book — two-letter abbreviations (ex, ru, is, am, ac, re, ph, jd) are recognized in the TYPED input path only (still ignored in live speech to avoid false-firing on ordinary English)",
      "Fused-digit shortcuts now work for EVERY book, not just one — type 'john1010' and get John 10:10, 'psalm316' and get Psalm 3:16, 'matt77' skipped as too ambiguous, 'psalm119' or 'psalm150' correctly resolves to the whole chapter (Psalm 119 / Psalm 150) rather than 1:19 / 1:50. The split heuristic knows each book's max chapter and 1..176 verse range, so nonsense splits (Acts 290) are rejected instead of misfiring",
      "AI no longer projects a verse while you're typing in the search bar or reference field. If focus is inside any input, textarea, or contenteditable, the auto-approve path is held until focus leaves. Prevents the annoying interruption when you're mid-lookup and the mic hears a passing phrase",
      "Settings popover tabs (Audio / Messages / Timers / Themes / Macros) were visually crashing into each other in the narrow sidebar — the uppercase + wide letter spacing meant 5 labels didn't fit. Simplified label style and switched to natural-width tabs so they either fit comfortably or scroll cleanly",
    ],
  },
  {
    version: "0.1.40",
    date: "2026-07-25",
    headline: "Live preview locked to 220px 16:9 + grid cards readable again + ResizeObserver false-positive silenced",
    highlights: [
      "Live preview panel is now a fixed 220px-tall 16:9 box (was auto-growing to 60vh which took over the whole right sidebar on long verses). Wider than tall, matches audience projector aspect, never oscillates. Long verses paginate at the sanctuary-readability floor instead of stretching the box",
      "Slide grid cards raised the readable floor 8px → 14px and re-enabled pagination — thumbnails were unreadable at 8px. Now short verses fit whole, long ones page cleanly with a visible indicator",
      "'Runtime error: ResizeObserver loop completed with undelivered notifications' toast — this was a benign Chromium warning that fires whenever a layout callback triggers another layout callback in the same frame (AutoFitText's binary-search setState is the classic trigger). Silenced in the global error handler; the browser handles it correctly by deferring to the next frame",
    ],
  },
  {
    version: "0.1.39",
    date: "2026-07-25",
    headline: "Right-panel Phase 3: unified icon bar with popovers (proper lucide icons, no emojis)",
    highlights: [
      "The two big empty-state detection panels (Bible Detections + Song Detections, each ~200px tall showing 'no references yet…' most of the time) are GONE — replaced by a single horizontal icon toolbar at the bottom of the sidebar",
      "Six icons: Bible, Songs, Cross-references, Logs, Settings, Screens — all proper lucide-react icons, NOT emojis. Click any icon to open a scrollable popover with that section's content. Click the icon again (or the X) to close",
      "Live badge counts on Bible / Songs / Cross-refs icons — a small orange circle showing how many active detections there are, updates in real time as the AI listens",
      "Settings popover: consolidates Audio / Messages / Timers / Themes / Macros as sub-tabs. Screens popover: the per-machine resolution + display assignment + 'Configure Screens' button. Both were previously buried below the fold",
      "The old AIDetectionsPanel and RightTabs components still exist in the tree (unused) so we can roll back trivially if this regresses; will be deleted in a follow-up ship",
    ],
  },
  {
    version: "0.1.38",
    date: "2026-07-25",
    headline: "Slide grid cards + Live preview fit their full content + Cmd+R now hard-reloads",
    highlights: [
      "Slide grid cards (the thumbnails in the center panel showing each verse / stanza / section of a song) now shrink text as far as needed to fit the WHOLE content in one card — no more truncated 'I once was lost, but…' cutoff, no pagination inside a thumbnail",
      "Live preview panel dropped its 16:9 aspect constraint (was clipping longer stanzas like 'And grace will lead me hom…'). Now grows dynamically 320px→60vh so multi-line verses fit without pagination. Aspect on the actual audience projector output is unchanged — this is just the operator preview",
      "Cmd+R now force-reloads the app and clears its cache, so a fresh Vercel push always lands on the very next reload. Was previously a soft reload that reused Chromium's cached JS bytecode, which is why 'reload' sometimes didn't show new features (fix requires new .dmg — v0.1.38 or later)",
      "Phase 3 of the right-panel refactor (unified icon bar with proper lucide icons — NOT emojis — replacing the two detection panels + tabs row) coming next",
    ],
  },
  {
    version: "0.1.37",
    date: "2026-07-25",
    headline: "Right-panel Phase 2: taller transcript + scroll pause + orange trigger highlights + timestamps",
    highlights: [
      "Live transcript grew from 96px fixed → 150px min (flexes up to 280px) so multiple recent lines are visible without cycling out",
      "Scroll up to read older lines and the panel STOPS auto-scrolling — new lines land at the bottom but the view stays put. Scroll back to bottom and auto-scroll resumes automatically",
      "Detected trigger phrases (the exact words that caused a Bible / song / lyric detection) now highlight inline in orange within the transcript so you can see WHY the AI fired",
      "Each transcript line gets an mm:ss clock timestamp on the right edge — hover for the full time",
      "Dark-themed scrollbar in the transcript panel (matches the rest of the shell instead of the default OS look)",
      "Phase 3 (unified icon bar + popovers replacing the detection panels) coming next after you review this",
    ],
  },
  {
    version: "0.1.36",
    date: "2026-07-25",
    headline: "Right-panel preview: LIVE ● / IDLE ○ label, taller box, red glow when hot",
    highlights: [
      "'SCREEN 1' relabeled to LIVE ● (red pulse when something is on the projector) / IDLE ○ (grey when nothing is)",
      "Preview box grew from min 200px → 220px so verses and lyrics have visibly more breathing room without hitting the AutoFitText pagination boundary as often",
      "When live, the preview now has a subtle outer red glow (box-shadow) so you can tell at a glance from across the room that content is projecting",
      "Phase 1 of a right-panel refactor — Phase 2 (fatter scrollable transcript with pause/resume + inline highlights + timestamps) coming next after you review this",
    ],
  },
  {
    version: "0.1.35",
    date: "2026-07-25",
    headline: "Staged song 'GO LIVE' button + X really dismisses + screens config timing fix + playlist duplicate guard",
    highlights: [
      "AI-staged song banner now has an explicit orange 'GO LIVE →' button — click or press G, either works. Previously only the G keyboard shortcut worked and if focus was elsewhere the operator was stuck",
      "The X close button on the staged banner now REALLY dismisses — the same song won't re-stage for 10 minutes. Was previously bouncing back within seconds because the same lyric fragment kept firing detections",
      "'Screen configuration is available only in the PresentFlow desktop app' popup no longer appears inside the desktop app — the check now polls for the preload bridge up to 3 seconds instead of giving up on the first render (fixed a real timing race)",
      "Playlist no longer shows duplicate rows when the same song is added twice — client-side dedup mirrors the existing server-side dedup so optimistic-add doesn't stack on top of a real row",
      "Song re-stage floor bumped 15s → 60s so the banner doesn't blink back the moment you're still figuring out what to press",
    ],
  },
  {
    version: "0.1.34",
    date: "2026-07-25",
    headline: "Playlist rows are clickable + AI detections auto-highlight the sidebar item",
    highlights: [
      "Clicking a song / hymn / verse in the left sidebar playlist now actually goes somewhere — it switches the center panel to the slide grid, previews that item's slides, and (if AUTO is on) sends the first slide live immediately. Before, the click set an invisible state and looked like nothing happened",
      "When the AI auto-projects a song (worship team starts singing 'Amazing Grace...'), the sidebar's playlist row for that song now auto-scrolls into view + pulse-highlights so the operator can see at a glance which song is playing",
      "Both changes together: 'they start singing → song appears on screen → sidebar row for it pulses so I know where I am in the plan'",
    ],
  },
  {
    version: "0.1.33",
    date: "2026-07-24",
    headline: "Transcript feels snappier — finalized text lands ~50ms sooner",
    highlights: [
      "Deepgram finalization pushed 150ms → 100ms — white (final) transcript text lands ~33% sooner. The '97 What?' fragment issue was specifically at 50ms; 100ms is well past that pathological floor",
      "Interim transcript debounce 150ms → 90ms — grey partial-word text updates ~40% more frequently without the 'dancing text' jitter we saw at 40ms (that was aggravated by the fragmentation bug, now fixed)",
      "Detection latency is unchanged — both knobs only affect display cadence, not auto-fire responsiveness",
    ],
  },
  {
    version: "0.1.32",
    date: "2026-07-24",
    headline: "Live transcription never stops + song 0-slides in playlist fixed + song auto-project diagnostics",
    highlights: [
      "Live transcript panel's red 'recording' dot no longer disappears during background reconnects — it now shows whenever AI is ON, matching the binary AI ON/OFF rule. Only manually turning AI OFF removes it. Transcript content was already preserved across reconnects; only the visual dot was misleading",
      "Songs added via chip-click no longer show '0' slides in the playlist row while router.refresh() catches up — the optimistic add now seeds slides from the local library data so the count is correct immediately",
      "Added [latency] diagnostic logs for song auto-project (song-candidate arrival, autoLiveSong slide-fetch count, blocked-when-0-slides warning) so we can trace root cause when a song is detected but doesn't reach the projector",
    ],
  },
  {
    version: "0.1.31",
    date: "2026-07-24",
    headline: "Auto-fire +100ms (false-trigger floor tuning) + yellow highlight now fires on real-world book misspellings",
    highlights: [
      "Auto-fire min-gap raised 700ms → 800ms per the tuning heuristic (nudge +100ms until false triggers stop, that's the real floor for THIS mic/room). Still ~5× tighter than the original 4000ms wall",
      "Yellow correction highlight now fires on fuzzy book-name matches too — before it only triggered on rare TH-fronting number words ('tree'→'three'). Now if someone says 'filippians' or 'corintians' or 'ecclesiastis', the corrected word (Philippians / Corinthians / Ecclesiastes) shows briefly yellow in the transcript panel with the original in the hover tooltip",
    ],
  },
  {
    version: "0.1.30",
    date: "2026-07-24",
    headline: "Fixed transcript glitches ('97 What?' style) from over-aggressive endpointing",
    highlights: [
      "Deepgram finalization cadence pulled back from 50ms → 150ms. The 50ms setting was cutting utterances mid-word and Deepgram's numerals-to-digits converter was mis-reading the fragment tails as spoken numbers — that's why you'd see things like '97 What?' when someone said 'so what?'",
      "Detection latency is unchanged either way (detection uses interim results upstream, not final-emission timing)",
      "Endpointing is now 25% tighter than the pre-latency-push baseline of 200ms, without the fragment artefacts",
    ],
  },
  {
    version: "0.1.29",
    date: "2026-07-24",
    headline: "Latency pull-back — 100ms auto-fire was too twitchy, 40ms transcript was too jittery",
    highlights: [
      "Auto-fire min-gap raised 100ms → 700ms — real-service feedback showed 100ms produced visible flicker on rapid quote-then-quote stretches. Still 5-6× tighter than the original 4000ms wall; matches typical preacher cadence without the twitch",
      "Transcript panel debounce raised 40ms → 150ms — 40ms produced 'dancing text' as every partial-word interim caused a re-render. 150ms smooths that while still being 2× tighter than the original 300ms",
      "Detection latency is unchanged either way (both knobs are display/output tuning, not detection gates)",
    ],
  },
  {
    version: "0.1.28",
    date: "2026-07-24",
    headline: "Latency halved twice + fuzzy book fix + smoother slide transitions",
    highlights: [
      "Auto-fire min-gap 400ms → 100ms (10 fires/sec ceiling — sermon-rapid scripture citations project in real time)",
      "Deepgram finalization pushed to 50ms (aggressive; interim-driven detection is unaffected either way)",
      "Whisper canonical two-pass min-gap 3000ms → 750ms — Groq double-checks land twice as often on low-confidence stretches",
      "Slide transitions: text slides no longer flash at min-size before resizing (initial paint now uses last fitted size + a per-text LRU cache skips the binary search entirely on repeat slides)",
      "Image slides: every image URL in the current plan is now background-preloaded when the operator opens it — no more 'black frame then image pops in' on image-slide transitions",
      "Fuzzy book-name F1 fix: 'filippians four verse thirteen' style misspellings now correctly resolve to Philippians (previously silent-failed). Accuracy audit: 12/12 match rate, 0 silent-failures, 0 false-triggers on 17-scenario adversarial suite",
    ],
  },
  {
    version: "0.1.27",
    date: "2026-07-24",
    headline: "Latency push — auto-fire min-gap 4000ms → 400ms, Deepgram finalization 200ms → 100ms",
    highlights: [
      "The single biggest cause of 'AI feels laggy on consecutive scripture citations' was a 4-second hard wall between auto-fires. Cut to 400ms — a preacher rattling off two verses back-to-back at ~1s/verse now lands each on screen instead of blocking the second one for 4 seconds",
      "Deepgram finalization threshold pushed from 200ms → 100ms. Doesn't affect auto-live speed (interim-based detection already bypassed the finalization wait), but sermon RAG ingest / learned-vocab miner / transcript panel all now update ~100ms sooner",
      "Added [latency] auto-fire logging (visible in devtools console) that shows the delta between detection landing and slide firing — real per-fire ms number instead of just perceived feel",
      "DECISIONS.md now has a top-of-file 'current latency budget' table so future audits use live numbers not stale planning notes",
    ],
  },
  {
    version: "0.1.26",
    date: "2026-07-24",
    headline: "Songs auto-project even when Bible is currently live",
    highlights: [
      "Root-cause fix: at ≥85% detection confidence, a song will now auto-project even if Bible (or media, or anything else) is currently on screen. Previously the redetect-cooldown was only bypassed when a DIFFERENT song was live — Bible-live blocked the auto swap to song, so 'let us sing Amazing Grace' at 98% confidence just added it to the playlist instead of putting it on screen",
      "Same-song echo suppression is retained — if the song is already live, the same detection won't re-fire and cause a flicker",
      "No wake phrase needed: locked in by a new test — speaking the lyrics ('Amazing grace how sweet the sound') resolves the song without any 'let us sing' cue phrase. Content match works standalone",
      "Slide-by-slide auto-advance during a live song was already wired (matchNextSlide watches interim words against the next slide's lyrics) — should work end-to-end now that songs actually reach the LIVE state",
    ],
  },
  {
    version: "0.1.25",
    date: "2026-07-24",
    headline: "Yellow highlight now means 'AI just self-corrected' + transcript feels ~200ms snappier",
    highlights: [
      "The yellow highlight in the transcript panel is no longer a confidence indicator — it now marks words the AI initially transcribed one way but corrected using context. Example: preacher says 'James Forrest four' → transcript shows 'James three four' with 'three' briefly highlighted yellow (hover to see original 'tree' that got corrected). Fades to plain over 3 seconds",
      "Same real-time self-correcting behavior you'd expect from Claude/ChatGPT voice — approximate first pass, corrected second pass, all in-line",
      "Transcript panel debounce dropped from 300ms → 80ms so the visible transcript tracks live speech much more closely. Detection latency is unchanged — this only affects how quickly you *see* what was heard",
    ],
  },
  {
    version: "0.1.24",
    date: "2026-07-24",
    headline: "Kept reconnect awareness, killed the visual noise near the AI pill",
    highlights: [
      "Removed the manual ↻ 'Restart AI listener' button next to the AI ON pill — it was another circle-arrow icon reading as 'AI is churning'. If you want to restart, just toggle the AI pill OFF then ON — same effect",
      "Silent for the common case: brief background reconnects (< 5 seconds) produce ZERO visual noise. Pill stays green throughout",
      "If a reconnect takes 5+ seconds a discreet toast appears in the corner ('AI reconnecting… — pipeline stays ON'), auto-dismissing on recovery with a green 'AI reconnected' confirmation. Decoupled from the pill so it never reads as 'AI is off'",
      "If it drags past 20 seconds it escalates to a persistent warning suggesting toggle OFF/ON to force recovery",
      "The AI ON/AI OFF pill is now truly binary — nothing else can appear next to it",
    ],
  },
  {
    version: "0.1.23",
    date: "2026-07-24",
    headline: "Removed the reconnecting spinner — restores strictly-binary AI ON/OFF",
    highlights: [
      "The subtle amber ↻ next to the AI ON pill (added yesterday) read as 'the AI is stopping' rather than 'the socket is silently reconnecting in the background'. Removed — the pill stays green throughout any transient reconnect, exactly as the July 2026 product rule intended",
      "Underlying reconnect churn was already fixed yesterday (DG stall watchdog + KeepAlive); this just hides the last visual noise around it",
    ],
  },
  {
    version: "0.1.22",
    date: "2026-07-24",
    headline: "Silences the 'Update check failed — code signature' warning on unsigned tester builds",
    highlights: [
      "The auto-updater now only runs when the current app is signed with an Apple Developer certificate; unsigned tester builds explicitly skip it (no more failed-signature-validation banner)",
      "Once code signing is set up, auto-updates start working automatically — no code change needed",
    ],
  },
  {
    version: "0.1.21",
    date: "2026-07-23",
    headline: "Fixed the Deepgram silence-timeout reconnect churn",
    highlights: [
      "AI listener now sends a KeepAlive frame every 6 seconds during silence so Deepgram doesn't close and re-open the connection during pastoral pauses or worship transitions — cleaner logs, no more visible reconnect churn",
      "Behind the scenes: batched multi-row keyterm upsert (1 DB round trip instead of up to 40), stale-eviction pass to keep the learned-vocab table bounded over months, and adversarial tests locking the multi-tenant boundaries in place",
    ],
  },
  {
    version: "0.1.20",
    date: "2026-07-23",
    headline: "Transcript panel perf + tightened learned-vocab hygiene",
    highlights: [
      "Long-service transcript panel now renders 5–10× fewer DOM nodes by grouping same-confidence-tier words into single spans — smoother scrolling on older Macs during 90-minute sermons",
      "Learned-vocab table now enforces its documented enum at the database level (source can only be 'manual' or 'learned') — hygiene, prevents a future raw SQL slip from poisoning it",
    ],
  },
  {
    version: "0.1.19",
    date: "2026-07-23",
    headline: "Reliability pass on today's shipped features",
    highlights: [
      "Auto-live: fixed a subtle case where a stale detection at the very start of a service could fire the wrong slide (the anti-replay guard now catches it correctly)",
      "Whisper double-check: added rate-limit protection, per-connection concurrency caps, and drops stale corrections older than 8 seconds so a purple chip never appears jarringly mid-sermon",
      "Learned vocabulary now filters out congregation voices (uses speaker diarization), rejects multi-word garble, and can't be double-promoted by a network retry",
      "Reconnecting spinner: only appears when a reconnect actually takes >750ms — no more single-frame flicker on quick recoveries",
      "Song auto-live: 15-second floor even when swapping between songs stops rapid worship transitions from machine-gunning slide changes",
      "All fixes are transparent — nothing to configure or change in your workflow",
    ],
  },
  {
    version: "0.1.18",
    date: "2026-07-23",
    headline: "AI learns your church's vocabulary + Whisper double-checks low-confidence scripture",
    highlights: [
      "Learned vocabulary: after every service, words the AI kept struggling with get automatically added to that church's Deepgram vocabulary — no manual config, gets smarter with every service",
      "Whisper double-check: when the AI catches a scripture reference but isn't fully sure, it silently sends the audio to Groq Whisper for a canonical second opinion. If Whisper disagrees, a purple 'Whisper says' chip appears with the corrected reference — one click to swap. Never auto-swaps a live slide during a service",
      "Both are best-effort: any failure (DB blip, Whisper API hiccup, no per-preacher data yet) silently falls back to the previous behavior — the pipeline is fail-open by design",
    ],
  },
  {
    version: "0.1.17",
    date: "2026-07-23",
    headline: "Deeper audio: word-level confidence heatmap, background-reconnect indicator, speaker diarization",
    highlights: [
      "Live transcript panel now colors low-confidence words amber (< 75%) and very-low words with a dotted underline (< 50%) — you can see exactly which words the AI is struggling with instead of only whether the whole segment was right or wrong",
      "When the AI listener is silently reconnecting in the background, a subtle spinning ↻ now appears next to the AI ON pill — the pill itself stays green so nothing changes about the binary ON/OFF you asked for",
      "Deepgram now labels each word with a speaker index (preacher vs congregation vs guest) — first pass is passthrough only; a future pass will filter congregation shouts out of detection",
    ],
  },
  {
    version: "0.1.16",
    date: "2026-07-23",
    headline: "New: LOW AUDIO chip so bad-mic misfires don't look like AI bugs",
    highlights: [
      "When transcription confidence drops over the last several segments, an amber 'LOW AUDIO' chip now appears next to the AI ON pill with the current rolling average",
      "The tooltip explains: 'AI misfires right now are likely a signal problem, not a model error' — check mic position, room echo, preacher distance",
      "Chip auto-clears once quality recovers; hysteresis stops it flapping at the boundary",
    ],
  },
  {
    version: "0.1.15",
    date: "2026-07-23",
    headline: "Transcription accuracy: full 66-book vocab + core Christian terms",
    highlights: [
      "Deepgram now knows every Bible book by name (was only 12), plus core Christian vocabulary (Jesus Christ, Holy Spirit, hallelujah, righteousness, salvation, covenant, etc.) and common preacher phrasing ('the Bible says', 'turn with me to', 'chapter', 'verse')",
      "This directly biases the transcription model against the accented / fast-speech mishearings you've been seeing — a preacher saying 'Habakkuk 3:2' or '2 Corinthians 5:17' is now much more likely to land correctly on the first try",
      "The parser's downstream repairs (TH-fronting: tree→three, tird→third, etc. and fuzzy book matching for near-miss names) still catch anything Deepgram misses",
    ],
  },
  {
    version: "0.1.14",
    date: "2026-07-23",
    headline: "AUTO now follows worship leader back and forth between songs",
    highlights: [
      "Worship team swapping Song A → Song B → back to Song A now auto-projects each swap live — previously the 3rd, 4th, Nth mention was silently blocked",
      "Same-song echo suppression is retained: if the song the AI just detected is already the slide on screen, it won't re-fire",
      "Requires AUTO ON and ≥85% detection confidence, same as before",
    ],
  },
  {
    version: "0.1.13",
    date: "2026-07-23",
    headline: "AUTO now follows the preacher back and forth between verses",
    highlights: [
      "Preacher jumping Matt 5:5 → Gen 4:4 → back to Matt 5:5 → Gen 4:4 (and so on) now auto-projects each swap — previously the 3rd, 4th, Nth mention was silently blocked by the anti-replay guard",
      "Guardrail unchanged: if the reference the preacher just said is ALREADY the slide on screen, it still won't re-fire on echo (avoids flicker)",
      "Works within a 10-minute rolling window per reference; AUTO must be ON, same as before",
    ],
  },
  {
    version: "0.1.12",
    date: "2026-07-23",
    headline: "Bible: each reference gets its own clean slide grid",
    highlights: [
      "Jumping to a new Bible reference (from an AI chip, the Bible Detections panel, or a spoken detection) now REPLACES the slide grid with just that reference — no more stale verses from an earlier passage mixed in",
      "Full history of detected references still lives in the AI chips strip and the Bible Detections panel — click any chip to swap grids cleanly",
      "Verse ▸ / ◂ nav is unchanged: walking Matthew 5:5 → 5:6 → 5:7 still builds up cards in the same section",
    ],
  },
  {
    // Content-only revision (no new shell binary — thin-client web/backend
    // fixes, always live regardless of installed app version). See R1 in
    // WhatsNewModal.tsx for why version numbering here no longer maps 1:1
    // to a released Electron build.
    version: "0.1.11",
    date: "2026-07-22",
    headline: "AI listening fixes + sermon search",
    highlights: [
      "AI Live connection no longer flickers on/off during brief network blips",
      "Scripture detection now understands more accents and mispronounced book names automatically",
      "If the preacher restates a verse, or says \"verse 7\" / \"from verse 13\" on its own, AUTO mode now catches it instantly",
      { text: "New: search past services in plain English, get an AI-composed answer with sources", tryItHref: "/archive", tryItLabel: "Try Sermon Search", highlightParam: "ask-sermon-history" },
      { text: "10 songs from recent services added to your library (titles only — add lyrics via Import Songs before using live)", tryItHref: "/library/songs", tryItLabel: "View Songs Library" },
    ],
  },
  {
    version: "0.1.10",
    date: "2026-07-18",
    headline: "AI listening fix + one-click diagnostic",
    highlights: [
      "🔴 Fixed the real reason AI wasn't connecting — corrected the audio bridge URL on the server (was silently returning a URL your browser couldn't reach)",
      "New: click the Present Flow logo (bottom-left) → 'Diagnose AI listener' to run a one-click trace of every pipeline step (session → ticket → mic → WebSocket → Deepgram) with a specific fix line on any failure",
      "New: 'Reset & re-sync' button in this modal — clears local caches + service workers + reloads with a fresh bundle from the server",
    ],
  },
  {
    version: "0.1.9",
    date: "2026-07-18",
    headline: "Reliability + safety pass",
    highlights: [
      "AI listening: end-to-end rework — new server guard, mic-mute leak fixed, retryable stall watchdog",
      "Add Song: ProPresenter-style dialog with Theme + Size + optional blank template seed",
      "Bible: new List view — compact verses on the left, big preview on the right (toggle via header List button)",
      "Auto-update: 'Undo' toast on any autopilot auto-live push (4-second window)",
      "Song editor: 1.5s debounced autosave with visible save status + unsaved-changes guard",
      "Verse ▸ button now actually walks forward through verses; toast on end-of-chapter",
      "Bible references without spaces now parse: '1john 1 1', '1cor2:1', 'psalm23:1'",
      "Every panel wrapped in a crash-recovery boundary — one broken panel no longer nukes the whole app",
      "Global error handler surfaces any silent failure as a toast so nothing hides in the console",
      "6 security headers on every response (X-Frame, HSTS, CSP report-only, Permissions-Policy, etc.)",
      "Every paid API endpoint now rate-limited (audio ticket, Bible search, PPTX convert, media presign, all AI helpers)",
    ],
  },
  {
    version: "0.1.6",
    date: "2026-07-18",
    headline: "Auto-updater fixed",
    highlights: [
      "Ad-hoc code signing so macOS Squirrel accepts unsigned updates",
      "Auto-update banner has a Retry button after a stalled download",
      "Live-service guard: never quits to install mid-service without a confirm dialog",
    ],
  },
  {
    version: "0.1.3",
    date: "2026-07-18",
    headline: "Thin-client shell",
    highlights: [
      "Desktop app now a thin client — loads hosted UI from Vercel",
      ".app dropped from 388 MB to 115 MB",
      "Zero secrets bundled in the shell (no more DB URL / API keys on tester disks)",
      "All 3-agent audit fixes landing: AI listening hardening, sandbox, navigation guards, single-instance lock",
    ],
  },
];

// WhatsNewModal.dismiss() trusts CHANGELOG[...][0] of its filtered result to
// be the NEWEST shown entry, which only holds if this array is kept
// newest-first — enforced today only by the comment above, not by any
// runtime check. A single out-of-order insert would silently record a stale
// version as "last seen" and permanently hide later entries for testers who
// already passed that point. Fail fast in dev if the ordering ever slips.
function cmpVersionForOrderCheck(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
if (process.env.NODE_ENV !== "production") {
  for (let i = 1; i < CHANGELOG.length; i++) {
    if (cmpVersionForOrderCheck(CHANGELOG[i - 1].version, CHANGELOG[i].version) < 0) {
      throw new Error(
        `CHANGELOG must be newest-first: "${CHANGELOG[i - 1].version}" (index ${i - 1}) is older than "${CHANGELOG[i].version}" (index ${i}).`,
      );
    }
  }
}
