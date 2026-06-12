# Scheduler Analysis Tools

The backend has two developer-only tools for checking and tuning FSRS mode
behavior:

- `simulate_scheduler.py`: synthetic what-if simulations, no real database.
- `tune_scheduler.py`: real-history calibration, can update active scheduler
  tuning settings.

Run both from `backend/` with the backend virtualenv.

```bash
cd backend
venv/bin/python simulate_scheduler.py --cards 1000 --days 365 --seed 1
venv/bin/python tune_scheduler.py --dry-run
```

## Synthetic Scheduler Simulator

Use the simulator to test whether the scheduling rules look sane before trusting
them on real data. It generates fake cards and fake answers, then writes a
static report.

```bash
cd backend
venv/bin/python simulate_scheduler.py --cards 1000 --days 365 --seed 1
```

Useful options:

```bash
venv/bin/python simulate_scheduler.py \
  --cards 2000 \
  --days 730 \
  --seed 42 \
  --preset balanced \
  --mode-mix type_all=0.25,type_prompt=0.25,click_prompt=0.25,qcm=0.25 \
  --click-sizes 2,4,8,16,32,64
```

Outputs are written to `backend/simulation_reports/`:

- `report.html`: visual summary.
- `summary.json`: top-level metrics by mode.
- `interval_sweep.csv`: deterministic mode/quality/starting-state comparison.
- `daily_load.csv`: simulated review count per day.
- `outliers.csv`: shortest/longest intervals, largest mode deltas, overloaded
  days, and low-retrievability reviews.

What to check:

- `type_all` interval ratio should stay exactly `1.0`.
- Easier modes like QCM/click should usually schedule correct answers earlier
  than `type_all`.
- Harder modes like `type_prompt` should reward correct answers more and punish
  misses less.
- Daily load should not have suspicious spikes unless the simulated deck is
  intentionally overloaded.
- Low retrievability outliers should not cluster mostly in one adjusted mode.

The simulator is not proof that values are correct. Its answer probabilities
are synthetic guesses. Use it to catch obvious scheduler shape problems, then
use the tuning CLI on real history.

## FSRS Mode Tuning CLI

Use the tuner to calibrate mode values from real review history. It replays
stored `Progress.history`, uses future `type_all` reviews as ground truth, and
scores candidate settings with Brier error.

Dry-run first:

```bash
cd backend
venv/bin/python tune_scheduler.py --dry-run
```

Apply conservative accepted changes:

```bash
cd backend
venv/bin/python tune_scheduler.py --apply
```

`--apply` only writes settings if all safety gates pass:

- enough future-`type_all` validation pairs exist;
- enough examples exist for the changed mode;
- validation score improves by at least `1%`;
- only one small parameter step is applied per run.

Useful options:

```bash
venv/bin/python tune_scheduler.py \
  --dry-run \
  --min-total-pairs 100 \
  --min-mode-pairs 25 \
  --out-dir tuning_reports
```

Outputs are written to `backend/tuning_reports/`:

- `report.html`: visual summary.
- `summary.json`: current params, candidate params, sample counts, score
  improvement, and applied/not-applied reason.
- `calibration_by_mode.csv`: predicted retrievability vs observed future
  `type_all` success by mode and bucket.
- `candidate_scores.csv`: score for each one-step candidate.

Active settings are stored in `app_settings` under key `scheduler_tuning`.
There is no database migration. Existing scheduled dates are not rewritten;
new values only affect future answers and projected intervals.

## Reading Tuning Results

Start with `summary.json`:

- `accepted`: whether the candidate passed the statistical gates.
- `applied`: whether settings were actually written.
- `reason`: why the run did or did not apply settings.
- `current_params`: active values before the run.
- `candidate_params`: proposed values.
- `expected_direction`: increase/decrease/unchanged per parameter.
- `total_pairs`: number of validation pairs found.
- `validation_sample_counts`: validation pairs by source mode.
- `current_validation_brier` and `candidate_validation_brier`: lower is better.

Then inspect `calibration_by_mode.csv`:

- If predicted retrievability is higher than observed success, that mode is
  probably being over-rewarded.
- If predicted retrievability is lower than observed success, that mode is
  probably being under-rewarded.
- Ignore modes with small sample counts; the CLI also refuses to apply changes
  when counts are too low.

## Opening Reports From WSL

From WSL, open the generated HTML report in Windows:

```bash
explorer.exe "$(wslpath -w "$PWD/simulation_reports/report.html")"
explorer.exe "$(wslpath -w "$PWD/tuning_reports/report.html")"
```

If you are in the project root instead of `backend/`:

```bash
explorer.exe "$(wslpath -w "backend/simulation_reports/report.html")"
explorer.exe "$(wslpath -w "backend/tuning_reports/report.html")"
```

## Recommended Workflow

1. Run the simulator after scheduler code changes:

   ```bash
   cd backend
   venv/bin/python simulate_scheduler.py --cards 1000 --days 365 --seed 1
   ```

2. Inspect `simulation_reports/report.html` for obvious behavior problems.

3. Run real-history tuning in dry-run mode:

   ```bash
   venv/bin/python tune_scheduler.py --dry-run
   ```

4. If the report has enough samples and the proposed direction makes sense,
   apply:

   ```bash
   venv/bin/python tune_scheduler.py --apply
   ```

5. Re-run a normal review session. The tuned values affect future scheduling,
   but existing `next_review` dates stay as they were.
