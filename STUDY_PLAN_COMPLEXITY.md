# Quantitative Study 2: Traffic Complexity, Uncertainty and Negotiation

Design and analysis plan for the second quantitative study, implemented on the
`quant-complexity` branch. Run it with `?study2=1` (see DOCUMENTATION.md).

Companion documents: `STUDY_PLAN.md` (qualitative phase), and the 2x2
eHMI-by-proximity study on the `quantitative-study` branch (`?study=1`).

---

## 0. Where this study sits

In the framework this project builds on (Sadeghian and colleagues; the
mixed-traffic social-interaction line with Khan & Sadeghian), the
pedestrian-AV encounter is a *social* interaction, and acknowledgment or
prosocial experience is the downstream, "afterwards" phase. **This study does
not measure that phase.** It targets the phase *before* resolution: the moment
of **uncertainty** about what the vehicle will do and whom it addresses, and
the **negotiation** of right of way in **mixed traffic** where several road
users hold competing or ambiguous claims.

The eHMI is held **constant** (full package in every condition); what varies
is the traffic situation. The question is not "does the eHMI make people feel
acknowledged" but "how do uncertainty and negotiation behaviour change as the
scene gets more mixed and more ambiguous, and where does the communication
break down". The design deliberately probes **failure modes** (misreading the
addressee, feeling pressured, over-trusting the signal and under-scanning).

Deliberately dropped, since they target the acknowledgment phase: the
felt-acknowledgment scale and the Godspeed social-perception subscales.
Perceived safety is retained, because it is a negotiation-relevant safety
judgement rather than a social-agent perception.

## 1. Research questions

- **RQ1 (uncertainty).** How does mixed-traffic complexity affect uncertainty
  about the AV's intent and about whom the signal addresses?
- **RQ2 (negotiation).** How does complexity affect crossing-negotiation
  behaviour: willingness, initiation timing, hesitation, deference?
- **RQ3 (failure modes).** As complexity rises, do misattribution, pressure /
  over-compliance, and over-trust / complacency intensify?
- **RQ4 (coupling).** Does subjective confidence track objective correctness,
  or do they decouple under load (confidently wrong)?

## 2. Design

Within-subjects, single primary factor, eHMI constant.

| Level | Label | Scene (as implemented) | Demand |
|---|---|---|---|
| C1 | Solo, unambiguous | Participant alone; the car approaches, signals, stops 1.5 m short of them. | Low: intent is the only unknown. |
| C2 | Mixed, parallel | 2 to 3 companions on the same kerb cross alongside the participant; no conflicting claims. | Moderate: "is the signal for me?" arises. |
| C3 | Mixed, competing | A conflicting claim, two operationalizations (one per instantiation). | High: explicit negotiation, addressee genuinely ambiguous. |

**C3 is operationalized both ways** (open item 1 answered empirically by the
pilot), one per scene instantiation:
- **C3a, addressee elsewhere:** the car stops 1.5 m short of a *far-kerb*
  pedestrian, who crosses promptly, revealing the signal was for them.
  Misattribution ground truth: `other`.
- **C3b, competing cyclist:** the car yields honestly to the participant while
  a cyclist cuts through the crossing. Ground truth: `you`; following the
  signal without scanning is unsafe. **The car never lies**, so this
  over-trust probe carries no deception (open item 3: a genuinely misleading
  eHMI stays unimplemented pending ethics sign-off).

**Trials.** 1 unscored practice + 6 scored (3 levels x 2 instantiations).
Instantiations vary the participant's kerb position (approach distance), the
number of companions, and the layout mirroring, so effects are not bound to a
single scene. Scene is available as a random effect in the models.

**Counterbalancing.** Condition order is a Latin square over the three levels,
keyed to the participant number (P01 row 1, P02 row 2, P03 row 3, then
repeating). Instantiation order within a condition is a seeded shuffle; the
seed and the resulting order are logged in `session_start`. Presentation
position is stored per trial as `conditionPos` for use as a nuisance covariate.

