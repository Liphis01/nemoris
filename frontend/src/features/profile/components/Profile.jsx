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

export default function Profile({ setMode, onOpenSettingsSection = null }) {
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
        </main>
      </div>
    </div>
  );
}
