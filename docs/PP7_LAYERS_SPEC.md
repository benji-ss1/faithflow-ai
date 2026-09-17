# ProPresenter's layer system — what it is, and where PresentFlow differs

For Victor to confirm before any more code is written.

Researched 2026-09-18 from Renewed Vision's own knowledge base, their release notes, and
their public API specification (`openapi.propresenter.com/swagger.json`, downloaded and
read directly). Every statement below is either **[V]** verified against a first-party
source or **[?]** flagged as unconfirmed. Nothing here is guesswork dressed up as fact.

---

## 1. The stack

ProPresenter: *"ProPresenter's output is made up of 8 fixed layers."* **[V]**

Top of the screen down to the back wall:

| | Layer | Clear button? | Notes |
|---|---|---|---|
| top | **Mask** | no | Cuts a shape out of everything below. Set per screen in a Look. |
| | **Messages** | F6 | Ad-hoc text over everything. Timers live here. |
| | **Props** | F4 | Free-floating overlays ("bugs"). Several at once. |
| | **Announcements** | F7 | A second presentation running in parallel. |
| | **Slide** | F2 | The words. |
| | *Slide / Presentation background colour* | no | Switched off, not cleared. Above Media since 7.11. |
| | **Media** | F3 | Pictures, video, motions. |
| | **Video Input** | none by default | Camera / NDI. |
| bottom | **Screen Color** | no | Always present. Only its colour changes. |

**The order is fixed. Nobody can reorder it** — not the operator, not a theme, not a Look. **[V]**

**There is no 1–7 numbering anywhere** in ProPresenter's UI, docs or API. **[V]** What looks
like numbering is the **seven clear buttons**, and their own documentation says:
*"The clear buttons stacked order is also reflective of the order the layers are stacked on
your screen."* **[V]** So the buttons, top to bottom, ARE the stack, top to bottom:

**Audio · Messages · Props · Announcements · Slide · Media · Live Video**

(Audio paints nothing; it sits at the top of the button column because the column follows
the stack and audio has no place in it.)

## 2. The rules that actually bite

- **Media covers a live camera.** Video Input is below Media. Enable the camera, and any
  media or slide content layers on top of it. **[V]**
- **A slide's background colour paints above media** since 7.11 — *"should you add a media
  action on a slide, and not see the media, but instead see a color, you would need to
  disable your slide or presentation background color."* **[V]** This is the single most
  common ProPresenter support complaint.
- **Announcements draw BELOW the slide.** An announcement look turns Announcements on and
  everything under it off. **[V]**
- **Only one layer ever forces another off:** foreground media clears the live slide;
  background media does not. Everything else is just covering, by stack order. **[V]**
- **"Clear Media" will not remove a picture baked into a slide in the editor.** That media
  is part of the slide, so it clears with the slide. **[V]**

## 3. What each clear button does

Each clears **its own layer only**. **[V]** Names come from three different vocabularies in
ProPresenter's own products (rail, desktop menu, API), which is worth knowing when reading
their docs:

| Rail | API | Clears |
|---|---|---|
| Audio | `audio` | Splits into Music and Audio Effects at group level |
| Messages | `messages` | Messages **and any audience timer**, because a timer is a message |
| Props | `props` | All active props |
| Announcements | `announcements` | The announcement presentation (optionally stops its timeline) |
| Slide | `slide` | The slide, including media embedded in the slide |
| Media | `media` | Media-bin media only |
| Live Video | `video_input` | The camera. **No default shortcut** |

**Clear All is not a command.** It is an editable **Clear Group**, and ProPresenter warns:
*"if you do [change it], you will no longer have a clear group that truly clears everything
unless you create a new one."* **[V]** There is no `clear/all` in their API. **[V]**

**Clear Groups** (7.7+) let you build your own multi-layer clears from exactly eight things:
Music, Audio Effects, Messages, Props, Announcements, Presentation, Presentation Media,
Video Input. Their own worked example is **"All But Video Input"** — the IMAG case. **[V]**

**Clear to Logo** clears the Media layer and sends a single global logo there; it only appears
if a logo is set in Preferences. **[?]** whether it also clears Video Input / Props /
Announcements — their guide pages are down; test in the app.

**Shortcuts**, identical on Mac and Windows: F1 Clear All, F2 Slide, F3 Media, F4 Props,
F5 Audio, F6 Message, F7 Announcements, F12 Clear to Logo. Editable since 7.7. **[V]**
Note for anyone coming from ProPresenter 6: F6 used to be Logo. **[V]**

