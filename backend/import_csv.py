import csv
from app.database import SessionLocal
from app.models import Question

db = SessionLocal()

with open("questions.csv", newline='', encoding="utf-8") as csvfile:
    reader = csv.DictReader(csvfile)

    for row in reader:
        q = Question(
            question=row["question"],
            answer=row["answer"],
            theme=row["theme"]
        )
        db.add(q)

db.commit()
db.close()

print("Import terminé")