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

// Seeking state
let seekResumeTimer = null;
let seekWasPlaying = false;
let seekInProgress = false;

// Learning mode state
let learningMode = false;
let learnConfig = {
    lightLeft: false,
    lightRight: false,
    navChannelLeft: 1,
    navChannelRight: 2,
    bindChannelLeft: 1,
    bindChannelRight: 1,
    level: 'follow'
};
let learnState = {
    songNotesLeft: [],
    songNotesRight: [],
    pendingNotesLeft: [],
    pendingNotesRight: [],
    litKeysLeft: new Set(),
    litKeysRight: new Set(),
    blinkTimer: null
};

function $(id) { return document.getElementById(id); }

function init() {
    $('request-midi').addEventListener('click', enableMidi);
    $('midi-outputs').addEventListener('change', e => selectOutput(e.target.value));
    $('midi-inputs').addEventListener('change', e => selectInput(e.target.value));

    $('midi-file').addEventListener('change', handleFile);
    $('play').addEventListener('click', () => {
        console.debug('[play] Play button pressed');
        if (!player) return;
        if (learningMode && learnConfig.level === 'follow') {
            const currentTick = player.getCurrentTick ? player.getCurrentTick() : 0;
            const beatTicks = player && player.division ? player.division : 480;
            const startTick = currentTick + beatTicks;
            console.debug('[play] Learning mode active: syncing queues to tick', startTick);
            learnSyncQueuesToTick(startTick);
            learnBindInputHandler();
            learnUpdateKeyLighting();
        }
        player.play();
    });
    $('pause').addEventListener('click', () => {
        console.debug('[pause] Pause button pressed');
        if (player) player.pause();
        sendAllNotesOff();
        if (learningMode) {
            learnClearKeys('left');
            learnClearKeys('right');
        }
    });

    seekSlider = $('seek');
    timeLabel = $('time');
    seekSlider.addEventListener('input', onSeekChange);

    const chList = $('channel-list');
    for (let i = 1; i <= 16; i++) {
        const id = 'ch-' + i;
        const label = document.createElement('label');
        label.innerText = i;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.id = id;
        cb.dataset.ch = i;
        cb.addEventListener('change', e => { allowedChannels[Number(e.target.dataset.ch) - 1] = e.target.checked; });
        label.prepend(cb);
        chList.appendChild(label);
    }

    $('mode-play').addEventListener('click', () => { setMode('play'); });
    $('mode-learn').addEventListener('click', () => { setMode('learn'); });

    $('learn-light-left').addEventListener('change', e => {
        learnConfig.lightLeft = e.target.checked;
        if (!e.target.checked) learnClearKeys('left');
        if (loaded && learningMode && learnConfig.level === 'follow') {
            learnBuildSongQueues();
        }
    });
    $('learn-light-right').addEventListener('change', e => {
        learnConfig.lightRight = e.target.checked;
        if (!e.target.checked) learnClearKeys('right');
        if (loaded && learningMode && learnConfig.level === 'follow') {
            learnBuildSongQueues();
        }
    });
    $('learn-nav-left').addEventListener('change', e => {
        learnConfig.navChannelLeft = clampChannel(e.target.value, 1);
    });
    $('learn-nav-right').addEventListener('change', e => {
        learnConfig.navChannelRight = clampChannel(e.target.value, 2);
    });
    $('learn-bind-left').addEventListener('change', e => {
        learnConfig.bindChannelLeft = clampChannel(e.target.value, 1);
        if (loaded) learnBuildSongQueues();
    });
    $('learn-bind-right').addEventListener('change', e => {
        learnConfig.bindChannelRight = clampChannel(e.target.value, 1);
        if (loaded) learnBuildSongQueues();
    });
    $('learn-level').addEventListener('change', e => {
        learnConfig.level = e.target.value;
        learnBindInputHandler();
        if (learnConfig.level === 'follow') {
            learnBuildSongQueues();
        }
    });
    $('learn-debug').addEventListener('click', learnDebugLightKey);
    $('learn-play').addEventListener('click', () => {
        console.debug('[learnPlay] Starting playback in learning mode');
        if (!player || !learningMode) return;
        const currentTick = player.getCurrentTick ? player.getCurrentTick() : 0;
        const beatTicks = player && player.division ? player.division : 480;
        const startTick = currentTick + beatTicks;
        console.debug('[learnPlay] syncing queues to', startTick);
        learnSyncQueuesToTick(startTick);
        learnBindInputHandler();
        learnUpdateKeyLighting();
        player.play();
    });
    $('learn-pause').addEventListener('click', () => {
        console.debug('[learnPause] Pausing playback in learning mode');
        if (player && learningMode) player.pause();
        sendAllNotesOff();
    });

    // Faster follow-mode updates reduce missed-light and late-pause race conditions.
    setInterval(updateTime, 50);
    // Read initial learn-mode controls state so persisted/checked boxes take effect
    const ll = $('learn-light-left'); if (ll) learnConfig.lightLeft = !!ll.checked;
    const lr = $('learn-light-right'); if (lr) learnConfig.lightRight = !!lr.checked;
    const nnl = $('learn-nav-left'); if (nnl) learnConfig.navChannelLeft = clampChannel(nnl.value, learnConfig.navChannelLeft);
    const nnr = $('learn-nav-right'); if (nnr) learnConfig.navChannelRight = clampChannel(nnr.value, learnConfig.navChannelRight);
    const bdl = $('learn-bind-left'); if (bdl) learnConfig.bindChannelLeft = clampChannel(bdl.value, learnConfig.bindChannelLeft);
    const bdr = $('learn-bind-right'); if (bdr) learnConfig.bindChannelRight = clampChannel(bdr.value, learnConfig.bindChannelRight);
    console.debug('[init] Initial learnConfig loaded from DOM:', learnConfig);

    checkMidiPermission();
}