## 4. Timers

**A timer is not a layer.** **[V]**

- On the **audience screen** a timer is a **Message carrying a timer token**, styled by a
  Theme. So clearing Messages (F6) removes it.
- On a **stage screen** a timer is an object in the stage layout. **No audience clear touches it.**
- **Clearing never stops a timer.** Start/stop/reset is separate. **[V]**

## 5. How themes and Looks fit

**Theme = style. Look = routing. The layers are the fixed base both act on.**

- A **Theme** controls the Slide layer (font, size, caps, scaling, stroke, shadow, text box
  position, shapes) plus theme media. **It can never turn a layer on or off, and never
  changes the words.** **[V]**
- A **Look** is a grid of screens × layers. Per screen it turns layers on or off, and can
  carry **a different theme per screen** and a mask. Unlimited saved presets, switchable
  live, from the Screens menu, or as a slide action. **[V]**
- Therefore **the only way to change theme live is to swap a Look** that carries a different
  theme. Applying a theme to slides is an edit, not a live action. **[V]**
- The per-screen switches are exactly: Video Input, Media, Slide, Announcements, Props,
  Messages — plus a theme override and a mask. **[V]**
- Applying a theme **keeps** bold, italic, underline and a colour applied to part of a line;
  it **overwrites** font, size, position and box geometry, which always follow the theme. **[V]**
- Trap worth knowing: media added in a theme's **Theme tab** goes to the real **Media layer**;
  media added from the button at the top of the theme editor goes onto the **slide**. **[V]**
- Looks apply to **audience screens only**. Stage screens are layouts of elements, not a
  layer stack. **[V]**

## 6. Where PresentFlow differs today

Matching already:

- The seven clear buttons, their names and their order.
- The Layers panel now shows the same seven rows, clears per layer, circled ✕ for Clear All.
- Clears are destructive; no hide toggles.
- A timer now clears with Messages.

Not matching yet:

| # | Difference | Impact |
|---|---|---|
| 1 | **Props draw below Announcements.** ProPresenter has Props above. | Wrong thing on top when both are live |
| 2 | **Media draws below Video Input**, patched at render time. ProPresenter has Media above. | Camera can cover media |
| 3 | **Props is one church logo.** ProPresenter has many props, single-prop mode, auto-clear. | Name promises more than it does |
| 4 | **Announcements is not a parallel presentation** for a lobby screen. | Feature absent |
| 5 | **No Clear Groups**, so Clear All is fixed, and there is no "All But Video Input". | IMAG operators have no safe clear |
| 6 | **No Clear to Logo (F12).** | Missing |
| 7 | **Messages have no theme and no tokens** (name, clock, timer). | Messages are unstyled |
| 8 | **No Mask, no Screen Color, no background-colour switch.** | Absent (screen colour is trivial; mask is not) |
| 9 | **Looks/Scenes exist but are off for most churches** and are not the per-screen layer grid. | No per-screen layer control |
| 10 | **Stage timers** are not a separate stage-layout object. | Clearing behaviour differs |

## 7. Proposed order of work

1. **Draw order** — Props above Announcements, Media above Video Input. Small change, but it
   alters the projector, so: preview, then a rehearsal on a real projector with a camera.
2. **Clear Groups + Clear to Logo (F12)** — gives operators "All But Video Input".
3. **Messages with a theme and tokens** — makes messages presentable.
4. **Props as a collection** — several props, single-prop mode, auto-clear.
5. **Looks as the per-screen layer grid** — built on Scenes, which already exists.
6. **Announcements as a parallel presentation** — the largest piece, and the least urgent.

Screen Color and the background-colour switch can ride along with (1). Mask is deliberately
last: it is the one layer with no equivalent anywhere in PresentFlow today.

## 8. Questions for Victor

1. **Draw order:** confirm we flip Props above Announcements and Media above the camera to
   match ProPresenter, and that we rehearse it with a camera before a service.
2. **Clear All:** ProPresenter lets you edit it and warns you about it. Do we keep ours fixed
   and add named groups alongside, so the panic button always works?
3. **Audio:** show the row greyed as ProPresenter does, or hide it until audio exists?
4. **Props:** worth building the full collection, or is one logo enough for these churches?
5. **Announcements:** is a lobby screen running its own presentation something any of them
   actually use?
6. Two things the docs don't answer — please test in real ProPresenter: does switching a
   Look change what's **already on screen**, and does applying a theme **replay the
   transition** on live output?
