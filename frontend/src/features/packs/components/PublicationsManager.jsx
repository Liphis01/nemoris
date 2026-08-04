import { useCallback, useEffect, useState } from "react";
import { listGroups } from "../../../api/groups";
import { listCollections } from "../../../api/collections";
import {
  deletePackPublication,
  previewPackRelease,
  publishPack,
  publishPackDraft,
  listPackPublications,
  unpublishPack
} from "../../../api/packs";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { usePackPublishAuth } from "../hooks/usePackPublishAuth";
import { useActionState } from "../hooks/useActionState";
import { formatRatingLabel, questionCountLabel, splitTerms } from "./packFormatting";
import PackReviewsSection from "./PackReviewsSection";
import PublishAuthPanel from "./PublishAuthPanel";

const NEW_PACK_KEY = "new";

function isArchivedPublication(publication) {
  return publication.publication_status === "archived";
}

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

function matchesSearch(name, term) {
  if (!term.trim()) return true;

  return (name || "").toLocaleLowerCase("fr-FR").includes(
    term.trim().toLocaleLowerCase("fr-FR")
  );
}


function termsToDraft(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}


function releasePayloadKey(payload) {
  return JSON.stringify({
    name: payload.name,
    description: payload.description,
    license: payload.license,
    tags: payload.tags
  });
}


function diffCount(value) {
  return Array.isArray(value) ? value.length : 0;
}


function ReleaseDiffPreview({ preview }) {
  if (!preview) return null;

  const metadataLabels = {
    name: "titre",
    description: "description",
    license: "licence",
    tags: "mots-clés de recherche",
    themes: "thèmes dérivés"
  };
  const metadataChanged = Array.isArray(preview.metadata_changed)
    ? preview.metadata_changed
    : [];
  const metadataText = metadataChanged.length
    ? metadataChanged.map((field) => metadataLabels[field] || field).join(", ")
    : "aucun";

  return (
    <div className="pack-release-preview" role="status">
      <div className="pack-release-preview-head">
        <strong>Changements à publier</strong>
        <span>
          {preview.question_count?.published ?? "—"} → {preview.question_count?.next ?? "—"} questions
        </span>
      </div>

      <div className="pack-release-diff-grid">
        <div className="pack-release-diff-stat">
          <span>Questions ajoutées</span>
          <strong>{diffCount(preview.questions?.added)}</strong>
        </div>
        <div className="pack-release-diff-stat">
          <span>Questions modifiées</span>
          <strong>{diffCount(preview.questions?.edited)}</strong>
        </div>
        <div className="pack-release-diff-stat">
          <span>Questions retirées</span>
          <strong>{diffCount(preview.questions?.removed)}</strong>
        </div>
        <div className="pack-release-diff-stat">
          <span>Groupes modifiés</span>
          <strong>
            {diffCount(preview.groups?.added) +
              diffCount(preview.groups?.edited) +
              diffCount(preview.groups?.removed)}
          </strong>
        </div>
      </div>

      <p>Métadonnées : {metadataText}</p>

      {preview.unchanged && (
        <div className="pack-release-warning">
          Aucun changement détecté.
        </div>
      )}
    </div>
  );
}

