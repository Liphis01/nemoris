import { useCallback, useMemo } from "react";

export function formatReviewDate(value) {
  // Dates arrive as YYYY-MM-DD from the backend. Build a local Date from parts
  // to avoid timezone shifts around midnight.
  if (!value) return "";

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;

  const reviewDate = new Date(Number(year), Number(month) - 1, Number(day));
  const today = new Date();
  const todayKey = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const tomorrowKey = new Date(todayKey);
  tomorrowKey.setDate(todayKey.getDate() + 1);

  if (reviewDate.getTime() === todayKey.getTime()) return "Aujourd'hui";
  if (reviewDate.getTime() === tomorrowKey.getTime()) return "Demain";

  return `${day}-${month}-${year}`;
}

function hasStartedProgress(question) {
  // New questions are due immediately, but showing a calendar jump before the
  // first review is noisy. Only expose it after progress has started.
  const history = question?.progress?.history || [];
  return (question?.progress?.reps || 0) > 0 || history.length > 0;
}

export default function useInspectorPreviewState({
  onOpenInCalendar,
  requestManageTransition,
  selectedItem,
  setEditingZone,
  setSelectedItem
}) {
  const selectedNextReview = useMemo(() => (
    hasStartedProgress(selectedItem)
      ? selectedItem.progress?.next_review || selectedItem.next_review
      : null
  ), [selectedItem]);

  const openSelectedInCalendar = useCallback(() => {
    if (!selectedNextReview) return;

    const openCalendar = () => {
      onOpenInCalendar?.(selectedItem);
      setSelectedItem?.(null);
      setEditingZone?.(null);
    };

    if (requestManageTransition) {
      requestManageTransition(openCalendar);
      return;
    }

    openCalendar();
  }, [
    onOpenInCalendar,
    requestManageTransition,
    selectedItem,
    selectedNextReview,
    setEditingZone,
    setSelectedItem
  ]);

  return {
    openSelectedInCalendar,
    selectedNextReview
  };
}
