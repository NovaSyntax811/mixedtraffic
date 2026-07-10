# eHMI Simulation — Documentation

Browser based Three.js environment for studying prosocial communication between
an automated vehicle (AV) and people on foot. It is used for focus group video
vignettes and as a first prototype of browser based behavioural measurement.

This document reflects the current state of the prototype. The older `README.md`
keeps some background that predates recent changes (scenarios 7 and 8 and the
repeated crossings protocol were removed, the walk replaced them, and the old
Start button is now a single Restart).

---

## Running locally

No build step. The ES modules need to be served over http, so do not open
`index.html` directly:

```bash
python3 -m http.server 8741 --directory ehmi-sim
# then open http://localhost:8741
```

Three.js loads from a CDN (jsdelivr), so the first load needs an internet
connection.

> Cache busting: every module import carries a `?v=NN` query. When you edit a JS
> file, increase its version number in the importing file (and `main.js?v=NN` in
> `index.html`), otherwise the browser serves the cached old copy. The stylesheet
> link carries `?v=N` for the same reason.

---

## Controls

- **W / ↑** walk forward (where you look), **S / ↓** back, **A / D** strafe.
- **Drag the mouse** to turn your head in first person (look around, glance at the
  approaching car).
- **R** re-centres the view to face across the street.
- **C** cycles cameras.
- **O** or the **⚙ button** (bottom right) opens the admin menu.
- **Esc** exits record mode and closes the admin menu.

You decide for yourself when to cross. There is no prompt telling you to go.

## Starting and restarting

- Open **☰ Scenarios** and pick one. That is the only way to start a new
  scenario. The "who's who" briefing appears, then you confirm.
- **↺ Restart** re-runs the current scenario from the beginning (no briefing).
- When a scenario starts, the car holds for about 5 seconds so you can get
  oriented, then it begins to approach.

## Admin menu (researcher only)

Opened with **O** or the **⚙ button**. It keeps the participant screen clean and
gathers everything a researcher needs:

- **Camera** views: Pedestrian (first person, 1.6 m), Cyclist (1.9 m, faster),
  Observer (follows the player from above), Cinematic (slow orbit, for
  recordings).
- **AV speed**, **Volume**, **Light band brightness** sliders.
- Toggles for **Ambient traffic**, the **Cyclist actor**, the **Merging car actor**.
- **⏺ Start recording**: hides all UI for a clean screen recording (Esc exits).
- **⬇ Download log (JSON)**: exports every run.

---

## eHMI states

| Layer | Neutral | Assessing | Yielding | Thanks |
|---|---|---|---|---|
| Light band | white | yellow (fast sweep) | cyan (slow sweep) | white |
| Windshield | off | 👁 Detecting + 🚶🚲🚗 | 👋 animated wave | ☺️ |
| Sound | hum (scaled by distance and speed) | — | friction cue while braking, then a two-note go-ahead chime | soft chime |

Band transitions are smoothstep eased (0.6 s), never hard cuts. Each interaction
follows the arc Detection → Decision → Action (signal) → Acknowledgment → Outcome.

## Reactive stopping

The AV stops with respect to where the player is, not at a fixed painted line:

- If the player stands still beside the road near the crossing for about 3
  seconds, the car reads that as intent to cross and stops roughly 1 m before
  the player's position.
- Otherwise it stops at a clean line before the crossing.
- Either way the stop is clamped so the car's whole body comes to rest **north
  of the junction**, so a yielding car never stands in the intersection blocking
  the cross streets. (The crossing sits at z = 12, well north of the junction,
  which spans z = -4 to 4, to leave room for this.)

## Accidents

Any real collision between two actors (vehicle and pedestrian, cyclist and
pedestrian, cyclist and vehicle, vehicle and vehicle) triggers a crash: a sound,
stopped or knocked-over actors, a frozen scenario, an `accident` log event, and a
pop-up whose OK button resets the scenario. The run is kept in the log, flagged
`aborted: "accident"`. Normal queued or passing traffic stays below the contact
threshold, so only unusual behaviour that produces real body overlap counts.
Walking into a stopped vehicle is not an accident: the pedestrian is just
blocked, never clipped through geometry.

---

## Scenario catalogue

Numbered scenarios all play out at the same single crossing.