function clampChannel(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(16, parsed));
}

function setMode(mode) {
    console.debug('[setMode] Changing mode to:', mode);
    document.querySelectorAll('.mode').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#mode-content > div').forEach(d => d.classList.add('hidden'));

    if (mode === 'play') {
        learningMode = false;
        learnStop();
        $('mode-play').classList.add('active');
        $('play-mode').classList.remove('hidden');
        console.debug('[setMode] Switched to play mode');
    } else {
        learningMode = true;
        learnInit();
        $('mode-learn').classList.add('active');
        $('learn-mode').classList.remove('hidden');
        console.debug('[setMode] Switched to learning mode');
    }
}

async function checkMidiPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return;

    try {
        const result = await navigator.permissions.query({ name: 'midi', sysex: true });
        console.debug('[checkMidiPermission] MIDI permission state:', result.state);
        if (result.state === 'granted') {
            $('request-midi').innerText = 'MIDI Enabled';
            $('request-midi').disabled = true;
            await enableMidi(true);
            return;
        }

        if (result.state === 'denied') {
            $('request-midi').innerText = 'MIDI Permission Denied';
            $('request-midi').disabled = true;
            console.debug('[checkMidiPermission] MIDI permission denied by user');
            return;
        }

        $('request-midi').innerText = 'Enable Web MIDI';
        $('request-midi').disabled = false;
    } catch (e) {
        console.warn('Unable to query MIDI permission', e);
    }
}

async function enableMidi(fromPermissionCheck = false) {
    if (!navigator.requestMIDIAccess) {
        alert('Web MIDI not supported in this browser. Use Chrome/Chromium.');
        return;
    }

    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        console.debug('[enableMidi] MIDI access granted');
        populateMIDIPorts();
        midiAccess.onstatechange = populateMIDIPorts;
        if (!fromPermissionCheck) {
            $('request-midi').disabled = true;
            $('request-midi').innerText = 'MIDI Enabled';
        }
        learnBindInputHandler();
    } catch (e) {
        console.error('MIDI access failed', e);
        alert('MIDI access failed: ' + e);
    }
}

