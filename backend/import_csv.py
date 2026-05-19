import csv
from app.database import SessionLocal
from app.models import Question


def parse_tags(value):
    return [
        tag.strip()
        for tag in (value or "").replace("|", ",").split(",")
        if tag.strip()
    ]


db = SessionLocal()

with open("questions.csv", newline='', encoding="utf-8") as csvfile:
    reader = csv.DictReader(csvfile)

    for row in reader:
        q = Question(
            question=row["question"],
            answer=row["answer"],
            type_q=row["type_q"],
            media=row["media"] if row["media"] else None,
            tags=parse_tags(row["tags"]),
            data={}
        )
        db.add(q)

db.commit()
db.close()

print("Import terminé")
