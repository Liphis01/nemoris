import { useState } from "react";
import { usePackPublishAuth } from "../hooks/usePackPublishAuth";
import { usePackReviews } from "../hooks/usePackReviews";
import { formatRatingLabel } from "./packFormatting";
import PublishAuthPanel from "./PublishAuthPanel";

const STAR_VALUES = [1, 2, 3, 4, 5];

export default function PackReviewsSection({ entry, setMode, isOwner = false }) {
  const auth = usePackPublishAuth();
  const signedIn = Boolean(auth.publishStatus?.signed_in);
  const {
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
  } = usePackReviews(entry.pack_guid, {
    signedIn,
    initialAggregate: {
      avg_rating: entry.avg_rating,
      rating_count: entry.rating_count
    }
  });
  const [commentDraft, setCommentDraft] = useState("");

  const isInstalled = Boolean(myStatus?.is_installed);
  // Rating your own pack would inflate the public average shown in Découvrir,
  // so only an installer can rate -- but commenting has no such downside, and
  // requiring the creator to install their own pack first made no sense.
  const canRate = signedIn && !isOwner && isInstalled;
  const canComment = signedIn && (isOwner || isInstalled);
  const ratingLabel = formatRatingLabel(aggregate?.avg_rating, aggregate?.rating_count);

  function handleSubmitComment(event) {
    event.preventDefault();

    if (!commentDraft.trim() || commentBusy) {
      return;
    }

    submitComment(commentDraft.trim()).then((success) => {
      if (success) {
        setCommentDraft("");
      }
    });
  }

  return (
    <section className="pack-reviews" aria-label="Avis sur le pack">
      <div className="pack-section-head">
        <div>
          <h2>Avis</h2>
          <p>
            {ratingLabel || "Pas encore noté"} ·{" "}
            {comments.length} commentaire{comments.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {!signedIn && (
        <PublishAuthPanel
          authStep={auth.authStep}
          busy={auth.busy}
          code={auth.code}
          email={auth.email}
          publishStatus={auth.publishStatus}
          setAuthStep={auth.setAuthStep}
          setCode={auth.setCode}
          setEmail={auth.setEmail}
          setMode={setMode}
          onRequestCode={auth.requestCode}
          onSignOut={auth.signOut}
          onVerify={auth.verifyCode}
        />
      )}

      {signedIn && !isOwner && !isInstalled && (
        <div className="pack-theme-empty">
          Installe ce pack pour le noter et laisser un commentaire.
        </div>
      )}

      {(canRate || canComment) && (
        <div className="pack-reviews-form">
          {canRate && (
            <>
              <div className="pack-reviews-stars" role="radiogroup" aria-label="Ta note">
                {STAR_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={ratingBusy}
                    aria-pressed={myStatus?.my_rating === value}
                    className={`pack-star-button${
                      myStatus?.my_rating && value <= myStatus.my_rating
                        ? " is-filled"
                        : ""
                    }`}
                    onClick={() => submitRating(value)}
                  >
                    ★
                  </button>
                ))}
              </div>

              {ratingError && (
                <div className="pack-alert" role="alert">{ratingError}</div>
              )}
            </>
          )}

          {canComment && (
            <>
              <form className="pack-reviews-comment-form" onSubmit={handleSubmitComment}>
                <textarea
                  aria-label="Ton commentaire"
                  value={commentDraft}
                  disabled={commentBusy}
                  placeholder="Un avis pour le créateur..."
                  onChange={(event) => setCommentDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="pack-secondary-button"
                  disabled={commentBusy || !commentDraft.trim()}
                >
                  {commentBusy ? "Envoi..." : "Commenter"}
                </button>
              </form>

              {commentSubmitError && (
                <div className="pack-alert" role="alert">{commentSubmitError}</div>
              )}
            </>
          )}
        </div>
      )}

      {loadingComments && (
        <div className="pack-status" role="status">Chargement des commentaires...</div>
      )}

      {!loadingComments && commentsError && (
        <div className="pack-alert" role="alert">{commentsError}</div>
      )}

      {!loadingComments && !commentsError && (
        <ul className="pack-comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="pack-comment-item">
              <strong>{comment.author_label}</strong>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