function populateMIDIPorts() {
    if (!midiAccess) return;

    const outputs = $('midi-outputs');
    outputs.innerHTML = '';
    for (const out of midiAccess.outputs.values()) {
        const o = document.createElement('option');
        o.value = out.id;
        o.text = out.name || out.id;
        outputs.appendChild(o);
    }

    const savedOut = localStorage.getItem('midi-output-id');
    if (savedOut) {
        outputs.value = savedOut;
        midiOutput = midiAccess.outputs.get(savedOut) || midiOutput;
    }

    const inputs = $('midi-inputs');
    inputs.innerHTML = '';
    for (const inp of midiAccess.inputs.values()) {
        const o = document.createElement('option');
        o.value = inp.id;
        o.text = inp.name || inp.id;
        inputs.appendChild(o);
    }

    const savedIn = localStorage.getItem('midi-input-id');
    if (savedIn) {
        inputs.value = savedIn;
        if (midiInput) midiInput.onmidimessage = null;
        midiInput = midiAccess.inputs.get(savedIn) || midiInput;
    }

    learnBindInputHandler();
}

function selectOutput(id) {
    if (!midiAccess) return;
    midiOutput = midiAccess.outputs.get(id) || null;
    try { localStorage.setItem('midi-output-id', id); } catch (_) { }
}

function selectInput(id) {
    if (!midiAccess) return;
    if (midiInput) midiInput.onmidimessage = null;
    midiInput = midiAccess.inputs.get(id) || null;
    try { localStorage.setItem('midi-input-id', id); } catch (_) { }
    learnBindInputHandler();
}

function handleFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        loadMidi(evt.target.result, f.name);
    };
    reader.readAsArrayBuffer(f);
}

function loadMidi(arrayBuffer, name) {
    console.debug('[loadMidi] Loading MIDI file:', name);
    if (player) {
        player.stop();
        player = null;
    }
    learnStop();

    try {
        player = new MidiPlayer.Player(function (event) {
            if (!midiOutput) return;
            if (!event.name) return;

            const ch = event.channel || 1;
            if (!allowedChannels[ch - 1]) return;

            if (event.name === 'Note on') {
                const status = 0x90 | ((ch - 1) & 0x0f);
                const note = event.noteNumber || event.note || 0;
                const vel = event.velocity || 64;
                if (vel > 0) {
                    midiOutput.send([status, note, vel]);
                    activeNotes.set(note + '-' + ch, { note, ch });
                } else {
                    midiOutput.send([0x80 | ((ch - 1) & 0x0f), note, 0]);
                    activeNotes.delete(note + '-' + ch);
                }
            } else if (event.name === 'Note off') {
                const note = event.noteNumber || event.note || 0;
                midiOutput.send([0x80 | ((ch - 1) & 0x0f), note, 0]);
                activeNotes.delete(note + '-' + ch);
            }
        });

        player.loadArrayBuffer(arrayBuffer);
        if (player.on) {
    player.on('endOfFile', () => {
        console.debug('[player] End of file reached; stopping and resetting transport');

        if (seekResumeTimer) {
            clearTimeout(seekResumeTimer);
            seekResumeTimer = null;
        }

        seekInProgress = false;
        seekWasPlaying = false;

        try {
            player.pause();
        } catch (_) {}

        // Make absolutely sure no MIDI notes remain held.
        sendAllNotesOff();

        try {
            if (player.resetTracks) {
                player.resetTracks();
            }

            player.tick = 0;
        } catch (_) {}

        seekSlider.value = 0;

        timeLabel.innerText =
            '0.00 / ' +
            (totalSeconds > 0 ? totalSeconds.toFixed(2) : '??') +
            ' s';
    });
}


        loaded = true;
        $('file-info').innerText = 'Loaded: ' + name;

        try {
            totalSeconds = (player.getSongTime && typeof player.getSongTime === 'function') ? player.getSongTime() : 0;
        } catch (e) {
            totalSeconds = 0;
        }

        try {
            if (player && !player.totalTicks && player.getTotalTicks) player.totalTicks = player.getTotalTicks();
        } catch (e) { }

        seekSlider.value = 0;
        learnPopulateChannelSelects();
        learnBuildSongQueues();
        learnBindInputHandler();
        console.debug('[loadMidi] File loaded: totalSeconds=%f, songNotesLeft=%d, songNotesRight=%d', totalSeconds, learnState.songNotesLeft.length, learnState.songNotesRight.length);
    } catch (err) {
        console.error(err);
        alert('Failed to parse MIDI: ' + err);
    }
}

