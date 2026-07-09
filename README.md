# eHMI Simulation — Prosocial AV–VRU Communication

Browser-based Three.js test environment for a multimodal eHMI concept
(light band + windshield display + synthetic sound). Built for focus-group
video vignettes and as a first prototype of browser-based behavioral measurement.

> **See [DOCUMENTATION.md](DOCUMENTATION.md) for the current, authoritative guide.**
> Some sections below predate recent changes: scenarios 7 and 8 and the repeated
> crossings protocol were removed, the continuous walk replaced them, the
> controls and cameras moved into an admin menu (⚙ / O key), and the old Start
> button is now a single Restart.

## Run

No build tools needed — just serve the folder (ES modules require http://):

```bash
python3 -m http.server 8741 --directory ehmi-sim
# open http://localhost:8741
```

Three.js loads from CDN (jsdelivr), so the first load needs internet.

## Usage

1. Open **☰ Scenarios** and pick a scenario from the menu (starts the run
   immediately; **Start** re-runs the selected one).
2. Move the pedestrian (camera-relative): **W/↑** = straight forward on
   screen, **S/↓** = backward, **A/D** = strafe. You decide when to cross.
3. After each run a confidence check appears, branched on actual behavior:
   if you **crossed** — why (multi-select: vehicle stopped / eHMI signal /
   sound cue / traffic clear / just went) + felt-safe-while-crossing (1–7);
   if you **didn't cross** — why not (multi-select) + would-you-cross-next-time
   + overall safety (1–7).
4. **⏺ Record mode** hides all UI for clean screen recordings — **Esc** exits.
5. **⬇ Download log** exports all runs as JSON.

Cameras: 1 pedestrian FPV (1.6 m) · 2 cyclist (1.9 m, faster) · 3 observer
(follows the player) · 4 cinematic orbit centered on the player (for
recordings). **C** cycles. In first person, **drag the mouse to turn your
head** (yaw + pitch, e.g. to glance at the approaching AV); **W always walks
where you look**; **R** re-centers the view to face across the street.

## eHMI states

| Layer | Neutral | Assessing | Yielding | Thanks |
|---|---|---|---|---|
| Light band | white | yellow (fast sweep) | cyan (slow sweep) | white |
| Windshield | off | 👁 Detecting + 🚶🚲🚗 | 👋 animated | ☺️ |
| Sound | hum (distance/speed-scaled) | — | friction cue while braking, then go-ahead two-note chime | soft chime |

All band transitions are smoothstep-eased (0.6 s), never hard cuts.
Scenarios follow the arc Detection → Decision → Action → Acknowledgment → Outcome.

Ambient traffic (toggle in Controls) spawns up to 3 human-driven cars with
randomized color, speed and timing. They follow simple real traffic rules:
only one vehicle may occupy the intersection at a time (closest approaching
car has priority), they wait while the AV / cyclist / merging car are inside
the intersection, southbound cars stop at a line before the zebra while the
pedestrian is in the road, and they keep following distance behind slower
vehicles — so they visibly react to the scenario without interfering.

In scenario 3 a cyclist appears behind the yielding AV, overtakes it on the
left and rides straight over the zebra — it does **not** brake for the
pedestrian. If the pedestrian is crossing at that moment, the cyclist crashes
into them (the overtrust/misplaced-trust edge case).

**Accidents:** any real collision between any two actors — vehicle–pedestrian,
cyclist–pedestrian, cyclist–vehicle, and vehicle–vehicle (AV, baseline car,
merging car, ambient traffic; rear-end and T-bone geometry both detected) —
triggers a crash: sound, knocked-over/stopped actors, frozen scenario, an
`accident` log event, and a pop-up ("There was an accident…") whose OK button
resets the scenario; the run is kept in the log, flagged `aborted: "accident"`.
Normal traffic never triggers it: queued cars and passing opposite-lane cars
stay below the contact threshold — only unusual behavior that produces real
body overlap counts. Walking into a *stopped* vehicle is not an accident —
the pedestrian is just blocked (no clipping through geometry).

**Scenario 5 — Mixed Traffic:** the same crossing interaction, but in chaos:
a bus on the opposite lane, a truck waiting at the side street, the
side-street cyclist, ambient cars — and an ambulance (siren, blinking
beacons) that crosses the intersection while **all** other traffic pulls over
and waits. Actors visibly follow different rules; the participant has to
judge the crossing in a noisy scene.

**Scenario 6 — Aggressive Drivers:** drivers are unhappy with the cautious
AV. A tailgater follows the AV closely, honks repeatedly while stuck behind
the yielding AV, then loses patience, swings out and overtakes it — cutting
straight across the zebra. Oncoming traffic ignores the zebra stop line and
honks too. Whether the overtaker hits the crossing pedestrian depends on the
participant's timing (a hesitant crossing is dangerous, a brisk one is safe) —
collisions end in the standard accident pop-up and are logged (`honk`,
`aggressive_overtake_started`, `accident` events).

**Scenarios 7/8 — Sound Study (Story 2):** scenario 7 ("Mara") blacks out the
screen — the participant crosses guided purely by the sound layer. To make
this feasible by ear, audio-only runs boost cue loudness and range, repeat
the go-ahead motif continuously while the AV yields (instead of a one-shot
tone), add footsteps while walking and a curb tick when entering/leaving the
roadway, and extend the crossing window to 45 s. Scenario 8 ("Tom") plays a
masking music loop over the AV cues. Both log the active sound volume per run
(sweep the volume slider between runs for the loudness study) and add a
required sound-pleasantness rating (1 = very annoying … 7 = very pleasant) to
the confidence check.

**Scenario 9 — Broadcast Signal (signal-scoping challenge):** several
pedestrians wait at the crossing — one on the participant's curb, one on the
opposite curb. The AV runs its full yield sequence once, and *both* NPCs act
on that same signal, each after their own staggered, human-like reaction
delay (1.4 s / 2.6 s) rather than stepping off in lockstep. The participant is
free to cross alongside them. Messages frame the open question directly
("AV yields once — everyone waiting can go. Is that signal for you too?"),
so the participant judges whether a single broadcast signal genuinely serves
several people, including themselves, at once. The AV safely waits until
everyone who entered the road (either NPC and/or the participant) has
actually cleared it before thanking everyone and moving on. Logged:
`npc_crossing_started/finished` (tagged per NPC) plus the standard behavioral
measures — comparing reaction times and chosen reasons ("the signal" vs. "the
vehicle stopped") against scenario 2 shows whether people read a broadcast
signal as personally addressed even when others are visibly acting on it too.

**★ Trust Protocol (Story 3):** five back-to-back runs; runs 1–4 are clean
scenario-2 yields, run 5 silently swaps in the unaddressed-cyclist edge case —
no warning messages reveal it. Each run logs `protocolStep` plus a gaze proxy
from the first-person head direction: `gazeAtVehiclePreCrossMs` (time spent
looking at the vehicle before stepping off) and `scannedBeforeCrossing`
(>0.4 s = active scan). This operationalizes the Active Scan → Built
Confidence → Passive Routine arc: watch whether scanning decays across the
clean runs and what happens in run 5.

**Scenario 4 — Baseline (control condition):** the AV is removed and a
human-driven car runs the *identical* approach and yielding maneuver — same
lane, same start position, same speed profile and stopping point — but with
zero eHMI: no light band, no windshield display, no synthetic sound. The only
cue the pedestrian gets is the implicit one (visible deceleration + full
stop). For reaction-time comparability, `signal_onset` is logged the moment
the car has come to a full stop. Everything else (behavioral log, confidence
check, cameras, record mode) works identically, so runs of scenario 2 vs. 4
can be compared directly: explicit eHMI signal vs. implicit motion cue.

After each scenario there is a ~7 s observation window (watch how traffic
reacts) before the confidence check appears.

## Logged per run (JSON)

`reactionTimeMs` (signal onset → crossing start), `crossed`, `completedCrossing`,
`hesitations` (stops while in the road), `avDistanceAtCrossingStart`,
timestamped event list, confidence answers. Aborted runs are kept and flagged.

## Files

- `js/scene.js` — renderer, bloom, dusk lighting, intersection/zebra/buildings
- `js/vehicle.js` — AV body, segmented LED band, canvas windshield display
- `js/actors.js` — pedestrian (user), cyclist, merging car, baseline human car, ambient traffic
- `js/audio.js` — Web Audio hum / friction / chimes / crash with stereo panning
- `js/scenarios.js` — the four scenario state machines
- `js/logger.js` — behavioral log + confidence dialog
- `js/main.js` — cameras, input, UI wiring, main loop (`window.__sim` = debug handle)
