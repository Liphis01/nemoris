#!/usr/bin/env python3
"""Align the "Formes des pays du monde" group with "Drapeaux du monde".

The flags group ("Drapeaux du monde") holds the reference French labels and the
hand-curated aliases (short names like "Birmanie", "USA", "Tchéquie"...). The
shapes group ("Formes des pays du monde") was auto-seeded from mledoze/countries
with different French labels in ~50 cases and English/official/ISO aliases.

This script matches each shape question to its flag counterpart (by exact label,
then through a manual table for the spelling differences) and, for every match:

  * sets the shape LABEL to the flag label, EXCEPT it keeps the shape's own label
    when the two are the same name differing only by accent/case/hyphen, or when
    the flag label is a known typo (see KEEP_SHAPE_LABEL);
  * sets the shape ALIASES to the union of the flag aliases, the flag label, the
    old shape label and the existing auto aliases (deduped by normalized form,
    excluding the final label) -- so nothing answerable is ever lost.

Run from the backend/ directory:

    python sync_shape_aliases.py            # dry run: print every change
    python sync_shape_aliases.py --apply    # write the changes to questions.db
"""

import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

DB_PATH = Path(__file__).with_name("questions.db")
FLAGS_GROUP = "Drapeaux du monde"
SHAPES_GROUP = "Formes des pays du monde"

# shape label -> flag label, for the countries whose French names differ.
SHAPE_TO_FLAG = {
    "Ahvenanmaa": "Îles Åland",
    "Bahreïn": "Bahrein",
    "Belize": "Bélize",
    "Birmanie": "Myanmar",
    "Brunei": "Bruneï",
    "Cité du Vatican": "Vatican",
    "Congo": "République du Congo",
    "Congo (Rép. dém.)": "République Démocratique du Congo",
    "Guinée équatoriale": "Guinée Équatoriale",
    "Guyane": "Guyane Française",
    "Géorgie du Sud-et-les Îles Sandwich du Sud": "Géorgie du sud-et-les îles Sandwich du sud",
    "Kazakhstan": "Kazhakstan",
    "Micronésie": "États fédérés de Micronésie",
    "Monténégro": "Montenegro",
    "Palaos (Palau)": "Palaos",
    "Papouasie-Nouvelle-Guinée": "Papouasie Nouvelle Guinée",
    "Pays-Bas caribéens": "Bonaire, Saint-Eustache et Saba",
    "Polynésie française": "Polynésie Française",
    "République centrafricaine": "République Centrafricaine",
    "République dominicaine": "République Dominicaine",
    "Saint-Marin": "Saint Marin",
    "Salvador": "El Salvador",
    "Samoa américaines": "Samoa Américaines",
    "Surinam": "Suriname",
    "Svalbard et Jan Mayen": "Svalbard et île Jan Mayen",
    "São Tomé et Príncipe": "Sao Tomé-et-Principe",
    "Taïwan": "Taïwan, Province de Chine",
    "Tchéquie": "République tchèque",
    "Timor oriental": "Timor-Leste",
    "Viêt Nam": "Vietnam",
    "Wallis-et-Futuna": "Wallis et Futuna",
    "Yémen": "Yemen",
    "Émirats arabes unis": "Emirats Arabes Unis",
    "Équateur": "Equateur",
    "Érythrée": "Erythrée",
    "États-Unis": "États-Unis d'Amérique",
    "Éthiopie": "Ethiopie",
    "Île Christmas": "île Christmas",
    "Île Maurice": "Maurice",
    "Îles Cocos": "Cocos/Keeling (Îles)",
    "Îles Féroé": "îles Féroé",
    "Îles Malouines": "Falkland/Malouines (Îles)",
    "Îles Pitcairn": "Pitcairn",
    "Îles Turques-et-Caïques": "Îles Turks et Caïques",
    "Îles Vierges britanniques": "Îles vierges britanniques",
    "Îles Vierges des États-Unis": "Îles vierges des Etats-Unis",
    "Îles du Cap-Vert": "Cap Vert",
    "Îles mineures éloignées des États-Unis": "Îles mineures éloignées des Etats-Unis",
}

