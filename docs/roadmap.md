## Current focus


## vérifier

## Urgent
- il reste un dossier qui s'appelle blueprint
- bouton synchroniser depuis le menu (push pull)
- quand on a modifié localement un groupe, proposer de reupdate le pack associé


## quick fixes

- faire en sorte que les interfaces des menus soient bien positionnées sur l'écran
- ajouter le timer final dans la recap d'entrainement de maps
- ajouter un chip reconnaissable pour le type image au dessus du titre dans la preview de groupe (et décaler les chips pour qu'elles hug le bord gauche)
- ajouter des raccourcis clavier pour les nouveaux modes
- mettre une petite loupe plutôt que le + pour la preview des images
- scroll automatique à enlever quand on quitte la preview d'une image de 
- mettre une ou deux stats dans les gros boutons de qualité des modes qcm
- pouvoir zoomer sur les images pour les questions isolées
- ne pas nécessairement reset les records après un edit (et s'interroger sur comment gérer les records sur les packs importés (leaderboard possible ?))
- ajouter bouton annuler dans les autres types
- il faudrait pouvoir naviguer les suggestions de tags avec les flèches du clavier
- bouton annuler dans le manage de groupes
- Le header de certaines questions est rempli et déborde

## bugs

- il faudrait charger la question suivante pendant qu'on répond à celle d'avant et pas avant
- type_all d'images : faire tab ça doit cycler et pas bloquer sur le dernier + bug quand je sélectionne une image il alterne entre les images au lieu des rangées

## to do when i have more time

- aller voir l'historique d'une seule question
- heatmap des zones les plus durs pour les maps
- trouver un meilleur agencement pour les aliases dans map preview
- supprimer une question appelle le rebalancing ?
- permettre d'accepter une réponse fausse si faute de frappe
- ajouter une barre de progression qui montre la maîtrise d'une question dans manage (et éventuellement un historique de la progression en fonction du temps)
- fine tune les difficultés des modes en fonction des prédictions des reviews en prenant type_all en ref
- qcm de maps : choisir des zones proches pour les réponses
- uniformiser le style partout
- augmenter la difficulté des qcm en proposant des réponses plus proches
- essayer de deviner la mode_difficulty (je sais pas comment ça s'appelle) d'un qcm en fonction des propals
- faire les modes en fonctions des gaps dans le calendrier ?
- faire un truc automatique pour importer les maps svg (data-code, les shapes pour les zones trop petites)
- un mode où je dois pointer sur une map le plus proche possible
- site de quiz en ligne relié
- ajouter type liste (ordonné et désordonné ? alphabet grec / albums d'asterix)
- créer de nouveaux modes timeline (et revoir la création ?)
- leaderboard des packs
- suivre des amis
- faire des packs publics/amis only/privés
- challenge des amis sur des packs
- quels sont les principes à respecter pour un rendu graphique idéal ? vérifie que c'est appliqué partout

## refactors

## ideas

- daily habit mechanics: streaks, reminders, rewards, but keep them separate from core review so they do not distort scheduling.
- faire un mode "challenge" où on a une question et on doit répondre le plus vite possible
- faire un mode "compétition" où on peut jouer contre d'autres personnes en temps réel
- ia pour proposer des qcm si on a pas la réponse (à la TLMVPSP)
- faire un executable
- faire une extension pour chrome pour facilement créer des questions à partir de n'importe quelle page web (ex : pour faire une question sur une ville, aller sur la page wikipedia de la ville et créer la question à partir de là en sélectionnant la zone de la carte) (avec de l'ia éventuellement pour suggérer la question et les réponses à partir du contenu de la page)
- quand on vient d'ajouter une question, ajouter un indicateur et on doit passer la souris sur la card dans la liste pour enlever l'indicateur (à la LoL)
- systeme de mmr
- différentes langues disponibles
- scraper le site de émilien
- indice dans l'entraînement (exemple: premières lettres, éliminer la moitié des zones restantes, ...)
- type liste ? (= juste énumérer)
- les questions ratées réapparaissent avec un mode différent (si disponible pour le type de question)
- un module pour entrainer à bien écrire les caractères spéciaux (dessiner et reconnaître les kanjis ou autre)
----> peut aussi servir pour dessiner des drapeaux, des symboles, des logos (soit self evaluation, soit reconnaissance par l'ia)
- organiser la section tags de training en arborescence conformément à l'arborescence des tags dans manage
- autoriser l'italique, le gras, le souligné + latex
- faire un truc cooperatif à la git pour les packs
- quand on change de preview dans manage, garder l'état en mémoire et attendre pour enregistrer ou annuler
- régler le problème que quand on importe un pack, on n'a pas forcément envie de tout travailler et pour l'instant le seul moyen c'est de supprimer des questions
- peut être avoir plein de templates de maps à disposition pour aider les gens à faire leurs custom svg
- faire des modes de jeu infinis et fun (mini jeux)
- si c'est la même map, permettre de combiner des trainings de deux trucs différents (pays + capitales du monde par exemple)
- un mode 1v1 (ou plus) sur un pack en particulier ou sur un pack aléatoire ou sur un pack aléatoire en commun ? sur un tirage aléatoire du pack (pour pas faire tout le pack)


## Conseils/idées issus de la littérature scientifique

- varier les contextes
- "cite les pays frontaliers de l'allemagne"
- indices (progressifs)
- mode free recall (?)
- objectif de rétention par thème : par exemple 85 %, 90 %, 95%
- bloquer un trop gros load de nouvelles questions
- autoriser réviser en avance
- afficher une prédiction sur la proba de s'en souvenir ajdhui
- mettre un statut sur les questions : new / learning / fragile / stable / mastered
- faire un mode différent pour les nouvelles questions ? apprentissage into quiz ?
- ajouter un input pour les questions textes puis créer automatiquement des cartes "différence entre X et Y" après avoir identifié des confusions récurrentes entre certains auteurs ou autre ("quel auteur est associé au naturalisme ?", "madame bovary vs germinal", "classe ces auteurs par mouvement littéraire")
- dans l'entraînement : mode "mes erreurs récentes", "différences proches"
- interleaving : mélanger intelligement les thèmes proches
- option pour questions timeline : "qui est antérieur : X ou Y ?"
- créer plusieurs chemins vers la même connaissance : date > événement / événement > date (i.e. générer automatiquement des cartes inverses).
associer les paires, retrouver à partir d'une image, trouver tous les éléments d'une catégorie
- accompagner un palais mental
- accompagner pour PAO (table de 00-99)
- pour chaque carte, faire un bouton : créer une image mentale absurde (mini-histoire, lien phonétique, lien spatial, image visuelle absurde)
- graphe de connaissances pour faire des questions synthèse, comparer, expliquer, match
- signaler les cartes trop longues
- éviter la charge cognitive ! signaler cartes trop longes, écran minimaliste
- feature transformer info brute en questions efficaces : import d'un texte > extraction automatique de faits > proposition de questions > détection des dates, lieux, personnes > génération de cartes "inverses"/"pourquoi"/"différence entre" > validation manuelle
- au lieu de faire directement les questions, le user écrit des connaissances qui font un knowledge graph qui permet de générer automatiquement les questions

## Product Suggestions

Add question history view from Manage: answer history, lapses, interval, next review, manual reschedule.
Add settings UI for scheduler targets, per-type daily weights, theme/display preferences, backup location, import behavior.
Improve content ingestion: CSV import/export UI, “import from URL”, local media copy, duplicate detection, and batch tag/collection editing.
Add map review mode variants: visible answer list, hidden answer list, strict JetPunk-style mode, small-zone emphasis.

## Long term improvements

Desktop hardening: automatic backups, restore flow, portable data location chooser, startup health checks.
AI-assisted authoring: generate draft questions, aliases, distractors, timeline entries, or map labels from selected text/URLs, but keep review data user-verifiable.
Optional sync later: only after local data/migrations/backups are strong. Sync will multiply edge cases.