**Stop distance is constant (1.5 m to the addressee) in every trial**, so
distance never confounds felt address; only *whose* position it is varies.

**Optional extension, not implemented:** crossing complexity with eHMI signal
ambiguity (clear vs degraded) to manipulate uncertainty at the source, turning
this into a 3x2 (open item 4).

## 3. Measures

**Per trial (in-app form after every scored trial):**
- `intentCertainty` 1-7 — reverse-scored to intent uncertainty (RQ1)
- `decisionConfidence` 1-7 (RQ1, and the confidence half of RQ4)
- `addressee` — "Was the car communicating with you?" (you / other / unsure),
  scored automatically against the trial's ground truth into
  `addresseeCorrect` (RQ3a, and the correctness half of RQ4)

**Per trial (behavioural, logged automatically):**
- `crossed` (binary), `completedCrossing`
- `reactionTimeMs` — signal onset to first step-off (decision latency).
  Early step-offs before the signal get a negative value plus
  `crossedBeforeSignal`, so they stay analysable.
- `hesitations`, `hesitationTimeMs`, `falseStarts`
- `trace` — head yaw and position at ~10 Hz, the scanning proxy for RQ3c/H5
- `gazeAtVehiclePreCrossMs`, `scannedBeforeCrossing`

**Per condition (battery after each condition block):**
- Perceived signal ambiguity: `amb_clearWhat`, `amb_clearWho`, `amb_hardRead`
- Negotiation: `willingness`, `deference`
- Felt pressure: `press_pushed`, `press_ratherThanJudged`
- Over-trust: `trust_reliedOnSignal`, `trust_lessChecking`
- Trust in the AV (short form): `trust_dependable`, `trust_predictable`,
  `trust_confidence`
- Perceived safety (semantic differential): `ps_anxiousRelaxed`,
  `ps_agitatedCalm`, `ps_unsafeSafe`
- Attention checks `attn1` (blocks 2) and `attn2` (block 3), auto-scored

**Covariates:** age, gender, driving and cycling experience, AV familiarity,
AV attitude, prior VR/AR exposure, ATI short (4 items), device, headphone
confirmation, audio-calibration confirmation, screen size, presentation order.

## 4. Hypotheses (confirmatory, directional)

- **H1.** Intent uncertainty and perceived ambiguity increase monotonically
  C1 < C2 < C3; decision latency likewise.
- **H2.** Willingness to cross decreases and hesitation increases with
  complexity, most sharply at C3.
- **H3a.** Addressee-identification accuracy declines with complexity, lowest
  at C3.
- **H3b.** Felt pressure is higher at C3 than C1.
- **H3c.** Self-reported reliance and reduced scanning increase with
  complexity; on the C3b hazard trial a non-trivial proportion crosses without
  scanning.
- **H4.** Confidence-accuracy calibration worsens under load: the
  confident-but-wrong gap is largest at C3.
- **H5 (exploratory).** Trust declines less steeply than objective accuracy.

## 5. Sampling and power

