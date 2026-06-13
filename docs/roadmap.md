# TODO

## vérifier

- j'ai l'impression que l'ordre des items de group en training met d'abord les questions ratées puis aléatoire
- si le groupe est modifié il faut reset le record dans entraînement

- setup github pour tout automatiser
- uniformiser le style partout
- vérifier quelle version de fsrs j'ai (peut etre pas la dernière car dans create_initial_progress j'initialise les stability et difficulty à 1.0 et 5.0 au lieu de faire en fonction de la première réponse)
- que signifie 304 Not Modified ? seulement certaines images l'ont

## Product Suggestions

Add question history view from Manage: answer history, lapses, interval, next review, manual reschedule.
Add settings UI for scheduler targets, per-type daily weights, theme/display preferences, backup location, import behavior.
Improve content ingestion: CSV import/export UI, “import from URL”, local media copy, duplicate detection, and batch tag/collection editing.
Add map review mode variants: visible answer list, hidden answer list, strict JetPunk-style mode, small-zone emphasis.

## Long term improvements

Desktop hardening: automatic backups, restore flow, portable data location chooser, startup health checks.
AI-assisted authoring: generate draft questions, aliases, distractors, timeline entries, or map labels from selected text/URLs, but keep review data user-verifiable.
Optional sync later: only after local data/migrations/backups are strong. Sync will multiply edge cases.

## Urgent
- 

## quick fixes

- ajouter le timer final dans la recap d'entrainement de maps
- ajouter un chip reconnaissable pour le type image au dessus du titre dans la preview de groupe (et décaler les chips pour qu'elles hug le bord gauche)
- enlever le type modifiable dans les questions maps (remplacer par quel mode de jetpunk on veut)
- faire un bouton toggle pour l'era dans la preview
- ajouter bouton annuler dans les autres types
- tab pour skip dans nommer
- augmenter la difficulté des qcm en proposant des réponses plus proches
- essayer de deviner la mode_difficulty (je sais pas comment ça s'appelle) d'un qcm en fonction des propals
- limiter le nombre d'images pour le mode "cliquer image" sinon horrible de chercher

## bugs

- je fais ma série du jour donc par effet de cascade, les questions remontent à cause du rebalancing et je me retrouve avec des questions en plus à faire quand je relance l'application
- recentrer les svg
- le texte des cards est décalé vers la droite (à cause du MAP)
- empêcher la map de faire des minizooms quand j'ajoute un tag ou que je fais apparaître les inputs en bas
- l'autozoom dans recap devrait considérer la taille de la zone pour adapter le zoom
- timeline sépare les zones en deux couleurs (il suffit de décaler d'une demi zone)
- quand je suis en cours de review et que le jour suivant commence ça rebalance pas correctement je crois

## features

- arborescence des thèmes pour pouvoir grouper les questions par tags (usa toujours inclus dans amérique et monde par exemple)
- mettre les différents modes de jetpunk pour les maps et alterner selon les jours (commencer par le mode facile, puis alterner les modes et identifier les mode compliqués pour chaque question pour les faire réapparaître plus souvent)
- mettre en évidence les zones trop petites (c.f. jetpunk)
- le nombre de questions par jour devrait dépendre du type parce que les questions map sont plus rapides et les timeline très longues
- agrandir un peu le recap ?
- aller voir l'historique d'une seule question
- heatmap des zones les plus durs pour les maps
- bloquer les questions nouvelles tant qu'on décide pas de les mettre dans la review (genre brouillon)
- un mode pour renforcer les points faibles
- importer/exporter db
- ajouter une recherche dans calendar
- trouver un meilleur agencement pour les aliases dans map preview
- mettre des groupes en favoris pour les faire réapparaître plus souvent (qui se met sur toutes les questions du groupe)
- pouvoir choisir quels questions bonus faire (et sélectionner une sous partie d'un groupe notamment)
- supprimer une question appelle le rebalancing ?
- permettre d'accepter une réponse fausse si faute de frappe
- aller chercher dans les questions à tags similaires pour proposer un qcm ?
- ajouter une barre de progression qui montre la maîtrise d'une question dans manage (et éventuellement un historique de la progression en fonction du temps)
- fine tune les difficultés des modes en fonction des prédictions des reviews en prenant type_all en ref
- qcm de maps : choisir des zones proches pour les réponses
- créer un groupe avec les formes de maps à partir de world.svg
- faire en sorte que les reviews n'aient pas besoin de scroll la page pour répondre

## refactors

- refactor général des styles redondants, des noms, des fichiers inutiles, mal placés, etc...
- stocker uniquement l'id des groupes dans les questions pour alléger

## ideas

- daily habit mechanics: streaks, reminders, rewards, but keep them separate from core review so they do not distort scheduling.
- permettre de convertir un svg en groupe d'images (pour les shapes de pays)
- mettre une option de favoris et de difficile sur les questions (pour les voir plus souvent et aider le scheduler)
- faire un mode "challenge" où on a une question et on doit répondre le plus vite possible
- faire un mode "compétition" où on peut jouer contre d'autres personnes en temps réel
- pouvoir manuellement modifier les dates des questions
- ia pour proposer des qcm si on a pas la réponse (à la TLMVPSP)
- faire un executable
- faire une extension pour chrome pour facilement créer des questions à partir de n'importe quelle page web (ex : pour faire une question sur une ville, aller sur la page wikipedia de la ville et créer la question à partir de là en sélectionnant la zone de la carte) (avec de l'ia éventuellement pour suggérer la question et les réponses à partir du contenu de la page)
- faire un mode "berserk" où on peut choisir dans la review d'ajouter un chrono pour essayer de battre son record de temps
- quand on vient d'ajouter une question, ajouter un indicateur et on doit passer la souris sur la card dans la liste pour enlever l'indicateur (à la LoL)
- faire un menu settings
- systeme de mmr
- différentes langues disponibles
- scraper le site de émilien
- indice dans l'entraînement (exemple: premières lettres, éliminer la moitié des zones restantes, ...)
- type liste ? (= juste énumérer)
- les questions ratées réapparaissent avec un mode différent (si disponible pour le type de question)

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