function updateTime() {
    if (!player || !loaded) return;

    let curr = 0;
    try {
        const currentTick = (player.getCurrentTick && typeof player.getCurrentTick === 'function') ? player.getCurrentTick() : 0;
        curr = (player.ticksToSeconds && typeof player.ticksToSeconds === 'function') ? player.ticksToSeconds(0, currentTick) : 0;
    } catch (e) {
        curr = 0;
    }

    try {
        if (player.getSongTime) totalSeconds = player.getSongTime();
    } catch (e) { }

    const max = totalSeconds || Math.max(1, curr);
    const pct = (max > 0) ? Math.min(100, (curr / max) * 100) : 0;
    seekSlider.value = isFinite(pct) ? pct : 0;
    timeLabel.innerText = curr.toFixed(2) + ' / ' + (max > 0 ? max.toFixed(2) : '??') + ' s';

    if (learningMode && learnConfig.level === 'follow' && player.isPlaying && player.isPlaying()) {
        learnUpdateKeyLighting();
    }
}

function onSeekChange(e) {
    if (!player || !loaded) return;

    const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));

    // Pause before moving the MidiPlayerJS event pointers.
    // Otherwise skipped events can be emitted all at once.
    if (!seekInProgress) {
        seekWasPlaying = !!(player.isPlaying && player.isPlaying());
        seekInProgress = true;
    }

    if (seekResumeTimer) {
        clearTimeout(seekResumeTimer);
        seekResumeTimer = null;
    }

    try {
        if (player.pause) player.pause();
    } catch (_) {}

    // Stop any notes that were playing before the seek.
    sendAllNotesOff();

    const targetTick = player.totalTicks
        ? Math.floor(player.totalTicks * (pct / 100))
        : 0;

    try {
        if (player.skipToSeconds && totalSeconds) {
            player.skipToSeconds(totalSeconds * (pct / 100));
        } else if (player.skipToTick && player.totalTicks) {
            player.skipToTick(targetTick);
        }

        // Keep the transport position explicitly synchronized.
        if (typeof player.tick === 'number') {
            player.tick = targetTick;
        }
    } catch (err) {
        console.warn('seek error', err);
    }

    if (learningMode && learnConfig.level === 'follow') {
        learnSyncQueuesToTick(targetTick);
    }

    // Wait until the slider stops moving before resuming playback.
    seekResumeTimer = setTimeout(() => {
        seekResumeTimer = null;

        if (!seekInProgress) return;

        const shouldResume = seekWasPlaying;

        seekInProgress = false;
        seekWasPlaying = false;

        if (shouldResume && player && player.play) {
            try {
                player.play();
            } catch (err) {
                console.warn('Failed to resume after seek', err);
            }
        }
    }, 60);
}

function sendAllNotesOff() {
    if (!midiOutput) return;
    for (const key of activeNotes.keys()) {
        const it = activeNotes.get(key);
        midiOutput.send([0x80 | ((it.ch - 1) & 0x0f), it.note, 0]);
    }
    activeNotes.clear();
}