// Two steps, not one shared pane: picking a source and filling in metadata
// are different tasks that both want the full width, and at a few hundred
// groups a picker sharing space with the form would either force endless
// scrolling or crowd the fields down to nothing. Step 1 browses/searches
// one group or playlist (never a mix -- a pack ships a whole group or a
// playlist's selection, which may itself span several groups and types);
// step 2 owns the pane to itself for the metadata fields.
function PublishForm({ auth, basePublication = null, onCancelRelease, onPublished }) {
  const releaseMode = Boolean(basePublication);
  const releaseSourceKind = basePublication?.source?.kind === "playlist" ? "playlist" : "group";
  const releaseSourceId = basePublication?.source?.id ? String(basePublication.source.id) : "";
  const [step, setStep] = useState(releaseMode ? "form" : "select");
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(
    releaseMode && releaseSourceKind === "group" ? releaseSourceId : ""
  );
  const [sourceKind, setSourceKind] = useState(releaseSourceKind);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(
    releaseMode && releaseSourceKind === "playlist" ? releaseSourceId : ""
  );
  const [sourceSearch, setSourceSearch] = useState("");
  const [title, setTitle] = useState(basePublication?.name || "");
  const [license, setLicense] = useState(basePublication?.license || "");
  const [description, setDescription] = useState(basePublication?.description || "");
  const [tagsDraft, setTagsDraft] = useState(termsToDraft(basePublication?.tags));
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const publishingBusy = auth.busy || draftBusy || previewBusy;
  const publishError = previewError || draftError || auth.error;

  useEffect(() => {
    let cancelled = false;

    listCollections()
      .then((rows) => {
        if (!cancelled) {
          setPlaylists(Array.isArray(rows) ? rows : []);
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoadingGroups(true);
    setGroupsError("");

    listGroups()
      .then((rows) => {
        if (cancelled) return;

        setGroups(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        console.error(error);

        if (!cancelled) {
          setGroupsError(error.message || "Groupes impossibles à charger.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingGroups(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGroup = groups.find((group) => String(group.id) === selectedGroupId);
  const selectedPlaylist = playlists.find(
    (playlist) => String(playlist.id) === selectedPlaylistId
  );
  const selectedSource = sourceKind === "playlist"
    ? selectedPlaylist
    : selectedGroup;
  const publishPayload = {
    name: title.trim(),
    description: description.trim(),
    license: license.trim(),
    tags: splitTerms(tagsDraft)
  };
  const previewKey = releasePayloadKey(publishPayload);
  const previewReady = releaseMode && preview?.payloadKey === previewKey;
  const canPublish = (
    selectedSource &&
    !publishingBusy &&
    title.trim() &&
    (selectedSource.question_count || 0) > 0 &&
    // A generated playlist is derived from your review history, so it is not
    // yours to hand to someone else.
    !selectedSource.generated &&
    auth.publishStatus?.signed_in
  );

  function selectGroup(group) {
    setSelectedGroupId(String(group.id));
    setTitle(group.name || "");
    setStep("form");
  }

  function selectPlaylist(playlist) {
    setSelectedPlaylistId(String(playlist.id));
    setTitle(playlist.name || "");
    setStep("form");
  }

  async function handlePreview() {
    if (!releaseMode || !canPublish) {
      return;
    }

    setPreviewBusy(true);
    setPreviewError("");
    setPreview(null);

    try {
      const result = await previewPackRelease(
        basePublication.pack_guid,
        publishPayload
      );
      setPreview({ ...result, payloadKey: previewKey });
    } catch (error) {
      console.error(error);
      setPreviewError(error.message || "Prévisualisation impossible.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handlePublish() {
    if (!canPublish || (releaseMode && !previewReady)) {
      return;
    }

    setDraftBusy(true);
    setDraftError("");

    try {
      // Upload and go public in one step: there is no review or moderation
      // between the two, and dépublier is a one-click undo.
      const result = await publishPack(
        sourceKind === "playlist"
          ? { collectionId: selectedSource.id }
          : { groupId: selectedSource.id },
        publishPayload
      );
      onPublished(result.publication);
    } catch (error) {
      console.error(error);
      setDraftError(error.message || "Publication impossible.");
    } finally {
      setDraftBusy(false);
    }
  }

  if (step === "select") {
    const filteredGroups = groups.filter((group) => matchesSearch(group.name, sourceSearch));
    const filteredPlaylists = playlists.filter(
      (playlist) => matchesSearch(playlist.name, sourceSearch)
    );

    return (
      <section className="pack-export-panel app-scrollbar" aria-label="Choisir une source">
        <div className="pack-section-head">
          <div>
            <h2>Nouveau pack</h2>
            <p>Choisis un groupe ou une playlist à publier</p>
          </div>
        </div>

        <div className="pack-tab-list" role="tablist" aria-label="Type de source">
          <button
            type="button"
            role="tab"
            aria-selected={sourceKind === "group"}
            className={`pack-tab-button${sourceKind === "group" ? " is-active" : ""}`}
            onClick={() => {
              setSourceKind("group");
              setSourceSearch("");
            }}
          >
            Groupe
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceKind === "playlist"}
            className={`pack-tab-button${sourceKind === "playlist" ? " is-active" : ""}`}
            onClick={() => {
              setSourceKind("playlist");
              setSourceSearch("");
            }}
          >
            Playlist
          </button>
        </div>

        <label className="pack-field">
          <span className="pack-field-label">Recherche</span>
          <input
            aria-label={sourceKind === "playlist" ? "Rechercher une playlist" : "Rechercher un groupe"}
            type="search"
            placeholder={sourceKind === "playlist" ? "Nom de la playlist..." : "Nom du groupe..."}
            value={sourceSearch}
            onChange={(event) => setSourceSearch(event.target.value)}
          />
        </label>

        {sourceKind === "playlist" && (
          <div className="pack-export-group-list">
            {filteredPlaylists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="pack-export-group"
                onClick={() => selectPlaylist(playlist)}
                disabled={playlist.generated}
                title={playlist.generated
                  ? "Une playlist générée dépend de ton historique de révision."
                  : undefined}
              >
                <span>{playlist.name}</span>
                <small>
                  {questionCountLabel(playlist.question_count)}
                  {playlist.generated ? " · générée" : ""}
                </small>
              </button>
            ))}

            {playlists.length === 0 && (
              <div className="pack-theme-empty">
                Aucune playlist. Crée-en une dans le Gestionnaire.
              </div>
            )}

            {playlists.length > 0 && filteredPlaylists.length === 0 && (
              <div className="pack-theme-empty">
                Aucun résultat pour « {sourceSearch} ».
              </div>
            )}
          </div>
        )}

        {sourceKind === "group" && loadingGroups && (
          <div className="pack-status" role="status">Groupes locaux en cours de chargement.</div>
        )}

        {sourceKind === "group" && !loadingGroups && groupsError && (
          <div className="pack-alert" role="alert">{groupsError}</div>
        )}

        {sourceKind === "group" && !loadingGroups && !groupsError && (
          <div className="pack-export-group-list">
            {filteredGroups.map((group) => {
              const typeStyle = getQuestionTypeChipStyle(group.type_group);

              return (
                <button
                  key={group.id}
                  type="button"
                  className="pack-export-group"
                  onClick={() => selectGroup(group)}
                >
                  <span>{group.name}</span>
                  <small
                    style={{
                      "--pack-type-bg": typeStyle.background,
                      "--pack-type-color": typeStyle.color
                    }}
                  >
                    {typeStyle.label} · {questionCountLabel(group.question_count)}
                  </small>
                </button>
              );
            })}

            {groups.length === 0 && (
              <div className="pack-theme-empty">
                Aucun groupe exportable.
              </div>
            )}

            {groups.length > 0 && filteredGroups.length === 0 && (
              <div className="pack-theme-empty">
                Aucun résultat pour « {sourceSearch} ».
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  const sourceTypeStyle = sourceKind === "group" && selectedGroup
    ? getQuestionTypeChipStyle(selectedGroup.type_group)
    : null;

  return (
    <section
      className="pack-export-panel app-scrollbar"
      aria-label={releaseMode ? "Publier les changements" : "Nouveau pack"}
    >
      <div className="pack-section-head">
        <div>
          <h2>{releaseMode ? "Publier les changements" : "Nouveau pack"}</h2>
          <p>
            {releaseMode
              ? "Préparer les changements pour le catalogue"
              : (
                sourceKind === "playlist"
                  ? "Mettre une playlist dans le catalogue"
                  : "Mettre un groupe dans le catalogue"
              )}
          </p>
        </div>
      </div>

      {releaseMode ? (
        <div className="pack-source-summary pack-source-summary-static">
          <span className="pack-source-summary-text">
            <span className="pack-field-label">Source</span>
            <span>
              <strong>{selectedSource?.name || basePublication?.source?.name || "Source introuvable"}</strong>
              {sourceTypeStyle ? ` · ${sourceTypeStyle.label}` : ""}
              {" · "}
              {questionCountLabel(selectedSource?.question_count)}
              {sourceKind === "playlist" ? " · playlist" : ""}
            </span>
          </span>
          <span className="pack-source-summary-change is-static">Source liée</span>
        </div>
      ) : (
        <button
          type="button"
          className="pack-source-summary"
          onClick={() => setStep("select")}
        >
          <span className="pack-source-summary-text">
            <span className="pack-field-label">Source</span>
            <span>
              <strong>{selectedSource?.name}</strong>
              {sourceTypeStyle ? ` · ${sourceTypeStyle.label}` : ""}
              {" · "}
              {questionCountLabel(selectedSource?.question_count)}
              {sourceKind === "playlist" ? " · playlist" : ""}
            </span>
          </span>
          <span className="pack-source-summary-change">Changer →</span>
        </button>
      )}

      <div className="pack-publish-form">
        <label className="pack-field">
          <span className="pack-field-label">Titre</span>
          <input
            aria-label="Titre du pack"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={publishingBusy}
          />
        </label>

        <label className="pack-field">
          <span className="pack-field-label">Licence</span>
          <input
            aria-label="Licence du pack"
            type="text"
            placeholder="CC0, CC-BY..."
            value={license}
            onChange={(event) => setLicense(event.target.value)}
            disabled={publishingBusy}
          />
        </label>

        <label className="pack-field">
          <span className="pack-field-label">Description</span>
          <textarea
            aria-label="Description du pack"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={publishingBusy}
          />
        </label>

        <div className="pack-form-grid">
          <div className="pack-field">
            <span className="pack-field-label">Thèmes</span>
            <div style={{ color: "#777", fontSize: "12px", lineHeight: 1.45, paddingTop: "7px" }}>
              Déduits automatiquement des thèmes de base présents dans le pack.
            </div>
          </div>
          <label className="pack-field">
            <span className="pack-field-label">Mots-clés de recherche</span>
            <input
              aria-label="Mots-clés de recherche du pack"
              type="text"
              placeholder="pays, capitales"
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              disabled={publishingBusy}
            />
          </label>
        </div>

        {releaseMode && (
          <ReleaseDiffPreview preview={previewReady ? preview : null} />
        )}

        <div className="pack-publish-actions">
          {releaseMode ? (
            <>
              <button
                type="button"
                className="pack-secondary-button"
                disabled={!canPublish}
                onClick={handlePreview}
              >
                {previewBusy ? "Prévisualisation..." : "Prévisualiser les changements"}
              </button>
              <button
                type="button"
                className="pack-primary-button"
                disabled={!canPublish || !previewReady}
                onClick={handlePublish}
              >
                {draftBusy ? "Publication..." : "Publier les changements"}
              </button>
              <button
                type="button"
                className="pack-secondary-button"
                disabled={publishingBusy}
                onClick={onCancelRelease}
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pack-primary-button"
              disabled={!canPublish}
              onClick={handlePublish}
            >
              {publishingBusy ? "Publication..." : "Publier"}
            </button>
          )}
        </div>
      </div>

      {publishError && (
        <div className="pack-alert" role="alert">{publishError}</div>
      )}
    </section>
  );
}

// The dashboard for one already-published pack: stats, where it came from,
// and the ratings/comments a creator could not read anywhere else before
// this screen existed.
function PackDetail({
  action,
  onOpenGroup,
  onDelete,
  onPublish,
  onStartRelease,
  onUnpublish,
  publication,
  setMode
}) {
  const ratingLabel = formatRatingLabel(publication.avg_rating, publication.rating_count);
  const canRepublish = (
    publication.publication_status === "draft" ||
    publication.publication_status === "archived"
  );
  const canDeletePermanent = (
    publication.publication_status === "archived"
  );
  const canStartRelease = (
    publication.is_public &&
    !publication.orphaned &&
    publication.source?.id
  );

  return (
    <section className="pack-export-panel app-scrollbar" aria-label="Détail du pack">
      <div className="pack-section-head">
        <div>
          <h2>{publication.name}</h2>
          <p>{questionCountLabel(publication.question_count)}</p>
        </div>
        <span className={`pack-status-pill ${statusClassName(publication)}`}>
          {statusLabel(publication)}
        </span>
      </div>

      <div className="pack-detail-stat-grid">
        <div className="pack-detail-stat">
          <span>Questions</span>
          <strong>{publication.question_count ?? "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Note</span>
          <strong>{ratingLabel || "—"}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Commentaires</span>
          <strong>{publication.comment_count || 0}</strong>
        </div>
        <div className="pack-detail-stat">
          <span>Publication</span>
          <strong>{statusLabel(publication)}</strong>
        </div>
      </div>

      {/*
        Deleting a group locally never touches the catalog row, so a pack
        can stay public with nothing left to rebuild it from. Saying so is
        the whole point of this screen.
      */}
      {publication.orphaned ? (
        <div className="pack-alert" role="note">
          ⚠ Source supprimée localement — ce pack reste public mais tu ne
          peux plus publier de changements.
        </div>
      ) : publication.source?.name ? (
        publication.source.kind === "group" && onOpenGroup ? (
          <button
            type="button"
            className="pack-source-summary"
            onClick={() => onOpenGroup(publication.source.id)}
          >
            <span className="pack-source-summary-text">
              <span className="pack-field-label">Source</span>
              <span><strong>{publication.source.name}</strong></span>
            </span>
            <span className="pack-source-summary-change">Ouvrir →</span>
          </button>
        ) : (
          <div className="pack-source-summary pack-source-summary-static">
            <span className="pack-source-summary-text">
              <span className="pack-field-label">Source</span>
              <span>
                <strong>{publication.source.name}</strong>
                {publication.source.kind === "playlist" ? " (playlist)" : ""}
              </span>
            </span>
          </div>
        )
      ) : null}

      <div className="pack-action-row">
        {canStartRelease && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onStartRelease(publication)}
          >
            Publier les changements
          </button>
        )}

        {publication.is_public && (
          <button
            type="button"
            className="pack-danger-button"
            disabled={action.busy}
            onClick={() => onUnpublish(publication)}
          >
            {action.busy ? "..." : "Dépublier"}
          </button>
        )}

        {canRepublish && (
          <button
            type="button"
            className="pack-primary-button"
            disabled={action.busy}
            onClick={() => onPublish(publication)}
          >
            {action.busy ? "..." : "Publier"}
          </button>
        )}

        {canDeletePermanent && (
          <button
            type="button"
            className="pack-danger-button"
            disabled={action.busy}
            onClick={() => onDelete(publication)}
          >
            {action.busy ? "..." : "Supprimer définitivement"}
          </button>
        )}
      </div>

      {action.error && (
        <div className="pack-alert" role="alert">{action.error}</div>
      )}

      <PackReviewsSection entry={publication} setMode={setMode} isOwner />
    </section>
  );
}

export default function PublicationsManager({ setMode, onOpenGroup }) {
  const auth = usePackPublishAuth();
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionState, patchAction] = useActionState();
  // null until the first load resolves, then either a pack_guid or
  // NEW_PACK_KEY. Once set, only explicit clicks (or a fresh publish) move
  // it -- a background reload must never yank the user off what they picked.
  const [selectedKey, setSelectedKey] = useState(null);
  const [publicationView, setPublicationView] = useState("active");
  // Optimistic stand-in for a pack that was just published, shown until the
  // authoritative row for it shows up in `publications`. Without this, a
  // slow or stale refresh would strand the user on a blank "new pack" form
  // with no confirmation that anything happened.
  const [justPublished, setJustPublished] = useState(null);
  const [releaseBase, setReleaseBase] = useState(null);

  const loadPublications = useCallback(async (fallbackPublication = null) => {
    // publishStatus is null until the session check resolves -- that is
    // "unknown yet", not "signed out". Treating it as signed-out here used
    // to lock the default selection to "new" a render before the real
    // signed-in status (and the real publications) ever arrived.
    if (auth.publishStatus === null) {
      return;
    }

    if (!auth.publishStatus.signed_in) {
      setPublications([]);
      setSelectedKey((previous) => previous ?? NEW_PACK_KEY);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const drafts = await listPackPublications();
      const next = drafts.publications || [];
      const firstActive = next.find(
        (publication) => !isArchivedPublication(publication)
      );
      const firstArchived = next.find(isArchivedPublication);
      const fallbackGuid = fallbackPublication?.pack_guid || null;
      setPublications(next);
      setSelectedKey((previous) => {
        const hasPrevious = previous && (
          previous === NEW_PACK_KEY ||
          next.some((publication) => publication.pack_guid === previous)
        );

        if (fallbackGuid) return fallbackGuid;
        if (hasPrevious) return previous;

        // Land on "Nouveau pack" by default rather than an arbitrary
        // existing publication -- that's the natural first stop when
        // opening the tab.
        return NEW_PACK_KEY;
      });
      setPublicationView((previous) => (
        previous === "archived" && !firstArchived && firstActive
          ? "active"
          : previous === "active" && !firstActive && firstArchived
          ? "archived"
          : previous
      ));
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || "Packs indisponibles.");
    } finally {
      setLoading(false);
    }
  }, [auth.publishStatus]);

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
      setPublicationView("archived");
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
      setPublicationView("active");
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

  async function handleDelete(publication) {
    const confirmed = window.confirm(
      `Supprimer définitivement « ${publication.name} » ? ` +
      "Cette action efface le pack du catalogue et ne peut pas être annulée."
    );

    if (!confirmed) {
      return;
    }

    patchAction(publication.pack_guid, { busy: true, error: "" });

    try {
      await deletePackPublication(publication.pack_guid);
      setSelectedKey(null);
      await loadPublications();
      patchAction(publication.pack_guid, { busy: false });
    } catch (deleteError) {
      console.error(deleteError);
      patchAction(publication.pack_guid, {
        busy: false,
        error: deleteError.message || "Suppression impossible."
      });
    }
  }

  function handlePublished(publication) {
    // Land on the pack you just published instead of leaving the form up --
    // seeing it appear in the dashboard is the confirmation, not a banner.
    // Show it immediately from the publish response; the background reload
    // below fills in rating/comment/source once the authoritative row
    // exists, without leaving the user staring at an empty form meanwhile.
    setJustPublished(publication);
    setReleaseBase(null);
    setSelectedKey(publication.pack_guid);
    loadPublications(publication);
  }

  function handleStartRelease(publication) {
    setReleaseBase(publication);
    setSelectedKey(NEW_PACK_KEY);
  }

  const selectedPublication = (
    publications.find((publication) => publication.pack_guid === selectedKey) ||
    (justPublished?.pack_guid === selectedKey ? justPublished : undefined)
  );
  const activePublications = publications.filter(
    (publication) => !isArchivedPublication(publication)
  );
  const archivedPublications = publications.filter(isArchivedPublication);
  const visiblePublications = publicationView === "archived"
    ? archivedPublications
    : activePublications;
  const visibleEmptyText = publicationView === "archived"
    ? "Aucun pack dépublié."
    : "Aucun pack actif.";

  function selectPublicationView(nextView) {
    const nextList = nextView === "archived"
      ? archivedPublications
      : activePublications;

    setPublicationView(nextView);
    setSelectedKey((previous) => {
      if (previous === NEW_PACK_KEY && nextView === "active") {
        return previous;
      }

      if (nextList.some((publication) => publication.pack_guid === previous)) {
        return previous;
      }

      return nextList[0]?.pack_guid || (
        nextView === "active" ? NEW_PACK_KEY : previous
      );
    });
  }

  return (
    <div className="pack-manage-layout">
      <section className="pack-panel pack-rail-panel" aria-label="Mes packs">
        <div className="pack-section-head">
          <div>
            <h2>Mes packs</h2>
            <p>
              {activePublications.length} actif{activePublications.length > 1 ? "s" : ""}
              {archivedPublications.length > 0
                ? ` · ${archivedPublications.length} dépublié${archivedPublications.length > 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`pack-rail-new${selectedKey === NEW_PACK_KEY ? " is-active" : ""}`}
          onClick={() => {
            setReleaseBase(null);
            setSelectedKey(NEW_PACK_KEY);
          }}
        >
          + Nouveau pack
        </button>

        <div className="pack-rail-filter" role="tablist" aria-label="Filtrer mes packs">
          <button
            type="button"
            role="tab"
            aria-selected={publicationView === "active"}
            className={publicationView === "active" ? "is-active" : ""}
            onClick={() => selectPublicationView("active")}
          >
            Actifs <span>{activePublications.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={publicationView === "archived"}
            className={publicationView === "archived" ? "is-active" : ""}
            disabled={archivedPublications.length === 0}
            onClick={() => selectPublicationView("archived")}
          >
            Dépubliés <span>{archivedPublications.length}</span>
          </button>
        </div>

        <div className="pack-rail-scroll app-scrollbar">
          {!auth.publishStatus?.signed_in && (
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

          {!loading && !error && publications.length > 0 && visiblePublications.length === 0 && (
            <div className="pack-theme-empty">
              {visibleEmptyText}
            </div>
          )}

          {!loading && !error && visiblePublications.length > 0 && (
            <div className="pack-publication-list">
              {visiblePublications.map((publication) => {
                const ratingLabel = formatRatingLabel(
                  publication.avg_rating,
                  publication.rating_count
                );
                const active = publication.pack_guid === selectedKey;

                return (
                  <button
                    key={publication.pack_guid}
                    type="button"
                    className={`pack-publication-item${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => setSelectedKey(publication.pack_guid)}
                  >
                    <span className={`pack-status-pill ${statusClassName(publication)}`}>
                      {statusLabel(publication)}
                    </span>
                    <strong>{publication.name}</strong>
                    <small>
                      {questionCountLabel(publication.question_count)}
                      {ratingLabel ? ` · ${ratingLabel}` : ""}
                      {publication.orphaned ? " · ⚠ source supprimée" : ""}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {selectedKey === NEW_PACK_KEY || !selectedPublication ? (
        <PublishForm
          key={releaseBase?.pack_guid || "new"}
          auth={auth}
          basePublication={releaseBase}
          onCancelRelease={() => {
            setReleaseBase(null);
            setSelectedKey(releaseBase?.pack_guid || null);
          }}
          onPublished={handlePublished}
        />
      ) : (
        <PackDetail
          action={actionState[selectedPublication.pack_guid] || {}}
          onDelete={handleDelete}
          onOpenGroup={onOpenGroup}
          onPublish={handlePublish}
          onStartRelease={handleStartRelease}
          onUnpublish={handleUnpublish}
          publication={selectedPublication}
          setMode={setMode}
        />
      )}
    </div>
  );
}
