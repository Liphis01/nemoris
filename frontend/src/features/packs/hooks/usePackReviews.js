import { useCallback, useEffect, useState } from "react";
import {
  addPackComment,
  backfillPackInstalls,
  getMyPackStatus,
  listPackComments,
  ratePack
} from "../../../api/packs";

// Comments load unconditionally (no auth needed to read). my-status only
// loads when signed in. Before reading it, we sync local PackSubscription rows
// so anonymous installs become eligible under the account that signs in later.
export function usePackReviews(packGuid, { signedIn = false, initialAggregate = null } = {}) {
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentsError, setCommentsError] = useState("");
  const [myStatus, setMyStatus] = useState(null);
  const [aggregate, setAggregate] = useState(initialAggregate);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentSubmitError, setCommentSubmitError] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState("");

  const loadComments = useCallback(async () => {
    if (!packGuid) {
      setComments([]);
      setLoadingComments(false);
      return;
    }

    setLoadingComments(true);
    setCommentsError("");

    try {
      const result = await listPackComments(packGuid);
      setComments(result.comments || []);
    } catch (error) {
      console.error(error);
      setCommentsError(error.message || "Commentaires indisponibles.");
    } finally {
      setLoadingComments(false);
    }
  }, [packGuid]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  useEffect(() => {
    setAggregate(initialAggregate);
    // Only re-seed when the pack itself changes -- not on every parent
    // re-render, since submitRating updates this locally afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packGuid]);

  useEffect(() => {
    let cancelled = false;

    if (!packGuid || !signedIn) {
      setMyStatus(null);
      return undefined;
    }

    setMyStatus(null);

    async function loadMyStatus() {
      try {
        await backfillPackInstalls();
      } catch (error) {
        console.error(error);
      }

      if (cancelled) {
        return;
      }

      try {
        const status = await getMyPackStatus(packGuid);

        if (!cancelled) {
          setMyStatus(status);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadMyStatus();

    return () => {
      cancelled = true;
    };
  }, [packGuid, signedIn]);

  async function submitComment(body) {
    setCommentBusy(true);
    setCommentSubmitError("");

    try {
      const result = await addPackComment(packGuid, body);
      setComments((previous) => [result.comment, ...previous]);
      return true;
    } catch (error) {
      console.error(error);
      setCommentSubmitError(error.message || "Commentaire impossible à envoyer.");
      return false;
    } finally {
      setCommentBusy(false);
    }
  }

  async function submitRating(value) {
    setRatingBusy(true);
    setRatingError("");

    try {
      const result = await ratePack(packGuid, value);
      setMyStatus((previous) => ({ ...previous, my_rating: result.my_rating }));
      setAggregate({
        avg_rating: result.avg_rating,
        rating_count: result.rating_count
      });
      return result;
    } catch (error) {
      console.error(error);
      setRatingError(error.message || "Note impossible à enregistrer.");
      return null;
    } finally {
      setRatingBusy(false);
    }
  }

  return {
    comments,
    loadingComments,
    commentsError,
    myStatus,
    aggregate,
    commentBusy,
    commentSubmitError,
    ratingBusy,
    ratingError,
    submitComment,
    submitRating
  };
}
