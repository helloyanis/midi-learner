// Simple client-side MIDI player using Web MIDI and MidiPlayerJS

import MidiPlayer from './libraries/midi-player.js';

let midiAccess = null;
let midiOutput = null;
let midiInput = null;
let player = null;
let loaded = false;
let totalSeconds = 0;
let seekSlider = null;
let timeLabel = null;
let activeNotes = new Map();
let allowedChannels = new Array(16).fill(true);

function $(id) { return document.getElementById(id); }

function init() {
    $('request-midi').addEventListener('click', enableMidi);
    $('midi-outputs').addEventListener('change', e => selectOutput(e.target.value));
    $('midi-inputs').addEventListener('change', e => selectInput(e.target.value));

    $('midi-file').addEventListener('change', handleFile);
    $('play').addEventListener('click', () => { if (player) player.play(); });
    $('pause').addEventListener('click', () => { if (player) player.pause(); sendAllNotesOff(); });

    seekSlider = $('seek');
    timeLabel = $('time');
    seekSlider.addEventListener('input', onSeekChange);

    // channel checkboxes
    const chList = $('channel-list');
    for (let i = 1; i <= 16; i++) {
        const id = 'ch-' + i;
        const label = document.createElement('label');
        label.innerText = i;
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true; cb.id = id; cb.dataset.ch = i;
        cb.addEventListener('change', e => { allowedChannels[e.target.dataset.ch - 1] = e.target.checked; });
        label.prepend(cb);
        chList.appendChild(label);
    }

    // mode buttons
    $('mode-play').addEventListener('click', () => { setMode('play'); });
    $('mode-learn').addEventListener('click', () => { setMode('learn'); });

    // update UI clock
    setInterval(updateTime, 200);

    checkMidiPermission();
}

function setMode(mode) {
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#mode-content > div').forEach(d => d.classList.add('hidden'));
    if (mode === 'play') { $('mode-play').classList.add('active'); $('play-mode').classList.remove('hidden'); }
    else { $('mode-learn').classList.add('active'); $('learn-mode').classList.remove('hidden'); }
}

async function checkMidiPermission() {
    if (!navigator.permissions || !navigator.permissions.query) {
        return;
    }

    try {
        const result = await navigator.permissions.query({ name: 'midi' });
        if (result.state === 'granted') {
            $('request-midi').innerText = 'MIDI Enabled';
            $('request-midi').disabled = true;
            await enableMidi(true);
            return;
        }

        if (result.state === 'denied') {
            $('request-midi').innerText = 'MIDI Permission Denied';
            $('request-midi').disabled = true;
            return;
        }

        $('request-midi').innerText = 'Enable Web MIDI';
        $('request-midi').disabled = false;
    } catch (e) {
        console.warn('Unable to query MIDI permission', e);
    }
}

async function enableMidi(fromPermissionCheck = false) {
    if (!navigator.requestMIDIAccess) { alert('Web MIDI not supported in this browser. Use Chrome/Chromium.'); return; }
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        populateMIDIPorts();
        midiAccess.onstatechange = populateMIDIPorts;
        if (!fromPermissionCheck) {
            $('request-midi').disabled = true;
            $('request-midi').innerText = 'MIDI Enabled';
        }
    } catch (e) { console.error('MIDI access failed', e); alert('MIDI access failed: ' + e); }
}

function populateMIDIPorts() {
    const outputs = $('midi-outputs'); outputs.innerHTML = '';
    for (const out of midiAccess.outputs.values()) {
        const o = document.createElement('option'); o.value = out.id; o.text = out.name || out.id; outputs.appendChild(o);
    }
    const savedOut = localStorage.getItem('midi-output-id');
    if (savedOut) {
        outputs.value = savedOut;
        midiOutput = midiAccess.outputs.get(savedOut) || midiOutput;
    }
    const inputs = $('midi-inputs'); inputs.innerHTML = '';
    for (const inp of midiAccess.inputs.values()) {
        const o = document.createElement('option'); o.value = inp.id; o.text = inp.name || inp.id; inputs.appendChild(o);
    }
    const savedIn = localStorage.getItem('midi-input-id');
    if (savedIn) {
        inputs.value = savedIn;
        if (midiInput) midiInput.onmidimessage = null;
        midiInput = midiAccess.inputs.get(savedIn) || midiInput;
        if (midiInput) midiInput.onmidimessage = e => { /* placeholder if you want to use keyboard input */ };
    }
}

function selectOutput(id) {
    midiOutput = midiAccess.outputs.get(id) || null;
    try { localStorage.setItem('midi-output-id', id); } catch (_) { }
}

