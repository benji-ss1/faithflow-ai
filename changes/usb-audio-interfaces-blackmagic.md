---
headline: Better sound from USB mixers, audio interfaces and Blackmagic devices
audience: operator
version: 0.1.440
date: 2026-09-16
highlights:
  - New option in Audio → "Separate channels from my mixer (USB)". Turn it on for a USB mixer or interface (X32, XR18, SQ, Focusrite, ATEM Mini) so each channel reaches PresentFlow on its own instead of being squashed together. It turns on automatically for recognised mixers and interfaces (ordinary microphones keep standard processing), and you can switch it off per device.
  - Desktop app, new "Pro audio driver" (on by default, switch it off in Audio if needed): PresentFlow reads every input channel of your interface, including over ASIO on Windows, and shows the real channel count so you can pick the pastor's mic channel.
  - Desktop app, Blackmagic UltraStudio and DeckLink devices can send their SDI/HDMI audio to PresentFlow's AI listening. You need Blackmagic Desktop Video 14.3 or newer installed.
  - If a USB interface is unplugged during a service, PresentFlow now tries to reconnect it automatically.
---
