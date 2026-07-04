// Scenario state machines, following the interaction arc:
// Detection -> Decision -> Action (signal) -> Acknowledgment -> Outcome
import { LAYOUT } from './scene.js?v=47';

let ZEBRA = LAYOUT.zebraZ;
export function setCrossingZ(z) { ZEBRA = z; }
const PREROLL = 2;       // vehicle holds briefly so ambient traffic clears, then
                         // begins approaching — longer start distance compensates
const STOP_BEFORE = 3.2; // the vehicle nose stops this far before the crossing (clearly before it)
// Southernmost the vehicle nose may rest and still keep its whole ~4.4 m body
// north of the junction (junction north edge = roadWidth/2). Stops are clamped
// to this so a yielding vehicle never blocks the cross streets.
const JUNCTION_CLEAR = LAYOUT.roadWidth / 2 + 5;

export class ScenarioRunner {
  constructor({ av, humanCar, pedestrian, cyclist, mergingCar, traffic, npcs, sound, logger, onPhase, onMessage, onComplete }) {
    Object.assign(this, { av, humanCar, pedestrian, cyclist, mergingCar, traffic, npcs, sound, logger, onPhase, onMessage, onComplete });
    this.scenario = 2;
    this.phase = 'idle';
    this.approachSpeed = 8;
    this._timer = 0;
    this.running = false;
  }

  setPhase(p, msg) {
    this.phase = p;
    this.onPhase?.(p);
    if (msg) { this.onMessage?.(msg); this._lastMsg = msg; }
    this._timer = 0;
  }

  reset() {
    this.running = false;
    this.av.reset();
    this.av.group.visible = true;
    this.humanCar.hide();
    this.pedestrian.clearMotionState(); // keep position/side — no teleport between scenarios
    this.cyclist.hide();
    this.mergingCar.hide();
    this.traffic?.clearScripted();
    this.npcs?.forEach((n) => n.hide());
    this.sound?.stopYieldLoop?.();
    this._timeline = null;
    this._elapsed = 0;
    this._preroll = 0;
    this.quietEdge = false;
    this._stillTimer = 0;
    this._dynamicStopZ = null;
    this._walkStillTimer = 0;
    this._walkDynamicStopZ = null;
    this.setPhase('idle', 'Press Start, then decide when to cross.');
  }

