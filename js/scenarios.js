// Scenario state machines, following the interaction arc:
// Detection -> Decision -> Action (signal) -> Acknowledgment -> Outcome
import { LAYOUT } from './scene.js?v=48';

const ZEBRA = LAYOUT.zebraZ;
const PREROLL = 5;       // short opening hold: the car waits a few seconds so the
                         // player can orient and walk around before it approaches
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
    this.pedestrian.reset();
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
    this.walkAwaitZ = null; // z of the glowing field the walk is waiting at (null = none)
    this._autoStations = false; // scenario 10: encounters arise while walking, no fields
    this.setPhase('idle', 'You can walk around freely. The next situation will start in a moment.');
  }

  start(scenario) {
    this.reset();
    this.scenario = scenario;
    this.running = true;
    this.logger.startRun(scenario);
    // Free-walk lead-in: the vehicle holds for a few seconds so the player can
    // walk around and get oriented before it starts approaching.
    this._preroll = PREROLL;

    if (scenario === 'training') {
      // Free-roam training: no staged events, but a FEW ORDINARY CARS drive
      // around (ambient traffic, max 3) so the world feels alive and crossing
      // can be practised realistically. They brake for people in the road and
      // follow normal rules; nothing is scripted. The participant explores
      // until the session leader ends the run (Stop button). Nothing here is
      // analysed. update() has no branch for this phase, so the world simply
      // idles while the player walks around.
      this._preroll = 0;
      this.traffic?.setEnabled(true); // overrides the walk-like default (off)
      this.traffic?.clearScripted();
      this.av.group.visible = false;
      this.pedestrian.group.position.set(-(LAYOUT.roadWidth / 2 + LAYOUT.sidewalk / 2), 0, 0);
      this.setPhase('training', 'Explore freely: W walks where you look, the mouse turns your head. Walk around, cross the street if you like. Tell the session leader when you feel ready.');
      return;
    }

    if (scenario === 'walk' || scenario === 10) {
      // Continuous walk: a single journey north past several encounters, each
      // probing one of the research themes (uncertainty, who the signal is for,
      // negotiation, and scaling to several road users). Traffic is kept light:
      // only the scripted actors of the current station appear.
      // Scenario 10 reuses this machinery as the STANDALONE uncertainty
      // situation (pedestrian variant): one encounter that arises naturally
      // while walking, no glowing fields, run ends after it.
      this._preroll = 0;
      this.traffic?.setEnabled(false);
      this.traffic?.clearScripted();
      this.av.group.visible = false;
      this.pedestrian.group.position.set(-(LAYOUT.roadWidth / 2 + LAYOUT.sidewalk / 2), 0, 0);
      // Station spacing sets the walk's pacing: ~26 m between crossings keeps a
      // short breather between encounters without long empty stretches. Tune the
      // z values here after playtests.
      // Intros only state what is visibly there; outros never pose the domain
      // question (that is the moderator's job in the focus group). The `kind`
      // is for the log only and must never reach the screen.
      // Stations sit in different districts of the town (mid-block south, past
      // the leafy junction B, warm mid-block, past the bus-stop junction C).
      // minStop keeps a reactive stop from resting the car inside a junction
      // (B spans z 40..48, C spans 88..96; nose >= edge + 5 clears the body).
      this._walkStations = [
        { kind: 'uncertainty', z: 26, maxWait: 9,
          intro: 'A car is coming up the street. You are just walking here.',
          outro: 'The car drives on.' },
        { kind: 'targeted', z: 56, maxWait: 13, minStop: 53,
          intro: 'Someone is waiting on the far pavement as a car approaches.',
          outro: 'The car drives on.' },
        { kind: 'negotiation', z: 78, maxWait: 13,
          intro: 'Two cars are coming up the street.',
          outro: 'The cars drive on.' },
        { kind: 'scalability', z: 104, maxWait: 14, minStop: 101,
          intro: 'People are waiting on both sides of the street as a car comes.',
          outro: 'The car drives on.' },
      ];
      if (scenario === 10) {
        this._autoStations = true;
        this._walkStations = [{ kind: 'uncertainty', z: 34, maxWait: 9,
          intro: 'A car is coming up the street. You are just walking here.',
          outro: 'The car drives on.' }];
      }
      this._walkIndex = 0;
      this._walkPhase = 'walking';
      this._stationPhase = null;
      this._walkHintShown = false;
      this._walkDone = false;
      this.setPhase('walking', scenario === 10
        ? 'Walk up the street along the pavement (W to walk where you look, mouse to turn).'
        : 'Take a walk through town (W to walk where you look, mouse to turn). Walk into the glowing field on the pavement to begin.');
      return;
    }

    if (scenario === 1) {
      // Baseline: same yielding interaction, but a human-driven car and no
      // eHMI of any kind — the comparison condition. (Scenario 1 = first in
      // the study order so participants see the control before any eHMI.)
      this.av.group.visible = false;
      this.humanCar.spawn();
      this.humanCar.targetSpeed = this.approachSpeed;
      this.setPhase('approach', 'A car is approaching. There is no marked crossing here, so decide for yourself if and when to cross (W/↑).');
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
      this.setPhase('approach', 'A car is approaching on the main road, and another waits at the side street. Decide for yourself if and when to cross (W/↑).');
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
      this.setPhase('approach', 'A busy street. Decide for yourself if and when to cross (W/↑).');
    } else if (scenario === 6) {
      // Aggressive drivers, unhappy with the cautious AV: a tailgater honks
      // and eventually overtakes the yielding AV; oncoming traffic creeps
      // over the zebra stop line.
      this._timeline = [
        {
          t: 0.3, fn: () => {
            this.traffic.spawnScripted({ kind: 'car', route: 'northAV', offset: 76, cruise: 13, color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true, patience: 2.4 });
            this.logger.event('tailgater_spawned');
            // No HUD announcement: the honking and the car itself are the cue.
            // Naming the driver "impatient" would hand the participant the theme.
          },
        },
        { t: 4.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'south', offset: 55, cruise: 9, honkWhenBlocked: true, ignoreZebra: true }) },
      ];
      this.setPhase('approach', 'A car is approaching. There is no marked crossing here, so decide for yourself if and when to cross (W/↑).');
    } else if (scenario === 9) {
      // Ambiguous signal (signal-scoping challenge): several pedestrians wait
      // at the crossing. The AV's yield signal is actually addressed to the
      // NPC on the far curb — the participant must judge for themselves
      // whether the signal applies to them too.
      this.npcs?.[0]?.place(5.5, ZEBRA, -Math.PI / 2);     // far (east) curb — the real addressee
      this.npcs?.[1]?.place(-5.5, ZEBRA + 3, Math.PI / 2); // same curb as the player, a bit north
      this.setPhase('approach', 'A car is approaching, and other people are waiting nearby. Decide for yourself if and when to cross (W/↑).');
    } else {
      this.setPhase('approach', 'A car is approaching. There is no marked crossing here, so decide for yourself if and when to cross (W/↑).');
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
    if (this.scenario === 1 || this.scenario === 4 || this.scenario === 'walk' || this.scenario === 10 || this.scenario === 'trial' || this.scenario === 'ctrial') return;
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

    // Free-walk lead-in: hold the vehicles, let the player roam, then release.
    if (this._preroll > 0) {
      this.av.targetSpeed = 0;
      this.humanCar.targetSpeed = 0;
      if (this._prerollMsg !== true) {
        this.onMessage?.('Take a moment and walk around. The vehicle will start approaching shortly.');
        this._prerollMsg = true;
      }
      this._preroll -= dt;
      if (this._preroll <= 0) {
        this._prerollMsg = false;
        if (this.scenario === 1) this.humanCar.targetSpeed = this.approachSpeed;
        else this.av.targetSpeed = this.approachSpeed;
        if (this._lastMsg) this.onMessage?.(this._lastMsg); // restore scenario message
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

    if (this.scenario === 'ctrial') this._updateComplexityTrial(dt);
    else if (this.scenario === 'trial') this._updateTrial(dt);
    else if (this.scenario === 'walk' || this.scenario === 10) this._updateWalk(dt);
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
          this.setPhase('detection'); // no narration: the participant reads the signals themselves
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
          this.setPhase('action'); // silent: naming the ambiguity would answer the study question
        }
        break;
      }
      case 'action': {
        if (this._npcDelay !== undefined) {
          this._npcDelay -= dt;
          if (this._npcDelay <= 0) {
            this._npcDelay = undefined;
            this.npcs[0].startCross(-5.6); // east -> west, right across the zebra
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
          this.setPhase('acknowledgment');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 2.0) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('outcome', 'The car drives on.');
        }
        break;
      case 'outcome':
        if (this.av.group.position.z > 55) this._finish();
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
        // No narration: pointing at the deceleration would annotate the very
        // implicit cue this baseline exists to measure.
        if (d < 42) this.setPhase('decision');
        break;
      case 'decision': {
        const gap = this._brakeToStopLine(this.humanCar, ZEBRA - STOP_BEFORE);
        if (this.humanCar.speed < 0.3 && gap < 1.0) {
          this.humanCar.targetSpeed = 0;
          this.setPhase('action');
        }
        break;
      }
      case 'action': {
        if (this.humanCar.speed < 0.2) this.logger.signalOnset(); // implicit cue: full stop
        const px = this.pedestrian.group.position.x;
        if (px > LAYOUT.roadWidth / 2 + 0.5) {
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
        if (this.humanCar.group.position.z > 55) this._finish();
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
          this.setPhase('detection');
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
          // Silent: spelling out who the "After you" addresses is the study question.
          this.setPhase('action');
        }
        break;
      }
      case 'action':
        if (this.av.speed < 0.2 && this._timer > 1.0) {
          this.mergingCar.merge();
          this.setPhase('acknowledgment');
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
          this.setPhase('outcome', 'The cars drive on.');
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
          this.setPhase('detection');
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
          this.setPhase('action');
          // Scenario 3 edge case: a cyclist appears behind the now-stopped AV
          // and overtakes it. The AV does NOT address it, and the cyclist does
          // not brake for the crossing pedestrian. Deliberately NO warning
          // message: noticing (or missing) the cyclist unaided is exactly the
          // overtrust behaviour this scenario measures.
          if (this.scenario === 3) {
            this.cyclist.startOvertake(this.av);
            this.logger.event('cyclist_overtaking_unaddressed');
          }
        }
        break;
      }
      case 'action': {
        // Wait for pedestrian to fully cross (reach far sidewalk) or time out
        // (audio-only runs get a longer window — orientation by ear takes time)
        const px = this.pedestrian.group.position.x;
        const timeoutS = 30; // AV gives up and drives on
        if (px > LAYOUT.roadWidth / 2 + 0.5) {
          this.sound.stopYieldLoop();
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.logger.event('av_thanks');
          this.setPhase('acknowledgment');
        } else if (this._timer > timeoutS && !this.logger.current?.crossed) {
          this.sound.stopYieldLoop();
          this.logger.event('timeout_no_crossing');
          this.setPhase('acknowledgment', 'You stayed, and the car continues.');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 2.0) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('outcome', 'The car drives on.');
        }
        break;
      case 'outcome':
        if (this.av.group.position.z > 55) this._finish();
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
    if (this._walkPhase === 'walking') {
      this.av.group.visible = false; // no car between encounters
      const st = this._walkStations[this._walkIndex];
      if (!st) {
        if (!this._walkDone) {
          this._walkDone = true;
          this.walkAwaitZ = null;
          this.logger.event('walk_complete');
          if (this.scenario === 'walk') this.onMessage?.('You have reached the end of the walk. Thanks for coming along.');
          this._finish();
        }
        return;
      }
      this.onPhase?.('walking');
      if (this._autoStations) {
        // Standalone variant (scenario 10): the encounter arises on its own as
        // the player walks, no field to step into.
        this.walkAwaitZ = null;
        if (this.pedestrian.group.position.z > st.z - 22) this._startStation(st);
        return;
      }
      // Between encounters the walk waits at a glowing field on the pavement
      // (rendered by main.js on BOTH kerbs, a few metres before the crossing
      // point, so the player can arrive on either side). main.js calls
      // walkEnterZone() when the player steps into one.
      this.walkAwaitZ = st.z - 4;
      return;
    }

    this._updateStation(dt, this._walkStations[this._walkIndex]);
  }

  // Player stepped into the glowing field: begin this station's encounter.
  walkEnterZone() {
    if (this.scenario !== 'walk' || !this.running || this._walkPhase !== 'walking') return;
    const st = this._walkStations[this._walkIndex];
    if (!st) return;
    this.walkAwaitZ = null;
    this._startStation(st);
  }

  _startStation(st) {
    this._walkPhase = 'encounter';
    this._stationPhase = 'stage';
    this._timer = 0;
    this._stationActorsDone = false;
    this._npcCrossDelay = undefined;
    // Which pavement the player is on when the encounter begins. After crossing
    // at a station they may carry on up the other side; every station works from
    // either side (crossing then means going the other way), so nobody has to
    // cross back just to continue the walk.
    this._stationSide = this.pedestrian.group.position.x >= 0 ? 1 : -1;
    // The scene is set FIRST: any waiting pedestrians are already there when
    // the player arrives (no popping in mid-encounter), and the car only sets
    // off after a short beat, so there is time to take the scene in.
    this._stageStationActors(st);
    this.av.group.visible = false;
    this._stageT = 2.5; // seconds before the car appears down the road
    this.logger.event('walk_station_start', { kind: st.kind, z: st.z });
    this.onPhase?.('encounter'); // never the domain name — the phase label is on screen
    this.onMessage?.(st.intro);
  }

  // Pedestrian staging at the moment the player enters the field, relative to
  // the pavement the player is on (side changes stay supported).
  _stageStationActors(st) {
    const side = this._stationSide || -1;
    if (st.kind === 'targeted') {
      this.npcs?.[0]?.place(-side * 5.5, st.z, side * Math.PI / 2); // person on the far kerb (the real addressee)
    } else if (st.kind === 'scalability') {
      this.npcs?.[0]?.place(side * 5.5, st.z - 2, -side * Math.PI / 2);  // near side, just behind the player
      this.npcs?.[1]?.place(-side * 5.5, st.z + 1.5, side * Math.PI / 2); // far side
    }
  }

  // Where the car should aim to stop. If the player is waiting (standing still)
  // beside the road near this station, the car stops ~1 m short of them, so it
  // reacts to where the person actually is. While the player is still walking,
  // it just aims for the nominal line before the crossing (no creeping after a
  // moving target).
  _walkStopZ(st) {
    const p = this.pedestrian.group.position;
    const besideRoad = Math.abs(p.x) > LAYOUT.roadWidth / 2 - 1.0;
    const waitingHere = besideRoad && !this.pedestrian.moving && Math.abs(p.z - st.z) < 14;
    const base = waitingHere ? p.z - 1.5 : st.z - STOP_BEFORE; // ~1 m clearance after braking settles
    // minStop keeps the car's body clear of the junction just south of this station
    return Math.max(st.minStop ?? -Infinity, Math.min(base, st.z + 6));
  }

  _updateStation(dt, st) {
    const p = this.pedestrian.group.position;
    switch (this._stationPhase) {
      case 'stage': {
        // Waiting pedestrians are already in place; after a short beat the car
        // appears further down the road (later arrival than before, so the
        // player has time to read the scene before it matters).
        this._stageT -= dt;
        if (this._stageT <= 0) {
          this.av.group.visible = true;
          this.av.group.position.set(-1.9, 0, st.z - 40);
          this.av.group.rotation.y = 0;
          this.av.speed = this.approachSpeed * 0.6;
          this.av.targetSpeed = this.approachSpeed;
          this.av.setBandState('neutral', true);
          this.av.setDisplay('off');
          this._stationPhase = 'approach';
          this._timer = 0;
        }
        break;
      }
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
        // Crossed = reached the pavement OPPOSITE the one this station started
        // on (works in both directions, so the walk continues on either side).
        const crossed = -this._stationSide * p.x > LAYOUT.roadWidth / 2 + 0.5;
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
            this.onMessage?.('Walk on to the next glowing field, on whichever side of the street you like.');
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
    // Domain-targeted mini survey right after the situation resolves (main.js
    // shows it and appends the answers to the run's event log).
    this.onStationSurvey?.(st.kind);
  }

  // Reactions at the moment the car yields. The waiting pedestrians were
  // already staged when the encounter began; here they only start REACTING to
  // the signal (the addressee steps off shortly after the cue), and the
  // negotiation station brings in the car behind.
  _triggerStationActors(st) {
    if (st.kind === 'targeted') {
      this._npcCrossDelay = 1.8;
    } else if (st.kind === 'scalability') {
      this._npcCrossDelay = 1.6;
    } else if (st.kind === 'negotiation') {
      // An impatient car a little behind the yielding AV: it honks, then
      // overtakes across the crossing. (Reactions are relative to the AV, so it
      // works anywhere along the street.) safeOvertake: inside the walk the
      // overtaker still brakes for people in the road — the threat stays, but a
      // collision cannot abort the whole walk. The standalone scenario 6 keeps
      // the real hazard.
      const imp = this.traffic?.spawnScripted({
        kind: 'car', route: 'northAV', offset: 20, cruise: this.approachSpeed + 5,
        color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true,
        patience: 1.8, safeOvertake: true,
      });
      if (imp) { imp.mesh.position.set(-1.9, 0, this.av.group.position.z - 16); imp.speed = this.approachSpeed; }
      // No HUD line: the horn and the swerve are the cues, not a caption.
    }
  }

  _updateStationActors(dt, st) {
    const side = this._stationSide || -1;
    if (this._npcCrossDelay !== undefined) {
      this._npcCrossDelay -= dt;
      if (this._npcCrossDelay <= 0) {
        this._npcCrossDelay = undefined;
        if (st.kind === 'targeted') this.npcs?.[0]?.startCross(side * 5.6);        // far -> near (toward the player's side)
        else if (st.kind === 'scalability') this.npcs?.[0]?.startCross(-side * 5.6); // near person crosses; far one stays
      }
    }
  }

  _cleanupStationActors() {
    this.npcs?.forEach((n) => n.hide());
    this.traffic?.clearScripted();
  }

  // ---------- Quantitative 2x2 trials ----------
  // One parametric trial for the factorial design. cfg:
  //   ehmi       true = full communicative package (band, display, yield
  //              chime); false = same vehicle with the package dark/silent.
  //              Engine hum and braking sounds are identical in both levels.
  //   proximity  'player' | 'npc' — whose kerb position the car stops at
  //              (nose a constant 1.5 m short of the target's z).
  //   npc        false = no co-present pedestrian (fillers); default present.
  //   npcCrosses whether the NPC steps off npcDelayMs after the stop/signal.
  //   stops      false = non-stopping filler, the car just drives through.
  //   mirrored   swaps who stands nearer the approaching car (the two kerb
  //              slots are 7 m apart on the same pavement).
  // ---------- Complexity study (single-factor: Traffic Complexity) ----------
  // The eHMI is held CONSTANT (full package always on); what varies is the
  // traffic scene. cfg:
  //   level         'C1' solo/unambiguous | 'C2' mixed/parallel | 'C3' mixed/competing
  //   playerZ       kerb position of the participant (scene instantiation)
  //   sameSideNpcs  companions on the participant's kerb who cross in parallel (C2)
  //   oppositeNpc   an addressee on the far kerb who crosses promptly (C3a)
  //   hazard        'cyclist' = a competing cyclist cuts through the crossing
  //                 while the car yields (C3b, the over-trust probe). The car
  //                 never lies: it yields honestly and simply does not speak
  //                 for the cyclist, so this needs no deception.
  //   groundTruth   'you' | 'other' — who the signal is really for, for
  //                 scoring the misattribution item.
  //   mirrored      flips the layout (companions ahead vs behind)
  startComplexityTrial(cfg) {
    this.reset();
    this.scenario = 'ctrial';
    this.trial = cfg;
    this.running = true;
    this.logger.startRun('ctrial');
    this._preroll = 0;
    this.traffic?.setEnabled(false);
    this.traffic?.clearScripted();
    this.humanCar.hide();
    this.cyclist.hide();

    const pz = cfg.playerZ ?? 12;
    this.pedestrian.group.position.set(-5.5, 0, pz);
    this.pedestrian.heading = Math.PI / 2;
    this.pedestrian.group.rotation.y = Math.PI / 2;

    // The AV, coming from the south, rests with its ~4.4 m body reaching south
    // of its nose. Everyone who crosses must do so NORTH of the nose (in front
    // of the car), never inside that footprint, or they would stall at the car.
    // Companions therefore sit north of the participant; the far-kerb addressee
    // sits just north too. Kerb x = +/-5.5.
    this._companions = [];
    const nSame = Math.min(cfg.sameSideNpcs ?? 0, this.npcs?.length ?? 0);
    const offsets = [2, 4, 6]; // metres north of the participant
    for (let i = 0; i < nSame; i++) {
      this.npcs[i].place(-5.5, pz + offsets[i], Math.PI / 2);
      this._companions.push(this.npcs[i]);
    }
    // Far-kerb addressee: the road user the signal is actually for (C3a).
    this._addressee = null;
    this._addresseeZ = null;
    if (cfg.oppositeNpc && this.npcs?.[nSame]) {
      this._addresseeZ = pz + 1; // just north of the participant, far kerb
      this._addressee = this.npcs[nSame];
      this._addressee.place(5.5, this._addresseeZ, -Math.PI / 2);
    }

    // Stop 1.5 m short of whoever the signal is for: constant stop DISTANCE,
    // only the addressee varies (so distance never confounds felt address).
    const targetZ = (cfg.groundTruth === 'other' && this._addresseeZ !== null) ? this._addresseeZ : pz;
    this._trialStopZ = targetZ - 1.5;
    this._companionTimer = null;
    this._addresseeTimer = null;
    this._hazardFired = false;

    this.av.group.visible = true;
    this.av.group.position.set(-1.9, 0, -55);
    this.av.group.rotation.y = 0;
    this.av.speed = this.approachSpeed;
    this.av.targetSpeed = this.approachSpeed;
    this.av.setBandState('neutral', true);
    this.av.setDisplay('off');
    this.logger.event('ctrial_start', { level: cfg.level, inst: cfg.inst, groundTruth: cfg.groundTruth });
    this.setPhase('approach', 'You want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross (W/↑).');
  }

  _updateComplexityTrial(dt) {
    const cfg = this.trial;
    const p = this.pedestrian.group.position;
    const half = LAYOUT.roadWidth / 2;
    switch (this.phase) {
      case 'approach': {
        if (this._trialStopZ - this.av.frontZ < 25) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
        }
        const gap = this._brakeToStopLine(this.av, this._trialStopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          // eHMI is constant across all conditions: full package every time.
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset(); // reference for decision latency
          if (this._companions.length) this._companionTimer = 2.0;
          if (this._addressee) this._addresseeTimer = 1.2; // prompt reveal
          if (cfg.hazard === 'cyclist' && !this._hazardFired) {
            this._hazardFired = true;
            this.cyclist.startOvertake(this.av);
            this.logger.event('competing_cyclist_started');
          }
          this.setPhase('waiting');
        }
        break;
      }
      case 'waiting': {
        this._brakeToStopLine(this.av, this._trialStopZ);
        if (this._companionTimer !== null) {
          this._companionTimer -= dt;
          if (this._companionTimer <= 0) {
            this._companionTimer = null;
            for (const c of this._companions) c.startCross(5.6);
            this.logger.event('companions_cross_start', { n: this._companions.length });
          }
        }
        if (this._addresseeTimer !== null) {
          this._addresseeTimer -= dt;
          if (this._addresseeTimer <= 0) {
            this._addresseeTimer = null;
            this._addressee?.startCross(-5.6); // far kerb -> near kerb
            this.logger.event('addressee_cross_start');
          }
        }
        const playerCrossed = p.x > half + 0.5;
        const playerInRoad = Math.abs(p.x) < half + 0.4;
        const othersInRoad = (this.npcs ?? []).some((n) => n.group.visible && Math.abs(n.group.position.x) < half + 0.4);
        const clear = !playerInRoad && !othersInRoad;
        if (((playerCrossed || this._timer > 18) && clear) || this._timer > 40) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('leave', 'The car drives on.');
        }
        break;
      }
      case 'leave':
        if (this.av.group.position.z > this._trialStopZ + 40) this._endTrial();
        break;
    }
  }

  startTrial(cfg) {
    this.reset();
    this.scenario = 'trial';
    this.trial = cfg;
    this.running = true;
    this.logger.startRun('trial');
    this._preroll = 0;
    this.traffic?.setEnabled(false);
    this.traffic?.clearScripted();
    this.humanCar.hide();

    // Kerb slots on the west pavement; the car approaches from the south.
    const SOUTH = 10, NORTH = 17;
    const pSlot = cfg.mirrored ? NORTH : SOUTH;
    const nSlot = cfg.mirrored ? SOUTH : NORTH;
    this.pedestrian.group.position.set(-5.5, 0, pSlot);
    this.pedestrian.heading = Math.PI / 2;
    this.pedestrian.group.rotation.y = Math.PI / 2;
    if (cfg.npc !== false) this.npcs?.[0]?.place(-5.5, nSlot, Math.PI / 2);

    // Factor B with a CONSTANT stop distance: only the target person varies.
    this._trialStopZ = (cfg.proximity === 'npc' ? nSlot : pSlot) - 1.5;
    this._npcTimer = null;
    this._npcCrossed = false;

    this.av.group.visible = true;
    this.av.group.position.set(-1.9, 0, -55);
    this.av.group.rotation.y = 0;
    this.av.speed = this.approachSpeed;
    this.av.targetSpeed = this.approachSpeed;
    this.av.setBandState('neutral', true);
    this.av.setDisplay('off');
    this.setPhase('approach', 'You want to reach the other side of the street. There is no marked crossing, so decide for yourself if and when to cross (W/↑).');
  }

  _updateTrial(dt) {
    const cfg = this.trial;
    const p = this.pedestrian.group.position;
    const npc = this.npcs?.[0];
    switch (this.phase) {
      case 'approach': {
        if (cfg.stops === false) {
          // Non-stopping filler: the car simply drives through. Breaks the
          // "the car always stops" learning across the session.
          if (this.av.group.position.z > 55) this._endTrial();
          return;
        }
        if (cfg.ehmi && this._trialStopZ - this.av.frontZ < 25) {
          this.av.setBandState('assessing');
          this.av.setDisplay('detecting');
        }
        const gap = this._brakeToStopLine(this.av, this._trialStopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          if (cfg.ehmi) {
            this.av.setBandState('yielding');
            this.av.setDisplay('yielding');
            this.sound.playGoAhead();
          }
          // Latency reference: the explicit cue when present, otherwise the
          // full stop (same convention as the old baseline scenario).
          this.logger.signalOnset();
          if (cfg.npc !== false && cfg.npcCrosses) this._npcTimer = (cfg.npcDelayMs ?? 3500) / 1000;
          this.setPhase('waiting');
        }
        break;
      }
      case 'waiting': {
        this._brakeToStopLine(this.av, this._trialStopZ);
        if (this._npcTimer !== null) {
          this._npcTimer -= dt;
          if (this._npcTimer <= 0) {
            this._npcTimer = null;
            npc?.startCross(5.6);
            this.logger.event('npc_move_start');
          }
        }
        if (!this._npcCrossed && npc?.group.visible && npc.state === 'idle' && npc.group.position.x > 5) {
          this._npcCrossed = true;
          this.logger.event('npc_cross_complete');
        }
        const half = LAYOUT.roadWidth / 2;
        const playerCrossed = p.x > half + 0.5;
        const playerInRoad = Math.abs(p.x) < half + 0.4;
        const npcInRoad = !!npc?.group.visible && Math.abs(npc.group.position.x) < half + 0.4;
        const everyoneClear = !playerInRoad && !npcInRoad;
        // Resume once the crossing resolved (crossed, or the wait window ran
        // out) and nobody is in the road; hard cap so the flow never hangs.
        if (((playerCrossed || this._timer > 16) && everyoneClear) || this._timer > 40) {
          if (cfg.ehmi) { this.av.setDisplay('off'); this.av.setBandState('neutral'); }
          this.av.targetSpeed = this.approachSpeed;
          this.setPhase('leave', 'The car drives on.');
        }
        break;
      }
      case 'leave':
        if (this.av.group.position.z > this._trialStopZ + 40) this._endTrial();
        break;
    }
  }

  // Trials skip the long observation cooldown of the qualitative scenarios:
  // the next screen (form or next trial) should come promptly.
  _endTrial() {
    this.running = false;
    this.av.targetSpeed = 0;
    this.setPhase('done', 'This situation is complete.');
    this.onComplete?.();
  }

  _finish() {
    this.setPhase('cooldown', 'This situation is complete.');
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
