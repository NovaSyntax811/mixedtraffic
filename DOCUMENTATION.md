# eHMI Simulation, Documentation

Browser based Three.js environment for studying prosocial communication
between an automated vehicle (AV) and people on foot. Used hands-on in focus
groups and as a prototype for browser based behavioural measurement.

The study procedure itself is described in [STUDY_PLAN.md](STUDY_PLAN.md).
The older `README.md` keeps historical background; where they differ, this
file is current.

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

> Cache busting: every module import carries a `?v=NN` query. When you edit a
> JS file, increase its version number in the importing file (and
> `main.js?v=NN` in `index.html`), otherwise the browser serves the cached old
> copy.

## Participant view vs researcher view

The participant screen is deliberately minimal: the scenario label ("Scenario
3"), a Restart button, the phase indicator, the message line, and a small gear
button. Everything else lives in the **admin menu**, opened with the gear
button or the **O** key, closed with Close, O, or Escape:

- **Start scenario**: number-only buttons. Study set: 1, 3, 4, 6, 9. Extras
  (demo only): 2, 5. There is no participant-facing scenario list, so a
  watching focus group never sees what is coming.
- **Camera** views: Pedestrian (first person), Cyclist, Observer, Cinematic.
- **AV speed**, **Volume**, **Light band brightness** sliders.
- Toggles: ambient traffic, cyclist actor, merging car actor, and
  **Confidence check after each run** (switch off when the probes happen
  verbally in a group session).
- **Start recording** (hides all UI, Escape exits) and **Download log (JSON)**.

Flow: the researcher presses a scenario number, the participant reads a short
neutral briefing and presses Start. Between situations the participant can
walk around freely (this doubles as controls practice). Restart re-runs the
current scenario without the briefing.

## Scenario key (researcher only)

The UI shows only numbers. Mapping:

| # | Content | Domain |
|---|---|---|
| 1 | Human car, no eHMI at all; only the implicit motion cue | Baseline |
| 3 | Full eHMI yield; an unnoticed cyclist overtakes the stopped AV and does not brake | Overtrust |
| 4 | The AV yields and shows "After you" to a car merging from the side street | Targeted pro-sociality (vehicle) |
| 6 | The AV yields correctly; the driver behind honks and overtakes across the crossing | Negotiation |
| 9 | The AV yields while several people wait; the signal addresses the person opposite | Targeted pro-sociality (who?) |
| 2 | Plain full eHMI yield | Extra: demo and practice |
| 5 | Busy street: bus, truck, cyclist, ambulance everyone pulls over for | Extra: excluded from the study |

The continuous walk ("A walk through town") is no longer offered in the UI;
its code remains in `js/scenarios.js` and can be launched from the console via
`__sim.beginRun('walk')` for demos.

## Debiasing rules (implemented)

So that neither the player nor a watching group is primed:

- Labels are number-only; the descriptive titles ("The car missed a cyclist")
  are gone from every visible surface.
- Briefings introduce only who is present, never what will happen. Scenarios
  2, 3 and 6 share a word-for-word identical briefing on purpose: any
  difference would itself signal "something is special this time".
- During a run there is exactly one neutral instruction ("A car is
  approaching. There is no marked crossing here, so decide for yourself if
  and when to cross"). No in-run narration annotates the eHMI states,
  announces the cyclist, names the impatient driver, or asks the study
  question out loud.
- The intro no longer lists the tricky situations.

## eHMI states

| Layer | Neutral | Assessing | Yielding | Thanks |
|---|---|---|---|---|
| Light band | white | yellow (fast sweep) | cyan (slow sweep) | white |
| Windshield | off | eye icon | animated wave | smile |
| Sound | hum (distance and speed scaled) | none | friction cue while braking, then a two-note chime | soft chime |

Band transitions are smoothstep eased (0.6 s). Each interaction follows the
arc Detection, Decision, Action (signal), Acknowledgment, Outcome.

## Reactive stopping

The AV stops with respect to where the player is, not at a fixed painted
line. If the player stands still beside the road near the crossing for about
3 seconds, the car reads that as intent and stops roughly 1 m before them;
otherwise it stops at a clean line before the crossing. Every stop is clamped
so the car's body rests north of the junction and never blocks the cross
streets.

## Accidents

Any real collision between two actors triggers a crash: sound, stopped or
knocked-over actors, a frozen scenario, an `accident` log event, and a dialog
whose OK button resets the scenario. The run is kept in the log, flagged
`aborted: "accident"`. Walking into a stopped vehicle is not an accident, the
pedestrian is just blocked. In scenario 6 the overtaking driver genuinely can
hit a badly timed crossing; that hazard is the point of the scenario.

## Logged data (JSON)

Per run: `reactionTimeMs` (signal onset to crossing start), `crossed`,
`completedCrossing`, `hesitations`, `avDistanceAtCrossingStart`,
`gazeAtVehiclePreCrossMs` and `scannedBeforeCrossing` (first person gaze
proxy; more than 0.4 s on the vehicle counts as an active scan), a
timestamped `events` list, and the confidence check answers (null when the
check is toggled off). Aborted runs are kept and flagged. Export via the
admin menu.

## Confidence check

After each run, branched on behaviour: crossed (why, felt safety 1 to 7) or
did not cross (why not, would you next time, overall safety 1 to 7). Can be
switched off in the admin menu.

## Architecture and files

- `index.html`: UI overlay and all modals (intro, briefing, admin menu,
  confidence check, accident), loads `js/main.js?v=NN`.
- `style.css`: styling for panels and modals.
- `js/main.js`: entry point. Wires everything: admin menu, briefings,
  per-scenario lighting, cameras, input, mouse look, accident system,
  collision checks, main loop. `window.__sim` is a debug handle.
- `js/scene.js`: renderer, bloom, time-of-day presets, the urban environment,
  and the `LAYOUT` constants (including `zebraZ`, the crossing position).
- `js/vehicle.js`: the AV body, 360 degree light band, canvas windshield
  display and its modes.
- `js/actors.js`: player pedestrian, NPC pedestrians, cyclist, merging car,
  baseline human car, and the ambient `TrafficManager` (intersection rules,
  ambulance pull-over, aggressive and safe overtaking, honking).
- `js/scenarios.js`: `ScenarioRunner`, the state machines for every scenario,
  the reactive stop logic, and the (currently unlisted) continuous walk.
- `js/audio.js`: Web Audio (hum, friction, chime, horn, siren, crash) with
  stereo panning.
- `js/logger.js`: behavioural logging and the confidence dialog.

## Deployment (Netlify)

Static site, no build step. `netlify.toml` publishes the repository root.
Netlify redeploys automatically on every push to the connected branch.
Previous versions stay available in git history; notable branches:
`scenario-selector` (backup of the menu-driven version) and `feature/Julius`
(the chained single-flow experiment).
