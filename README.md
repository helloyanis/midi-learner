# MIDI Learner

> [!NOTE]  
> This project was heavily made by AI. While I tested, manually tweaked the code, the implementation of most things was done by Copilot 

Use the key lighting system of Casio's LKS line of piano keyboards to learn songs from MIDI files!

Play mode compatible with any device that can receive and play MIDI signals.

Learning mode compatible with the Casio LKS-245, LKS-250, LKS-450 and any other lighted piano keyboard that allow for MIDI connectivity

It's a quick project so really rough but it's functional!

---

## What you'll need

- A compatible device (see above). Keep in mind that casio devices have a limit of simultaneously lit keys, it's 4 for the LKS-250 and 10 for the LKS-450 (which should be enough since you have 10 fingers!)
- A compatible browser. Try Firefox for PC or Chrome / Chromium for Android and PC
- A MIDI file. If you want to use the learning mode, make sure that the part you want to play is on a separate MIDI channel for each hand (a track for left hand and a track for right hand, or both hands on one track). Other tracks can be used as accompaniment and can be either enabled or disabled.

---

## Connect your devices

- **BEFORE** opening the website, connect your MIDI device or piano keyboard to the device your browser runs on.
- Open the site. If you already had it open, refresh the page
- Click on the button to grant MIDI permissions.
- Select your output device (Where the midi output will be send, so which device will output sound) and input device if you want to use the learning mode (Where you'll be playing). Most of the time this is the same device.
- Import your MIDI file.

Next, pick a mode :

### Play mode

Plays a MIDI file out of your MIDI keyboard or device.

- Click on the `Play mode` button to select play mode
- Select the MIDI channels you want to hear
- Start playback by clicking on "Play"!

### Learning mode

Lights up the next note on your keyboard and pauses the song when you miss it!

- Click on the `Learning mode` button to select play mode
- In your piano keyboard's configuration menu, enable `MIDI IN Navigate`, and set the `MIDI IN Navigate Right-hand Channel` and `MIDI IN Navigate Right-hand Channel` to 2 channel numbers that are not being used by the MIDI file. I recommend 15 and 16 because since those are the last, they're less used by MIDI files found online.
- Depending on if the MIDI file has separate tracks for left and right hand, select on the website which channels should be treated as lit hands. If all of the notes you want to play are on a single channel, only light one hand
- Set the `Left navigation channel` and `Right navigation channel` to the values you set on your piano keyboard in the previous step
- Set `Bind to song channel` to the channel of the MIDI file that has the notes to play for this hand. For example if left-hand notes are on channel 1 of the MIDI file, set it to 1
- Uncheck the channels which correspond to the notes you'll be playing, otherwise you'll hear the output twice : Once from the play mode and once from your keyboard.
- Click play and get ready to learn!