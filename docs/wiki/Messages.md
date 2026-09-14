# Messages

Messages let somebody on one Kinboard device say something to the rest of the
house: “Back by 6”, “Dinner is ready”, or any other short note that should be
seen rather than left in a list.

Messages are different from [Notes](Notes). A note remains a document until it
is deleted. A message interrupts the board briefly and remains waiting until
somebody confirms they saw it.

## Send a message

1. Find the **Messages** widget on the dashboard.
2. Select **Say something**.
3. Enter up to 200 characters and select **Send**.

Every other active family screen receives the message over Realtime. For its
first minute it appears as a large panel above the dashboard widgets. It then
collapses into the Messages widget and stays there until acknowledged. The
screensaver does not cover a message while it has the large attention state.

The sending device shows the message as **Waiting for someone to see this**. It
does not interrupt or notify itself.

## Acknowledge or withdraw

On another device, select **Got it**. The first acknowledgement clears the
message from every family screen at once. There is one household-wide
acknowledgement rather than a separate copy for every device.

The sender sees **Withdraw** instead. This removes a message sent by mistake and
also gives a one-device household a way to clear its own message.

## Push notifications

Subscribed devices receive the message immediately, except for the device that
sent it. Tapping the notification opens that exact message. If somebody else
already acknowledged it, Kinboard explains that it has already been seen.

Messages are sent even during configured quiet hours because they are written
by a person at that moment rather than scheduled by Kinboard. A push failure
does not discard the message: connected screens still receive it over Realtime.

## Settings and troubleshooting

Messages is enabled by default. **Settings → Widgets** is also the feature
switch: hiding the Messages widget stops message takeovers on the family
dashboard.

| Problem | Check |
|---|---|
| A screen does not update immediately | Confirm Realtime is healthy and reload once; the client also polls as a fallback. |
| No phone notification | Enable notifications on that device and use **Settings → Notifications → Send test**. |
| The sender gets no takeover | This is intentional; the sender sees a waiting row instead. |
| A message vanished everywhere | Another device acknowledged it, or the sender withdrew it. |
| Messages never appear | Enable Messages under **Settings → Widgets**. This is a family-wide setting. |

See [Notifications](Notifications) for push setup and [Notes](Notes) for
long-lived household notes.
