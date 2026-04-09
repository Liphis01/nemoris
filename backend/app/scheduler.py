from datetime import date, timedelta

def update_progress(interval, ease, quality):
    # quality: 0 = faux, 1 = dur, 2 = facile

    if quality == 0:
        return 1, 2.5, date.today() + timedelta(days=1)

    if quality == 1:
        interval = max(1, int(interval * 1.5))
        ease -= 0.1
    else:
        interval = int(interval * ease)
        ease += 0.05

    ease = max(1.3, ease)
    next_review = date.today() + timedelta(days=interval)

    return interval, ease, next_review