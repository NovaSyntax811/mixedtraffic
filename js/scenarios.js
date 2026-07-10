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

// Continuous-walk pacing. Distances here govern how much ground the player
// covers *before* an encounter starts building — i.e. how much real time
// they get to notice the car and watch it approach/brake before reaching the
// crossing themselves. That time budget should stay the same regardless of
// how fast the player walks, so these are scaled by the same factor as the
// pedestrian walk-speed increase (1.5 -> 3.0 m/s, see Pedestrian.speed in
// actors.js) rather than left as the old, now too-tight, absolute values.
const WALK_SPEED_SCALE = 2;
const WALK_TRIGGER_LEAD = 22 * WALK_SPEED_SCALE;  // player-to-station distance that starts an encounter
const WALK_STATION_GAP = 28 * WALK_SPEED_SCALE;   // distance between consecutive stations
const WALK_FIRST_HEADROOM = 4 * WALK_SPEED_SCALE; // free, car-free walking before the very first encounter
// The AV should still visibly "come up from behind" the player when an
// encounter starts. This gap is about the vehicle's own approach, not the
// player's pace, so it stays fixed rather than scaling with WALK_SPEED_SCALE.
const WALK_AV_BEHIND_GAP = 10;
const WALK_AV_SPAWN_LEAD = WALK_TRIGGER_LEAD + WALK_AV_BEHIND_GAP;

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
    this.setPhase('idle', 'Press Start, then decide when to cross.');
  }

  start(scenario) {
    this.reset();
    this.scenario = scenario;
    this.running = true;
    this.logger.startRun(scenario);
    // Free-walk lead-in: the vehicle holds for a few seconds so the player can
    // walk around and get oriented before it starts approaching.
    this._preroll = PREROLL;

    if (scenario === 'walk') {
      // Continuous walk: a single journey north past several encounters, each
      // probing one of the research themes (uncertainty, who the signal is for,
      // negotiation, and scaling to several road users). The point of a *walk*
      // is to give the player an actual street to read, not four isolated
      // set-pieces in an empty corridor — so ambient oncoming traffic runs
      // continuously between stations (see _updateWalkAmbientTraffic). The
      // built-in auto-spawner is disabled because its routes are anchored to
      // the original intersection and would never reach the far stations.
      this._preroll = 0;
      this.traffic?.setEnabled(false);
      this.traffic?.clearScripted();
      this._walkAmbientTimer = 3; // first ambient car arrives a few seconds in
      this.av.group.visible = false;
      this.pedestrian.group.position.set(-(LAYOUT.roadWidth / 2 + LAYOUT.sidewalk / 2), 0, 0);
      // Station z's build on WALK_TRIGGER_LEAD/WALK_STATION_GAP so the spacing
      // stays derived from the pacing constants above, not re-guessed here.
      // maxWait budgets = the same decision time as before + how long it now
      // actually takes to walk the (unchanged) 8m road at the new speed.
      const s1 = WALK_TRIGGER_LEAD + WALK_FIRST_HEADROOM;
      this._walkStations = [
        { kind: 'uncertainty', z: s1, maxWait: 6,
          intro: 'A car is coming up the street. You are just walking here.',
          outro: 'It stopped for you anyway. Did you actually want to cross, or did it misread you?' },
        { kind: 'targeted', z: s1 + WALK_STATION_GAP, maxWait: 10,
          intro: 'Someone is waiting on the far pavement as a car approaches.',
          outro: 'The car gave way. Was that signal for you, or for the person opposite?' },
        { kind: 'negotiation', z: s1 + WALK_STATION_GAP * 2, maxWait: 10,
          intro: 'A car approaches, with an impatient one close behind it.',
          outro: 'The first car gave way, but the driver behind would not wait.' },
        { kind: 'scalability', z: s1 + WALK_STATION_GAP * 3, maxWait: 11,
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

    if (scenario === 1) {
      // Baseline: same yielding interaction, but a human-driven car and no
      // eHMI of any kind — the comparison condition. (Scenario 1 = first in
      // the study order so participants see the control before any eHMI.)
      this.av.group.visible = false;
      this.humanCar.spawn();
      this.humanCar.targetSpeed = this.approachSpeed;
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
            this.traffic.spawnScripted({ kind: 'car', route: 'northAV', offset: 76, cruise: 13, color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true, patience: 2.4 });
            this.logger.event('tailgater_spawned');
            this.onMessage?.('An impatient driver is tailgating the AV…');
          },
        },
        { t: 4.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'south', offset: 55, cruise: 9, honkWhenBlocked: true, ignoreZebra: true }) },
      ];
      this.setPhase('approach', 'Aggressive drivers who are unhappy with the cautious AV. Cross carefully (W/↑).');
    } else if (scenario === 9) {
      // Broadcast signal (signal-scoping challenge): several pedestrians wait
      // at the crossing, on both curbs. The AV gives a single yield signal,
      // and everyone waiting — the far-curb NPC, the near-curb NPC, and the
      // participant — is free to act on it, each reacting after their own
      // human-like beat rather than all stepping off in lockstep. The open
      // question is not "who is this really for" but whether one broadcast
      // signal can genuinely serve several people, including you, at once.
      this.npcs?.[0]?.place(5.5, ZEBRA, -Math.PI / 2);     // far (east) curb
      this.npcs?.[1]?.place(-5.5, ZEBRA + 3, Math.PI / 2); // same curb as the player, a bit north
      this.setPhase('approach', 'Several people are waiting to cross here, on both curbs. Decide for yourself (W/↑).');
    } else if (scenario === 'pedestrian_baseline') {
      // Clean reference condition for the "several people, one signal" theme
      // — the counterpart to scenario 9's ambiguous/dangerous version, with
      // none of the scoping tricks. One person waits on each curb, the AV
      // yields once, and both are free to cross; the AV waits for both to
      // actually clear before it thanks them and moves on.
      this.npcs?.[0]?.place(5.5, ZEBRA, -Math.PI / 2); // far (east) curb, mirrors the player
      this.setPhase('approach', 'Someone is also waiting on the far curb. See whether the AV lets you both cross (W/↑).');
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
    // Scenarios with a scripted NPC crossing line deliberately use a fixed
    // stop line instead (see _updateAmbiguous / _updatePedestrianBaseline):
    // a dynamic stop could park the AV closer to the NPC than intended.
    if (this.scenario === 1 || this.scenario === 4 || this.scenario === 9
      || this.scenario === 'pedestrian_baseline' || this.scenario === 'walk') return;
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

    if (this.scenario === 'walk') this._updateWalk(dt);
    else if (this.scenario === 4) this._updateMerge(dt);
    else if (this.scenario === 1) this._updateBaseline(dt);
    else if (this.scenario === 9) this._updateAmbiguous(dt);
    else if (this.scenario === 'pedestrian_baseline') this._updatePedestrianBaseline(dt);
    else this._updateCrossing(dt);
  }

  // ---------- Scenario 9: Broadcast signal — and the danger of assuming it's for you ----------
  // Everything below fires on fixed, elapsed-time cues rather than reacting
  // to another actor's live position or state. Earlier versions of this
  // scenario had the AV wait for an NPC's crossing to finish while that same
  // NPC waited for the AV to get out of its way — a circular dependency that
  // could freeze both. Fixed timers, generous enough to comfortably cover the
  // relevant walk, remove that dependency entirely: nothing here ever asks
  // "is the other one done yet." A fixed stop line (not the usual
  // pedestrian-tracking dynamic stop) keeps the AV's resting position a safe,
  // known distance from both NPCs' crossing lines, for the same reason.
  //
  // Sequence: the AV yields for one real, tracked addressee — the NPC on the
  // far curb, on the marked zebra — and moves off once they, and the
  // participant if they crossed, are clear. It was never watching for anyone
  // else. A second NPC, on the participant's own curb, reads the same
  // wave/tone as meant for them too and steps out late, after the AV is
  // already rolling again, at an unmarked point north of the zebra. The AV
  // brakes hard for them before continuing.
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
        // Fixed stop line only (see class comment) — always a safe, known
        // distance from both NPCs' crossing lines.
        const stopZ = Math.max(JUNCTION_CLEAR, ZEBRA - STOP_BEFORE);
        const gap = this._brakeToStopLine(this.av, stopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this._npc0Started = false;
          this.setPhase('action', 'AV yields. Cross when ready — but who is this signal actually for?');
        }
        break;
      }
      case 'action': {
        // The real, tracked addressee starts crossing on a fixed cue.
        if (!this._npc0Started && this._timer > 1.4) {
          this._npc0Started = true;
          this.npcs[0].startCross(-5.6); // far curb -> near curb, on the marked zebra
          this.logger.event('npc_crossing_started', { npc: 0, addressed: true });
        }
        const playerInRoad = Math.abs(this.pedestrian.group.position.x) < LAYOUT.roadWidth / 2 + 0.4;
        // Fixed wait, comfortably longer than the addressee's crossing takes
        // (1.4s delay + ~4s to walk it) — no dependency on their live state.
        // The AV moves on once that person and the participant (if crossed)
        // are clear, without waiting to see whether anyone else also goes.
        if (!playerInRoad && this._timer > 6.5) {
          this.logger.event('npc_crossing_finished');
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.setPhase('acknowledgment', 'AV thanks you and prepares to move off.');
        }
        break;
      }
      case 'acknowledgment':
        if (this._timer > 2.0) {
          this.av.setDisplay('off');
          this.av.setBandState('neutral');
          this.av.targetSpeed = this.approachSpeed;
          this._npc1Started = false;
          this._emergencyBraked = false;
          this._resumed = false;
          this.setPhase('outcome', 'AV moves off.');
        }
        break;
      case 'outcome': {
        // The other NPC watched the first exchange, assumes the same signal
        // covers them too, and steps out once the AV is visibly rolling —
        // a fixed cue, not a check on how fast the AV actually is.
        if (!this._npc1Started && this._timer > 1.0) {
          this._npc1Started = true;
          this.npcs[1].startCross(5.6); // near curb -> far curb, off the marked zebra
          this.logger.event('npc_wrong_addressee_stepped_out');
          this.onMessage?.('The other person assumes the same signal was meant for them too, and steps out as the AV moves off.');
        }
        // Fixed brake trigger: the AV was never tracking this pedestrian —
        // it reacts late, at a set point after they step out, not by
        // continuously checking where they currently are.
        if (!this._emergencyBraked && this._timer > 1.6) {
          this._emergencyBraked = true;
          this.av.targetSpeed = 0;
          this.sound.playHorn();
          this.logger.event('av_emergency_brake', { reason: 'wrong_addressee_in_path' });
          this.onMessage?.('⚠ The AV slams the brakes — it was only ever tracking the person who crossed first, not this one. Assuming a broadcast signal is meant for you can be dangerous.');
        }
        // Fixed resume: comfortably longer than the second pedestrian needs
        // to clear (steps out at t=1.0, ~4s to walk it) — again, no
        // dependency on their live position or state.
        if (!this._resumed && this._timer > 5.5) {
          this._resumed = true;
          this.av.targetSpeed = this.approachSpeed;
          this.onMessage?.('Clear now — the AV moves off again.');
        }
        if (this.av.group.position.z > 55) this._finish();
        break;
      }
    }
  }

  // ---------- Pedestrian baseline: two people, one clean yield ----------
  // The reference condition for the "several people, one signal" theme —
  // counterpart to scenario 9, with none of its scoping ambiguity or
  // near-miss danger. One person waits on each curb; the AV yields once,
  // addressed to both, and simply waits until both have actually cleared
  // the road before it thanks them and drives on. Fixed stop line (not the
  // pedestrian-tracking dynamic stop) keeps the AV a safe, known distance
  // from the NPC's crossing line, same reasoning as scenario 9.
  _updatePedestrianBaseline(dt) {
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
        const stopZ = Math.max(JUNCTION_CLEAR, ZEBRA - STOP_BEFORE);
        const gap = this._brakeToStopLine(this.av, stopZ);
        if (this.av.speed < 0.3 && gap < 1.0) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this._npcStarted = false;
          this._npcDelay = 1.4; // a natural beat before the NPC steps out too
          this.setPhase('action', 'AV yields for both of you (cyan + 👋 + tone). Cross when ready.');
        }
        break;
      }
      case 'action': {
        if (!this._npcStarted) {
          this._npcDelay -= dt;
          if (this._npcDelay <= 0) {
            this._npcStarted = true;
            this.npcs[0].startCross(-5.6); // far curb -> near curb, on the marked zebra
            this.logger.event('npc_crossing_started');
          }
        }
        const npcDone = this._npcStarted && this.npcs[0].state !== 'crossing';
        const playerInRoad = Math.abs(this.pedestrian.group.position.x) < LAYOUT.roadWidth / 2 + 0.4;
        if (!playerInRoad && ((npcDone && this._timer > 6) || this._timer > 35)) {
          this.logger.event('npc_crossing_finished');
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.setPhase('acknowledgment', 'AV thanks you both ☺️');
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
        if (px > LAYOUT.roadWidth / 2 + 0.5) {
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
    const p = this.pedestrian.group.position;

    if (this._walkPhase === 'walking') {
      this.av.group.visible = false; // no station AV between encounters
      this._updateWalkAmbientTraffic(dt); // but the street is never empty
      const st = this._walkStations[this._walkIndex];
      if (!st) {
        if (!this._walkDone) {
          this._walkDone = true;
          this.traffic?.clearScripted();
          this.logger.event('walk_complete');
          this.onMessage?.('You have reached the end of the walk. Thanks for coming along.');
          this._finish();
        }
        return;
      }
      this.onPhase?.('walking');
      if (p.z > st.z - WALK_TRIGGER_LEAD) { this._startStation(st); return; }
      return;
    }

    this._updateStation(dt, this._walkStations[this._walkIndex]);
  }

  // Ambient oncoming traffic for the free walk: without this, the corridor
  // between the four scripted stations is completely empty, which defeats
  // the point of a walk meant to let the player read a live street. Cars
  // spawn in the opposite lane a little ahead of wherever the player
  // currently is, and get swept away once they fall behind — the built-in
  // TrafficManager auto-spawner can't do this itself, since its routes are
  // anchored to the original intersection (z≈0), far short of the later
  // stations (up to z=220).
  _updateWalkAmbientTraffic(dt) {
    if (!this.traffic) return;
    const playerZ = this.pedestrian.group.position.z;

    this._walkAmbientTimer -= dt;
    if (this._walkAmbientTimer <= 0) {
      this._walkAmbientTimer = 5 + this.traffic._rand() * 4;
      const car = this.traffic.spawnScripted({
        kind: 'car', route: 'south', offset: playerZ + 70 + this.traffic._rand() * 20,
        cruise: 7 + this.traffic._rand() * 3,
        ignoreZebra: true, // the fixed zebra-stop rule is tied to one z; irrelevant this far up the corridor
      });
      if (car) car.walkAmbient = true;
    }

    // Sweep cars that have fallen well behind the player, instead of relying
    // on the route's built-in despawn line (z < -85), which is miles behind
    // the player for most of this corridor and would leave them lingering.
    for (let i = this.traffic.cars.length - 1; i >= 0; i--) {
      const c = this.traffic.cars[i];
      if (c.walkAmbient && c.mesh.position.z < playerZ - 40) {
        this.traffic.scene.remove(c.mesh);
        this.traffic.cars.splice(i, 1);
      }
    }
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
    this.av.group.position.set(-1.9, 0, st.z - WALK_AV_SPAWN_LEAD);
    this.av.group.rotation.y = 0;
    this.av.speed = this.approachSpeed * 0.6;
    this.av.targetSpeed = this.approachSpeed;
    this.av.setBandState('neutral', true);
    this.av.setDisplay('off');
    this.logger.event('walk_station_start', { kind: st.kind, z: st.z });
    this.onPhase?.(st.kind);
    this.onMessage?.(st.intro);
  }

  // Where the car should aim to stop: wherever the player currently is, not a
  // fixed painted line — the whole point is that the AV reacts to the person,
  // not to a predetermined "station" point they may not have reached yet.
  // Clamped so it never rests absurdly early (player still far off when
  // braking starts) or past the nominal crossing.
  _walkStopZ(st) {
    const playerZ = this.pedestrian.group.position.z;
    const target = playerZ - 1.5; // ~1m clearance once braking settles
    return Math.min(Math.max(target, st.z - 20), st.z + 6);
  }

  _updateStation(dt, st) {
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
        // Keep re-aiming at the player's live position while braking. If they
        // just keep walking through the whole time, stop re-aiming after a
        // few seconds and commit to the nominal line instead — otherwise the
        // AV would trail a continuously-moving target and never actually stop.
        this._stationStopZ = this._timer < 6 ? this._walkStopZ(st) : st.z - STOP_BEFORE;
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
