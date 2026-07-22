import { useSyncAccount } from "./useSyncAccount";

function SyncServerFields({ sync }) {
  return (
    <div className="settings-inline-fields">
      <label className="settings-field">
        <span className="settings-label">Serveur de sync</span>
        <input
          aria-label="Serveur de sync"
          type="text"
          value={sync.serverDraft}
          disabled={sync.busy}
          onChange={(event) => sync.setServerDraft(event.target.value)}
          onBlur={sync.saveServer}
          onKeyDown={(event) => {
            if (event.key === "Enter") sync.saveServer();
          }}
          className="settings-input settings-input-wide"
        />
      </label>

      <label className="settings-field">
        <span className="settings-label">Clé publique (Supabase)</span>
        <input
          aria-label="Clé publique (Supabase)"
          type="text"
          value={sync.keyDraft}
          disabled={sync.busy}
          placeholder="sb_publishable_... (vide pour serveur perso)"
          onChange={(event) => sync.setKeyDraft(event.target.value)}
          onBlur={sync.saveServer}
          onKeyDown={(event) => {
            if (event.key === "Enter") sync.saveServer();
          }}
          className="settings-input settings-input-wide"
        />
      </label>
    </div>
  );
}

function SyncAccountSectionFromHook() {
  const sync = useSyncAccount();

  return <SyncAccountSectionView sync={sync} />;
}

function SyncAccountSectionView({ sync }) {
  const serverVersion = sync.serverVersion;

  return (
    <section className="settings-group settings-group-sync" id="settings-sync">
      <div className="settings-group-head">
        <span
          className="settings-section-icon settings-section-icon-blue"
          aria-hidden="true"
        >
          ⇄
        </span>

        <div>
          <h2>Synchronisation</h2>
          <p>Compte, cloud et serveur</p>
        </div>

        <span
          className={`settings-badge ${
            sync.signedIn ? "settings-badge-success" : ""
          }`}
        >
          {sync.signedIn ? "Connecté" : "Non connecté"}
        </span>
      </div>

      <div className="settings-group-content">
        {sync.signedIn ? (
          <>
            <div className="settings-row settings-row-priority">
              <div className="settings-row-copy">
                <strong>
                  Connecté en tant que {sync.status.account_email}
                </strong>
                <span>
                  Dernière version synchronisée : v
                  {sync.status.last_server_version}
                  {serverVersion ? ` · cloud : v${serverVersion}` : ""}
                </span>
              </div>

              <div className="settings-actions settings-row-actions">
                <button
                  type="button"
                  aria-label="Envoyer vers le cloud"
                  title="Envoyer vers le cloud"
                  onClick={() => sync.doPush(false)}
                  disabled={sync.busy}
                  className="settings-save"
                >
                  {sync.busy ? "..." : "Envoyer"}
                </button>

                <button
                  type="button"
                  onClick={sync.doPull}
                  disabled={sync.busy}
                  className="settings-secondary"
                >
                  Télécharger
                </button>
              </div>
            </div>

            {sync.conflict != null && (
              <div role="alert" className="settings-alert">
                La copie cloud est plus récente (v{sync.conflict}).
                Téléchargez-la (écrase cet appareil) ou envoyez quand même
                (écrase le cloud).
                <div className="settings-actions settings-alert-actions">
                  <button
                    type="button"
                    onClick={sync.doPull}
                    disabled={sync.busy}
                    className="settings-secondary"
                  >
                    Télécharger
                  </button>

                  <button
                    type="button"
                    onClick={() => sync.doPush(true)}
                    disabled={sync.busy}
                    className="settings-secondary"
                  >
                    Envoyer quand même
                  </button>
                </div>
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Serveur de sync</strong>
                <span>Configuration utilisée pour ce compte.</span>
              </div>

              <SyncServerFields sync={sync} />
            </div>

            <div className="settings-danger-zone">
              <p>
                Les données cloud sont une copie de tes questions, ta
                progression et tes médias. Elles ne sont pas partagées avec
                d'autres comptes.
              </p>

              <div className="settings-actions">
                <button
                  type="button"
                  onClick={sync.signOut}
                  disabled={sync.busy}
                  className="settings-secondary"
                >
                  Se déconnecter
                </button>

                <button
                  type="button"
                  onClick={sync.deleteCloudData}
                  disabled={sync.busy}
                  className="settings-danger"
                >
                  Supprimer mes données cloud
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Connexion</strong>
                <span>Connecte ce poste pour envoyer ou télécharger le cloud.</span>
              </div>

              {sync.step === "email" ? (
                <div className="settings-auth-row">
                  <input
                    aria-label="E-mail du compte"
                    type="email"
                    value={sync.email}
                    disabled={sync.busy}
                    placeholder="vous@exemple.com"
                    onChange={(event) => sync.setEmail(event.target.value)}
                    className="settings-input settings-input-wide"
                  />

                  <button
                    type="button"
                    onClick={sync.sendCode}
                    disabled={sync.busy || !sync.email.trim()}
                    className="settings-save"
                  >
                    {sync.busy ? "..." : "Recevoir un code"}
                  </button>
                </div>
              ) : (
                <div className="settings-auth-row">
                  <input
                    aria-label="Code de connexion"
                    type="text"
                    value={sync.code}
                    disabled={sync.busy}
                    onChange={(event) => sync.setCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sync.signIn();
                    }}
                    className="settings-input settings-input-wide"
                  />

                  <button
                    type="button"
                    onClick={sync.signIn}
                    disabled={sync.busy || !sync.code.trim()}
                    className="settings-save"
                  >
                    {sync.busy ? "..." : "Se connecter"}
                  </button>
                </div>
              )}
            </div>

            {sync.step === "code" && (
              <p className="settings-help settings-help-compact">
                {sync.devCode
                  ? `Code (dev) : ${sync.devCode}`
                  : "Colle le code à 6 chiffres reçu par e-mail, ou l'adresse du lien reçu par e-mail."}
              </p>
            )}

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Serveur de sync</strong>
                <span>Serveur local ou projet Supabase.</span>
              </div>

              <SyncServerFields sync={sync} />
            </div>
          </>
        )}

        {sync.message && (
          <div className="settings-status" role="status">
            {sync.message}
          </div>
        )}

        {sync.error && (
          <div role="alert" className="settings-alert">
            {sync.error}
          </div>
        )}
      </div>
    </section>
  );
}

export default function SyncAccountSection({ sync }) {
  if (!sync) {
    return <SyncAccountSectionFromHook />;
  }

  return <SyncAccountSectionView sync={sync} />;
}