  start(scenario) {
    this.reset();
    this.scenario = scenario;
    this.running = true;
    this.logger.startRun(scenario);
    this._preroll = PREROLL; // suppress detection logic briefly; vehicle already rolling

    if (scenario === 'walk') {
      // Continuous walk: a single journey north past several encounters, each
      // probing one of the research themes (uncertainty, who the signal is for,
      // negotiation, and scaling to several road users). Traffic is kept light:
      // only the scripted actors of the current station appear.
      this._preroll = 0;
      this.traffic?.setEnabled(false);
      this.traffic?.clearScripted();
      this.av.group.visible = false;
      this.pedestrian.group.position.set(-(LAYOUT.roadWidth / 2 + LAYOUT.sidewalk / 2), 0, 0);

      this._walkStations = [
        { kind: 'uncertainty', z: 26, maxWait: 9,
          intro: 'A car is coming up the street. You are just walking here.',
          outro: 'It stopped for you anyway. Did you actually want to cross, or did it misread you?' },
        { kind: 'targeted', z: 54, maxWait: 13,
          intro: 'Someone is waiting on the far pavement as a car approaches.',
          outro: 'The car gave way. Was that signal for you, or for the person opposite?' },
        { kind: 'negotiation', z: 82, maxWait: 13,
          intro: 'A car approaches, with an impatient one close behind it.',
          outro: 'The first car gave way, but the driver behind would not wait.' },
        { kind: 'scalability', z: 110, maxWait: 14,
          intro: 'People are waiting on both sides of the street as a car comes.',
          outro: 'One car, several people. Who was its signal really meant for?' },
      ];
      this._walkIndex = 0;
      this._walkPhase = 'walking';
      this._stationPhase = null;
      this._walkHintShown = false;
      this._walkDone = false;
      this.setPhase('walking', 'Walk up the street with W (turn with the mouse). Keep going, situations come to you. Cross whenever you choose.');
      return;
    }

    // The crossing is wherever the player is standing right now — no teleport.
    // The vehicle starts 80 m south of that and approaches naturally.
    ZEBRA = this.pedestrian.group.position.z;
    this.av.group.position.z = ZEBRA - 80;
    // Which curb the player actually started on (west = -1, east = 1), so
    // "crossed" detection and side-specific staging work from either side.
    this._startSide = Math.sign(this.pedestrian.group.position.x) || -1;

    if (scenario === 1) {
      // Baseline: same yielding interaction, but a human-driven car and no
      // eHMI of any kind — the comparison condition. (Scenario 1 = first in
      // the study order so participants see the control before any eHMI.)
      this.av.group.visible = false;
      this.humanCar.spawn();
      this.humanCar.group.position.z = ZEBRA - 80;
      this.setPhase('approach', 'An ordinary car is approaching, with no crossing here. Will it let you cross? (W/↑)');
      return;
    }

    this.av.targetSpeed = this.approachSpeed;
    this.av.setBandState('neutral');
    this.av.setDisplay('off');

    if (scenario === 4) {
      this.mergingCar.spawnWaiting();
      // Stand the observer south on the west sidewalk, clear of the merge arc
      // (the default curb spot sits right on the car's path). The car still
      // waits rather than crashes if the player walks into its way.
      this.pedestrian.group.position.set(-5.5, 0, -7);
      this.setPhase('approach', 'AV approaching. A car waits to merge from the left. Watch the interaction.');
    } else if (scenario === 5) {
      // Mixed-traffic chaos: bus, truck, side-street cyclist, and an
      // emergency vehicle everyone has to yield to. Actors behave differently.
      // Cyclist is deferred to the timeline so it arrives at the crossing after
      // the preroll ends (not during it, when the player is still orienting).
      this._timeline = [
        { t: 0, fn: () => this.cyclist.start() },
        { t: 0.5, fn: () => this.traffic.spawnScripted({ kind: 'bus', route: 'south', offset: 70, cruise: 6 }) },
        { t: 2.0, fn: () => this.traffic.spawnScripted({ kind: 'truck', route: 'west', offset: 75, cruise: 6 }) },
        {
          // The ambulance uses the side street so it can actually get through
          // (own clear lane, passes the yielding AV with ~3m clearance).
          t: 5.0, fn: () => {
            this.traffic.spawnScripted({ kind: 'ambulance', route: 'east', offset: 110, cruise: 13, siren: true, ignoreReservation: true, ignoreZebra: true });
            this.logger.event('emergency_vehicle_spawned');
            this.onMessage?.('🚨 Emergency vehicle approaching. All traffic pulls over!');
          },
        },
        { t: 9.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'west', offset: 60, cruise: 7 }) },
      ];
      this.setPhase('approach', 'Mixed traffic: bus, truck, cyclist… Cross when you feel safe (W/↑).');
    } else if (scenario === 6) {
      // Aggressive drivers, unhappy with the cautious AV: a tailgater honks
      // and eventually overtakes the yielding AV; oncoming traffic creeps
      // over the zebra stop line.
      this._timeline = [
        {
          t: 0.3, fn: () => {
            this.traffic.spawnScripted({ kind: 'car', route: 'northAV', offset: 96, cruise: 13, color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true, patience: 2.4 });
            this.logger.event('tailgater_spawned');
            this.onMessage?.('An impatient driver is tailgating the AV…');
          },
        },
        { t: 4.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'south', offset: 55, cruise: 9, honkWhenBlocked: true, ignoreZebra: true }) },
      ];
      this.setPhase('approach', 'Aggressive drivers who are unhappy with the cautious AV. Cross carefully (W/↑).');
    } else if (scenario === 9) {
      // Ambiguous signal (signal-scoping challenge): several pedestrians wait
      // at the crossing. The AV's yield signal is actually addressed to the
      // NPC on the far curb — the participant must judge for themselves
      // whether the signal applies to them too.
      // Mirrored on whichever side the player actually stands (west or east),
      // so "far curb" and "same curb as the player" stay correct either way.
      const side = this._startSide;
      const farX = -side * 5.5, nearX = side * 5.5;
      this.npcs?.[0]?.place(farX, ZEBRA, -Math.sign(farX) * Math.PI / 2);        // far curb — the real addressee
      this.npcs?.[1]?.place(nearX, ZEBRA + 3, -Math.sign(nearX) * Math.PI / 2);  // same curb as the player, a bit north
      this.setPhase('approach', 'Several people are waiting to cross here. Decide for yourself (W/↑).');
    } else {
      this.setPhase('approach', 'An AV is approaching, with no marked crossing here. See whether it yields for you (W/↑).');
    }
  }

  // Dynamic, pedestrian-aware stopping (Akib's "invisible space" idea). While
  // the AV is still approaching, we watch the pedestrian: if they stand still on
  // the footpath beside the road for 3 seconds, the AV reads that as an intent
  // to cross and aims to stop with its nose ~1 m short of wherever they are,
  // tracking their position, rather than braking to a fixed painted line. This
  // lets the person wait anywhere along the kerb and have the car respond to
  // them, not to a predetermined crossing point.
  _updatePedestrianDetection(dt) {
    if (this.scenario === 1 || this.scenario === 4 || this.scenario === 'walk') return;
    // Once the AV has committed to its stop (action phase onward), freeze the
    // target so it does not chase the pedestrian as they step into the road.
    if (this.phase !== 'approach' && this.phase !== 'detection') return;

    const p = this.pedestrian.group.position;
    const besideRoad = Math.abs(p.x) > LAYOUT.roadWidth / 2 - 1.0; // on/near the kerb, not mid-lane
    const nearCrossing = Math.abs(p.z - ZEBRA) < 8;

    if (besideRoad && nearCrossing && !this.pedestrian.moving) {
      this._stillTimer = Math.min((this._stillTimer || 0) + dt, 15);
    } else {
      this._stillTimer = 0;
    }

    if ((this._stillTimer || 0) >= 3.0) {
      // Intent detected. Track the pedestrian's z, stopping ~1 m before it, but
      // never so far back that the body sits in the junction (JUNCTION_CLEAR),
      // nor past the crossing.
      const target = Math.max(JUNCTION_CLEAR, Math.min(p.z - 1.0, ZEBRA + 1));
      if (this._dynamicStopZ === null) {
        this.logger.event('pedestrian_intent_detected', { stopZ: Math.round(target * 10) / 10 });
      }
      this._dynamicStopZ = target;
    } else if (this.phase === 'approach') {
      // Lost the wait before the AV began braking — revert to the fixed line.
      this._dynamicStopZ = null;
    }
  }

  // distance from AV front to the zebra crossing along the lane
  get distToZebra() { return ZEBRA - this.av.frontZ; }
  // distance from AV front to side-street mouth (z ~ -roadWidth/2)
  get distToSideStreet() { return -LAYOUT.roadWidth / 2 - this.av.frontZ; }

  // Smoothly brake a vehicle so its nose comes to rest at frontTargetZ (a stop
  // line), regardless of approach speed. Returns the remaining gap so callers
  // can detect when it has settled. Prevents overshooting onto the crossing.
  _brakeToStopLine(vehicle, frontTargetZ, decel = 2.5) {
    const gap = frontTargetZ - vehicle.frontZ;
    vehicle.targetSpeed = Math.max(0, Math.min(this.approachSpeed, Math.sqrt(2 * decel * Math.max(0, gap))));
    return gap;
  }

  update(dt) {
    if (!this.running) return;

    // Track pedestrian intent throughout the scenario, including during preroll,
    // so the dynamic stop target is ready when the AV starts approaching.
    this._updatePedestrianDetection(dt);

    // Brief hold so any ambient traffic in the lane has time to clear before
    // the AV starts moving. Shorter than the original 5 s because the longer
    // start distance (ZEBRA-80) already provides a natural approach window.
    if (this._preroll > 0) {
      this.av.targetSpeed = 0;
      this.humanCar.targetSpeed = 0;
      this._preroll -= dt;
      if (this._preroll <= 0) {
        if (this.scenario === 1) this.humanCar.targetSpeed = this.approachSpeed;
        else this.av.targetSpeed = this.approachSpeed;
        if (this._lastMsg) this.onMessage?.(this._lastMsg);
      }
      return;
    }

    this._timer += dt;
    this._elapsed = (this._elapsed ?? 0) + dt;

    // Scripted spawns for the mixed-traffic / aggressive scenarios
    if (this._timeline) {
      for (const item of this._timeline) {
        if (!item.done && this._elapsed >= item.t) { item.done = true; item.fn(); }
      }
    }

    // Observation window after the interaction: let the user watch how the
    // surrounding traffic plays out before the confidence check appears.
    if (this.phase === 'cooldown') {
      if (this._timer > 11) {
        this.running = false;
        this.av.targetSpeed = 0;
        this.setPhase('done', 'Scenario complete.');
        this.onComplete?.();
      }
      return;
    }

    if (this.scenario === 'walk') this._updateWalk(dt);
    else if (this.scenario === 4) this._updateMerge(dt);
    else if (this.scenario === 1) this._updateBaseline(dt);
    else if (this.scenario === 9) this._updateAmbiguous(dt);
    else this._updateCrossing(dt);
  }

  // ---------- Scenario 9: Ambiguous signal — who is the yield for? ----------
  // The AV runs the full eHMI sequence, but the addressee is the NPC on the
  // opposite curb. Messages stay deliberately neutral; the AV waits until
  // everyone who entered the road (NPC and/or participant) has cleared it.
  _updateAmbiguous(dt) {
    const d = this.distToZebra;
    switch (this.phase) {
      case 'approach':
        if (d < 42) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
          this.setPhase('detection', 'AV detected pedestrians (yellow band + eye icon).');
        }
        break;
      case 'detection': {
        const stopZ = Math.max(JUNCTION_CLEAR, this._dynamicStopZ ?? (ZEBRA - STOP_BEFORE));
        const gap = this._brakeToStopLine(this.av, stopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this._npcDelay = 1.6; // the addressee reacts shortly after the signal
          this.setPhase('action', 'AV yields, but for whom? Decide for yourself.');
        }
        break;
      }
      case 'action': {
        if (this._npcDelay !== undefined) {
          this._npcDelay -= dt;
          if (this._npcDelay <= 0) {
            this._npcDelay = undefined;
            this.npcs[0].startCross(this._startSide * 5.6); // far curb -> the player's curb
            this.logger.event('npc_crossing_started');
          }
        }
        const npcDone = this._npcDelay === undefined && this.npcs[0].state !== 'crossing';
        const playerInRoad = Math.abs(this.pedestrian.group.position.x) < LAYOUT.roadWidth / 2 + 0.4;
        // Continue only when the addressee has crossed and nobody is on the road
        if (!playerInRoad && ((npcDone && this._timer > 6) || this._timer > 35)) {
          this.logger.event('npc_crossing_finished');
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.setPhase('acknowledgment', 'AV thanks you and continues.');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 2.0) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('outcome', 'AV returns to neutral and continues.');
        }
        break;
      case 'outcome':
        if (this.av.group.position.z > ZEBRA + 40) this._finish();
        break;
    }
  }

  // ---------- Scenario 4: Baseline — human car yields, zero eHMI ----------
  // Mirrors the scenario-2 interaction arc, but the only "signal" is the
  // car's implicit motion cue. Signal onset for reaction-time comparison is
  // logged the moment the car has visibly come to a full stop.
  _updateBaseline(dt) {
    const d = ZEBRA - this.humanCar.frontZ;
    switch (this.phase) {
      case 'approach':
        if (d < 42) this.setPhase('decision', 'The car is slowing down…');
        break;
      case 'decision': {
        const gap = this._brakeToStopLine(this.humanCar, ZEBRA - STOP_BEFORE);
        if (this.humanCar.speed < 0.3 && gap < 1.0) {
          this.humanCar.targetSpeed = 0;
          this.setPhase('action', 'The car has stopped, with no signal. Decide yourself.');
        }
        break;
      }
      case 'action': {
        if (this.humanCar.speed < 0.2) this.logger.signalOnset(); // implicit cue: full stop
        const px = this.pedestrian.group.position.x;
        if (px * this._startSide < -(LAYOUT.roadWidth / 2 + 0.5)) {
          this.logger.event('crossed_baseline');
          this.setPhase('acknowledgment', 'You crossed, and the car waits briefly.');
        } else if (this._timer > 30 && !this.logger.current?.crossed) {
          this.logger.event('timeout_no_crossing');
          this.setPhase('acknowledgment', 'You stayed, and the car continues.');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 1.5) {
          this.humanCar.targetSpeed = this.approachSpeed;
          this.setPhase('outcome', 'The car drives on.');
        }
        break;
      case 'outcome':
        if (this.humanCar.group.position.z > ZEBRA + 40) this._finish();
        break;
    }
  }

  // ---------- Scenario 1: Merge ----------
  _updateMerge(dt) {
    const d = this.distToSideStreet;
    switch (this.phase) {
      case 'approach':
        if (d < 30) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
          this.setPhase('detection', 'AV detected the waiting car (yellow band).');
        }
        break;
      case 'detection': {
        // Brake to a stop just before the junction (nose at z = -6), so the AV
        // waits clear of the intersection rather than rolling into it.
        const gap = this._brakeToStopLine(this.av, -6);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          // Signal addressed to the OTHER CAR ("After you"), not the pedestrian.
          // Open question: do you read it as meant for you and step out anyway?
          this.av.setDisplay('yielding_car');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this.setPhase('action', 'The AV is letting the other car in. Is that signal for you too?');
        }
        break;
      }
      case 'action':
        if (this.av.speed < 0.2 && this._timer > 1.0) {
          this.mergingCar.merge();
          this.setPhase('acknowledgment', 'Car is merging in front of the AV.');
        }
        break;
      case 'acknowledgment':
        if (this.mergingCar._mergeT >= 1 && this._timer > 3.5) {
          // No thank-you from the AV here. It was the one that gave way, so a
          // thank-you would naturally come from the merging driver, not from the
          // car that yielded. That driver is human and has no display to show it,
          // so the AV simply returns to neutral and drives on without reacting.
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.setPhase('outcome', 'The other car has merged in. The AV continues.');
        }
        break;
      case 'outcome':
        if (this._timer > 1.8) {
          this.av.setDisplay('off');
          // Car-following: keep a safe gap behind the merged car rather than
          // rear-ending it; resume full speed once it is far enough ahead.
          const mc = this.mergingCar;
          if (mc.group.visible && mc.group.position.z > this.av.frontZ) {
            const gap = mc.group.position.z - this.av.frontZ;
            this.av.targetSpeed = Math.max(0, Math.min((gap - 6) * 1.2, this.approachSpeed));
          } else {
            this.av.targetSpeed = this.approachSpeed;
          }
        }
        if (this.av.group.position.z > 50) this._finish();
        break;
    }
  }

  // ---------- Scenarios 2 & 3: Pedestrian crossing (3 adds the unaddressed cyclist) ----------
  _updateCrossing(dt) {
    const d = this.distToZebra;
    switch (this.phase) {
      case 'approach':
        if (d < 42) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
          this.setPhase('detection', 'AV detected you (yellow band + eye icon).');
        }
        break;
      case 'detection': {
        // Use the dynamic stop target if the pedestrian was standing still long
        // enough for intent to be detected; otherwise fall back to the fixed line.
        // Either way, never rest with the body in the junction.
        const stopZ = Math.max(JUNCTION_CLEAR, this._dynamicStopZ ?? (ZEBRA - STOP_BEFORE));
        const gap = this._brakeToStopLine(this.av, stopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this.setPhase('action', 'AV yields (cyan + 👋 + tone). Cross when ready.');
          // Scenario 3 edge case: a cyclist appears behind the now-stopped AV
          // and overtakes it. The AV does NOT address it, and the cyclist does
          // not brake for the crossing pedestrian.
          if (this.scenario === 3) {
            this.cyclist.startOvertake(this.av);
            this.logger.event('cyclist_overtaking_unaddressed');
            if (!this.quietEdge) {
              this.onMessage?.('⚠ A cyclist is overtaking the AV from behind, and it will not stop for you.');
            }
          }
        }
        break;
      }
      case 'action': {
        // Wait for pedestrian to fully cross (reach far sidewalk) or time out
        // (audio-only runs get a longer window — orientation by ear takes time)
        const px = this.pedestrian.group.position.x;
        const timeoutS = 30; // AV gives up and drives on
        if (px * this._startSide < -(LAYOUT.roadWidth / 2 + 0.5)) {
          this.sound.stopYieldLoop();
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.logger.event('av_thanks');
          this.setPhase('acknowledgment', 'AV thanks you ☺️');
        } else if (this._timer > timeoutS && !this.logger.current?.crossed) {
          this.sound.stopYieldLoop();
          this.logger.event('timeout_no_crossing');
          this.setPhase('acknowledgment', 'You stayed, and the AV continues.');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 2.0) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('outcome', 'AV returns to neutral and continues.');
        }
        break;
      case 'outcome':
        if (this.av.group.position.z > ZEBRA + 40) this._finish();
        break;
    }
  }

  // ---------- Continuous walk: a journey north past several encounters ----------
  // The walk alternates between 'walking' (player strolls up the pavement, no car
  // around) and 'encounter' (a station triggers as the player nears its z). Each
  // station reuses the reactive yield, so the car responds to where the player
  // actually is, plus a little station-specific staging (a person opposite, an
  // impatient overtaker, people on both sides).
  _updateWalk(dt) {
    const p = this.pedestrian.group.position;

    if (this._walkPhase === 'walking') {
      this.av.group.visible = false; // no car between encounters
      const st = this._walkStations[this._walkIndex];
      if (!st) {
        if (!this._walkDone) {
          this._walkDone = true;
          this.logger.event('walk_complete');
          this.onMessage?.('You have reached the end of the walk. Thanks for coming along.');
          this._finish();
        }
        return;
      }
      this.onPhase?.('walking');
      if (p.z > st.z - 22) { this._startStation(st); return; }
      return;
    }

    this._updateStation(dt, this._walkStations[this._walkIndex]);
  }

  _startStation(st) {
    this._walkPhase = 'encounter';
    this._stationPhase = 'approach';
    this._timer = 0;
    this._stationActorsDone = false;
    this._npcCrossDelay = undefined;
    // The car comes up from behind (the side a crossing pedestrian checks first),
    // a little south of the crossing, and approaches at the set speed.
    this.av.group.visible = true;
    this.av.group.position.set(-1.9, 0, st.z - 32);
    this.av.group.rotation.y = 0;
    this.av.speed = this.approachSpeed * 0.6;
    this.av.targetSpeed = this.approachSpeed;
    this.av.setBandState('neutral', true);
    this.av.setDisplay('off');
    this._walkStillTimer = 0;
    this._walkDynamicStopZ = null;
    this.logger.event('walk_station_start', { kind: st.kind, z: st.z });
    this.onPhase?.(st.kind);
    this.onMessage?.(st.intro);
  }

  // Accumulate stillness while the pedestrian waits beside the road near a
  // station. After 3 seconds the dynamic stop target locks onto their z,
  // so the AV reacts to where the person actually is. While they are still
  // walking (or before the timer fires), the car aims for the nominal fixed
  // line and does not chase a moving target.
  _updateWalkStillness(dt, st) {
    const p = this.pedestrian.group.position;
    const besideRoad = Math.abs(p.x) > LAYOUT.roadWidth / 2 - 1.0;
    const nearStation = Math.abs(p.z - st.z) < 14;
    if (besideRoad && nearStation && !this.pedestrian.moving) {
      this._walkStillTimer = Math.min((this._walkStillTimer || 0) + dt, 15);
      if (this._walkStillTimer >= 3.0 && this._walkDynamicStopZ === null) {
        this._walkDynamicStopZ = Math.min(p.z - 1.0, st.z + 6);
        this.logger.event('walk_pedestrian_intent_detected', { stopZ: Math.round(this._walkDynamicStopZ * 10) / 10, station: st.kind });
      }
    } else {
      this._walkStillTimer = 0;
      if (this._stationPhase === 'approach') {
        this._walkDynamicStopZ = null; // lost wait before braking — revert to fixed line
      }
    }
  }

  // Where the car aims to stop: the dynamic position (locked after 3s of
  // pedestrian stillness) or the fixed nominal line before the crossing.
  _walkStopZ(st) {
    return this._walkDynamicStopZ ?? (st.z - STOP_BEFORE);
  }

  _updateStation(dt, st) {
    if (this._stationPhase === 'approach' || this._stationPhase === 'detect') {
      this._updateWalkStillness(dt, st);
    }
    const p = this.pedestrian.group.position;
    switch (this._stationPhase) {
      case 'approach': {
        this.av.targetSpeed = this.approachSpeed;
        if (st.z - this.av.frontZ < 26) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
          this._stationPhase = 'detect';
          this._timer = 0;
        }
        break;
      }
      case 'detect': {
        // Keep re-aiming while braking so the stop reflects where the player is
        // by the time the car settles.
        this._stationStopZ = this._walkStopZ(st);
        const gap = this._brakeToStopLine(this.av, this._stationStopZ);
        if (this.av.speed < 0.3 && gap < 1.2) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this._triggerStationActors(st);
          this._stationPhase = 'yield';
          this._timer = 0;
        }
        break;
      }
      case 'yield': {
        // Hold at the frozen stop target (no creeping toward the pedestrian).
        this._brakeToStopLine(this.av, this._stationStopZ);
        this._updateStationActors(dt, st);
        const crossed = p.x > LAYOUT.roadWidth / 2 + 0.5;
        const walkedPast = p.z > st.z + 6;
        if (crossed) { this.logger.event('walk_crossed', { kind: st.kind }); this._endStation(st); }
        else if (this._timer > st.maxWait || walkedPast) { this.logger.event('walk_not_crossed', { kind: st.kind }); this._endStation(st); }
        break;
      }
      case 'resume': {
        this.av.targetSpeed = this.approachSpeed;
        this._updateStationActors(dt, st);
        if (this.av.group.position.z > st.z + 30) {
          this._cleanupStationActors();
          this._walkPhase = 'walking';
          this._walkIndex += 1;
          this._stationPhase = null;
          if (this._walkStations[this._walkIndex]) {
            this.onMessage?.('The car drives on. Keep walking up the street, the next moment is ahead.');
          }
        }
        break;
      }
    }
  }

  _endStation(st) {
    this.av.setDisplay('off');
    this.av.setBandState('neutral');
    if (st.outro) this.onMessage?.(st.outro);
    this._stationPhase = 'resume';
    this._timer = 0;
  }

  // Bring in the station's extra road users at the moment the car yields.
  _triggerStationActors(st) {
    if (st.kind === 'targeted') {
      this.npcs?.[0]?.place(5.5, st.z, -Math.PI / 2); // person on the far kerb (the real addressee)
      this._npcCrossDelay = 1.8;
    } else if (st.kind === 'scalability') {
      this.npcs?.[0]?.place(-5.5, st.z - 2, Math.PI / 2);  // near side, just behind the player
      this.npcs?.[1]?.place(5.5, st.z + 1.5, -Math.PI / 2); // far side
      this._npcCrossDelay = 1.6;
    } else if (st.kind === 'negotiation') {
      // An impatient car a little behind the yielding AV: it honks, then
      // overtakes across the crossing. (Reactions are relative to the AV, so it
      // works anywhere along the street.)
      const imp = this.traffic?.spawnScripted({
        kind: 'car', route: 'northAV', offset: 20, cruise: this.approachSpeed + 5,
        color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true, patience: 1.8,
      });
      if (imp) { imp.mesh.position.set(-1.9, 0, this.av.group.position.z - 16); imp.speed = this.approachSpeed; }
      this.onMessage?.('The car yields for you, but the one behind is not waiting.');
    }
  }

  _updateStationActors(dt, st) {
    if (this._npcCrossDelay !== undefined) {
      this._npcCrossDelay -= dt;
      if (this._npcCrossDelay <= 0) {
        this._npcCrossDelay = undefined;
        if (st.kind === 'targeted') this.npcs?.[0]?.startCross(-5.6);       // far -> near, across the crossing
        else if (st.kind === 'scalability') this.npcs?.[0]?.startCross(5.6); // near person crosses; far one stays
      }
    }
  }

  _cleanupStationActors() {
    this.npcs?.forEach((n) => n.hide());
    this.traffic?.clearScripted();
  }

  _finish() {
    this.setPhase('cooldown', 'Scenario complete. Watch how the traffic reacts…');
  }

  // Hard stop after an accident: freeze the scripted vehicles, end the run.
  haltForAccident() {
    this.running = false;
    this.av.targetSpeed = 0;
    this.humanCar.targetSpeed = 0;
    this.sound?.stopYieldLoop?.();
    this.setPhase('accident', '💥 Accident!');
  }
}
