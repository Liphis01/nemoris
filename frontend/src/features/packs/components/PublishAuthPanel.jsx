export default function PublishAuthPanel({
  authStep,
  busy,
  code,
  email,
  publishStatus,
  setCode,
  setEmail,
  setMode,
  setAuthStep,
  onRequestCode,
  onSignOut,
  onVerify
}) {
  if (!publishStatus) {
    return (
      <div className="pack-publish-auth">
        <div>
          <strong>Connexion au catalogue</strong>
          <span>Vérification de la session Supabase.</span>
        </div>
      </div>
    );
  }

  if (!publishStatus?.configured) {
    return (
      <div className="pack-publish-auth">
        <div>
          <strong>Catalogue non configuré</strong>
          <span>Ajoute l'URL du projet et la clé publishable.</span>
        </div>
        <button
          type="button"
          className="pack-secondary-button"
          onClick={() => setMode("settings")}
        >
          Paramètres
        </button>
      </div>
    );
  }

  if (publishStatus?.signed_in) {
    const usingSyncAccount = publishStatus.auth_source === "sync";

    return (
      <div className="pack-publish-auth is-signed-in">
        <div>
          <strong>
            {usingSyncAccount ? "Connecté via Synchronisation" : "Connecté"}
          </strong>
          <span>{publishStatus.account_email}</span>
        </div>
        <button
          type="button"
          className="pack-secondary-button"
          disabled={busy}
          onClick={usingSyncAccount ? () => setMode("settings") : onSignOut}
        >
          {usingSyncAccount ? "Réglages" : "Se déconnecter"}
        </button>
      </div>
    );
  }

  return (
    <div className="pack-publish-auth">
      <div>
        <strong>Connexion Supabase</strong>
        <span>Requise pour créer un brouillon privé.</span>
      </div>

      {authStep === "email" ? (
        <div className="pack-publish-auth-row">
          <input
            aria-label="E-mail de publication"
            type="email"
            value={email}
            disabled={busy}
            placeholder="vous@exemple.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="button"
            className="pack-primary-button"
            disabled={busy || !email.trim()}
            onClick={onRequestCode}
          >
            Recevoir un code
          </button>
        </div>
      ) : (
        <div className="pack-publish-auth-row">
          <input
            aria-label="Code de publication"
            type="text"
            value={code}
            disabled={busy}
            placeholder="Code ou lien e-mail"
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onVerify();
            }}
          />
          <button
            type="button"
            className="pack-primary-button"
            disabled={busy || !code.trim()}
            onClick={onVerify}
          >
            Se connecter
          </button>
          <button
            type="button"
            className="pack-secondary-button"
            disabled={busy}
            onClick={() => setAuthStep("email")}
          >
            Modifier l'e-mail
          </button>
        </div>
      )}
    </div>
  );
}
