import ReturnToMenuButton from "../../../shared/ReturnToMenuButton";
import {
  AVATAR_COLOR_PRESETS,
  AVATAR_EMOJI_PRESETS,
  overallRetention,
  useProfile
} from "../hooks/useProfile";
import "./Profile.css";

function AvatarBadge({ emoji, color, size = "lg" }) {
  return (
    <span
      className={`profile-avatar profile-avatar-${size} profile-avatar-${color}`}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}

function ProfileHero({
  accountEmail,
  colorDraft,
  emojiDraft,
  loadError,
  loading,
  onOpenSettingsSection,
  setMode,
  signedIn,
  usernameDraft
}) {
  function openSignIn() {
    if (onOpenSettingsSection) {
      onOpenSettingsSection("settings-sync");
      return;
    }

    setMode("settings");
  }

  if (loading) {
    return (
      <section className="profile-hero">
        <AvatarBadge emoji="…" color="neutral" size="xl" />
        <div className="profile-hero-copy">
          <strong>Chargement…</strong>
        </div>
      </section>
    );
  }

  if (!signedIn) {
    return (
      <section className="profile-hero">
        <AvatarBadge emoji="?" color="neutral" size="xl" />
        <div className="profile-hero-copy">
          <strong>Non connecté</strong>
          <span className="profile-hero-caption">
            Connecte-toi pour choisir un pseudo et un avatar visibles dans les
            commentaires de packs.
          </span>
          {loadError && (
            <div role="alert" className="profile-alert">{loadError}</div>
          )}
        </div>
        <button type="button" className="profile-save profile-hero-action" onClick={openSignIn}>
          Se connecter
        </button>
      </section>
    );
  }

  return (
    <section className={`profile-hero profile-hero-${colorDraft}`}>
      <AvatarBadge emoji={emojiDraft} color={colorDraft} size="xl" />
      <div className="profile-hero-copy">
        <strong>{usernameDraft.trim() || "Pseudo à choisir"}</strong>
        <span className="profile-hero-caption">{accountEmail} · connecté</span>
        {loadError && (
          <div role="alert" className="profile-alert">{loadError}</div>
        )}
      </div>
    </section>
  );
}

function ProfileStatsPanel({ error, loading, stats }) {
  const counts = stats?.counts || {};
  const retention = overallRetention(stats?.retention_by_type);
  const tiles = [
    { label: "Questions", value: counts.total },
    { label: "À réviser", value: counts.due_total },
    { label: "Maîtrisées", value: counts.mastered },
    { label: "Rétention", value: retention != null ? `${retention}%` : null }
  ];

  return (
    <section className="profile-card profile-stats-panel" aria-label="Progression">
      <div className="profile-edit-divider">
        <span>Progression</span>
      </div>

      <div className="profile-stats-grid">
        {tiles.map((tile) => (
          <div className="profile-stat-tile" key={tile.label}>
            <strong>
              {loading ? "…" : (tile.value ?? "—")}
            </strong>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>

      {error && <div role="alert" className="profile-alert">{error}</div>}
    </section>
  );
}

function pickRecommendation(guidance) {
  if (!guidance) return null;

  const fragileLoad = guidance.fragile_upcoming_load_groups?.[0];

  if (fragileLoad) {
    const count = fragileLoad.fragile_count;

    return {
      text: `${count} question${count > 1 ? "s" : ""} fragile${count > 1 ? "s" : ""} dans « ${fragileLoad.name} » ${count > 1 ? "arrivent" : "arrive"} bientôt en révision : à consolider en priorité.`,
      scope: fragileLoad
    };
  }

  const weakest = guidance.weakest_groups?.[0];

  if (weakest) {
    return {
      text: `« ${weakest.name} » est le point le plus fragile en ce moment (${Math.round(weakest.fragile_ratio * 100)}% fragile).`,
      scope: weakest
    };
  }

  const closeToMastery = guidance.close_to_mastery_groups?.[0];

  if (closeToMastery) {
    return {
      text: `« ${closeToMastery.name} » est presque maîtrisé, encore un petit effort.`,
      scope: closeToMastery
    };
  }

  const improving = guidance.improving_groups?.[0];

  if (improving) {
    return {
      text: `« ${improving.name} » progresse (+${improving.delta} points de rétention).`,
      scope: improving
    };
  }

  return null;
}

function GroupGuidanceList({ emptyLabel, items, onOpenStudy, renderMeta }) {
  if (!items || items.length === 0) {
    return <p className="profile-guidance-empty">{emptyLabel}</p>;
  }

  return (
    <ul className="profile-guidance-list">
      {items.map((item) => (
        <li key={item.id} className="profile-guidance-row">
          <button
            type="button"
            className="profile-guidance-row-button"
            onClick={() => onOpenStudy?.({ type: "group", id: item.id, name: item.name })}
          >
            <span className="profile-guidance-row-name">{item.name}</span>
            <span className="profile-guidance-row-meta">{renderMeta(item)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProfileGuidancePanel({ error, guidance, loading, onOpenStudy }) {
  const recommendation = pickRecommendation(guidance);
  const runway = guidance?.new_material_runway;
  const retentionByTag = guidance?.retention_by_tag || [];

  return (
    <section className="profile-card profile-guidance-panel" aria-label="Guidage">
      <div className="profile-edit-divider">
        <span>Ce qu'il faut savoir</span>
      </div>

      {loading && <p className="profile-guidance-empty">Chargement…</p>}

      {!loading && recommendation && (
        <div className="profile-guidance-recommendation">
          <span className="profile-guidance-recommendation-label">Aujourd'hui</span>
          <p>{recommendation.text}</p>
          {onOpenStudy && recommendation.scope && (
            <button
              type="button"
              className="profile-guidance-cta"
              onClick={() => onOpenStudy({
                type: "group",
                id: recommendation.scope.id,
                name: recommendation.scope.name
              })}
            >
              Étudier ce groupe →
            </button>
          )}
        </div>
      )}

      {!loading && !recommendation && (
        <p className="profile-guidance-empty">
          Pas encore assez d'historique pour une recommandation. Continue à réviser.
        </p>
      )}

      <div className="profile-guidance-grid">
        <div className="profile-guidance-card">
          <h3>Groupes fragiles</h3>
          <GroupGuidanceList
            items={guidance?.weakest_groups}
            emptyLabel="Rien de fragile en ce moment."
            onOpenStudy={onOpenStudy}
            renderMeta={(item) => `${item.fragile_count}/${item.total} fragiles`}
          />
        </div>

        <div className="profile-guidance-card">
          <h3>En progression</h3>
          <GroupGuidanceList
            items={guidance?.improving_groups}
            emptyLabel="Pas assez de données récentes."
            onOpenStudy={onOpenStudy}
            renderMeta={(item) => `+${item.delta} pts (${item.previous_retention}% → ${item.recent_retention}%)`}
          />
        </div>

        <div className="profile-guidance-card">
          <h3>Proches de la maîtrise</h3>
          <GroupGuidanceList
            items={guidance?.close_to_mastery_groups}
            emptyLabel="Rien de proche pour l'instant."
            onOpenStudy={onOpenStudy}
            renderMeta={(item) => `${item.mastered}/${item.total} maîtrisées`}
          />
        </div>

        <div className="profile-guidance-card">
          <h3>Charge fragile à venir</h3>
          <GroupGuidanceList
            items={guidance?.fragile_upcoming_load_groups}
            emptyLabel="Aucune charge fragile à venir."
            onOpenStudy={onOpenStudy}
            renderMeta={(item) => `${item.fragile_count} fragiles · ${item.upcoming_load} dues bientôt`}
          />
        </div>
      </div>

      <div className="profile-guidance-grid profile-guidance-grid-secondary">
        <div className="profile-guidance-card">
          <h3>Nouveau contenu</h3>
          {runway ? (
            <div className="profile-guidance-runway">
              <div className="profile-guidance-runway-tile">
                <strong>{runway.unseen_total}</strong>
                <span>non vues</span>
              </div>
              <div className="profile-guidance-runway-tile">
                <strong>
                  {runway.days_remaining != null ? `${runway.days_remaining} j` : "—"}
                </strong>
                <span>d'avance au rythme actuel</span>
              </div>
            </div>
          ) : (
            <p className="profile-guidance-empty">Pas encore de données.</p>
          )}
        </div>

        <div className="profile-guidance-card">
          <h3>Rétention par thème</h3>
          {retentionByTag.length > 0 ? (
            <ul className="profile-guidance-list">
              {retentionByTag.map((tag) => (
                <li key={tag.tag} className="profile-guidance-tag-row">
                  <span>{tag.label}</span>
                  <span>{tag.retention}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="profile-guidance-empty">Pas encore assez de revues par thème.</p>
          )}
        </div>
      </div>

      {error && <div role="alert" className="profile-alert">{error}</div>}
    </section>
  );
}

function ProfileEditCard({ profile }) {
  const canSave = profile.usernameDraft.trim().length >= 3 && !profile.saving;

  return (
    <section className="profile-card profile-edit">
      <div className="profile-edit-divider">
        <span>Modifier le profil</span>
      </div>

      <label className="profile-field">
        <span className="profile-field-label">Pseudo</span>
        <input
          type="text"
          value={profile.usernameDraft}
          disabled={profile.saving}
          maxLength={20}
          placeholder="3 à 20 caractères"
          onChange={(event) => profile.setUsernameDraft(event.target.value)}
          className="profile-input"
        />
      </label>
      <p className="profile-help">
        Lettres, chiffres, underscores (_) ou tirets (-), 3 à 20 caractères.
      </p>

      <span className="profile-field-label">Avatar</span>
      <div className="profile-emoji-grid" role="group" aria-label="Choisir un avatar">
        {AVATAR_EMOJI_PRESETS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={emoji === profile.emojiDraft}
            aria-label={`Avatar ${emoji}`}
            className={`profile-emoji-button${emoji === profile.emojiDraft ? " is-selected" : ""}`}
            onClick={() => profile.setEmojiDraft(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      <span className="profile-field-label">Couleur</span>
      <div className="profile-color-row" role="group" aria-label="Choisir une couleur">
        {AVATAR_COLOR_PRESETS.map(({ value }) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === profile.colorDraft}
            aria-label={`Couleur ${value}`}
            className={`profile-color-swatch profile-color-swatch-${value}${value === profile.colorDraft ? " is-selected" : ""}`}
            onClick={() => profile.setColorDraft(value)}
          />
        ))}
      </div>

      <div className="profile-actions">
        <button
          type="button"
          className="profile-save"
          disabled={!canSave}
          onClick={profile.save}
        >
          {profile.saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {profile.saveStatus && (
        <div className="profile-status" role="status">{profile.saveStatus}</div>
      )}
      {profile.saveError && (
        <div role="alert" className="profile-alert">{profile.saveError}</div>
      )}
    </section>
  );
}

export default function Profile({ setMode, onOpenSettingsSection = null, onOpenStudy = null }) {
  const profile = useProfile();
  const showEditCard = !profile.loading && profile.signedIn;

  return (
    <div className="profile-screen">
      <div className="profile-shell">
        <header className="profile-header">
          <div className="profile-brand-row">
            <div className="profile-brand-mark" aria-hidden="true">☺</div>
            <div className="profile-title-block">
              <div className="profile-overline">Nemoris</div>
              <h1>Profil</h1>
              <p>Pseudo, avatar et résumé de ta progression.</p>
            </div>
          </div>

          <ReturnToMenuButton
            onClick={() => setMode("menu")}
            className="profile-back"
          />
        </header>

        <main className="profile-main app-scrollbar">
          <ProfileHero
            accountEmail={profile.accountEmail}
            colorDraft={profile.colorDraft}
            emojiDraft={profile.emojiDraft}
            loadError={profile.loadError}
            loading={profile.loading}
            onOpenSettingsSection={onOpenSettingsSection}
            setMode={setMode}
            signedIn={profile.signedIn}
            usernameDraft={profile.usernameDraft}
          />

          <div className={`profile-body-grid${showEditCard ? "" : " profile-body-grid-solo"}`}>
            {showEditCard && <ProfileEditCard profile={profile} />}

            <ProfileStatsPanel
              error={profile.statsError}
              loading={profile.statsLoading}
              stats={profile.stats}
            />
          </div>

          <ProfileGuidancePanel
            error={profile.statsError}
            guidance={profile.stats?.guidance}
            loading={profile.statsLoading}
            onOpenStudy={onOpenStudy}
          />
        </main>
      </div>
    </div>
  );
}
