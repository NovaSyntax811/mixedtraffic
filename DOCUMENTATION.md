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

- **Start scenario**: number-only buttons. Study set, one per topic: 1, 3, 6,
  9, then **Free roam** as the finale. Extras (demo only): 2, 4, 5.
  A public **☰ Scenarios** menu also exists for self-guided use; its cards are
  debiased (neutral titles, one shared description), so neither path reveals
  what is coming.
- **Stop current scenario**: ends the running scenario back to idle without
  starting a new one (moderator control between rounds).
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

## Scenario key (researcher only, qualitative study build)

Participants see sequential numbers (Scenario 1 to 5). The JSON log records
the INTERNAL id per run plus the display label (`label` field), so match logs
against the internal id column below.

| Display | Internal id (in logs) | Content | RQ |
|---|---|---|---|
| Training walk | walk | Walk through town with glowing trigger fields; controls practice, not analysed | Training |
| Scenario 1 | 1 | Human car, no signals at all; only the implicit motion cue | RQ1 |
| Scenario 2 | 2 | Automated car, full eHMI yield (light band, display, sound) | RQ1 |
| Scenario 3 | 6 | The AV yields; the honking driver behind it, hidden from the player by the AV, overtakes | RQ3/4 |
| Scenario 4 | 9 | Several people wait; the yield signal addresses the person opposite | RQ2 |
| Scenario 5 | 10 | The participant is only walking past; the car stops for them unprompted | RQ3/4 |

Extras (internal 3 unnoticed cyclist, 4 merge signal, 5 busy street) have no
UI entry in this build; start them from the console via `__sim.beginRun(n)`.

The free roam is meant to be run last: the participant takes a walk through a
larger town (three junctions, distinct districts: cool south, warm brick
middle with a leafy corner, light modern north with a bus stop). Between
encounters a pulsing **glowing field** appears on BOTH pavements at the next
spot (trigger logic adapted from Julius's branch); stepping into either one
starts the next situation, so after crossing the participant can carry on up
whichever side they like. The four encounters: a stop although they were only
passing, a person waiting opposite, an overtaking driver behind a yielding
car, people on both sides. Waiting pedestrians are already in place when the
player enters the field, and the car only sets off a couple of seconds later
from further down the road, so there is time to read the scene first. Texts
and the phase label are debiased like everything else, reactive stops never
rest inside a junction, and the overtaking driver there brakes for people in
the road, so a collision cannot abort the walk.

After each free-walk situation a short **mini survey** appears ("Quick
questions", 3 items): one or two questions targeted at that situation's
domain (wanted to cross? who was the signal for? what did you rely on?) plus
a shared trust item (1 to 7) that makes trust comparable across all four
situations. Answers are appended to the walk run's event log as
`walk_survey` events. The admin menu's confidence-check toggle also switches
these mini surveys off for sessions where the probing happens verbally.

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
`completedCrossing`, `avDistanceAtCrossingStart`,
`gazeAtVehiclePreCrossMs` and `scannedBeforeCrossing` (first person gaze
proxy; more than 0.4 s on the vehicle counts as an active scan), a
timestamped `events` list, and the confidence check answers (null when the
check is toggled off). Aborted runs are kept and flagged. Export via the
admin menu.

Hesitation is measured three ways:

- `hesitations`: how often the pedestrian stopped while already in the road.
- `hesitationTimeMs`: how long in total they stood still while in the road.
- `falseStarts`: how often they stepped right up to the kerb (closer than
  0.7 m to the road edge) and then backed away (beyond 1.2 m) without
  crossing; each occurrence also logs a `false_start` event.

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