function selectInput(id) {
    if (midiInput) midiInput.onmidimessage = null;
    midiInput = midiAccess.inputs.get(id) || null;
    if (midiInput) midiInput.onmidimessage = e => { /* placeholder if you want to use keyboard input */ };
    try { localStorage.setItem('midi-input-id', id); } catch (_) { }
}

function handleFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        const arrayBuffer = evt.target.result;
        loadMidi(arrayBuffer, f.name);
    };
    reader.readAsArrayBuffer(f);
}

function loadMidi(arrayBuffer, name) {
    if (player) { player.stop(); player = null; }
    try {
        player = new MidiPlayer.Player(function (event) {
            // event handler: forward note on/off to selected output if channel allowed
            if (!midiOutput) return;
            if (!event.name) return;
            const ch = (event.channel || 1);
            if (!allowedChannels[ch - 1]) return;
            if (event.name === 'Note on') {
                const status = 0x90 | ((ch - 1) & 0x0f);
                const note = event.noteNumber || event.note || 0;
                const vel = event.velocity || 64;
                if (vel > 0) {
                    midiOutput.send([status, note, vel]);
                    // track active notes to turn off later
                    activeNotes.set(note + '-' + ch, { note, ch });
                } else {
                    const off = 0x80 | ((ch - 1) & 0x0f);
                    midiOutput.send([off, note, 0]);
                    activeNotes.delete(note + '-' + ch);
                }
            } else if (event.name === 'Note off') {
                const status = 0x80 | ((ch - 1) & 0x0f);
                const note = event.noteNumber || event.note || 0;
                midiOutput.send([status, note, 0]);
                activeNotes.delete(note + '-' + ch);
            }
        });
        player.loadArrayBuffer(arrayBuffer);
        loaded = true;
        $('file-info').innerText = 'Loaded: ' + name;
        // set totalSeconds using the player's calculated song time
        try { totalSeconds = (player.getSongTime && typeof player.getSongTime === 'function') ? player.getSongTime() : 0; } catch (e) { totalSeconds = 0; }
        // ensure totalTicks is available
        try { if (!player.totalTicks && player.getTotalTicks) player.totalTicks = player.getTotalTicks(); } catch (e) { }
        // fallback: attempt to read player.totalTicks -> convert not implemented; keep slider 0-100 and update while playing
        seekSlider.value = 0;
    } catch (err) { console.error(err); alert('Failed to parse MIDI: ' + err); }
}

function updateTime() {
    if (!player || !loaded) return;
    // compute current seconds from current tick
    let curr = 0;
    try {
        const currentTick = (player.getCurrentTick && typeof player.getCurrentTick === 'function') ? player.getCurrentTick() : 0;
        curr = (player.ticksToSeconds && typeof player.ticksToSeconds === 'function') ? player.ticksToSeconds(0, currentTick) : 0;
    } catch (e) { curr = 0; }
    // recompute totalSeconds if possible
    try { if (player.getSongTime) totalSeconds = player.getSongTime(); } catch (e) { }
    const max = totalSeconds || Math.max(1, curr);
    // update slider as percentage
    const pct = (max > 0) ? Math.min(100, (curr / max) * 100) : 0;
    seekSlider.value = isFinite(pct) ? pct : 0;
    timeLabel.innerText = curr.toFixed(2) + ' / ' + (max > 0 ? max.toFixed(2) : '??') + ' s';
}

function onSeekChange(e) {
    if (!player || !loaded) return;
    const pct = parseFloat(e.target.value);
    // remember whether we were playing so we can resume after seeking
    const wasPlaying = player.isPlaying && player.isPlaying();
    // send all notes off before seeking
    sendAllNotesOff();
    try {
        if (player.skipToSeconds && totalSeconds) {
            player.skipToSeconds(totalSeconds * (pct / 100));
        } else if (player.skipToTick) {
            if (player.totalTicks) player.skipToTick(Math.floor(player.totalTicks * (pct / 100)));
        }
    } catch (err) { console.warn('seek error', err); }
    // resume playback if it was playing before
    try { if (wasPlaying && player.play) player.play(); } catch (_) { }
}

function sendAllNotesOff() {
    if (!midiOutput) return;
    for (const key of activeNotes.keys()) {
        const it = activeNotes.get(key);
        const off = 0x80 | ((it.ch - 1) & 0x0f);
        midiOutput.send([off, it.note, 0]);
    }
    activeNotes.clear();
}

window.addEventListener('load', init);