function learnInit() {
    console.debug('[learnInit] Initializing learning mode');
    console.debug('[learnInit] Config: lightLeft=%s lightRight=%s navCh=%d,%d bindCh=%d,%d level=%s', 
        learnConfig.lightLeft, learnConfig.lightRight, 
        learnConfig.navChannelLeft, learnConfig.navChannelRight,
        learnConfig.bindChannelLeft, learnConfig.bindChannelRight,
        learnConfig.level);
    learnPopulateChannelSelects();
    learnBindInputHandler();
    if (loaded) learnBuildSongQueues();
    learnUpdateStatus('Learning mode ready');
}

function learnStop() {
    if (learnState.blinkTimer) clearInterval(learnState.blinkTimer);
    learnState.blinkTimer = null;
    learnClearKeys('left');
    learnClearKeys('right');
    learnState.songNotesLeft = [];
    learnState.songNotesRight = [];
    learnState.pendingNotesLeft = [];
    learnState.pendingNotesRight = [];
}

function learnBindInputHandler() {
    if (!midiInput) return;
    if (learningMode && learnConfig.level === 'follow') {
        midiInput.onmidimessage = learnHandleMidiInput;
        console.debug('[learnBindInputHandler] MIDI input handler bound to learning mode');
    } else {
        midiInput.onmidimessage = e => { /* placeholder if you want to use keyboard input */ };
    }
}

function learnBuildSongQueues() {
    if (!player || !player.events) return;

    const leftNotes = [];
    const rightNotes = [];
    const useLeft = !!learnConfig.lightLeft;
    const useRight = !!learnConfig.lightRight;
    const sameBindChannel = learnConfig.bindChannelLeft === learnConfig.bindChannelRight;

    // If both hands point to the same song channel, keep only one required queue
    // to avoid requiring the same key press twice.
    const primaryHand = useLeft ? 'left' : (useRight ? 'right' : null);

    for (const trackEvents of player.events) {
        for (const event of trackEvents) {
            if (!event || event.name !== 'Note on' || !event.velocity || event.velocity === 0) continue;
            const noteEvent = {
                note: event.noteNumber || event.note,
                tick: event.tick,
                velocity: event.velocity,
                channel: event.channel || 1
            };

            if (sameBindChannel) {
                if (!primaryHand) continue;
                if (noteEvent.channel !== learnConfig.bindChannelLeft) continue;
                if (primaryHand === 'left') leftNotes.push(noteEvent);
                else rightNotes.push(noteEvent);
                continue;
            }

            if (useLeft && noteEvent.channel === learnConfig.bindChannelLeft) leftNotes.push(noteEvent);
            if (useRight && noteEvent.channel === learnConfig.bindChannelRight) rightNotes.push(noteEvent);
        }
    }

    leftNotes.sort((a, b) => a.tick - b.tick);
    rightNotes.sort((a, b) => a.tick - b.tick);

    // Dedupe same note at the same tick per hand (can happen with layered tracks)
    // so one physical key press is sufficient.
    const dedupeByTickAndNote = notes => {
        const seen = new Set();
        const out = [];
        for (const n of notes) {
            const key = n.tick + ':' + n.note;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(n);
        }
        return out;
    };

    const leftNotesDeduped = dedupeByTickAndNote(leftNotes);
    const rightNotesDeduped = dedupeByTickAndNote(rightNotes);

    learnState.songNotesLeft = leftNotesDeduped;
    learnState.songNotesRight = rightNotesDeduped;
    learnResetPendingQueues(0);
    console.debug('[learnBuildSongQueues] Built song queues: leftNotes=%d, rightNotes=%d, useLeft=%s, useRight=%s, sameBindChannel=%s', leftNotesDeduped.length, rightNotesDeduped.length, useLeft, useRight, sameBindChannel);
}

function learnResetPendingQueues(currentTick) {
    learnState.pendingNotesLeft = learnState.songNotesLeft.filter(note => note.tick >= currentTick).map(note => ({ ...note }));
    learnState.pendingNotesRight = learnState.songNotesRight.filter(note => note.tick >= currentTick).map(note => ({ ...note }));
}

function learnSyncQueuesToTick(currentTick) {
    learnResetPendingQueues(currentTick);
}