# Shape labels we keep as the primary label even though they differ from the flag
# label by more than accents/case (i.e. the flag label is a plain typo).
KEEP_SHAPE_LABEL = {"Kazakhstan"}

# Two shape questions share the label "Saint-Martin" (French and Dutch parts of
# the island), so they cannot be matched by label alone -- key them on the SVG
# code (the media filename) instead.
MEDIA_TO_FLAG = {
    "maf": "Saint-Martin (partie française)",
    "sxm": "Saint-Martin (partie néerlandaise)",
}


def normalize(value):
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[-\s]+", " ", text.strip())


def union_aliases(final_label, candidates):
    seen = {normalize(final_label)}
    out = []
    for cand in candidates:
        if not cand:
            continue
        norm = normalize(cand)
        if norm and norm not in seen:
            seen.add(norm)
            out.append(cand)
    return out


def group_id(cur, name):
    row = cur.execute(
        "SELECT id FROM question_groups WHERE name = ?", (name,)
    ).fetchone()
    if not row:
        raise SystemExit(f"Group not found: {name!r}")
    return row[0]


def load_aliases(data):
    if not data:
        return []
    return (json.loads(data) or {}).get("aliases", []) or []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes (default is a dry run).",
    )
    args = parser.parse_args()

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    flags_gid = group_id(cur, FLAGS_GROUP)
    shapes_gid = group_id(cur, SHAPES_GROUP)

    flags = {
        answer: load_aliases(data)
        for answer, data in cur.execute(
            "SELECT answer, data FROM questions WHERE group_id = ?", (flags_gid,)
        )
    }

    shapes = list(
        cur.execute(
            "SELECT id, question, answer, media, data FROM questions WHERE group_id = ? "
            "ORDER BY answer",
            (shapes_gid,),
        )
    )

    label_changes = []
    alias_changes = []
    unmatched = []
    updates = []

    for qid, question, answer, media, data in shapes:
        code = Path(media or "").stem.lower()
        flag_label = MEDIA_TO_FLAG.get(code)
        if flag_label is None:
            flag_label = answer if answer in flags else SHAPE_TO_FLAG.get(answer)

        if flag_label is None or flag_label not in flags:
            unmatched.append(answer)
            continue

        if answer in KEEP_SHAPE_LABEL or normalize(answer) == normalize(flag_label):
            final_label = answer
        else:
            final_label = flag_label

        flag_aliases = flags[flag_label]
        old_aliases = load_aliases(data)
        new_aliases = union_aliases(
            final_label,
            [*flag_aliases, flag_label, answer, *old_aliases],
        )

        if final_label != answer:
            label_changes.append((answer, final_label))
        if new_aliases != old_aliases:
            alias_changes.append((final_label, old_aliases, new_aliases))

        if final_label != answer or new_aliases != old_aliases:
            new_question = f"{SHAPES_GROUP} - {final_label}"
            new_data = json.dumps({"aliases": new_aliases}, ensure_ascii=False)
            updates.append((final_label, new_question, new_data, qid))

    print(f"Shapes: {len(shapes)} | matched: {len(shapes) - len(unmatched)} | "
          f"unmatched: {len(unmatched)}")
    print()

    print(f"=== LABEL CHANGES ({len(label_changes)}) ===")
    for old, new in label_changes:
        print(f"  {old!r}  ->  {new!r}")
    print()

    print(f"=== ALIAS CHANGES ({len(alias_changes)}) ===")
    for label, old, new in alias_changes:
        added = [a for a in new if a not in old]
        print(f"  {label!r}: +{added}")
    print()

    if unmatched:
        print(f"=== UNMATCHED (left untouched: {len(unmatched)}) ===")
        for name in unmatched:
            print(f"  {name!r}")
        print()

    if not args.apply:
        print("Dry run. Re-run with --apply to write these changes.")
        con.close()
        return

    for final_label, new_question, new_data, qid in updates:
        cur.execute(
            "UPDATE questions SET answer = ?, question = ?, data = ? WHERE id = ?",
            (final_label, new_question, new_data, qid),
        )
    con.commit()
    con.close()
    print(f"Applied {len(updates)} question updates.")


if __name__ == "__main__":
    main()
