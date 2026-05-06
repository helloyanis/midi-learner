# midi-learner

Small client-side app to import a MIDI file and play it to a connected MIDI device using the Web MIDI API.

Features:
- Import a `.mid` file
- Connect to Web MIDI devices (outputs and inputs)
- Play / Pause / Seek
- Choose which MIDI channels (1-16) are forwarded to the selected output
- Learning mode placeholder

Usage:
1. Serve the folder over HTTP (browsers often restrict file-based MIDI usage). Example:

```bash
cd midi-learner
python3 -m http.server 8000
# then open http://localhost:8000/ in Chrome/Chromium
```

2. Open the page in Chrome/Chromium (Web MIDI is best supported there).
3. Click "Enable Web MIDI" and select an output device (your keyboard or synth).
4. Import a `.mid` file and use Play/Pause/Seek. Select channels to forward.

Notes & Limitations:
- This is a minimal client-side scaffold. It uses MidiPlayerJS (CDN) for MIDI parsing and scheduling.
- Some MIDI player API calls are library-dependent; if you find seek behavior needs tweaks the code is in `app.js`.
- Learning mode is intentionally left empty as a placeholder.

Files:
- [index.html](index.html) — main UI
- [app.js](app.js) — app logic
- [style.css](style.css) — basic styling
