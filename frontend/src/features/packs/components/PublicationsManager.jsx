import { useCallback, useEffect, useState } from "react";
import { listPackPublications, publishPackDraft, unpublishPack } from "../../../api/packs";
import { usePackPublishAuth } from "../hooks/usePackPublishAuth";
import { useActionState } from "../hooks/useActionState";
import { formatRatingLabel } from "./packFormatting";
import PublishAuthPanel from "./PublishAuthPanel";

function statusLabel(publication) {
  if (publication.publication_status === "archived") return "Dépublié";
  if (publication.is_public) return "Publié";
  return "Brouillon";
}

function statusClassName(publication) {
  if (publication.publication_status === "archived") return "pack-status-pill-update";
  if (publication.is_public) return "pack-status-pill-install";
  return "";
}

export default function PublicationsManager({ setMode }) {
  const auth = usePackPublishAuth();
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionState, patchAction] = useActionState();

  const loadPublications = useCallback(async () => {
    if (!auth.publishStatus?.signed_in) {
      setPublications([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const drafts = await listPackPublications();
      setPublications(drafts.publications || []);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || "Packs indisponibles.");
    } finally {
      setLoading(false);
    }
  }, [auth.publishStatus?.signed_in]);

  useEffect(() => {
    loadPublications();
  }, [loadPublications]);

  async function handleUnpublish(publication) {
    const confirmed = window.confirm(
      `Dépublier « ${publication.name} » ? Il disparaîtra du catalogue public ` +
      "mais restera récupérable ici."
    );

    if (!confirmed) {
      return;
    }

    patchAction(publication.pack_guid, { busy: true, error: "" });

    try {
      await unpublishPack(publication.pack_guid);
      await loadPublications();
      patchAction(publication.pack_guid, { busy: false });
    } catch (unpublishError) {
      console.error(unpublishError);
      patchAction(publication.pack_guid, {
        busy: false,
        error: unpublishError.message || "Dépublication impossible."
      });
    }
  }

  async function handlePublish(publication) {
    patchAction(publication.pack_guid, { busy: true, error: "" });

    try {
      await publishPackDraft(publication.pack_guid);
      await loadPublications();
      patchAction(publication.pack_guid, { busy: false });
    } catch (publishError) {
      console.error(publishError);
      patchAction(publication.pack_guid, {
        busy: false,
        error: publishError.message || "Publication impossible."
      });
    }
  }

  return (
    <div className="pack-manage-layout">
      <section className="pack-panel app-scrollbar" aria-label="Mes packs publiés">
        <div className="pack-section-head">
          <div>
            <h2>Mes packs</h2>
            <p>{publications.length} élément{publications.length > 1 ? "s" : ""}</p>
          </div>
        </div>

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

        {loading && (
          <div className="pack-status" role="status">Chargement des packs...</div>
        )}

        {!loading && error && (
          <div className="pack-alert" role="alert">{error}</div>
        )}

        {!loading && !error && auth.publishStatus?.signed_in && publications.length === 0 && (
          <div className="pack-theme-empty">
            Aucun pack publié pour l'instant.
          </div>
        )}

        {!loading && !error && publications.length > 0 && (
          <div className="pack-publication-list">
            {publications.map((publication) => {
              const action = actionState[publication.pack_guid] || {};
              const ratingLabel = formatRatingLabel(
                publication.avg_rating,
                publication.rating_count
              );
              const canPublish = (
                publication.publication_status === "draft" ||
                publication.publication_status === "archived"
              );

              return (
                <div key={publication.pack_guid} className="pack-publication-item">
                  <span className={`pack-status-pill ${statusClassName(publication)}`}>
                    {statusLabel(publication)}
                  </span>
                  <strong>{publication.name}</strong>
                  <small>
                    v{publication.version} · {publication.question_count ?? "—"} questions
                    {ratingLabel ? ` · ${ratingLabel}` : ""}
                    {" · "}
                    {publication.comment_count || 0} commentaire
                    {publication.comment_count > 1 ? "s" : ""}
                  </small>

                  <div className="pack-manage-item-actions">
                    {publication.is_public && (
                      <button
                        type="button"
                        className="pack-danger-button"
                        disabled={action.busy}
                        onClick={() => handleUnpublish(publication)}
                      >
                        {action.busy ? "..." : "Dépublier"}
                      </button>
                    )}

                    {canPublish && (
                      <button
                        type="button"
                        className="pack-primary-button"
                        disabled={action.busy}
                        onClick={() => handlePublish(publication)}
                      >
                        {action.busy ? "..." : "Publier"}
                      </button>
                    )}
                  </div>

                  {action.error && (
                    <div className="pack-alert" role="alert">{action.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
