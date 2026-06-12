import csv
import json

import simulate_scheduler as sim


def test_interval_sweep_is_deterministic():
    first = sim.run_interval_sweep()
    second = sim.run_interval_sweep()

    assert first == second


def test_type_all_interval_ratio_is_reference():
    rows = [
        row
        for row in sim.run_interval_sweep()
        if row["mode"] == "type_all"
    ]

    assert rows
    assert {row["interval_ratio"] for row in rows} == {1.0}
    assert {row["interval_delta"] for row in rows} == {0}


def test_easier_mode_shortens_rewards_and_hardens_misses():
    rows = sim.run_interval_sweep()
    qcm_easy_rows = [
        row
        for row in rows
        if row["mode"] == "qcm" and row["quality"] == 3
    ]
    qcm_miss_rows = [
        row
        for row in rows
        if row["mode"] == "qcm" and row["quality"] == 0
    ]

    assert any(row["interval_delta"] < 0 for row in qcm_easy_rows)
    assert all(row["interval_delta"] <= 0 for row in qcm_easy_rows)
    assert any(
        row["stability_delta_vs_reference"] < 0
        for row in qcm_miss_rows
    )
    assert any(
        row["difficulty_delta_vs_reference"] > 0
        for row in qcm_miss_rows
    )


def test_harder_type_prompt_extends_rewards_and_softens_misses():
    rows = sim.run_interval_sweep()
    hit_rows = [
        row
        for row in rows
        if row["mode"] == "type_prompt" and row["quality"] == 3
    ]
    miss_rows = [
        row
        for row in rows
        if row["mode"] == "type_prompt" and row["quality"] == 0
    ]

    assert any(row["interval_delta"] > 0 for row in hit_rows)
    assert all(row["interval_delta"] >= 0 for row in hit_rows)
    assert any(
        row["stability_delta_vs_reference"] > 0
        for row in miss_rows
    )
    assert any(
        row["difficulty_delta_vs_reference"] < 0
        for row in miss_rows
    )


def test_synthetic_deck_is_deterministic_for_seed():
    config = sim.SimulationConfig(cards=40, days=45, seed=12)
    first = sim.run_simulation(config)
    second = sim.run_simulation(config)

    assert first["daily_load"] == second["daily_load"]
    assert first["summary"]["mode_summary"] == second["summary"]["mode_summary"]
    assert first["outliers"] == second["outliers"]


def test_balanced_easy_modes_do_not_drift_later_than_type_all():
    config = sim.SimulationConfig(cards=300, days=180, seed=1)
    summary = sim.run_simulation(config)["summary"]
    by_mode = {
        row["mode"]: row
        for row in summary["mode_summary"]
    }

    assert by_mode["qcm"]["avg_interval"] < by_mode["type_all"]["avg_interval"]
    assert (
        by_mode["click_prompt"]["avg_interval"] <
        by_mode["type_all"]["avg_interval"]
    )


def test_cli_writes_report_artifacts(tmp_path):
    result = sim.main([
        "--cards",
        "30",
        "--days",
        "40",
        "--seed",
        "3",
        "--out-dir",
        str(tmp_path)
    ])

    assert result == 0

    expected_files = {
        "report.html",
        "summary.json",
        "interval_sweep.csv",
        "daily_load.csv",
        "outliers.csv"
    }
    assert expected_files == {path.name for path in tmp_path.iterdir()}

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["config"]["cards"] == 30
    assert summary["config"]["days"] == 40
    assert summary["total_reviews"] > 0

    with (tmp_path / "interval_sweep.csv").open(newline="") as handle:
        rows = list(csv.DictReader(handle))

    assert rows
    assert {
        "mode",
        "quality",
        "interval_ratio"
    }.issubset(rows[0])