| # | Title | What it probes |
|---|---|---|
| 1 | A car with no signals | Baseline / control. A human-driven car runs the identical approach and yield but with zero eHMI. The only cue is the implicit one (visible deceleration and stop). Compare against scenario 2. |
| 2 | A car that lets you cross | The full eHMI yield: light band, windshield, sound. The reference prosocial stop. |
| 3 | The car missed a cyclist | The AV yields honestly, but a cyclist races up from behind that it never saw and does not brake. Overtrust / misplaced-trust edge case. |
| 4 | A signal for the other car | The AV yields and shows "After you" to a merging driver. The signal is for the car, not you. The AV does not thank anyone afterwards (the thank-you would come from the human driver who got let in). |
| 5 | A busy intersection | The same crossing amid a bus, a truck, a cyclist and an ambulance that everyone pulls over for. Judging a crossing in a noisy scene. |
| 6 | Impatient drivers | The AV yields correctly, but an impatient driver behind it honks and overtakes right across your path. The car is safe, the others are not. |
| 9 | Is the signal for you too? | Several people wait, on both kerbs. The AV's yield is really only for the person on the far kerb — it moves off once they're clear. The near kerb's person assumes the same signal covers them, steps out late off the marked crossing, and the AV has to brake hard to avoid them: a concrete near-miss from misreading a broadcast signal as personally addressed. |
| 10 | Pedestrian baseline | The clean reference case for scenario 9. One person waits on each kerb; the AV yields once, addressed to both, and simply waits until both have actually crossed before it thanks them and drives on. No scoping tricks, no near-miss. |

## ★ A walk through town (continuous walk)

One continuous journey north up the street. You walk (W) and turn (mouse); the
car turns up at several points and reacts to where you are. Crossing is optional
each time. After each moment you keep walking and the next one comes to you. The
four encounters each probe a research theme raised in supervision:

1. **Uncertainty** — the car stops for you even though you were only walking past.
   Did you want to cross, or did it misread you?
2. **Targeted pro-sociality** — someone waits opposite as the car yields. Is the
   wave for you, or for them?
3. **Negotiation** — the car gives way, but an impatient driver behind overtakes
   across your path.
4. **Scalability / both sides** — people on both kerbs at once. One car, several
   road users: who is the signal really for?

---

## Logged data (JSON)

Exported with **Download log** in the admin menu. Per run:

- `reactionTimeMs` (signal onset → crossing start)
- `crossed`, `completedCrossing`
- `hesitations` (stops while in the road)
- `avDistanceAtCrossingStart`
- `gazeAtVehiclePreCrossMs` and `scannedBeforeCrossing` (a first-person gaze
  proxy: time spent looking at the vehicle before stepping off; > 0.4 s counts
  as an active scan)
- a timestamped `events` list (e.g. `signal_onset`, `crossing_start`,
  `pedestrian_intent_detected`, `walk_station_start`, `walk_crossed`, `honk`,
  `accident`)
- the confidence-check answers
- `mode` for special scenarios, `soundVolume`

Aborted runs (for example after an accident) are kept and flagged.

## Confidence check

After each run a short dialog appears, branched on what you actually did:

- **Crossed**: why (vehicle stopped / eHMI signal / sound cue / traffic clear /
  just went) and how safe you felt while crossing (1 to 7).
- **Did not cross**: why not, whether you would cross next time, and overall
  felt safety (1 to 7).

---

## Architecture and files

- `index.html` — UI overlay, all modals (intro, scenario menu, briefing,
  confidence check, accident, admin menu), loads `js/main.js?v=NN`.
- `style.css` — styling for all panels and modals.
- `js/main.js` — entry point. Wires everything: scenario menu, briefings,
  per-scenario lighting, cameras, input, mouse look, admin menu, accident
  system, collision checks, the main loop. `window.__sim` is a debug handle.
- `js/scene.js` — renderer, bloom, time-of-day lighting presets, the urban
  environment (roads, pavements, buildings, lamps, signs), and the `LAYOUT`
  constants (including `zebraZ`, the crossing position).
- `js/vehicle.js` — the AV: body, 360° light band, canvas windshield display and
  its modes (detecting, yielding, yielding_car, thanks).
- `js/actors.js` — the player pedestrian, scripted NPC pedestrians, the cyclist,
  the merging car, the baseline human car, and the ambient `TrafficManager`
  (intersection rules, ambulance pull-over, aggressive overtaking, honking).
- `js/scenarios.js` — `ScenarioRunner`: the state machines for every scenario,
  the reactive stop logic, and the continuous walk.
- `js/audio.js` — Web Audio: motor hum, friction, go-ahead chime, horn, siren,
  distractor music, crash, with stereo panning.
- `js/logger.js` — behavioural logging and the confidence dialog.

---

## Deployment (Netlify)

The site is static, so `netlify.toml` simply publishes the repository root with
no build step. To deploy:

1. In Netlify, choose **Add new site → Import an existing project** and connect
   the GitHub repository (Netlify can deploy from a private repo and gives a
   public URL).
2. Pick the branch to deploy (for example `jonas` while it is in review, or
   `main` once merged). No build command and no publish directory beyond the
   root are needed; `netlify.toml` already sets `publish = "."`.
3. Netlify rebuilds and republishes automatically on every push to that branch.

The previous versions stay available in git history (the `main` branch is
untouched), so any earlier commit can be checked out or deployed.
