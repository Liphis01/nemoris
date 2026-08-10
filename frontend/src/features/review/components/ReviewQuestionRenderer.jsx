import TextReviewCard from "./TextReviewCard";
import TextTrainingCard from "./TextTrainingCard";
import MediaReview from "./MediaReview";
import TextGroupReview from "./TextGroupReview";
import MapReview from "./MapReview";
import TimelineReview from "./TimelineReview";
import SequenceReview from "./SequenceReview";
import ClozeReview from "./ClozeReview";
import NumericReview from "./NumericReview";
import GridReview from "./GridReview";
import SetReview from "./SetReview";
import EnumerationReview from "./EnumerationReview";
import {
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

function presentationKind(q) {
    return q?.presentation_kind || "";
}

function isMapGroup(q) {
    return presentationKind(q) === "map_group" || (
        q?.type_q === "map" && Boolean(q?.media)
    );
}

function isMediaGroup(q) {
    return presentationKind(q) === "media_group" || (
        q?.type_q === "media" && Array.isArray(q?.items)
    );
}

function isTimelineGroup(q) {
    return presentationKind(q) === "timeline_group" || q?.type_q === "timeline";
}

function isSequenceGroup(q) {
    return presentationKind(q) === "sequence_group" || (
        q?.type_q === "sequence" && Array.isArray(q?.items)
    );
}

function isTextGroup(q) {
    return presentationKind(q) === "text_group" || (
        q?.type_q === "text" && Array.isArray(q?.items)
    );
}

function isClozeGroup(q) {
    return presentationKind(q) === "cloze_group" || (
        q?.type_q === "cloze" && Array.isArray(q?.items)
    );
}

function isGridGroup(q) {
    return ["grid_cell", "grid_row"].includes(presentationKind(q)) || q?.type_q === "grid";
}

function isSetGroup(q) {
    return presentationKind(q) === "set_group" || (q?.type_q === "set" && Array.isArray(q?.items));
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
    handleSequenceComplete,
    handleClozeComplete,
    handleNumericComplete,
    handleGridComplete,
    onAnsweringComplete,
    submitMapAnswer,
    submitMediaAnswer,
    submitTextAnswer,
    submitTimelineAnswer,
    submitSequenceAnswer,
    submitClozeAnswer,
    submitNumericAnswer,
    submitGridAnswer,
    submitSetAnswer,
    submitEnumerationAnswer,
    graduateGroupedAnswer,
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
    if (isMapGroup(q)) {
        return (
            <MapReview
                key={renderKey}
                group={q}
                reviewZones={q.items}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onAnsweringComplete={onAnsweringComplete}
                onComplete={handleMapComplete}
                submitAnswer={submitMapAnswer}
                graduateAnswer={graduateGroupedAnswer}
                allowPartialSubmit={allowPartialSubmit}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (isMediaGroup(q)) {
        const imageMode = normalizeImageMode(q.mode);
        const separatesResolvedItems = imageMode === IMAGE_MODE_TYPE_PROMPT;

        return (
            <MediaReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onAnsweringComplete={onAnsweringComplete}
                onComplete={handleImageComplete}
                submitAnswer={submitMediaAnswer}
                graduateAnswer={graduateGroupedAnswer}
                allowPartialSubmit={allowPartialSubmit}
                separateResolvedItems={separatesResolvedItems}
                showQualityControls={!trainingMode}
                trainingElapsedMs={trainingElapsedMs}
                trainingBestTimeMs={trainingBestTimeMs}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (isTimelineGroup(q)) {
        return (
            <TimelineReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                onAnsweringComplete={onAnsweringComplete}
                onComplete={handleTimelineComplete}
                submitAnswer={submitTimelineAnswer}
                graduateAnswer={graduateGroupedAnswer}
                showQualityControls={!trainingMode}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (isSequenceGroup(q)) {
        return (
            <SequenceReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onAnsweringComplete={onAnsweringComplete}
                onComplete={handleSequenceComplete}
                submitAnswer={submitSequenceAnswer}
                graduateAnswer={graduateGroupedAnswer}
                showQualityControls={!trainingMode}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (isTextGroup(q)) {
        return (
            <TextGroupReview
                key={renderKey}
                group={q}
                reviewItems={q.items || []}
                contextItems={q.context_items || q.items || []}
                mode={q.mode}
                onAnsweringComplete={onAnsweringComplete}
                onComplete={handleImageComplete}
                submitAnswer={submitTextAnswer}
                graduateAnswer={graduateGroupedAnswer}
                showQualityControls={!trainingMode}
                fillAvailableHeight={compactVisualLayout}
            />
        );
    }

    if (isClozeGroup(q)) {
        return <ClozeReview key={renderKey} group={q} submitAnswer={submitClozeAnswer} onComplete={handleClozeComplete} trainingMode={trainingMode} />;
    }

    if (isGridGroup(q)) {
        return <GridReview key={renderKey} group={q} submitAnswer={submitGridAnswer} onComplete={handleGridComplete} trainingMode={trainingMode} />;
    }

    if (isSetGroup(q)) {
        return <SetReview key={renderKey} group={q} submitAnswer={submitSetAnswer} onComplete={handleGridComplete} trainingMode={trainingMode} />;
    }
    if (q.type_q === "enumeration") return <EnumerationReview key={renderKey} q={q} submitAnswer={submitEnumerationAnswer} onComplete={handleNumericComplete} trainingMode={trainingMode} />;

    if (q.type_q === "numeric") {
        return <NumericReview key={renderKey} q={q} submitAnswer={submitNumericAnswer} onComplete={handleNumericComplete} trainingMode={trainingMode} />;
    }

    // Text review question.
    if (trainingMode) {
        return (
            <TextTrainingCard
                key={renderKey}
                q={q}
                currentIndex={currentIndex}
                onAnsweringComplete={onAnsweringComplete}
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
