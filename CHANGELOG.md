# Changelog

All notable changes to Kinboard land here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **The public demo now shows pocket money too.** Neither child had an account, so the evolving avatar, the saving goal and the allowance countdown were invisible to anyone trying the demo. Both children now have one, at different avatar stages.
- **The public demo now shows the school timetable and pack list.** Nobody in the demo family was marked as a child, so the timetable screen greeted every visitor with "no child set up" — even though five full weeks of lessons were sitting in the demo data the whole time. Two of the children are now marked as such, the pack list knows what to remind you to bring for each subject, and the demo opens on the finished dashboard rather than the setup checklist. The demo also carries about fifty birthdays instead of ten, which is closer to what a real household accumulates, and its family members now use Kinboard's own colour palette instead of stand-in colours.

### Fixed
- **The PIN prompt no longer disappears while you are standing at it.** Settings was not on the list of screens where the screensaver holds off, so pausing at the PIN pad long enough let the screensaver take over and cover it — which looks like the prompt timing out. Related: which screens hold the screensaver off was decided once when the app started and never updated as you moved around, so it was frequently wrong.
- **Pocket money settings can be changed again.** Every edit on the pocket money settings screen — interest rate, allowance amount, how often it arrives — was rejected by the server and silently discarded, so the screen appeared to accept a change and then forget it. The same failure stopped a child's avatar stage from being recorded, which could replay the "new stage" celebration on every visit.
- **The setup checklist no longer takes over the wall display.** Until a family finishes setting up, the getting-started list sat above the clock and the family row — the most valuable block on the screen — on a device where none of it can be acted on anyway. Wall displays now show it collapsed to a single line; phones and tablets are unchanged, and collapsing or expanding it on a device is still remembered.

