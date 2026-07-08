import TextReviewCard from "./TextReviewCard";
import TextTrainingCard from "./TextTrainingCard";
import MediaReview from "./MediaReview";
import MapReview from "./MapReview";
import TimelineReview from "./TimelineReview";
import {
    IMAGE_MODE_CLICK_PROMPT,
    IMAGE_MODE_TYPE_PROMPT,
    normalizeImageMode
} from "../imageModes";

function reviewItemRenderKey(q, currentIndex) {
    const itemIds = Array.isArray(q.items)
        ? q.items.map(item => item.question_id).join(",")
        : "";
    const primaryId = q.group_id ?? q.question_id ?? q.id ?? q.name ?? q.media ?? currentIndex;

    return [
        q.type_q,
        primaryId,
        itemIds,
        q._reviewRetryOfIndex ?? "",
        q._reviewSkipId ?? ""
    ].join(":");
}

export default function ReviewQuestionRenderer({
    q,
    currentIndex,
    showAnswer,
    setShowAnswer,
    handleTextAnswer,
    currentTextQuality,
    selectedTextQuality,
    handleMapComplete,
    handleImageComplete,
    handleTimelineComplete,
    submitMapAnswer,
    submitMediaAnswer,
    submitTimelineAnswer,
    allowPartialSubmit = false,
    trainingMode = false,
    trainingElapsedMs = null,
    trainingBestTimeMs = null,
    compactVisualLayout = false,
}) {
    if (!q) return null;

    if (q.type_q === "map" && !q.media) {
        return <div>⚠️ Map vide</div>;
    }

    const renderKey = reviewItemRenderKey(q, currentIndex);

    // Grouped map review built from atomic map questions.
    if (q.type_q === "map" && q.media) {
        return (
            <MapReview
                key={renderKey}
                group={q}
                reviewZones={q.items}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onComplete={handleMapComplete}
                submitAnswer={submitMapAnswer}
                allowPartialSubmit={allowPartialSubmit}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (q.type_q === "media" && q.items) {
        const imageMode = normalizeImageMode(q.mode);
        const separatesResolvedItems = (
            imageMode === IMAGE_MODE_CLICK_PROMPT ||
            imageMode === IMAGE_MODE_TYPE_PROMPT
        );

        return (
            <MediaReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onComplete={handleImageComplete}
                submitAnswer={submitMediaAnswer}
                allowPartialSubmit={allowPartialSubmit}
                separateResolvedItems={separatesResolvedItems}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (q.type_q === "timeline") {
        return (
            <TimelineReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                onComplete={handleTimelineComplete}
                submitAnswer={submitTimelineAnswer}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    // Text review question.
    if (trainingMode) {
        return (
            <TextTrainingCard
                key={renderKey}
                q={q}
                currentIndex={currentIndex}
                onComplete={handleTextAnswer}
            />
        );
    }

    return (
        <TextReviewCard
            key={renderKey}
            q={q}
            currentIndex={currentIndex}
            showAnswer={showAnswer}
            setShowAnswer={setShowAnswer}
            handleAnswer={handleTextAnswer}
            currentQuality={currentTextQuality}
            selectedQuality={selectedTextQuality}
            showQualityButtons={!trainingMode}
        />
    );
}
