// Scenario state machines, following the interaction arc:
// Detection -> Decision -> Action (signal) -> Acknowledgment -> Outcome
import { LAYOUT } from './scene.js?v=28';

const ZEBRA = LAYOUT.zebraZ;
const PREROLL = 9; // seconds the vehicle waits at the start (free-walk lead-in)

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

    if (scenario === 1) {
      // Baseline: same yielding interaction, but a human-driven car and no
      // eHMI of any kind — the comparison condition. (Scenario 1 = first in
      // the study order so participants see the control before any eHMI.)
      this.av.group.visible = false;
      this.humanCar.spawn();
      this.humanCar.targetSpeed = this.approachSpeed;
      this.setPhase('approach', 'An ordinary car is approaching — no crossing here. Will it let you cross? (W/↑)');
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
      this.setPhase('approach', 'AV approaching — a car waits to merge from the left. Watch the interaction.');
    } else if (scenario === 5) {
      // Mixed-traffic chaos: bus, truck, side-street cyclist, and an
      // emergency vehicle everyone has to yield to. Actors behave differently.
      this.cyclist.start();
      this._timeline = [
        { t: 0.5, fn: () => this.traffic.spawnScripted({ kind: 'bus', route: 'south', offset: 70, cruise: 6 }) },
        { t: 2.0, fn: () => this.traffic.spawnScripted({ kind: 'truck', route: 'west', offset: 75, cruise: 6 }) },
        {
          // The ambulance uses the side street so it can actually get through
          // (own clear lane, passes the yielding AV with ~3m clearance).
          t: 5.0, fn: () => {
            this.traffic.spawnScripted({ kind: 'ambulance', route: 'east', offset: 110, cruise: 13, siren: true, ignoreReservation: true, ignoreZebra: true });
            this.logger.event('emergency_vehicle_spawned');
            this.onMessage?.('🚨 Emergency vehicle approaching — all traffic pulls over!');
          },
        },
        { t: 9.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'west', offset: 60, cruise: 7 }) },
      ];
      this.setPhase('approach', 'Mixed traffic — bus, truck, cyclist… Cross when you feel safe (W/↑).');
    } else if (scenario === 6) {
      // Aggressive drivers, unhappy with the cautious AV: a tailgater honks
      // and eventually overtakes the yielding AV; oncoming traffic creeps
      // over the zebra stop line.
      this._timeline = [
        {
          t: 0.3, fn: () => {
            this.traffic.spawnScripted({ kind: 'car', route: 'northAV', offset: 76, cruise: 13, color: 0x1c1c20, honkWhenBlocked: true, overtakeAV: true, ignoreZebra: true, patience: 1.2 });
            this.logger.event('tailgater_spawned');
            this.onMessage?.('An impatient driver is tailgating the AV…');
          },
        },
        { t: 4.0, fn: () => this.traffic.spawnScripted({ kind: 'car', route: 'south', offset: 55, cruise: 9, honkWhenBlocked: true, ignoreZebra: true }) },
      ];
      this.setPhase('approach', 'Aggressive drivers — they are unhappy with the cautious AV. Cross carefully (W/↑).');
    } else if (scenario === 9) {
      // Ambiguous signal (signal-scoping challenge): several pedestrians wait
      // at the crossing. The AV's yield signal is actually addressed to the
      // NPC on the far curb — the participant must judge for themselves
      // whether the signal applies to them too.
      this.npcs?.[0]?.place(5.5, 6.5, -Math.PI / 2);   // far (east) curb — the real addressee
      this.npcs?.[1]?.place(-5.5, 9.4, Math.PI / 2);   // same curb as the player, a bit north
      this.setPhase('approach', 'Several people are waiting to cross here. Decide for yourself (W/↑).');
    } else if (scenario === 7) {
      // Sound study "Mara": audio only — the screen is blacked out by the UI,
      // the participant must read the scene entirely through the sound layer.
      this.setPhase('approach', '🔊 Audio only — listen for the vehicle. Cross with W/↑ when you feel safe.');
    } else if (scenario === 8) {
      // Sound study "Tom": competing music masks the AV cues.
      this.setPhase('approach', '🎧 You are wearing earbuds — music is playing. Cross when you feel safe (W/↑).');
    } else {
      this.setPhase('approach', 'An AV is approaching — no marked crossing here. See whether it yields for you (W/↑).');
    }
  }

  // distance from AV front to the zebra crossing along the lane
  get distToZebra() { return ZEBRA - this.av.frontZ; }
  // distance from AV front to side-street mouth (z ~ -roadWidth/2)
  get distToSideStreet() { return -LAYOUT.roadWidth / 2 - this.av.frontZ; }

  update(dt) {
    if (!this.running) return;

    // Free-walk lead-in: hold the vehicles, let the player roam, then release.
    if (this._preroll > 0) {
      this.av.targetSpeed = 0;
      this.humanCar.targetSpeed = 0;
      if (this._prerollMsg !== true) {
        this.onMessage?.('Take a moment — walk around. The vehicle will start approaching shortly.');
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

    if (this.scenario === 4) this._updateMerge(dt);
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
      case 'detection':
        if (d < 20) {
          this.av.targetSpeed = this.approachSpeed * 0.35;
          this.setPhase('decision', 'AV decelerating for the crossing…');
        }
        break;
      case 'decision':
        if (d < 8) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this._npcDelay = 1.6; // the addressee reacts shortly after the signal
          this.setPhase('action', 'AV yields — but for whom? Decide for yourself.');
        }
        break;
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
        if (!playerInRoad && ((npcDone && this._timer > 6) || this._timer > 60)) {
          this.logger.event('npc_crossing_finished');
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.setPhase('acknowledgment', 'AV thanks — and continues.');
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
        if (d < 20) {
          this.humanCar.targetSpeed = this.approachSpeed * 0.35;
          this.setPhase('decision', 'The car is slowing down…');
        }
        break;
      case 'decision':
        if (d < 8) {
          this.humanCar.targetSpeed = 0;
          this.setPhase('action', 'The car has stopped — no signal. Decide yourself.');
        }
        break;
      case 'action': {
        if (this.humanCar.speed < 0.2) this.logger.signalOnset(); // implicit cue: full stop
        const px = this.pedestrian.group.position.x;
        if (px > LAYOUT.roadWidth / 2 + 0.5) {
          this.logger.event('crossed_baseline');
          this.setPhase('acknowledgment', 'You crossed — the car waits briefly.');
        } else if (this._timer > 45 && !this.logger.current?.crossed) {
          this.logger.event('timeout_no_crossing');
          this.setPhase('acknowledgment', 'You stayed — the car continues.');
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
      case 'detection':
        if (d < 18) {
          this.av.targetSpeed = this.approachSpeed * 0.4; // begin decelerating -> friction cue
          this.setPhase('decision', 'AV slowing down…');
        }
        break;
      case 'decision':
        if (d < 9) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          this.sound.playGoAhead();
          this.logger.signalOnset();
          this.setPhase('action', 'AV yields (cyan + 👋) — the car merges.');
        }
        break;
      case 'action':
        if (this.av.speed < 0.2 && this._timer > 1.0) {
          this.mergingCar.merge();
          this.setPhase('acknowledgment', 'Car is merging in front of the AV.');
        }
        break;
      case 'acknowledgment':
        if (this.mergingCar._mergeT >= 1 && this._timer > 3.5) {
          this.av.setDisplay('thanks');
          this.av.setBandState('neutral');
          this.sound.playThanks();
          this.setPhase('outcome', 'AV shows ☺️ and resumes driving.');
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
      case 'detection':
        if (d < 20) {
          this.av.targetSpeed = this.approachSpeed * 0.35;
          this.setPhase('decision', 'AV decelerating for the crossing…');
          // Scenario 3 edge case: a cyclist appears behind the AV and
          // overtakes it — the AV does NOT address it, and the cyclist does
          // not brake for the crossing pedestrian.
          if (this.scenario === 3) {
            this.cyclist.startOvertake(this.av);
            this.logger.event('cyclist_overtaking_unaddressed');
          }
        }
        break;
      case 'decision':
        if (d < 8) {
          this.av.targetSpeed = 0;
          this.av.setBandState('yielding');
          this.av.setDisplay('yielding');
          if (this.scenario === 7) this.sound.startYieldLoop(); // audio-only: repeating cue
          else this.sound.playGoAhead();
          this.logger.signalOnset();
          this.setPhase('action', 'AV yields (cyan + 👋 + tone). Cross when ready.');
          if (this.scenario === 3 && !this.quietEdge) {
            // In the trust protocol the edge case stays unannounced
            this.onMessage?.('⚠ A cyclist is overtaking the AV from behind — it will not stop for you.');
          }
        }
        break;
      case 'action': {
        // Wait for pedestrian to fully cross (reach far sidewalk) or time out
        // (audio-only runs get a longer window — orientation by ear takes time)
        const px = this.pedestrian.group.position.x;
        const timeoutS = this.scenario === 7 ? 75 : 45;
        if (px > LAYOUT.roadWidth / 2 + 0.5) {
          this.sound.stopYieldLoop();
          this.av.setDisplay('thanks');
          this.sound.playThanks();
          this.logger.event('av_thanks');
          this.setPhase('acknowledgment', 'AV thanks you ☺️');
        } else if (this._timer > timeoutS && !this.logger.current?.crossed) {
          this.sound.stopYieldLoop();
          this.logger.event('timeout_no_crossing');
          this.setPhase('acknowledgment', 'You stayed — the AV continues.');
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

  _finish() {
    this.setPhase('cooldown', 'Scenario complete — watch how the traffic reacts…');
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