### Security
- **`js-yaml` updated to 4.3.1** (CVE-2026-59870, quadratic CPU consumption). Build-time only — it reaches the project through ESLint and was never part of the running application, so no instance was exposed.
- **Sensor and forecast colours follow the theme, and the pale ones are visible.** Temperature, humidity and battery readings, door and motion sensors, the recycling widget and the timetable's child filter were still coloured with fixed values left over from before the palette existed, so they ignored light/dark and the alternate colour schemes. The clothing suggestions in the weather detail were the worst of it: the mild-weather ones were pale yellow and pale green on a pale card, barely visible. The temperature ladder still runs blue-cold to red-hot — it just adjusts itself to the background now. Radar and rainfall maps keep their standard meteorological colours, which are not ours to reinterpret.
- **Sideways swiping in the weather detail no longer drags the panel behind it.** Flicking through the hourly forecast past the last hour handed the gesture to the panel underneath, so it lurched. The same applies to every horizontally scrolling strip in the app.
- **A vehicle's settings no longer claim to save themselves.** The Tesla settings carried a line reading "Saved automatically." — in English regardless of your language, and untrue: that screen saves when you press Save, and nothing was saving in the background. Anyone who trusted it and navigated away lost their edits. The line is gone, and the Save button now shows that it is working and tells you if it fails, instead of appearing to do nothing on a slow connection and staying silent when a save actually failed.
- **Modals are solid again.** Every dialog, sheet and side panel — the smart-home controls, a person's details, the new-event form — was very slightly see-through, so whatever sat behind it showed as a faint sharp ghost across the content you were trying to read. They used to be frosted glass, and when the frosting was removed for wall-display performance the see-through part was left behind, which is worse than either. The same fix applies to the buttons that sit on top of a recipe photo.
- **The documented backup command produced unusable backups.** Both `Self-hosting` and `Troubleshooting` told you to run `docker exec -t kinboard-db pg_dump -U postgres …`, and that line fails in two separate ways. `postgres` is not a superuser in the Supabase image, so `pg_dump` aborts partway through with `permission denied for table _realtime.feature_flags` and leaves a ~166-byte file behind — which still looks like a backup. Fix that by dumping as `supabase_admin`, and a second problem appears: `-F c` writes a binary archive, but `-t` allocates a TTY that rewrites line endings in the stream, so the result is corrupt and `pg_restore` refuses it. That one is the more dangerous of the two, because a mangled dump is *larger* than a correct one and passes any size check. Both commands are corrected, and both pages now show how to verify a dump with `pg_restore -l`, which is the only check that catches either failure. Worth re-checking any backup you took after a realtime image upgrade — which tables sit under which owner shifts between versions, so this can begin failing on a setup that was fine for months.
- **The lights button no longer sits on top of the weather on a phone.** It floated in the bottom corner, which on a phone is exactly where the wind speed and humidity are printed — so two live readings were covered on the screen the household looks at most. On phones it is now a normal tile in the dashboard, above the weather; on tablets and wall displays, where there is room for it to float without landing on anything, it is unchanged.
- **The pickers that choose a vehicle, a stock, a period or a calendar view announce themselves correctly.** They were built from the tab component, which tells assistive technology that each button owns a panel of content and gives the address of that panel. None of these screens has such a panel — the content sits elsewhere on the page — so anyone following the reference arrived nowhere. They are now a group of toggle buttons, which is what they always were. Nothing changes visually, and they keep the same arrow-key behaviour.
- **The birthday ring's month names are readable on a phone.** The ring is drawn at a fixed internal size and then scaled to fit, and text scaled with it — so the month names that were sized to be legible on a wall display shrank to under eight pixels on a phone, smaller than they had been before anyone tried to fix them. They now hold their size at every screen width, and the ring was tightened slightly so the avatars no longer clip the first letter of a month.
- **Section headings on six screens are no longer skipped a level.** The calendar, shopping, recipes, news, calendar settings and camera screens each went straight from the page title to a third-level heading with nothing in between, so anyone navigating by headings — the usual way to move around a page with a screen reader — met a gap where a level should be.
- **The wall navigation no longer shows a chopped-off word next to Home.** Home is pinned to the left of the bar so it cannot scroll away, but the strip it reserved was wider than the block that covers it. The 27px left over was a window onto the items scrolled underneath, so the bar read "Home │ an │ Aufgaben" — the tail of "Stundenplan" surfacing through the gap. Both sides now measure from the same value and cannot drift apart.
- **The device list fits on a phone.** Each row put an icon, a name, up to two badges, two switches and two buttons on one line. On a phone the name wrapped and the controls were pushed on top of it, so the kiosk switch was drawn over the device name. The controls now move to their own row below the name on narrow screens.
- **Person colours are legible everywhere they appear.** A person's colour is used three ways — as the fill behind their initials, as coloured text on a tint of the same colour, and as a plain label — and each was handled differently. Initials were drawn in white on any colour, which is unreadable on the lighter half of the palette. Coloured text was darkened by a fixed amount regardless of theme, which in dark mode moved it *toward* the background rather than away from it. Initials now pick black or white by measuring the colour, and coloured text adjusts in the direction that suits the current theme. The same fix carries over to school-subject colours on the timetable, which shared the construction. Measured across the whole palette, the worst case went from about 2:1 to above 4.5:1.
- **Every switch, toggle and dropdown now has a name.** Around forty controls across Settings, the smart-home cards and the timetable were reachable but anonymous: a screen reader announced "switch" or "combobox" with no indication of what it controlled. Each now carries the same wording as its visible label.
- **The "larger text" setting now actually enlarges the small text.** Around seventy sizes across the app were written in fixed pixels, and pixels do not respond to the setting — so turning it up grew everything *except* the 9–12px labels, counts and badges that were hard to read in the first place, making the difference between them worse rather than better. All of them are now relative sizes, and they respond.
- **Small text steps up on wall-mounted displays.** Type was identical on a 390px phone and a 2560px panel, so the smallest labels were sized for something held at arm's length and then hung on a kitchen wall. On display-sized screens nothing load-bearing now renders below 13px. Phones and tablets are unchanged.
- **The person filter chips on the calendar are big enough to hit.** They were 32px tall on the main way of filtering the calendar by family member.
- **The pocket money screen speaks to the child it is for.** "Next stage at €30" was set smaller than everything around it, under a large avatar and a large balance, and the instruction that the avatar could be tapped was smaller still — at ten pixels, on a screen aimed at children. The progression line is now full size and the avatar looks tappable instead of being described as tappable.
- **The app no longer starts on a blank screen.** While the first data loaded, a wall display showed an empty background with one small spinner — for as long as it took, which on a slow self-hosted stack is several seconds. It now paints the dashboard's actual shape straight away and fills in.
- **Scrollbars are back on phones and desktops.** They were hidden everywhere, on the reasoning that a wall panel does not need them. That is true of a wall panel and wrong for every other device, where it removed the only clue that a page scrolls. Kiosk devices still hide them.
- **A widget you have not set up no longer takes a full slot on the dashboard.** The school timetable widget, before a child is marked as one, filled a whole cell in prime position — and because a taller neighbour set the row height, it left a large empty gap beside it. It is now a compact card and the grid packs around it.
- **The birthday year-ring stays readable with a real number of birthdays.** Past about thirty entries the avatars overlapped into an unreadable smear in the busy months. Marks that would collide are now combined and carry a "+2" count, the same way the month strip above already worked.
- **Home Assistant says when it cannot be reached.** Every card correctly showed "unavailable", but nothing on the page said why or offered a way to check — and underneath, a failed request was being reported as a successful empty one, so the app could not tell the difference between "unreachable" and "nothing configured". Both are fixed.
- **Smart-home cards follow the theme like the rest of the app.** Lights, locks, climate, media and the rest were drawn with fixed colours picked straight from a stock palette — around 130 of them — so they ignored light/dark, the monthly accent and the alternate neutral palettes. One consequence: a task counter measured barely legible in light mode. They now use named colours for what a device is doing (on, emitting light, cooling, alerting, idle), which adapt like everything else.
- **Error and empty states are recognisably related.** A screen with nothing on it and a screen that failed to load looked like they came from different apps — one a dashed card, the other loose text behind a blurred glow. They now share a shape; only the colour and the retry button differ.
- **Corner radii, shadows and one padding value follow the design tokens.** Several sizes matched the token by coincidence rather than by definition and would have silently drifted apart the moment it changed. Two competing shadow systems became one (the wrong one drew a hard black shadow instead of the palette's warm tint), and a stray 18px padding joined the scale. No visible change today — that is the point.
- **The demo's shopping list was rendering empty.** It said "14 of 16 still to buy" above a blank page. The demo data labelled each item with an English category name while the app looks them up by its own internal names, so every row was silently skipped. Only the demo was affected — a real household's list was always fine.
- **The day view's timeline now covers the day it is showing.** It always drew a fixed 06:00–22:00 window, so anything outside that — a 21:30 film night — appeared as a bar below the last hour mark, floating free of any time.
- **The screensaver looks intentional before you have set up photos.** With no photo source configured there was nothing to draw, so the middle of the screen was a large black rectangle. It now shows a soft gradient in the month's colour.
- **Delete is no longer next to edit in the family-member list**, and the calendar's day timeline, the energy flow and a few other screens make better use of a wall-mounted display.
- **The energy screen no longer shows the same numbers twice.** Solar yield, self-sufficiency and grid export appeared beside the flow diagram *and* in the statistics below it; the diagram now has the card to itself and is larger.
- **The shopping list is the first thing you see on the shopping screen.** The install prompt and the add form had pushed it below the fold on a phone.
- **The energy flow animation settles.** The marching dashes ran forever, which on an always-on kitchen display is motion in the corner of your eye all day. They now stop shortly after the numbers stop changing.
- **Entering a wrong family code now marks the code field**, instead of putting the message two fields below it with nothing to say which input was wrong.
- **A failed news thumbnail no longer leaves a grey box** on the screensaver, and the birthday screen no longer gives two different charts the same heading.
- **Screen readers no longer read the clock out loud every minute.** The time was marked as a live region, so assistive tech announced it on every tick — every *second* if you had seconds switched on — burying everything else on the page. It is still available on demand. The four PIN boxes in Settings also gained names; they were four unlabelled password fields.
- **Pocket money, stocks and vehicles were missing their main content landmark**, so the "skip to main content" link pointed at nothing on those three screens and assistive tech had no way to jump past the navigation. The dashboard's own top-level heading was missing too.
- **The rain chance in the weather forecast is readable.** It was drawn in a fixed light blue at half opacity, which measured worse than 2:1 against the background in dark mode and worse than 1.6:1 in light — the least legible thing on the dashboard, at the smallest size on it. It now follows the light/dark palette at full strength, one size up.
- **Settings descriptions are no longer cut off in German.** German runs about a third longer than English, and six of the one-line explanations under each settings entry were being clipped mid-sentence. They now wrap.
- **Family members show their colour's name instead of its hex code.** The People screen listed "#3B82F6" under each person; it now says "Sky" (or "Himmel", or "Ciel"). The colour picker's swatches gained the same names, so they are no longer announced as raw keys.
- **Blur effects are gone from dialogs, sheets and menus.** Kinboard deliberately avoids blur because it is expensive on the ARM boards these displays usually run on — a rule the stylesheet states four times, and which every dialog and sheet had quietly been breaking. One of them even carried a local override to undo it. Depth now comes from shadow, which costs nothing. There is a lint rule now, so this cannot drift back.
- **Regenerating the calendar feed link no longer looks like a harmless button.** It revokes the link for every family member and every subscribed app, and it sat directly under "Download a backup" in the same style and width, with its warning printed underneath — i.e. after you had already clicked. The warning now comes first and the button reads as destructive. Creating a link for the first time is unchanged.
- **Notification switches no longer claim to be on while notifications are off.** With push disabled, the five per-category switches still showed in their "on" position because a stored preference said so. The screen said "push off" and "five categories on" at the same time.
- **Light and dark mode can be switched from a phone.** The toggle only existed in the desktop navigation, so on a phone it was in the page but never visible, and the only route to it was Settings → Design. It is now in the "More" sheet.
- **The floating lights button no longer sits on top of the widget beneath it.** It overlapped the tasks card and its "+N more" link on a wall display, the today strip on a phone, and the clock at 200% zoom.
- **The kitchen display finally uses the screen it is hanging on.** On a wall-mounted landscape display, the clock and greeting were taking almost half the height and the widgets underneath were cut off by the navigation bar — you had to walk up and scroll a wall display to see today's tasks. The clock now keeps a fixed share of a landscape screen and the widgets sit fully in view beneath it. On large panels the dashboard also stops pretending to be a laptop: it spreads across the full width instead of stopping at a fixed column, so a 27-inch display shows more at a readable size rather than leaving wide empty margins while the cards inside it squeeze their text onto two lines. Portrait displays, which already fitted, are unchanged.
- **Small print on the wall display is readable from across the room.** The little uppercase headings above sections — "TODAY", "OPEN", "NEXT BIRTHDAY" and the rest — were set at 11px and dimmed, which is fine at arm's length and unreadable from the kitchen doorway. They are now larger, and larger again on display-sized screens. One knock-on effect: the heading style used to force its own colour onto anything it touched, which is why the pack-list subtitle on the timetable screen was showing as grey-on-orange. It now leaves the colour to whatever is using it.
- **Calendar entries in the month view are legible and easier to hit.** Event titles were drawn at 11px and their chips were 21px tall — below the minimum size a touch target is meant to be. They are now sized to the display and at least 24px tall, and the day cells grow on larger screens to make room. Tapping an event rather than the day around it is also no longer ambiguous: the two were nested controls, so a tap could land on either.
- **Meal names no longer shorten to two letters.** In the weekly meal plan the cooking time, servings, drag handle and menu button were all competing for the same line as the dish, leaving it about 33 pixels — enough for "Sp…". The name now gets the full width of its card, and cooking times over an hour read as hours instead of "1440m".
- **The dashboard says so when it cannot reach the server.** If the database or API was unreachable, the display quietly showed "no appointments or tasks today" and a set of loading placeholders that never resolved. That reads as a free day, which is the one thing a family calendar must never get wrong. A failed load now says it failed, offers a retry, and a banner appears when the problem is more than one widget.
- **Every page had a strip of dead scroll at the bottom.** Pages set themselves to a full screen tall and then had the navigation bar's height added on top, so almost every screen could be nudged down by that much with nothing underneath. Pages that fit now sit still.
- **The back arrow in Settings is announced properly on phones.** Below tablet width its label is hidden and only the arrow shows, which left screen-reader users with an unnamed link on all eighteen settings sub-pages — and it is the only way back out of them on a phone. The dashboard also gained a proper top-level heading, which it never had.
- **Recipe titles keep their contrast over the photo area.** The dark gradient behind the title was slightly too light for a white title, particularly for recipes without a photo, and the text shadow meant to guarantee it never actually rendered — that style is not one Tailwind provides and no plugin here supplied it. The gradient now carries the contrast on its own.
- **Times and counts no longer switch to a different typeface.** Clock times in the calendar, the school timetable and the pack list, along with dates on birthdays, note timestamps and shopping quantities, were all being drawn in the monospaced font used for join codes — so those areas looked like they belonged to a different app. They now use the same typeface as everything around them, and the digits still line up. Monospace stays where it earns its place: join codes, PINs, keyboard shortcuts, addresses and device ids. The small uppercase headings scattered through settings, shopping, birthdays and recipes now share one definition instead of six near-identical copies that had drifted apart in size and letter-spacing.

## [1.6.10] - 2026-08-06

### Security
- **Settings could open without the PIN.** The lock checked whether a PIN existed, but treated "I don't know yet" the same as "there isn't one" — so before the app had finished loading which family it belongs to, or if that check failed, Settings opened straight through with no prompt. Reaching Settings from a link elsewhere in the app was the usual way to hit it. The lock now stays shut unless it has positively established that no PIN is set, and shows a locked message rather than the settings if it cannot find out.
- **The service that answers the app's data requests is two major versions newer.** It sits between your browser and the database and had been pinned to a build from 2023. Nothing about how Kinboard talks to it changes. Two leftover settings that copied the signing secret into the database session — where any function could have read it — are gone; nothing was using them.
- **The live-updates service is around 75 releases newer.** It had been pinned to a build from early 2024, still carrying settings from a hosting platform Kinboard never ran on. Nothing changes in the app; it applies its own database updates on first start, so give it a minute longer than usual to come up.

### Fixed
- **Changes from other devices now appear straight away again.** Since 1.6.0 the live connection had been carrying the wrong credentials, so the server correctly decided it was allowed to see nothing and sent nothing. It never looked broken — the connection itself was healthy, so the "live updates paused" warning never appeared — and screens simply refreshed on their own schedule instead, up to a minute behind. Adding something on a phone should once again show up on the kitchen display while you are still standing there.

## [1.6.9] - 2026-08-06

### Security
- **The database moves up to the current 15.x.** It had been pinned to a build from early 2023 and was thirteen point releases behind, each of which carries upstream PostgreSQL fixes. Same major version, so nothing about your data changes and there is no conversion step — it starts up on exactly the files it was already using.

### Fixed
- **A brand-new install could get stuck before it ever started.** On a fresh database the setup script and the app's own migrations ran as two different users, and the second could not modify what the first had created — so the app refused to start and retried forever. Existing installs were never affected, which is why it went unnoticed. 
- **Upgrading could silently do nothing if you run the pre-built image.** The upgrade command in the release notes left out the file that actually points at the published image, so Docker quietly rebuilt the app from whatever source happened to be on disk — usually the version you were already on. It looked like a clean upgrade, every container came up healthy, and only the version number in Settings disagreed. The instructions now name both files, `start.sh up` warns when it is about to rebuild while a newer image sits unused, and Troubleshooting covers the symptom. Thanks to @edlucky1 for chasing this down across several attempts ([#106](https://github.com/svenger87/kinboard/issues/106)).

## [1.6.8] - 2026-08-05

### Security
- **The services Kinboard is built on are years newer.** The API gateway that sits in front of everything, the service that issues sign-in tokens, the file storage service and the image processor were all pinned to versions from 2023 and 2024. The gateway in particular had a serious denial-of-service flaw that a crafted request could trigger. Upgrading is invisible in day-to-day use — nothing to reconfigure, nothing to re-join.

## [1.6.7] - 2026-08-05

### Security
- **A device could issue itself a session that never ended.** The table holding device sessions was left writable by the browser, from back when the database had no row-level security and every table was opened up alike. Nothing in Kinboard used it — sessions are only ever written by the server — but it meant any device already in the household could quietly give itself a credential with no expiry, undo a sign-out you had just performed from the Devices screen, or sign another device out. It is now server-only, which is what the rest of the app already assumed. No re-joining; nothing to do.
### Fixed
- **Removing a family member did nothing if they had ever been assigned an event.** Settings → People closed the dialog and left the person sitting exactly where they were, with nothing on screen to say why. Their events were the reason: the database refused the deletion outright instead of simply unassigning them, which is what it was always meant to do and what it already did for birthdays and notes. Only installs that upgraded were affected — a brand-new one got this right, which is why it went unnoticed.
- **Gift ideas on a birthday never saved and never appeared.** The list came back empty no matter how many you had added, and adding one did nothing at all. Kinboard was refusing the browser access to that one table — it is the only one that never got the permission every other table has, so the feature had never worked on any install.
- **A shopping item no longer holds on to a recipe or a person that has been deleted.** Removing a family member or a recipe left the items they had added still pointing at them, so those items stopped showing where they came from. Anything already stranded this way is tidied up on upgrade.
- **Kinboard no longer keeps every notification it has ever sent.** Delivered reminders were never cleared out, so the table behind them grew for the life of the install with nothing ever reading the old rows again. They are now kept for 30 days. Deleting a device, a person or a recipe also got considerably faster — Kinboard was reading whole tables end to end to work out what still pointed at them.
- **An upgraded install now checks recipe difficulty and meal times the same way a fresh one does**, so an import can no longer drop a meal into a slot the app doesn't recognise and have it quietly vanish from the plan.
- **Camera passwords were being filed under the wrong shape.** They were correctly kept out of everything sent to your devices — that part worked — but in the protected store the list of cameras was written as a numbered object rather than a list. Nothing visible went wrong, and nothing needs re-entering; it is now stored the way the rest of the code expects to read it.
- **Kinboard's own API now checks who is asking.** Almost every endpoint identified you by a household id it took from the request — an id that sits in your browser's storage, in the address of nearly every request, and in the server's log files. It was never a secret, and it was the only thing standing in the way: anyone who could reach your Kinboard and had seen that id once could download the whole household — people, calendars, events, notes, birthdays, shopping, pocket money — set or remove the settings PIN, repoint your integrations, or delete the household outright. On an instance published to the internet, "anyone" meant anyone. Every one of those endpoints now requires the sign-in your devices already have, and refuses a request that names a household other than yours. The same check covers the integrations Kinboard makes calls on your behalf with: your Home Assistant (including switching things on and off), your Immich library, your cameras, Bring!, Google Calendar and CalDAV — each of which used your stored credentials for whoever asked.
- **Restoring a backup is now rate-limited.** It has to stay open to a device that hasn't joined a household yet — restoring onto a fresh install is the whole point — but it wrote as much as 25 MB per request with nothing slowing it down.
- **The calendar subscription link still works exactly as before.** It is the one address deliberately readable without signing in, because Google, Apple and Outlook fetch it from their own servers; it has always been protected by a long random token you can rotate, and that is unchanged. Rotating it now requires being signed in, so nobody else can break your subscriptions from the outside.
- Nothing to do on your side: this changes what the server accepts, not the sign-in your devices already hold, and no device needs to re-join. A device that has lost its sign-in could already not load anything from the database; it now gets the same clear refusal from these endpoints instead of some of them quietly still working.

## [1.6.6] - 2026-08-05

### Security
- **Removing a device now signs it out.** Deleting a device from Settings → Family → Devices only forgot the name attached to it: the session it was using stayed valid until it expired on its own, so a phone that was lost or handed on kept its access to the household. Sessions are now deleted along with the device by the database itself, which is the only place that can guarantee it — devices are removed straight from the browser. Any sessions already stranded this way are cleared on upgrade, so a device removed before today is signed out too.

## [1.6.5] - 2026-08-05

### Fixed
- **The battery charts were still losing a digit after 1.6.4.** Widening the axis wasn't enough on its own: all three energy charts pulled themselves leftwards with a negative margin, dragging part of the axis off the edge of the drawing area where it was clipped away. The battery percentage lost the most and still read "00%" where it meant "100%". The charts no longer do that, so the axis keeps the width it asks for.

## [1.6.4] - 2026-08-05

### Fixed
- **The energy charts were cutting the numbers off their own axis.** Solar power lost the leading digit of anything over 999 W, so a 1600 W reading showed as "600" and the scale read 600, 200, 800, 400, 0 on the way down — nonsense, and quietly wrong rather than obviously broken. The battery charts were worse: the percentages disappeared entirely and left a column of bare "%" signs. Both charts now size their axis to the numbers they actually have to show, so it holds at a few hundred watts or at five figures.
- **Adding the shopping list to an iPhone home screen could save the main app instead.** Opening it from the dashboard prompt handed over without a fresh page load, and both iOS's "Add to Home Screen" and Chrome's install decide what they're installing from the page as it was loaded — so you could end up with Kinboard on your home screen, opening to the dashboard, when you asked for the shopping list.
- **Pinch to zoom works in the shopping list too.** It was switched back on everywhere in 1.6.3, but the shopping app kept its own screen settings and overrode that — leaving it disabled on exactly the screen most likely to be read at arm's length in a supermarket, and with no browser zoom to fall back on once it's on your home screen.
- **A birthday with no year no longer claims the person is turning 0.** Leaving the year blank doesn't store "unknown" — it quietly stores this year — so the dashboard and the screensaver both worked out an age of 0 and announced it. They now simply show the name. The birthdays page itself already got this right, which is why it only showed up on the two screens you actually glance at.

## [1.6.3] - 2026-08-05

### Fixed
- **A wall display left running for days no longer quietly empties itself.** Upcoming events, the bin-collection reminder and the screensaver each worked out their date range once, when the page was first opened, and never again — so after a fortnight they showed nothing at all while real events sat in the calendar, and "bin day tomorrow" simply stopped arriving. The countdowns beside birthdays had the same problem and would sit on the same number indefinitely. Nothing ever closes and reopens a kiosk, which is why this only ever bit the screen it matters most on.
- **An unattended screen can get itself out of trouble again.** An error used to leave the display parked on a card that only a person standing in front of it could clear, and the same was true when Kinboard couldn't reach its server — so a hiccup at 3am meant a dead panel until somebody walked past. Both now keep trying on their own, and say so while they do. A pending update no longer waits forever for someone to tap it either.
- **The screensaver now shifts its clock and panels by a few pixels every so often**, so a screen that shows the same layout around the clock doesn't wear it into the panel.
- **"Display off" in the screensaver settings no longer pretends to do something.** A browser cannot power a screen down, and the kiosk's own presence sensor was handling it independently the whole time — so the setting had never had any effect in either position. It is now shown as unavailable, with an explanation, instead of silently doing nothing.
- **Things that failed used to fail invisibly.** Deleting a vehicle, saving a pocket-money goal, changing an allowance or interest rate, closing a pocket-money account, and switching a plugin on or off could all quietly do nothing at all — the dialog closed either way, so a failed delete looked exactly like a successful one. Vehicles, stocks and news also announced "nothing here yet, add your first one" when the truth was that loading had failed, which sent you off adding things that were already there.
- **Pinch to zoom works again.** It had been switched off everywhere, which left anyone who needs larger text with no way to get it — installed as an app there isn't even a browser zoom control to fall back on.
- **Buttons that were too small to hit reliably** on phones: opening a news article's original page, the calendar's month and week controls, ticking off a to-do, and the language picker. Delete and drag controls in the Google calendar settings only appeared when a mouse hovered over them, so on a phone or tablet they were invisible.
- **Pages that ran off the side of the screen or hid their own content** on a phone: the stocks page scrolled sideways, the setup wizard pushed its own buttons out of view (worst in German and French), and the last items on the shopping and recipe pages sat permanently underneath the bottom navigation where they could not be tapped.
- **The shopping app no longer dumps you into the main app.** Its back arrow led to the dashboard, which is outside the shopping app's own boundary — so tapping it left the shopping app entirely, with no navigation to get back. Inside the installed app the arrow is simply gone; in a browser tab, where the dashboard really is where you came from, it stays.
- Two labels for screen-reader users were missing in every language and showed a raw error instead of their text.

## [1.6.2] - 2026-08-05

## [1.6.1] - 2026-08-05

## [1.6.0] - 2026-08-04

### Security
- The admin database key can no longer be used from the internet. It is only ever needed by Kinboard's own server, which reaches the database on the internal network — so the public entry point now rejects it outright, while the ordinary browser connection is unaffected. Defence in depth: the key is not exposed, but a leak would no longer be usable from outside.
- Joining and creating a household are now rate-limited, and the app sends the security headers a public site should — HSTS, clickjacking protection, and more. Both from a security review of the 1.6.0 release.
- A brand-new install now has row-level security fully applied on its first start. Two migrations ran after the one that sets it up and put the old rules back, so a fresh install ended up protecting only a third of its tables — an existing installation upgrading was unaffected, which is why this only showed up when building one from scratch.
- Fresh installs and upgrades now enable row-level security correctly. `init.sql` was still creating the old policies that never applied, and two migrations were fighting the new ones on every restart — one disabling row-level security outright, another re-creating a rule that let every household read every other household's notifications. See UPGRADING.md: **every device has to re-join after this**, so note your join code down first.
- Joining a household, and creating one, now happen on the server. Kinboard used to look your family up by join code from the browser, against a table the browser could read in full — which meant the code wasn't really being checked, and every household's code was readable. Devices now get a proper session that the browser cannot read or forge.
- The photo proxy no longer fetches whatever address it is given. It was meant to fetch wallpapers from Unsplash, but accepted any URL, required no sign-in, and handed the response straight back — so anything able to reach your Kinboard could use it to read pages from inside your network. It now only fetches from Unsplash, over HTTPS, and only for a known household.
- The camera and photo proxies now check the id they're given. Both build a request to your own Home Assistant or Immich using your stored credentials, and a crafted id could steer that request to other parts of those services. The address itself was never at risk — it comes from your settings — but the rest of the path is now pinned to the shape an entity or asset id actually has.
- Camera passwords are no longer stored in the clear. They were kept alongside the rest of the camera settings, which meant they were sent to every device that loaded the page, readable by anything else on the network, and written into every backup file you export — and the settings PIN did not cover any of that. They now live in the same protected store as your other integration credentials. **Existing cameras keep working; their passwords move on the next save.**
- Importing a recipe from a link now checks where that link actually leads. A web address can look public and resolve to a machine on your own network, or redirect to one after the fact — either would have had Kinboard fetch it. Enormous pages are also no longer read whole into memory.
- The settings PIN now covers every settings page, not just the front one. Sub-pages were reachable directly, so a child on the kiosk could open Settings → Pocket money from the link on their own page and approve their own spend request, change the interest rate or edit the allowance — the page telling them approvals were PIN-protected linked straight past the PIN.
- Pocket-money and watchlist API routes now check that the thing you're editing belongs to your household. They previously acted on any id supplied, so anyone able to reach the server and guess a UUID could read or change another family's pocket-money account, approve a withdrawal, or reorder their tickers. Row-level security is off by design in Kinboard, which makes these checks the only barrier — and eleven routes were missing them.
- Updated `undici` (five advisories, one high: information disclosure between users, request smuggling, cookie and CRLF injection), `sharp`/libvips (four CVEs in image decoding) and `@babel/core` (arbitrary file read via a source-map comment, build-time only).
- The OpenWeatherMap API key is no longer sent to the browser. The weather map handed out tile URLs with the key embedded, so it appeared in the page's network requests and was readable by anyone who could open the dashboard — a guest on the wifi, anyone passing an unlocked kiosk. Tiles now go through Kinboard, and the key stays on the server.
- Feed fetching now resolves a URL's hostname and checks the address it actually points at, and validates every redirect hop, instead of trusting the hostname alone. A name like `feeds.example.com` can carry an A record pointing at `127.0.0.1` or a cloud provider's metadata endpoint, and a public host can redirect to one — either would previously have had the server fetch it. Applies to news feeds, which are the only URLs a household types in that Kinboard fetches on demand.
- The Next.js image optimizer is disabled. It was configured to accept **any** remote host, which made `/_next/image` an open image proxy: anyone able to reach a Kinboard instance could have the server fetch and decode an arbitrary remote image. That mattered because the bundled image decoder (sharp/libvips) is a version with known parsing vulnerabilities. Nothing in the app used the optimizer, so this closes the endpoint with no visible change.
- Updated `postcss` (path traversal when reading source-map comments) and `brace-expansion` (denial of service via crafted patterns) to patched versions.
- The ticker and vehicle endpoints matched on the id from the URL alone, without checking which family the row belonged to. Anyone who knew or guessed a row's UUID could read, edit or delete another family's entry. Both now filter by family, and a test blocks any future endpoint from shipping without that filter.

### Added
- **Your own RSS feeds.** Settings → News sources now takes any RSS or Atom feed alongside the built-in publishers — a local paper, a club, a blog, a project's releases. Paste the site address rather than hunting for the feed URL: Kinboard reads the page's feed declaration and, failing that, tries the conventional paths. A **Test** button shows how many articles were found and the latest headline before you commit to it, so a feed that quietly returns nothing can't sit in your list unnoticed. Reader mode works for your own feeds too. Up to 20 per family; see [News](https://github.com/svenger87/kinboard/wiki/News).
- **Pocket money goals can now be edited and deleted.** There was previously no way to change a goal's name, target or picture, or to remove one at all — a typo or an abandoned goal stayed on a child's page forever. Deleting a goal keeps the money and its transaction history untouched. Any goal can also be promoted to the main goal.
- Pocket money goals now show how much is still needed and roughly how many more allowances that is — the question a child actually asks, which a percentage bar doesn't answer. Any goal you can already afford offers the "ready to buy" action, not just the primary one, and asking a parent for the money now confirms it was sent instead of failing silently.
- Pocket money spend requests now show a badge on the navigation, so a parent sees a child is waiting on an answer without opening settings. The waiting-request notice on the child's page links straight to the approval screen.
- Pocket money now shows **when the next allowance arrives** — on the child's page, the dashboard widget and the parent settings screen, alongside the last payment date. The date was previously stored and never displayed, which made a correctly-working fortnightly allowance indistinguishable from a broken one for up to 13 days.
- CalDAV calendars (Settings → Calendar → CalDAV): connect Nextcloud, Radicale, Baïkal, SOGo, Synology, Fastmail, iCloud or any other CalDAV server with a username and password, pick which calendars to sync, and edit events from Kinboard — creations, changes and deletions are written back to the server. Closes the gap left by read-only `.ics` feeds for households outside the Google ecosystem ([#18](https://github.com/svenger87/kinboard/discussions/18)).
- Conflicting calendar edits are now caught rather than silently overwritten: if an event changed on your phone since Kinboard last synced, the save is refused with an explanation instead of discarding the other change.
- CalDAV calendars the server marks as read-only get a badge and are never written to, and a calendar that stops syncing (usually an expired app password) shows the reason in settings.
- Pre-release channel for testers: set `KINBOARD_TAG=next` in `webapp/docker/.env` to run release candidates and try fixes before they ship. `next` always points at the newest candidate, and removing the line returns you to stable. See [Self-hosting → Pre-release channel](https://github.com/svenger87/kinboard/wiki/Self-hosting#pre-release-channel).
- Weather can now be shown in imperial units. **Settings → Weather → Units** switches the whole household between metric (°C, km/h, km, mm) and imperial (°F, mph, mi, in), covering the widget, the detail view and the forecast ([#19](https://github.com/svenger87/kinboard/issues/19)).

### Changed
- Photo credits now follow Unsplash's rules. The screensaver showed the photographer's name and nothing else; it now credits Unsplash too and links back to the photographer's profile, and Kinboard tells Unsplash when a photo is shown — which is how a photographer's work gets counted as used.
- The news page keeps more articles: 50 per source instead of 15, and 150 in total instead of 40. Two sources used to run dry by the evening.
- Pocket money parent settings are grouped under Allowance and Interest headings instead of one flat grid of six controls, with a note that the allowance pays automatically on the chosen weekday.
- **Pocket money: the avatar stage now reflects the current balance, not lifetime earnings.** It used to only ever go up, so it said nothing about how a child's savings were actually doing — spending a month's savings left the avatar untouched. Stages now rise as money is saved and fall as it's spent. Nothing is lost: a **"best: Stage N"** badge records the highest stage ever reached and never falls, and the stage list marks stages that were reached before. Existing accounts keep their achievement — the badge is backfilled from lifetime earnings on upgrade, so nobody opens the app to find their avatar demoted with nothing to show for it.
- Pocket money stage thresholds retuned for balances (€0.50 / €1.50 / €4 / €10 / €30 / €80 / €200). The old top stage was €1000 of lifetime earnings, unreachable as a balance for a child on a few euro a week, which left the upper half of the progression dead. The early steps are deliberately small: a child who saves up and buys the thing lands on an empty account, so only a genuinely empty account is stage 1, fifty cents moves off it, and one €5 allowance reaches stage 4.
- The screensaver stops showing you the same photos. It picked each next photo at random, so one came back around every five minutes or so while a few of the photos it had fetched were never shown at all. It now works through the whole set in a shuffled order before any repeats. Each month also has fourteen search terms instead of eight, five are used per refresh instead of three, and the mix is less relentlessly industrial.

### Fixed
- The self-hosted auto-updater no longer gets stuck. If a file that used to be created locally became tracked upstream, the update's `git pull` aborted and — because the script stopped on the first error — the new image was never pulled, so instances silently stopped updating (including past the 1.6.0 security release). The updater now clears that specific kind of collision and always pulls the image even if the git step can't complete. Diun's runtime database is also no longer committed to the repo, which was the collision in practice.
- Pinning a note works again. The column it needs was only ever created on brand-new installs, so on anything that had been upgraded the pin button failed silently.
- The shopping app stops dropping you into the main dashboard. Two separate causes: a launch that couldn't reach the network fell back to Kinboard's home page instead of the shopping app's own, and joining a household from inside the shopping app always finished on the dashboard rather than where you started.
- The shopping list now has a permanent "Shopping app" button. The standalone shopping app could only be reached from the install tip, and dismissing that tip hid it for a year with nothing left to say it existed.
- Some stocks and ETFs showed an empty chart even though the data was there. The provider's library was rejecting the whole response over one field it didn't expect, and Kinboard read that as "no data". One holding in testing went from a blank chart to twenty candles.
- Searching for a stock or ETF works again. Every search — including plain ones like "AAPL" — returned "Yahoo Finance unavailable", so nothing could be added to the watchlist at all. The data provider's library was rejecting Yahoo's whole response because one entry in it no longer matched a shape the library expected.
- The crash page and the push-notification errors in Settings were German only. Everything else in the app has spoken your language for a while; these were the last places that didn't, and the crash page is the one screen with nothing else on it to explain itself.
- Changing two cameras in quick succession no longer undoes the first change. Deleting two cameras brought the first one back; adding two in a row kept only the second. Each change was calculated from the camera list as it stood when the page last drew, so whichever finished second overwrote the other.
- Kinboard now tells you when an event didn't reach Google Calendar. Adding, changing or deleting an event on a Google-linked calendar saved locally and pushed to Google afterwards — and every failure on that second step was silent, so an event that never made it to your phone looked exactly like one that did. A failed delete also no longer removes the event here, since it would only come back on the next sync.
- Two buttons that were nothing but an icon — remove a stock from the watchlist, and clear the location field — are now announced properly by screen readers instead of just "button".
- Restoring a backup keeps your default calendar. The setting still named a calendar from the old install, so the calendar page fell back to no default at all.
- Backups now say what they don't contain. Uploaded photos are files rather than database rows, so they were never in the export — and a restore reported success while leaving every uploaded image broken, with nothing to connect the two. The backup now lists the images it references, and the restore tells you to copy the storage volume as well.
- Recipe tags work now. The tag filter on the recipes page, the tags table and the export/import round-trip were all in place, but there was no way to put a tag on a recipe — creating one made the tag and never attached it, editing one ignored tags entirely. Both recipe forms now have a tag field that suggests the tags you already use.
- Two switches in Settings → Bring! now do what they say. "Auto sync" polled every two minutes whether it was on or off, and "Adopt Bring! categories" had no effect at all — both saved their state and were read by nothing.
- Reminders no longer fire for appointments you cancelled or moved. A reminder is queued up to ten minutes ahead and nothing rechecked it before sending, so a deleted event still announced itself at the old time, and a rescheduled one announced itself twice — once for the old slot and once for the new.
- The offline "pending changes" badge no longer sticks. When several offline edits to the same item were combined into one request, only one of them was cleared afterwards and the rest sat as pending for good — and every later sync re-sent work that had already gone through. An item you added and then deleted while offline left two rows behind that nothing could ever clear.
- Container logs no longer grow without limit. Docker keeps writing them until the disk fills, and Kong logs a line per request — on a dashboard that polls, roughly 10–15 MB a day, a few gigabytes a year, on a machine meant to run untouched. Each container is now capped at 30 MB of history.
- Setting the screensaver to **Off** no longer turns it permanently on. Choosing "Off" made the screensaver appear straight away and re-appear on every touch, leaving the display stuck behind it with no way out except changing the setting from another device.
- The month calendar now shows events on the days either side of the month. Those cells are part of the grid — the last days of the previous month and the first of the next — but nothing was ever drawn on them, so an appointment on the 30th looked like a free Monday and tapping it opened an empty day.
- Clearing a field when editing now works. Deleting a recipe's description, photo, prep time or cooking time — or an event's location — appeared to save and then left the old value in place. Only fields you changed to something new were ever stored; fields you emptied were quietly ignored.
- Kinboard no longer becomes unresponsive when Home Assistant, Immich or a camera stops answering. Requests to those had no time limit, so a device that is switched off but still on the network — or one behind a dropped VPN — left connections hanging for minutes. The dashboard re-checks them every few seconds, so these piled up faster than they cleared until the whole app stalled.
- Starting an MJPEG stream from a Home Assistant camera no longer eats memory until Kinboard restarts. The stream was being read into memory as though it would eventually end, which it never does; it now plays straight through, and closing the view stops it.
- Opening a planned meal showed the recipe's steps as raw JSON instead of a numbered list.
- Drag-and-drop now works in list view, which is the default on phones. Meal cards had drag handles there that never did anything; while you drag, each day expands to show all four meal slots so there's somewhere to drop.
- A recipe whose instructions were pasted in as plain text blanked the recipe page instead of showing them.
- The todos badge in the navigation never went away. Recurring chores don't get marked as completed — ticking one just schedules the next round — so the badge counted them permanently. It now counts only what's actually due, and the dashboard widget no longer lists a chore you already did today.
- A daily chore ticked off in the evening now comes back the next morning rather than 24 hours later.
- Task priority did nothing on the dashboard widget. High, medium and low all sorted identically, so an important task without a due date could sit below a trivial one.
- Notifications could switch themselves off on every device at once. A bad VAPID key or a malformed request made the push service reject all of them, and each rejection was read as "this device is gone". Only a genuine expired-subscription response unsubscribes a device now.
- An energy or charging price of €0.00 can finally be entered. Free charging or a fixed-price contract billed elsewhere is a real situation, and the field accepted the zero, dropped it, and went on billing you the €0.35/kWh default.
- Immich wallpaper albums are found whatever language you named them in. The month was only ever matched in German, so "Wallpaper March" was ignored and the screensaver quietly fell back to stock photos. Month numbers ("Wallpaper 03") work too.
- Sending a test notification could answer in German no matter what language Kinboard was set to — "VAPID-Schlüssel nicht konfiguriert" or "Kein aktives Push-Abonnement gefunden…" landing mid-page on an otherwise English or French screen. Those messages, and the ones behind the Bring! login, now read in English. The test notification itself is still German; that one is a separate fix.
- Dates now follow your own clock rather than UTC. Between midnight and 1–2am, a task due today showed as not due, yesterday's task wasn't flagged overdue, and the meal planner highlighted the wrong day. **"Move to tomorrow" on a meal wrote today's date**, so the meal stayed where it was — that one failed at any time of day.
- **Pocket-money interest now actually accrues.** Interest was rounded down to whole cents every day and the remainder thrown away, so at the default 10% rate any balance under €36.50 earned exactly nothing — forever — while the settings screen advertised the rate and the forecast drew a flat line. Larger balances lost about a quarter of theirs to the same rounding (€100 earned €7.30 a year instead of €10). The fraction is now carried from day to day, so a €5 balance earns its first cent after about a week instead of never.
- The "new version available" prompt now actually updates. Tapping it did nothing — not even reload — so a wall display stayed on the old version until someone reloaded it by hand. A wall display left running could also hit a blank page or a loading error after an update, because the old page's files were cleared while it was still using them.
- A calendar subscription no longer empties itself when the provider has a bad day. If an `.ics` link answered with a login page, a "share expired" notice or a Cloudflare check instead of a calendar, Kinboard read that as "this calendar has no events any more" and deleted all of them. Those responses are now recognised and the existing events left alone.
- Events far out in a calendar subscription no longer go missing. A feed that never changes — school holidays, a fixture list — was skipped on every sync, so as time passed the far end of the calendar quietly emptied. Such feeds are now re-read in full at least weekly.
- Calendar events no longer duplicate themselves. If a synced event ever ended up in the calendar twice, every following sync added another copy — every 15 minutes, indefinitely. Existing duplicates are cleaned up on upgrade, keeping the original, and the database now refuses to store the same event twice.
- Two households subscribed to the same Google calendar no longer overwrite each other's events. The lookup matched on the Google event id alone, so one family's sync could update — or delete — a row belonging to the other, and move the event into their own calendar.
- Shopping items added offline no longer multiply when you come back online. Five separate parts of the shopping screen each started their own sync at the same moment, all reading the same list of pending changes before any of them had claimed it, so items could be added several times over — and changes one of them had already handled made the others give up on the rest of their batch.
- Pocket-money dialogs now tell you when something went wrong. Trying to withdraw more than the balance made the Deposit/Withdraw/Spend dialog simply sit there — no message, no close, pressing the button again did nothing. Approving or denying a spend request had the same problem: if the money had been spent in the meantime, or another device had already answered, the row stayed in the list looking untouched and nobody was told.
- The weather map overlays are actually visible now. OpenWeatherMap's tiles are faint to begin with — measured across a tile, clouds average 18% opacity — and Kinboard then drew them at 70%, so rain and cloud cover reached the screen at around 12% and the map looked empty. The overlay is now drawn at full strength over a dimmed base map, roughly tripling how much of the weather you can actually see.
- The forecast now uses the weather location's own timezone. Days were grouped by UTC date and hourly times were rendered in the server's timezone, so a household not in Central Europe saw its hourly forecast labelled hours off, a day's low could come from the wrong date, and the icon for a distant city was picked from the middle of its night.
- The sunrise/sunset arc showed the sun in the wrong place — sometimes night at midday — when the weather location was in a different timezone from the device looking at it. It also printed negative daylight ("-1h 47m") in the far north, where a day can have no sunrise or no sunset at all.
- At exactly 0°, the weather widget's high/low pair and the "feels like" line disappeared. Zero is falsy, and the check tested for a value rather than for a number.
- The weather map draws again. rc.5 moved map tiles through Kinboard to keep the API key off the browser, and the two halves disagreed about what the layers were called, so every tile came back empty. Only affects rc.5.
- Weather advice was wrong in Fahrenheit. The clothing tips, the comfort badge and the forecast bar colours all compared against Celsius thresholds, so a 40 °F morning suggested "breathable clothing", a pleasant 68 °F day showed a red "very hot", and every day in the 7-day forecast rendered the same red bar. The windproof tip had the same problem with km/h against mph, firing only in roughly twice the intended wind.
- The weather map legend now follows your unit setting: temperature in °F and wind in mph for imperial households. The map tiles themselves come from OpenWeatherMap pre-rendered and stay metric, but the scale beneath them now reads correctly. Wind was also mislabelled in metric — it showed m/s, which the app never uses anywhere else.
- A bad latitude or longitude saved in settings no longer crashes the weather map or silently appends parameters to the upstream request.
- Large RSS feeds are no longer refused. A feed over 3 MB was rejected with "Feed is too large" — The Walt Disney Company's is 3.13 MB because it carries 100 full-text articles, of which Kinboard shows a fraction. Feeds are now read up to a ceiling and truncated, so a big feed just gives you its newest articles ([#37](https://github.com/svenger87/kinboard/issues/37)).
- Adding a custom RSS feed worked in the test but did nothing on **Add** for anyone running Kinboard over plain HTTP. The id generator used only exists on HTTPS, and the failure happened somewhere that swallowed it, so there wasn't even an error message ([#37](https://github.com/svenger87/kinboard/issues/37)).
- The **24-hour time** switch in Settings → Design now actually does something. It saved a value that nothing displaying a time ever read, so times stayed 24-hour whatever you chose. The dashboard clock, calendar, screensaver and every widget now follow it, with AM/PM shown in your language ([#38](https://github.com/svenger87/kinboard/issues/38)).
- Settings no longer says **"not connected"** next to Calendar when you sync with CalDAV or an ICS feed. The status only ever looked at Google Calendar, so anyone using another source saw it permanently, with nothing actually wrong. A CalDAV calendar that has stopped syncing now shows as needing attention instead of looking healthy.
- "What's new" no longer shows release candidates to households running a stable release. `/api/changelog` asked GitHub for *all* releases, so a 1.5.0 install listed the 1.6.0 candidates alongside shipped versions, described in the same words — features it did not have and could not get. Testers still see them, now marked **Pre-release**.
- Release candidates now report their own version. rc.1 and rc.2 of 1.6.0 both identified themselves as **1.5.0** in Settings, because the pre-release procedure never bumped `webapp/package.json`. Beyond the wrong number, that string is the service worker's cache key — so the cache was never rotated between builds and stale `_next/static/chunks/*` were never evicted, which is the `ChunkLoadError` the eviction exists to prevent. It landed on exactly the people running the `next` channel with auto-updates.
- Meal planner: the recipe suggestions no longer reshuffle themselves. They were re-randomised on every render, so the three cards changed under your hands on any interaction and the page jumped while you scrolled. They now stay put for the week you're looking at. The shuffle was also reordering the shared recipe list in place, which leaked into every other screen that reads it.
- Meal planner: **Add meal** and **Browse recipes** no longer overflow the card on narrow screens — the German labels are wide enough to push past both edges on a phone. They now wrap onto separate lines.
- Calendar week view: events happening at the same time no longer cover each other. Overlapping events now share the day's width side by side — as in any calendar app — and widen again as soon as there's room. Previously the second of two parallel events was drawn exactly on top of the first and was invisible.
- Calendar week view: events starting before 6:00 or ending after 22:00 are no longer cut off. The hour grid was fixed to 6:00–22:00, so an early-morning or late-evening event was drawn outside the visible area; the grid now stretches to cover whatever the week actually contains.
- **Shopping list image search no longer returns unrelated or adult images.** The feature scraped Bing's HTML search page with no SafeSearch setting, and fell back to DuckDuckGo when Bing returned nothing. Bing changed what it serves automated clients, so in practice every search fell through to that fallback — which, because its per-query token no longer matched the query, answered with results for something else entirely and with no content filtering. No Kinboard release caused this; it broke underneath us. **Update as soon as you can if children use your board.**
- Image search now requests SafeSearch properly and *verifies* it was applied, and no longer trusts a single source: results also come from Open Food Facts (real product photos) with Openverse and — if you've set a key — Unsplash filling gaps. Every result is checked against a blocklist and, crucially, against the search term itself, so a source that ignores what you typed returns nothing rather than something random.
- Shopping-list image search now actually finds the product: searching "Bananen" returns supermarket listings rather than nutrition-blog headers, and brand searches like "Domestos" or "L'Oréal Haarspray" return the real item. Results follow your interface language.
- The idle screensaver no longer appears on phones, where it rendered distorted and served no purpose. Devices marked as a kiosk keep it regardless of screen size.
- If image search can't return trustworthy results it now shows an empty state instead of falling back to an unfiltered source. Set `KINBOARD_IMAGE_SEARCH=off` to disable web image search entirely.
- CI: the end-to-end smoke suite had been failing on every push since 25 July, before it ran a single test. `npm ci` aborted during dependency install because the workflow used the npm bundled with Node 20 (npm 10) while the lockfile is npm 11 shaped. The npm version is now pinned in one place (`packageManager` in `webapp/package.json`) and activated in CI and the Docker build, so contributors and CI resolve dependencies identically.

## [1.5.0] - 2026-07-11 — Restore from backup, meal-plan digest, notification fixes

*Upgrade notes:* The schema migration (settings write lockdown) applies automatically on `./start.sh up`. Hard-refresh installed-PWA and kiosk devices once after updating.

### Added
- Restore from backup: the join screen can rebuild a family from a Kinboard export file — everything comes back (people, calendar, recipes, lists, plans) under a fresh join code.
- Meal-plan preview push: an optional evening notification (per-device toggle) lists tomorrow's planned meals.
- Undo now also works on the shopping kiosk (/einkaufen), including offline — restored items re-sync when the connection returns.

### Security
- The browser can no longer write settings directly to the database — all changes go through the app server, closing the last path a stale or hostile client on the network could use to plant settings values. Reads and live updates are unchanged.

### Fixed
- Bring!: closed the one remaining case of the v1.4.0 settings-reset fix — changing an option right after app start, before the Bring settings had loaded once, could still reset the others to defaults.
- Event reminders no longer send the same push notification twice; birthday and meal-plan digests can no longer double-send if their schedule re-runs.
- The weather settings Save button now disables again when you revert your edits or after saving.
- Event links: browser back never leaves a stale event address in the URL bar, deleting a deep-linked event can be undone like any other, and shared-link events show the right person color as soon as family data loads.
- "What's new" shows a loading shimmer instead of a blank panel, renders nested release-note lists properly, and retries sooner after a failed fetch.
- Family names are trimmed at creation, so the delete-family confirmation never demands an invisible trailing space.

## [1.4.0] - 2026-07-11 — Security hardening, full-language support, backup & undo

*Upgrade notes:* Hard-refresh installed-PWA and kiosk devices once after updating (pull to reload, or Ctrl+F5). If localhost access misbehaves on an older install, re-run `./setup.sh` and `docker restart kinboard-kong` to regenerate an outdated kong.yml.

### Added
- "What's new": after an update, the app shows a short notice with the release notes, and the version line in Settings opens the changelog anytime.
- A "Live updates paused" pill appears above the navigation when the realtime connection drops, and clears itself on reconnect — a kiosk display never shows stale data without warning.
- Settings → Data & backup can now export everything — events, todos, shopping, recipes, meal plans, notes, birthdays, schedules, settings — as one JSON file, excluding credentials and device data.
- Subscribe to the family calendar from Google Calendar, Apple Calendar, or Outlook via a secret ICS link (Settings → Data & backup), rotatable anytime to revoke access.
- Deleting a note, todo, shopping item, meal-plan entry, event, birthday, or recipe now shows an "Undo" toast that restores it exactly as it was.
- Calendar events are now searchable by title, location, or description, and every event has a shareable link that jumps straight to its date; the back button now closes the event dialog instead of leaving the calendar.
- Families can now be renamed from Settings and deleted entirely from the danger zone, which requires typing the family name and erases all data — export a backup first.
- A new Diagnostics section in Settings shows network, live-updates, push, and integration status at a glance, and the webapp container now reports its health for automated monitoring.
- Birthday reminders now actually send a push notification per the notify-days-before setting, respecting quiet hours, with a per-device toggle in Settings → Notifications.
- A new text-size setting (Settings → Theme) offers three sizes saved per device, so a wall kiosk can be read from across the room without affecting phones.

### Changed
- The setup wizard's weather step now has the same city search, suggestions, coordinates mode, and use-my-location button as the weather settings page; credential fields (Home Assistant token, Immich/Unsplash keys, Bring password) share one show/hide input everywhere, and the wizard's Home Assistant step trims trailing slashes automatically.
- Deleting calendar events, vehicles, Home Assistant rooms, or meal-plan entries now shows the same styled confirmation dialog instead of native browser popups or no confirmation at all.
- Empty pages (vehicles, stocks, pocket money, news, schedule, smart home) now use the same empty-state card as the rest of the app, each with a clear next step.
- Todos, birthdays, and the meal plan now have the same floating add button on phones as calendar, notes, and recipes; vehicles, stocks, pocket money, and schedule show loading skeletons instead of plain text.
- The flat visual theme now covers the remaining app surfaces (todos, news, vehicles, stocks, pocket money, error pages, getting-started checklist, plugin cards, PIN screen), replacing the old glass look and a dark-mode contrast bug in month-colored buttons.
- The school-schedule entry only appears in navigation once a schedule or subjects are configured, matching other optional features; the page stays reachable by direct link and explains setup.
- Fresh installs no longer log a failed request on the notifications settings page when no push notification keys are configured.

### Fixed
- Source builds and CI work again: a dependency-bot update had broken `npm ci` with an out-of-sync lock file (red since July 6); the lock file is regenerated and verified.
- Building the webapp image on a machine that had run the dev server no longer fails, and local dev files — including the stack's `.env` secrets — are no longer bundled into image layers.
- When the server is unreachable, the app now shows a "Can't reach the Kinboard server" screen with a retry button after about 12 seconds instead of spinning forever.
- Settings pages now correctly show success and error toasts (connect, sync, PIN saved, feed changes), and previously-silent failures — weather location, news sources, stonks watchlist, new vehicles, Google Calendar setup without server keys — now show a clear error instead of failing silently.
- The delete-person confirmation now correctly states that the pocket-money account and school schedules are deleted, while birthdays, events, and todos are kept but unassigned.
- Push notifications for shopping, todos, calendar reminders, and birthday reminders now use the family's chosen language and correctly pluralize "in N day(s)" in English, German, and French, instead of always German; families that never pick a language keep German pushes.
- The keyboard-shortcuts help dialog, weather condition labels, and assorted tooltips, labels, and dates now follow the app language (English, German, or French) instead of always showing German.
- Reconnecting or changing one Bring! option no longer silently resets your other Bring! settings (sync direction, list choice) to their defaults.
- Screen readers now announce what every icon-only button does — edit, delete, copy, and more.
- Family data export no longer fails for families with recipes, and now includes vehicles, the stocks watchlist, and pocket-money data.
- Calendar feed subscriptions no longer show whole-day events one day too long.

### Security
- Integration credentials (Home Assistant, Immich, Unsplash, Google, Bring!) are no longer readable from the browser — they moved to server-only storage. Existing installs migrate automatically; integrations keep working without reconnecting.
- The settings PIN is now checked and stored server-side, where devices on the network could previously read it or bypass the check client-side; existing PINs migrate automatically.

## [1.3.0] - 2026-07-10 — Redesign completion, French, join-code expiry

*Upgrade notes:* Join-code expiry is opt-in — existing codes keep working unless you set a TTL.

### Added
- Settings can now rotate the family join code and set it to expire (never / 1 hour / 24 hours / 7 days); expired codes are rejected at join time, and existing installs are unaffected.
- People now support an optional birth date, which shows a parent/child role label ("Parent" or "Child · N years") in the setup wizard and Settings → People.
- Settings → Theme now offers a neutral palette choice — Sand (default), Sage, or Warm grey — that adjusts background warmth while keeping your accent color and monthly themes.
- Birthdays now support a per-birthday gift-ideas list — add, check off, and delete ideas from the edit dialog or the next-birthday hero card.
- Notes can now be attributed to a family member, whose color and name appear on the sticky note.
- Birthdays now support an optional per-birthday photo, shown on the hero card, year-ring dots, and lists instead of the linked person's avatar.
- The screensaver now shows a compact weather chip and displays each family member's avatar next to their upcoming events.
- Home Assistant settings gained a manual re-sync action and a status footer.
- Kinboard now ships a French interface alongside English and German — selectable during onboarding or from Settings → Language, auto-detected from the browser, and applied to date/time and number formatting too (contributed by @Yorkou, #9).
- Calendar now has person-filter chips in the topbar to toggle which family members' events are shown.
- Mobile navigation is now a fixed 4-item bottom bar (Home, Calendar, Shopping, More), with a "More" sheet listing every other route, your per-device order, and unread badges.
- Page navigation now has a brief fade-and-rise transition, simplified to a plain fade in kiosk mode and disabled under reduced-motion settings.
- Shopping list now supports voice input via a microphone button (supported browsers) and gained a mobile floating add button.
- The join code is now entered into six individual cells, supporting paste, backspace-to-previous, and arrow-key navigation.
- The "Who's in your family?" setup step now offers a 10-color swatch picker with a live avatar preview.
- The language switcher now has a localized accessible label (EN/DE/FR).

### Changed
- Weather detail view and the screensaver clock got restyled to the new theme; screensaver section labels (News/Events/Birthdays) are now localized instead of hardcoded German.
- Smart Home entity cards, dashboard tabs, and light-on badges got the new flat theme, and a new Scenes section surfaces your actual Home Assistant scenes.
- Camera live tiles now show a LIVE pill, a scanline overlay, the camera name overlaid on video, and a clear offline state when a stream drops.
- Notes page redesigned as a sticky-note board with slight per-note rotation and a mobile add button.
- Birthdays year-ring now shows each family member's avatar and highlights the next birthday (name, age, days remaining) at its center.
- Onboarding now opens on a welcome screen with clear "Create a family" / "Join a family" options, and the setup wizard adopts the new flat card design.
- Settings hub and integration pages redesigned with live connection-status indicators and a consistent layout across subpages.
- The whole interface got a visual refresh: warm sage-linen colors, a rotating monthly accent color, new typography, and restyled buttons, cards, tabs, and other core UI elements, in both light and dark mode.
- Adding a new language is now much less work, with partial-translation support (untranslated strings fall back to English) and a language picker that shows each language's native name (English / Deutsch / Français).
- Empty states, loading skeletons, and desktop navigation adopted the new flat design, dropping the previous glass/blur look.
- Calendar was redesigned with flat day cells, a highlighted "today" ring, and person-colored event pills, and now shows waste-collection events (with a trash icon) directly on the month grid and day agenda.
- Schedule redesigned with avatar-based child selector pills, a weekly grid highlighting today's column, and a "Pack for tomorrow" card with an interactive packing checklist.
- Shopping list redesigned with colored category headers, quantity and person badges on each row, a strikethrough done state, and a flattened kiosk view.
- Meal planner week board and cards redesigned with the new flat theme; today is highlighted, and "Shopping list" is now the primary header action.
- Energy dashboard redesigned with flat cards, a re-skinned flow diagram, theme-matching chart colors, and a compact mobile Solar→Home→Grid flow with a battery bar; respects reduced-motion.
- Recipes redesigned with filter chips, a photo-header detail view with meta pills, and a checklist ingredient list; URL import now shows a preview (title, photo, ingredients) before saving instead of importing silently.

### Fixed
- Navigation now shows on all devices again, including kiosk and installed PWAs — a prior kiosk-only status bar had left some devices with no way to navigate.
- Fixed several mobile layout issues: overflowing or duplicated controls on birthdays, shopping, calendar, and the schedule widget, plus off-center join-code cells and dashboard elements.
- Long agenda event titles now scroll instead of truncating, unless you've turned on reduced motion.
- The energy page's animated flow diagram now also displays on phones (previously a static row).
- Birthday countdowns and the birthday nav badge now refresh at midnight or when the device wakes, instead of staying stale until a manual reload.
- Meal planner dates now follow your selected language instead of always showing German, and the drag-to-move error message is localized too.

## [1.2.0] - 2026-06-01 — Onboarding completeness + setup/self-host hardening

### Added
- Empty plugin widgets (Vehicles, Stonks, Pocket Money) now show a "discover" card explaining the feature and linking to enable it or add your first item, dismissible per device.
- Settings → Notifications now shows a "push server not configured" hint when no VAPID keys exist, explaining why push doesn't work and linking to the setup guide.
- The weather widget now shows a "set up weather" link to Settings → Weather when no API key is configured, instead of a cryptic error.
- The calendar page now shows an "add a calendar" banner linking to Settings → Calendar when no calendars exist yet.
- The first-run setup wizard gained a Calendar step to connect Google, add an iCal feed, or skip, so new families aren't left with an empty, unguided calendar.
- The dashboard's one-time setup banner is now a persistent, collapsible getting-started checklist that tracks family members, calendar, weather, and Home Assistant setup as you complete them.
- The shopping list header now shows a "Connect Bring!" button when Bring isn't linked yet.
- Settings for Google Calendar and Home Assistant now show a "Reconnect" banner when the saved credentials are rejected, instead of syncing failing silently or showing a misleading "Connected" status.

### Changed
- `setup.sh` no longer silently falls back to localhost when run non-interactively (e.g. over SSH); it now requires a `--url` flag (or `KINBOARD_URL`) and errors clearly if neither is given.
- `setup.sh`'s summary now flags when push notifications are off due to missing VAPID keys, and tells you how to fix it.
- Pocket Money's deposit, withdrawal, and spend-request flows now use a proper dialog instead of browser prompts, with amount and reason in one step.
- The kid-facing Pocket Money view now shows a pending-approval banner when a withdrawal request is awaiting parent sign-off.

### Fixed
- The setup wizard's People step (and several other flows) crashed on plain-HTTP LAN installs because a browser API required a secure context; fixed with a fallback so HTTP-only self-hosts work.
- The storage container's healthcheck falsely reported "unhealthy" forever due to an IPv6/IPv4 mismatch; fixed by pointing the healthcheck at 127.0.0.1.
- A bare `docker compose up` (without `start.sh`) used to crash-loop on database authentication errors; the stack now self-aligns service passwords automatically, so plain `docker compose up -d` works out of the box.
- Pocket Money's allowance schedule now re-anchors correctly when you change the payday mid-cycle, instead of making the next payment wait a full extra cycle.
- Push notification times for calendar events were shown in UTC instead of your local time; the server now defaults to (and lets you configure) your household's timezone.

### Security
- Bumped `next` to clear all 15 known dependency vulnerabilities (7 high, 6 moderate, 2 low) in the webapp; `npm audit` now reports zero.

## [1.1.0] - 2026-05-11 — Pocket Money plugin + end-to-end auto-update overlay

### Added
- Added the Pocket Money plugin (Piggy): per-kid virtual accounts with parent-configurable interest, a scheduled allowance, and a multi-goal savings queue with photo lookup.
- Each kid's Pocket Money avatar visibly evolves through 8 stages (one of five species) as their lifetime savings cross set milestones, with small celebration animations for evolutions, goals reached, and interest paid.
- Kids can view balances, add goals, and request withdrawals; deposits, withdrawals, interest-rate changes, and withdrawal approval stay parent-only in Settings → Pocket Money.
- Added an end-to-end auto-update overlay (Diun + a webhook) that automatically pulls, migrates, and restarts Kinboard when a new image is published, replacing the deprecated Watchtower overlay (which never handled config/migration changes).
- Added `/settings/navigation` — drag-and-drop reordering of the bottom navigation, saved per device, with a reset-to-default option.
- Settings → Pocket Money now shows a full avatar evolution preview when picking a species, and a projected-balance forecast (1/3/6/12 months) to help parents dial in a realistic interest rate.
- The public demo now seeds a sample vehicle and stock watchlist, so visitors see the Vehicles and Stonks pages populated without configuring real integrations.

### Changed
- Pocket Money's goal image search now falls back to a web image search when the curated catalog has too few results, tagging web results distinctly and degrading gracefully if unreachable.
- Pocket Money interest now commits daily instead of weekly, so accrued interest reaches the visible balance within about 24 hours instead of up to 6 days.
- Dashboard widgets in the same row now stretch to equal height, removing dead whitespace under shorter widgets.
- The desktop nav's theme toggle is now a proper pill button with visible contrast in dark mode (previously its icon and border blended into the background).
- `setup.sh` now backfills a missing key into `.env` instead of only replacing empty existing ones, so self-hosts with an older `.env` still get newly introduced keys.

### Deprecated
- The Watchtower auto-update overlay is deprecated in favor of Diun; it still works for existing installs, but see [Watchtower migration](https://github.com/svenger87/kinboard/wiki/Self-hosting#auto-updates) for the swap-out steps.

### Fixed
- The Diun auto-update overlay never actually triggered updates due to a configuration templating bug; re-running `setup.sh` once repairs existing installs.
- Swiping the mobile bottom nav to reach off-screen items no longer fires a stray click on whatever was under your finger at the start of the swipe.
- Newly added Stonks tickers now show the asset's full name (e.g. "Apple Inc.") instead of just the bare symbol; existing tickers keep their label until edited.

## [1.0.19] - 2026-05-09 — Stonks plugin + iCalendar (.ics) feeds + unified calendar settings

### Added
- Add a Stonks plugin to track stocks, ETFs, crypto, indices, and forex in a watchlist via Yahoo Finance (no API key needed), with a dashboard widget and per-ticker chart page (Settings → Stonks).
- Subscribe to read-only calendar feeds via an `.ics` or `webcal://` link — covers iCloud, Google's secret iCal address, and most CalDAV providers — with per-feed name, color, and person assignment (Settings → Calendar).
- Add a manual "Sync now" button (Settings → Calendar) to refresh ICS feeds on demand instead of waiting for the automatic 30-minute sync.

### Changed
- Cameras now follows the same enable/disable plugin pattern as Vehicles and Energy — turning it off at Settings → Plugins hides it from navigation and settings entirely.
- Settings → Calendar is now a single landing page linking to both Google Calendar and ICS feed setup, so you don't need to know which provider you're configuring first.

### Fixed
- Fix the Stonks toggle in Settings → Plugins showing a raw translation key instead of its name and description.
- Fix Settings → Calendar showing Google Calendar as "not connected" when it was already connected.

## [1.0.18] - 2026-05-09 — Energy migrates to SurfacePlugin contract

### Changed
- Energy now follows the same enable/disable plugin pattern as Vehicles — manage it from Settings → Plugins, with old bookmarks to its settings page redirecting automatically.

## [1.0.17] - 2026-05-09 — Calendar push reminders + /shopping nav fix

### Added
- Calendar events can now send a push notification a configurable number of minutes before they start (default 30, Settings → Notifications); all-day events are skipped.

### Fixed
- Fix the Shopping page hiding the bottom navigation bar, leaving users unable to get back to the dashboard; the dedicated kiosk Shopping app keeps its intentional no-nav layout.

## [1.0.16] - 2026-05-09 — Country-aware holidays + dashboard spacing

### Added
- Add a country picker (Settings → Language) so public holidays on the calendar match your country — Germany, US, UK, Netherlands, or France; existing families default to Germany.

### Fixed
- Fix the dashboard's today strip sitting flush against the widgets below it on narrow screens, adding proper spacing.

## [1.0.15] - 2026-05-09 — Clock detail popover is touch-accessible

### Fixed
- Fix the clock widget's detail view (weekday, week number, day progress) being hover-only and unreachable on touch and kiosk devices — tap to open it now, with keyboard and screen-reader support.

## [1.0.14] - 2026-05-09 — News reader image-dedup

### Fixed
- Fix the news reader showing the same hero image twice for some publishers (notably Der Spiegel).

## [1.0.13] - 2026-05-09 — Vehicles dashboard widget polish

### Changed
- Slim down the Vehicles dashboard widget to a compact card (photo, battery percentage, charging rate or range) so it fits the dashboard grid without dominating it.

### Fixed
- Remove a redundant settings icon from the Vehicles page's Tesla card — the page's Manage button already links to vehicle settings.

## [1.0.12] - 2026-05-09 — Vehicles plugin + plugin contract v0.1 + Watchtower-safe migrations

### Added
- Tesla-only support is now Vehicles, supporting multiple cars from different vendors per household; existing Tesla setups migrate automatically and old links keep working.
- Add a Generic-EV vehicle type that works with any car Home Assistant can talk to — VW, BMW, Polestar, Hyundai, OBD2 dongles — not just Tesla; the dashboard widget rotates through all configured vehicles.
- Add a Settings → Vehicles flow to add, edit, and manage multiple vehicles, replacing the single Tesla settings page (which now redirects automatically).
- Add Settings → Plugins to turn optional features on or off per family — disabled plugins disappear from navigation, the dashboard, and settings without deleting any data.
- Upload a custom photo (PNG, JPG, or WebP, up to 5 MB) for each vehicle from its settings page, shown on the dashboard widget and vehicles page instead of the default car image.

### Changed
- Database schema migrations now run automatically when the webapp container starts, so self-hosters using auto-updates no longer end up running new code against an outdated database; re-run `setup.sh` once after upgrading.
- Settings navigation now has a Vehicles entry instead of Tesla, and a new Plugins entry under Display.

### Fixed
- Fix a migration-ordering bug that could make a fresh install fail during its first boot.
- Fix uploaded recipe and vehicle images failing to load in the browser because the generated URL pointed at an internal-only address.
- Fix public image URLs (recipe and vehicle photos) sometimes failing to load because the API gateway required a key for files that should be publicly readable.

## [1.0.11] - 2026-05-08 — Device recognition resilience + interactive setup + Shopping PWA fixes

### Added
- Device recognition now survives browser and OS updates that used to break auto-rejoin — existing devices need to rejoin once via family code, and any device that still isn't recognized sees a hint on the join screen for where to find the code.
- Add an iOS-specific hint when the Shopping app is installed as its own PWA, explaining that "Add to Home Screen" only works from Safari, not from inside another installed app.
- The setup script now interactively prompts for optional integration keys (maintainer email, OpenWeatherMap, Google Calendar OAuth) after generating secrets, with a non-interactive flag for scripted installs and an advanced flag for more integrations.

### Changed
- Unconfigured integrations no longer log a false "404" error to the browser console on every page load for fresh installs and the demo overlay.
- The graceful-degradation handling for a missing OpenWeatherMap key now also covers invalid keys, rate-limiting, and outages, so the dashboard's location lookup never logs an error regardless of the cause.

## [1.0.10] - 2026-05-08 — Setup wizard + Leave family fix

### Added
- New families now go through a guided setup wizard after creating their family — add members, optionally connect Home Assistant, optionally set a city for weather — each step skippable, replacing an empty dashboard.

### Fixed
- Fix "Leave family" leaving the device recognized by the server, so leaving immediately showed a "Welcome back" rejoin prompt for the family you just left.
- Fix newly created families sometimes landing on an empty dashboard instead of the setup wizard due to a race in the post-join redirect.

## [1.0.9] - 2026-05-08 — Meal-plan upsert + chunk-reload recovery + E2E smoke

### Added
- Document how to enable hardware-accelerated video transcoding for camera streams on Intel-GPU hosts, with a template override file and wiki walkthrough.

### Fixed
- Fix meal-plan saves failing with an error on older installs missing a database constraint added after their initial setup; existing installs self-heal automatically on next restart.
- Fix the app getting stuck on a broken page after an auto-update — it now detects the stale files and reloads automatically.
- Fix push notification badges showing a featureless white blob on Android instead of the house icon, caused by a full-color image where Android expects a transparent silhouette.
- Fix the dashboard's location lookup logging server-error messages to the browser console on installs without a configured weather API key.

## [1.0.8] - 2026-05-07 — Demo overlay + auto-update opt-in + nav polish

### Added
- The public demo's camera tiles now show themed animated placeholder video (kitchen, garden, front door) instead of one static image.
- Add an optional demo overlay that runs mock Home Assistant, Tesla, weather, and camera services, so a public-facing demo instance can showcase every feature without real credentials.
- The public demo now shows fictional news articles instead of real RSS content, avoiding copyright issues from displaying real publisher content to anonymous visitors; self-hosted installs are unaffected.

### Changed
- The bottom navigation now hides Smart Home, Energy, Tesla, and Cameras until the matching integration is set up, so fresh installs aren't cluttered with dead links; direct links still work.

### Fixed
- Fix camera streams failing to load when the browser couldn't reach the camera's local network address directly; streams now proxy through the server, which also stops leaking your LAN address.

## [1.0.7] - 2026-05-07 — Live demo + auto-update opt-in

### Added
- Add a live demo link (demo.kinboard.app) to the README with a ready-to-use join code, so visitors can try Kinboard before installing.
- The public demo now ships with realistic sample data — a stocked shopping list, recipes, meal plan, events, birthdays, todos, notes, and school schedules — refreshed nightly to stay current.
- Add a banner on the join screen that shows the demo family's join code with a one-click "use this code" button when running the public demo; self-hosted installs never see it.
- Add an optional Watchtower overlay so self-hosters can auto-update just the webapp container (database and other services stay pinned), with a choice of update cadence via the image tag you track.

## [1.0.6] - 2026-05-07 — Traefik + push-notification papercuts

### Added
- Add a wiki walkthrough for setting up Traefik with Let's Encrypt from scratch, for self-hosters who don't already have a reverse proxy running.
- Add a "requirements" section to the push notifications wiki page listing the four preconditions — HTTPS, a supported browser, iOS PWA install, and server-side keys — so self-hosters know upfront why plain-HTTP setups can't push.
- Note in the self-hosting wiki that push notifications and PWA install need HTTPS even on a closed LAN, with three ways to get there — Cloudflare Tunnel, Traefik with Let's Encrypt, or a self-signed CA.

### Fixed
- Fix wiki cross-page links showing as literal "[[Page]]" text when read from the GitHub repo's file viewer instead of the wiki proper.
- Fix the push-notification Subscribe toggle appearing (but silently failing) on plain-HTTP installs and iOS Safari without a home-screen install; both now show an explanatory hint instead.
- Fix the setup script computing the wrong site URL for reverse-proxy deployments (Traefik, Caddy, Cloudflare Tunnel), which broke every API call in the browser due to a CORS mismatch.
- Fix the setup script's final instructions always telling you to open localhost, even when you'd configured a LAN IP or real domain.
- Fix the Traefik example config referencing a WebRTC entry point most self-hosters haven't defined, which spammed the logs with errors every few seconds.

## [1.0.5] - 2026-05-07 — Self-hoster orientation pass

### Added
- Google Calendar settings now shows a setup hint and disables the Connect button when the server's OAuth credentials aren't configured, instead of failing silently.
- Photos settings now shows a setup hint on fresh installs explaining the choice between self-hosted Immich and curated Unsplash photos.
- Home Assistant settings now shows a setup hint explaining how to generate a long-lived access token, with a link to the wiki walkthrough.

### Fixed
- Fix the weather settings page's setup walkthrough link pointing at a renamed wiki page.

## [1.0.4] - 2026-05-05 — Orphan-session + meal-plan race + CORS fixes

### Fixed
- Fix a wall of console errors appearing briefly when a stored family session pointed at a deleted family, by blocking the dashboard from rendering until the session is verified.
- Fix the meal planner sometimes logging conflict errors when the dashboard widget and the meal-plan page both tried to create the same week at once.
- Fix the app breaking entirely (until reload) whenever a request hit a brief server hiccup, caused by the API gateway rejecting a retry header modern Supabase libraries send; upgrade to 1.0.4+ (or restart the gateway after re-applying config) to pick up the fix.

## [1.0.3] - 2026-05-05 — News reader, version check, brand refresh

### Added
- Add an in-app article reader for news — tap an article to read a clean, distraction-free version inline instead of opening a new tab; if extraction fails, it falls back to an "open original" link.
- News now supports 10 sources to choose from (5 German, 5 English) instead of just Der Spiegel, picked from Settings → News.
- Add a dedicated News page to the main navigation, with search and per-source filtering, independent of the screensaver's news ticker.
- Settings now shows your current version in the footer and a link when a newer release is available, checked against GitHub releases.

### Changed
- Refresh the app icon, favicon, and all PWA icons with new artwork, and add a banner image to the README.

### Fixed
- Fix the app getting stuck showing errors everywhere (instead of redirecting to rejoin) when a browser's saved family no longer exists on the server, such as after restoring a backup.
- Weather settings now explains what to do when no weather API key is configured, instead of silently showing a form with no live preview.

## [1.0.2] - 2026-05-05 — Image-overlay path actually works

*Upgrade notes:* Self-hosters on `1.0.1` using the source-build path need no action — `start.sh restart` picks up the new code on the next pull. Self-hosters on the image-overlay path: pull `:1.0.2` (or `:latest`) and run `docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d`; the browser console error goes away.

### Fixed
- The pre-built Docker image now works with any self-hoster's URL — server URLs are injected at request time instead of baked in at build, so the published image no longer ships a broken join page, and `.env` URL changes apply on container restart without a rebuild.
- Quick-start docs now flag that `setup.sh` needs an interactive terminal — piping it over SSH or a script silently defaults to `localhost:8100`, breaking access for every other device, and the docs now point at the `API_EXTERNAL_URL` / `SITE_URL` workaround for non-interactive runs.

### Changed
- Project email addresses moved to the new `@kinboard.app` domain (Cloudflare Email Routing). `security@kinboard.app` (was `security@svenger87.de`) and `conduct@kinboard.app` (was `conduct@svenger87.de`) — referenced from `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `SUPPORT.md`.
- Quick-start now recommends the pre-built image overlay first (~30 sec bring-up, ~512 MB RAM) over a source build (~5–10 min, ~4 GB peak), keeping the source-build path for users who patched the code or want a frozen build.

## [1.0.1] - 2026-05-05 — Renamed to Kinboard

The project was renamed from **Familyboard** to **Kinboard** to avoid namespace overlap with two existing products in the same space (`familyboard.net` is a similarly-positioned family-organizer SaaS, and `familyboard.cz` is a Czech family message-board app). v1.0.1 ships zero functional changes — only branding, container names, image registry path, and badge URLs.

*Upgrade notes:* Image registry path changed from `ghcr.io/svenger87/familyboard` to `ghcr.io/svenger87/kinboard` (old `familyboard` images stay frozen at `1.0.0`). If you're on `:latest`, pointing `image:` at `ghcr.io/svenger87/kinboard:latest` and running `docker compose pull && docker compose up -d` is enough. If you've pinned `:1.0.0`, plan to bump to `:1.0.1` on the new image path — data is preserved either way. Default container name prefix also changed from `familyboard-*` to `kinboard-*`: set `PROJECT_NAME=familyboard` in `webapp/docker/.env` to keep the old names, or run `cd webapp/docker && docker compose down && docker compose -f docker-compose.yml -f docker-compose.image.yml up -d` to recreate under the new ones (volumes are bind-mounted from `${DATA_DIR}`, so the database survives). Repo URL also changed from `github.com/svenger87/familyboard` to `github.com/svenger87/kinboard` — GitHub auto-redirects, but `git remote set-url` is recommended for clarity. First-time installers see only Kinboard branding everywhere; this rename is invisible to them.

### Changed
- **Image registry path changed** from `ghcr.io/svenger87/familyboard` to `ghcr.io/svenger87/kinboard`.
- **Default Docker container name prefix changed** from `familyboard-*` to `kinboard-*`.
- **Repo URL changed** from `github.com/svenger87/familyboard` to `github.com/svenger87/kinboard`.
- Brand: `Familyboard` → `Kinboard` everywhere user-visible (PWA name, push notification title, page titles, settings labels, README, wiki).
- npm package name: `familyboard` → `kinboard` in `webapp/package.json`.
- Domain placeholder in docs and `.env.example` now uses `kinboard.app` / `kinboard.example.com` instead of `familyboard.example.com`.
- All English + German user-facing strings updated (`webapp/messages/en.json`, `webapp/messages/de.json`).

## [1.0.0] - 2026-05-04 — Initial public release

Initial public release.

### Added
- Built-in real-time shopping list with offline support, installable as its own home-screen icon
- Two-way Google Calendar sync — events created in Kinboard now push back to Google
- Recipe import from Chefkoch.de and any schema.org/Recipe URL
- Energy dashboard with live power/energy/battery flow and charts from Home Assistant
- Web push notifications for shopping items, task assignments, and the daily todo digest (PWA install required on iOS)
- LD2410 presence sensor support — the display blanks when no one is in the room
- English and German UI, with monthly themes that rotate colors through the year
- A documented reference hardware build (Mele Quieter 4C mini-PC + 27" touchscreen) for a wall-mounted kiosk
- Multi-arch (amd64 + arm64) Docker images published to `ghcr.io/svenger87/kinboard`, with an optional pre-built-image overlay so self-hosters don't need to build locally

### Changed
- Schema migrations now ship as separate files, keeping the initial schema reserved for fresh installs
- Row-level security is disabled — the device-cookie + family-join-code model is the actual auth boundary
- Dashboard widgets follow locale-specific date, time, and number formatting

### Fixed
- Fresh installs were missing a few columns that production already had; existing installs get patched automatically
- A missing database schema could make the realtime service crash-loop on some Postgres image versions
- Production deploys now keep their Traefik reverse-proxy configuration across container rebuilds
- The energy dashboard no longer shows raw translation-key placeholders instead of text
- Weather routes support a configurable base URL for testing without hitting the real API

### Security
- Demo and documentation screenshots are anonymized before capture, so no real household data appears in them
- VAPID keys, Supabase secrets, and family join codes are generated fresh per install — no shared defaults

---

[Unreleased]: https://github.com/svenger87/kinboard/compare/v1.6.10...HEAD
[1.6.10]: https://github.com/svenger87/kinboard/compare/v1.6.9...v1.6.10
[1.6.9]: https://github.com/svenger87/kinboard/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/svenger87/kinboard/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/svenger87/kinboard/compare/v1.6.6...v1.6.7
[1.6.6]: https://github.com/svenger87/kinboard/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/svenger87/kinboard/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/svenger87/kinboard/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/svenger87/kinboard/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/svenger87/kinboard/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/svenger87/kinboard/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/svenger87/kinboard/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/svenger87/kinboard/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/svenger87/kinboard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/svenger87/kinboard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/svenger87/kinboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/svenger87/kinboard/compare/v1.0.19...v1.1.0
[1.0.19]: https://github.com/svenger87/kinboard/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/svenger87/kinboard/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/svenger87/kinboard/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/svenger87/kinboard/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/svenger87/kinboard/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/svenger87/kinboard/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/svenger87/kinboard/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/svenger87/kinboard/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/svenger87/kinboard/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/svenger87/kinboard/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/svenger87/kinboard/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/svenger87/kinboard/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/svenger87/kinboard/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/svenger87/kinboard/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/svenger87/kinboard/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/svenger87/kinboard/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/svenger87/kinboard/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/svenger87/kinboard/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/svenger87/kinboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/svenger87/kinboard/releases/tag/v1.0.0