function learnGetPendingQueue(hand) {
    return hand === 'left' ? learnState.pendingNotesLeft : learnState.pendingNotesRight;
}

function learnGetCurrentGroup(hand) {
    const queue = learnGetPendingQueue(hand);
    if (!queue.length) return [];
    const tick = queue[0].tick;
    return queue.filter(note => note.tick === tick);
}

function learnRemoveMatchedNote(hand, noteNumber) {
    const queue = learnGetPendingQueue(hand);
    if (!queue.length) return false;
    const groupTick = queue[0].tick;
    const index = queue.findIndex(note => note.tick === groupTick && note.note === noteNumber);
    if (index === -1) return false;
    queue.splice(index, 1);
    return true;
}

function learnPopulateChannelSelects() {
    const leftSelect = $('learn-bind-left');
    const rightSelect = $('learn-bind-right');
    if (!leftSelect || !rightSelect) return;

    leftSelect.innerHTML = '';
    rightSelect.innerHTML = '';

    for (let i = 1; i <= 16; i++) {
        const opt1 = document.createElement('option');
        opt1.value = i;
        opt1.text = 'Channel ' + i;
        leftSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = i;
        opt2.text = 'Channel ' + i;
        rightSelect.appendChild(opt2);
    }

    leftSelect.value = learnConfig.bindChannelLeft;
    rightSelect.value = learnConfig.bindChannelRight;
}

function learnUpdateStatus(msg) {
    const status = $('learn-status');
    if (status) status.innerText = msg;
}

function learnLightKey(hand, noteNumber, velocity, keepLit = false) {
    if (!midiOutput) return;
    if (!learnConfig['light' + (hand === 'left' ? 'Left' : 'Right')]) return;

    const navCh = hand === 'left' ? learnConfig.navChannelLeft : learnConfig.navChannelRight;
    const ccStatus = 0xb0 | ((navCh - 1) & 0x0f);
    const noteOn = 0x90 | ((navCh - 1) & 0x0f);
    const noteOff = 0x80 | ((navCh - 1) & 0x0f);

    if (velocity > 0) {
        midiOutput.send([noteOff, noteNumber, 0]);
        midiOutput.send([ccStatus, 7, 0]);
        midiOutput.send([noteOn, noteNumber, 1]);
        learnState['litKeys' + (hand === 'left' ? 'Left' : 'Right')].add(noteNumber);
        if (!keepLit) {
            console.debug('[learnLightKey] Scheduling auto-off for %s hand note %d', hand, noteNumber);
            setTimeout(() => {
                midiOutput.send([noteOff, noteNumber, 0]);
                midiOutput.send([ccStatus, 7, 100]);
            }, 75);
        }
    } else {
        midiOutput.send([noteOff, noteNumber, 0]);
        midiOutput.send([ccStatus, 7, 100]);
        learnState['litKeys' + (hand === 'left' ? 'Left' : 'Right')].delete(noteNumber);
    }
}

function learnClearKeys(hand) {
    const keys = learnState['litKeys' + (hand === 'left' ? 'Left' : 'Right')];
    for (const note of keys) {
        learnLightKey(hand, note, 0);
    }
    keys.clear();
}

function learnDebugLightKey() {
    if (!midiOutput) return;

    const note = Math.floor(Math.random() * 88) + 21;
    const debugChannel = 15;
    const ccStatus = 0xb0 | ((debugChannel - 1) & 0x0f);
    const noteOn = 0x90 | ((debugChannel - 1) & 0x0f);

    midiOutput.send([ccStatus, 7, 0]);
    midiOutput.send([noteOn, note, 1]);

    setTimeout(() => {
        midiOutput.send([ccStatus, 7, 100]);
    }, 250);
}

