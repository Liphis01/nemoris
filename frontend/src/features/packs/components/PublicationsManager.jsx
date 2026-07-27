import { useCallback, useEffect, useState } from "react";
import { listGroups } from "../../../api/groups";
import { listCollections } from "../../../api/collections";
import { publishPack, publishPackDraft, listPackPublications, unpublishPack } from "../../../api/packs";
import { getQuestionTypeChipStyle } from "../../../shared/questionTypes";
import { usePackPublishAuth } from "../hooks/usePackPublishAuth";
import { useActionState } from "../hooks/useActionState";
import { formatRatingLabel, questionCountLabel, splitTerms } from "./packFormatting";
import PackReviewsSection from "./PackReviewsSection";
import PublishAuthPanel from "./PublishAuthPanel";

const NEW_PACK_KEY = "new";

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

// Two steps, not one shared pane: picking a source and filling in metadata
// are different tasks that both want the full width, and at a few hundred
// groups a picker sharing space with the form would either force endless
// scrolling or crowd the fields down to nothing. Step 1 browses/searches
// one group or playlist (never a mix -- a pack ships a whole group or a
// playlist's selection, which may itself span several groups and types);
// step 2 owns the pane to itself for the metadata fields.
function PublishForm({ auth, onPublished }) {
  const [step, setStep] = useState("select");
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [sourceKind, setSourceKind] = useState("group");
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("1");
  const [license, setLicense] = useState("");
  const [description, setDescription] = useState("");
  const [themesDraft, setThemesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState("");

  const publishingBusy = auth.busy || draftBusy;
  const publishError = draftError || auth.error;

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
  const versionNumber = Number(version);
  const publishPayload = {
    version: Math.floor(versionNumber),
    name: title.trim(),
    description: description.trim(),
    license: license.trim(),
    tags: splitTerms(tagsDraft),
    themes: splitTerms(themesDraft)
  };
  const canPublish = (
    selectedSource &&
    !publishingBusy &&
    title.trim() &&
    Number.isFinite(versionNumber) &&
    versionNumber >= 1 &&
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

  async function handlePublish() {
    if (!canPublish) {
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
    <section className="pack-export-panel app-scrollbar" aria-label="Nouveau pack">
      <div className="pack-section-head">
        <div>
          <h2>Nouveau pack</h2>
          <p>
            {sourceKind === "playlist"
              ? "Mettre une playlist dans le catalogue"
              : "Mettre un groupe dans le catalogue"}
          </p>
        </div>
      </div>

      <div className="pack-source-summary">
        <span>
          Source : <strong>{selectedSource?.name}</strong>
          {sourceTypeStyle ? ` · ${sourceTypeStyle.label}` : ""}
          {" · "}
          {questionCountLabel(selectedSource?.question_count)}
          {sourceKind === "playlist" ? " · playlist" : ""}
        </span>
        <button
          type="button"
          className="pack-inline-link"
          onClick={() => setStep("select")}
        >
          Changer
        </button>
      </div>

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

        <div className="pack-form-grid">
          <label className="pack-field">
            <span className="pack-field-label">Version</span>
            <input
              aria-label="Version du pack"
              type="number"
              min="1"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
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
        </div>

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
          <label className="pack-field">
            <span className="pack-field-label">Thèmes</span>
            <input
              aria-label="Thèmes du pack"
              type="text"
              placeholder="géographie, cartes"
              value={themesDraft}
              onChange={(event) => setThemesDraft(event.target.value)}
              disabled={publishingBusy}
            />
          </label>

          <label className="pack-field">
            <span className="pack-field-label">Tags</span>
            <input
              aria-label="Tags du pack"
              type="text"
              placeholder="pays, capitales"
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              disabled={publishingBusy}
            />
          </label>
        </div>

        <div className="pack-publish-actions">
          <button
            type="button"
            className="pack-primary-button"
            disabled={!canPublish}
            onClick={handlePublish}
          >
            {publishingBusy ? "Publication..." : "Publier"}
          </button>
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
function PackDetail({ action, onOpenGroup, onPublish, onUnpublish, publication, setMode }) {
  const ratingLabel = formatRatingLabel(publication.avg_rating, publication.rating_count);
  const canRepublish = (
    publication.publication_status === "draft" ||
    publication.publication_status === "archived"
  );

  return (
    <section className="pack-export-panel app-scrollbar" aria-label="Détail du pack">
      <div className="pack-section-head">
        <div>
          <h2>{publication.name}</h2>
          <p>v{publication.version} · {questionCountLabel(publication.question_count)}</p>
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
          <span>Version</span>
          <strong>v{publication.version}</strong>
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
          peux plus en publier de nouvelle version.
        </div>
      ) : publication.source?.name ? (
        <div className="pack-detail-meta">
          <span>
            Source :{" "}
            {publication.source.kind === "group" && onOpenGroup ? (
              <button
                type="button"
                className="pack-inline-link"
                onClick={() => onOpenGroup(publication.source.id)}
              >
                {publication.source.name}
              </button>
            ) : (
              <span>
                {publication.source.name}
                {publication.source.kind === "playlist" ? " (playlist)" : ""}
              </span>
            )}
          </span>
        </div>
      ) : null}

      <div className="pack-action-row">
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
      </div>

      {action.error && (
        <div className="pack-alert" role="alert">{action.error}</div>
      )}

      <PackReviewsSection entry={publication} setMode={setMode} />
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
  // Optimistic stand-in for a pack that was just published, shown until the
  // authoritative row for it shows up in `publications`. Without this, a
  // slow or stale refresh would strand the user on a blank "new pack" form
  // with no confirmation that anything happened.
  const [justPublished, setJustPublished] = useState(null);

  const loadPublications = useCallback(async () => {
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
      setPublications(next);
      setSelectedKey((previous) => (
        previous ?? (next.length > 0 ? next[0].pack_guid : NEW_PACK_KEY)
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

  function handlePublished(publication) {
    // Land on the pack you just published instead of leaving the form up --
    // seeing it appear in the dashboard is the confirmation, not a banner.
    // Show it immediately from the publish response; the background reload
    // below fills in rating/comment/source once the authoritative row
    // exists, without leaving the user staring at an empty form meanwhile.
    setJustPublished(publication);
    setSelectedKey(publication.pack_guid);
    loadPublications();
  }

  const selectedPublication = (
    publications.find((publication) => publication.pack_guid === selectedKey) ||
    (justPublished?.pack_guid === selectedKey ? justPublished : undefined)
  );

  return (
    <div className="pack-manage-layout">
      <section className="pack-panel app-scrollbar" aria-label="Mes packs">
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

        <button
          type="button"
          className={`pack-rail-new${selectedKey === NEW_PACK_KEY ? " is-active" : ""}`}
          onClick={() => setSelectedKey(NEW_PACK_KEY)}
        >
          + Nouveau pack
        </button>

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
                    v{publication.version} · {questionCountLabel(publication.question_count)}
                    {ratingLabel ? ` · ${ratingLabel}` : ""}
                    {publication.orphaned ? " · ⚠ source supprimée" : ""}
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedKey === NEW_PACK_KEY || !selectedPublication ? (
        <PublishForm auth={auth} onPublished={handlePublished} />
      ) : (
        <PackDetail
          action={actionState[selectedPublication.pack_guid] || {}}
          onOpenGroup={onOpenGroup}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
          publication={selectedPublication}
          setMode={setMode}
        />
      )}
    </div>
  );
}
