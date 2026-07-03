# Study Plan: Prosocial eHMI Prototype

Two-stage plan agreed with the supervisor (Akib): a qualitative focus group
first, then an online quantitative study whose research questions are locked
from the focus group findings.

```
Prototype (study set: scenarios 1, 3, 4, 6, 9, debiased)
        |
        v
Stage 1: Focus group (hands-on, qualitative)
        |   findings narrow the domains, wording and RQs
        v
Lock research questions + questionnaire items
        |
        v
Stage 2: Online quantitative study (browser)
```

## Scenario set and domain mapping (researcher only, never shown to participants)

| Button | Content | Domain |
|---|---|---|
| 1 | Human car, no eHMI (baseline) | Benefit / trust calibration (compare with eHMI runs) |
| 3 | eHMI yield, unnoticed cyclist overtakes | Overtrust |
| 4 | eHMI signals "After you" to a merging car | Targeted pro-sociality (vehicle-directed) |
| 6 | eHMI yield, impatient driver behind overtakes | Negotiation |
| 9 | eHMI yield with several waiting people | Targeted pro-sociality (who is addressed?) |
| 2 (extra) | Plain eHMI yield | Demo / practice only |
| 5 (extra) | Busy street with ambulance | Excluded from the study per supervisor |

Debiasing rules baked into the prototype: number-only labels, identical
who-is-present briefings (2, 3 and 6 are word-for-word the same), one neutral
instruction during every run, no in-run narration of signals or twists, no
domain or framework-stage names anywhere participants can see.

## Stage 1: Focus group (60 to 90 min, 4 to 6 participants)

Format: hands-on. One participant plays per scenario on a laptop connected to
a large screen; everyone else watches live. A mouse for the player. The
moderator starts scenarios from the admin menu (gear button or the O key), so
no list of upcoming situations is ever visible.

1. **Warm-up stories (10 min).** Personal traffic anecdotes: a moment someone
   was kind to you in traffic, a moment that made you uncomfortable. The word
   pro-sociality is never said; participants bring the concepts themselves.
2. **Bridge (5 min).** "That was all human drivers. What if it was a car with
   nobody inside?"
3. **Hands-on rounds (35 to 45 min).** A different participant plays each
   scenario. Before the first round, the player roams the idle scene for a
   minute to learn the controls. Before each run, the watchers silently write
   down whether they think the player will cross; comparing notes afterwards
   opens the discussion. The built-in confidence check doubles as the
   discussion starter (the player answers aloud); it can be switched off in
   the admin menu if the session runs long. Replays are cheap: hand the mouse
   to a disagreeing watcher and restart.
   - Suggested order: 1 first (calibrates "no signal"), then 9, 6, 3, with 4
     if time allows.
   - One probe per scenario, domain never named:
     - After 9: "Who was the car letting cross?"
     - After 6: "Who had the right to go, and who decided?"
     - After 3: "Would you have checked the road yourself? Why?"
     - After 1 vs the rest: "What was different about deciding here?"
4. **Closing (10 min).** "If you designed the car's signals, what would you
   change?" plus the pressure probe: did the car stopping feel like a kind
   gesture or like pressure to cross?

Recruiting: mixed backgrounds, not only HCI students, nobody from related
projects. One moderator, one notetaker, audio recording with consent.

Known limitation: the player acts under social observation, so focus group
crossing behaviour is discussion material, not clean data. Clean behavioural
data comes from Stage 2.

## Stage 2: Online quantitative study (15 to 20 min per participant)

1. Consent and demographics (age, walking habits, prior AV exposure).
2. Intro and one practice run (scenario 2, excluded from analysis).
3. The five study scenarios in randomized order (full random or Latin square,
   decision pending). Per run: automatic behaviour logging plus the confidence
   check with one or two domain items, for example "Who was the signal meant
   for?" after 9 and 4.
4. Post questionnaires: a validated trust scale (Automotive UI proceedings)
   and the pro-sociality scale from the paper the supervisor shared.
5. Submit.

Technical prerequisites before Stage 2 (not yet built):

- Automatic result submission (participants will not download and send JSON
  files). Options: a small endpoint, a Netlify Function writing to a store, or
  a form service.
- Participant ID passed through the URL.
- Randomized scenario order in a participant-facing study mode (no admin menu).

## Measures per domain

| Domain | Behavioural (logged) | Subjective (asked) |
|---|---|---|
| Baseline vs eHMI (1 vs rest) | reaction time, crossed | felt safety |
| Targeted (9, 4) | crossed while the signal addressed someone else | "who was it for?" |
| Negotiation (6) | hesitations, crossing timing vs the overtake | felt safety, trust in the car vs the traffic |
| Overtrust (3) | gaze before crossing, crossed into the cyclist's path | "did you check the road yourself?" |

## Open decisions

- Randomization scheme for Stage 2 (full random vs Latin square).
- Whether scenario 4 is core or optional in both stages.
- Per-run vs end-of-session questionnaire depth for Stage 2.