function learnHandleMidiInput(event) {
    if (!learningMode || learnConfig.level !== 'follow') return;

    const [status, note, velocity] = event.data;
    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0;
    if (!isNoteOn) return;

    const currentTick = player && player.getCurrentTick ? player.getCurrentTick() : 0;
    const beatTicks = player && player.division ? player.division : 480;

    console.debug('[learnHandleMidiInput] Input note=%d velocity=%d currentTick=%d', note, velocity, currentTick);

    // Try matching the note against left then right pending groups.
    for (const hand of ['left', 'right']) {
        const group = learnGetCurrentGroup(hand);
        if (!group.length) continue;

        const groupTick = group[0].tick;
        const ticksUntilNote = groupTick - currentTick;

        if (ticksUntilNote > beatTicks) continue;

        const matched = group.find(n => n.note === note);
        if (!matched) continue;

        console.debug('[learnHandleMidiInput] Matched note %d for %s hand (ticksUntilNote=%d)', note, hand, ticksUntilNote);

        // Remove matched note from pending queue
        learnRemoveMatchedNote(hand, note);
        learnUpdateStatus('Correct: ' + note);

        // Sound the note immediately on the bound song channel so the user hears it
        const bindCh = hand === 'left' ? learnConfig.bindChannelLeft : learnConfig.bindChannelRight;
        if (midiOutput) {
            const statusOut = 0x90 | ((bindCh - 1) & 0x0f);
            midiOutput.send([statusOut, note, Math.max(velocity, 30)]);
            setTimeout(() => {
                midiOutput.send([0x80 | ((bindCh - 1) & 0x0f), note, 0]);
            }, 200);
        }

        // If playback was paused (e.g., due to a missed note), resume now.
        try {
            if (player && player.play) {
                console.debug('[learnHandleMidiInput] Resuming playback after correct note');
                player.play();
            }
        } catch (e) {
            console.warn('Failed to resume playback', e);
        }

        // Immediately refresh target lighting so the next note appears without delay.
        learnUpdateKeyLighting();

        // Clear lighting for this group if it's now empty
        if (!learnGetCurrentGroup(hand).length) {
            learnClearKeys(hand);
        }

        return;
    }

    console.debug('[learnHandleMidiInput] No match for input note=%d', note);
}

function learnUpdateKeyLighting() {
    try {
        const currentTick = player && player.getCurrentTick ? player.getCurrentTick() : 0;
        const beatTicks = player && player.division ? player.division : 480;

        if (learnConfig.lightLeft) {
            learnUpdateHandLighting('left', currentTick, beatTicks);
        }

        if (learnConfig.lightRight) {
            learnUpdateHandLighting('right', currentTick, beatTicks);
        }
    } catch (e) {
        console.warn('Learning mode lighting update error:', e);
    }
}

function learnUpdateHandLighting(hand, currentTick, beatTicks) {
    const queue = learnGetPendingQueue(hand);
    if (!queue.length) {
        learnClearKeys(hand);
        return;
    }

    const group = learnGetCurrentGroup(hand);
    if (!group.length) {
        learnClearKeys(hand);
        return;
    }

    const groupTick = group[0].tick;
    const ticksUntilNote = groupTick - currentTick;

    const lateGraceTicks = Math.max(1, Math.floor(beatTicks * 0.2));
    if (ticksUntilNote < -lateGraceTicks) {
        console.debug('[learnUpdateHandLighting] Missed note on %s hand (ticksUntilNote=%d), pausing playback', hand, ticksUntilNote);
        learnUpdateStatus('Missed note, pausing');
        for (const noteEvent of group) {
            // Keep missed notes lit while paused until user presses the correct key(s)
            learnLightKey(hand, noteEvent.note, noteEvent.velocity, true);
        }
        if (player && player.pause) player.pause();
        return;
    }

    const isFastPhase = ticksUntilNote <= beatTicks;
    const blinkRate = isFastPhase ? 100 : 250;
    const blinkPhase = (Date.now() % (blinkRate * 2)) < blinkRate;

    if (blinkPhase) {
        for (const noteEvent of group) {
            learnLightKey(hand, noteEvent.note, noteEvent.velocity);
        }
    } else {
        learnClearKeys(hand);
    }
}

window.addEventListener('load', init);