One-way within-subjects model, three ordered levels. Monte Carlo simulation
(3,000 datasets per cell, subject random intercept rho = 0.5, linear trend
scaled to a target Cohen's f, alpha = .05):

| Test | Effect | n for 80% power |
|---|---|---|
| RM-ANOVA (omnibus) | f = 0.25 | 54 |
| Friedman (non-parametric omnibus) | f = 0.25 | 72 |
| Wilcoxon (pairwise, adjacent) | dz = 0.4 | 54 |
| Wilcoxon (pairwise, adjacent) | dz = 0.5 | 36 |
| Wilcoxon (pairwise, adjacent) | dz = 0.6 | 26 |

Small effects (f = 0.10) are undetectable at feasible online n; stated as a
limitation, not a target.

**Target n = 72 analysable, recruit about 88** (roughly 18 percent online
attrition and exclusion). Fixed-n stopping rule, no optional stopping and no
inferential peeking.

**Inclusion:** adults, fluent in the study language, headphones confirmed,
passed at least one of two attention checks, completed all three conditions.
**Exclusion:** failed the audio or headphone screen, more than one failed
attention check, completion time under 40 percent of the median, invariant
responding (SD = 0 across conditions).

## 6. Procedure (as implemented)

1. Consent (GDPR, University of Siegen ethics).
2. Screening: device, headphone confirmation, audio calibration tone.
3. Demographics and covariates (incl. ATI short, AV attitude).
4. Instructions plus one unscored practice trial.
5. Main block: 3 conditions in the Latin-square order, 2 instantiations each,
   with the per-trial form after every trial.
6. Per-condition battery after each condition's trials.
7. Post-study open questions, then debrief with the ground-truth reveal.
8. Automatic upload to the results platform, local download as fallback.

Target duration under 20 minutes.

## 7. Analysis plan

**Scale scoring.** Reverse-code where needed, subscale means. Report Cronbach
alpha and McDonald omega for every multi-item custom scale (ambiguity,
pressure, over-trust) and for trust and perceived safety; alpha below .70
means item-level analysis with a note.

**Continuous primary DVs** (uncertainty, willingness, trust, perceived
safety): one-way RM-ANOVA with Shapiro-Wilk and Mauchly checks
(Greenhouse-Geisser when violated); Friedman as the confirmatory fallback if
normality is grossly violated. **Pre-planned linear polynomial contrast**
across the ordered levels is the direct test of the monotone-load predictions
and is more powerful than the omnibus. Effect sizes always (generalized
eta-squared, Kendall W, rank-biserial r or dz) with 95 percent CIs. Pairwise
C1-C2, C2-C3, C1-C3 Holm-corrected, emphasis on **C2-C3**.

**Binary primary DVs** (cross/wait, addressee correctness): GLMM with logit
link, complexity fixed, random intercepts for participant and scene.
Robustness: Cochran's Q plus Holm-corrected McNemar.

**Behavioural DVs:** linear mixed model on log latency (or Friedman on
per-condition medians); counts via Poisson or negative-binomial GLMM.

**H4 (calibration):** confidence-by-correctness interaction in the GLMM, or
per-condition calibration curves and Brier scores.

**H3c:** descriptive proportion crossing without scanning on the C3b hazard
trial, by condition; exploratory test of whether it rises with complexity.

**Multiple comparisons:** family-wise Holm within each hypothesis family,
families kept separate, exploratory analyses flagged and uncorrected. The
parametric versus non-parametric decision rule is fixed in advance.

## 8. Limitations

- Online delivery lowers immersion versus lab VR; spatial-audio fidelity
  depends on participant headphones (screened, not controlled).
- Behavioural negotiation measures are as rich as the prototype's logging;
  here the study *is* interactive, so initiation time, hesitation and scanning
  are real behaviour rather than stated willingness (open item 2 resolved in
  favour of interactive).
- Not powered for small effects (f = 0.10); a null on a secondary DV is not
  evidence of absence.
- Six scene instantiations sample a limited slice of the mixed-traffic space
  (scene modelled as a random effect to partly address this).
- Self-selected online sample; AV attitudes may skew.

## 9. Open items

| # | Item | Status |
|---|---|---|
| 1 | C3 operationalization | **Resolved in build:** both variants implemented, one per instantiation; the pilot decides whether to keep both or split into a 4-level design. |
| 2 | Interactive vs pre-rendered | **Resolved:** interactive. The prototype logs initiation time, hesitation, false starts and a 10 Hz yaw trace. |
| 3 | Catch trial (misleading signal) | **Partly resolved:** the C3b hazard gives an over-trust probe with no deception. A genuinely misleading eHMI remains unimplemented pending ethics. |
| 4 | Signal-ambiguity second factor | Open. Not implemented; would roughly double trials. |
| 5 | Custom scale wording | Draft items are implemented (see section 3) and need a review pass before pre-registration. |
| 6 | Framework alignment | Open: confirm the exact phase terminology from the Sadeghian/Khan framework for the write-up. |
| 7 | Siegen ethics and GDPR | Open: confirm constraints on latency/scanning capture and retention. Consent text in `index.html` is a placeholder pending the final wording. |
