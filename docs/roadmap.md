## vérifier
- l'ordre aléatoire des images est louche : quand je quitte la review pour revenir dedans j'ai le même ordre
- question timeline ratée à un jour près mais "dur" ?? -> corriger et laisser la possibilité de modifier la qualité
- si peu d'éléments, type_all et type_prompt doit être presque la même difficulté

## Urgent
- revoir le mode timeline (mettre une timeline globale pour l'année et deux pour mois et jour)
- ajouter type liste (ordonné et désordonné ? alphabet grec / albums d'asterix)
- ne pas nécessairement reset les records après un edit
- intercepter le bouton retour arrière pour revenir au menu d'avant (et inversement)
- do you have any suggestion to improve my setup/workflow as a developper in this project? (ex: faster way to run, test new features, etc.)
- bug: après avoir créé les signes du zodiaque, j'ai fait le mode associer et le score a été appliqué aux deux modes (type_all et associer)

## quick fixes

- ajouter le timer final dans la recap d'entrainement de maps
- le timer continue quand on regarde les réponses
- ajouter un chip reconnaissable pour le type image au dessus du titre dans la preview de groupe (et décaler les chips pour qu'elles hug le bord gauche)
- faire un bouton toggle pour l'era dans la preview
- ajouter bouton annuler dans les autres types
- tab pour skip dans nommer
- ajouter des raccourcis clavier pour les nouveaux modes
- mettre une petite loupe plutôt que le + pour la preview des images
- le recap d'images est légèrement moins propre que maps
- scroll automatique à enlever quand on quitte la preview d'une image de 

## bugs

- recentrer les svg
- empêcher la map de faire des minizooms quand j'ajoute un tag ou que je fais apparaître les inputs en bas
- timeline sépare les zones en deux couleurs (il suffit de décaler d'une demi zone)
- il faudrait charger la question suivante pendant qu'on répond à celle d'avant et pas avant
- les tags marchent pas bien
- parfois on peut scroll la page alors qu'il n'y a rien en dessous

## to do when i have more time

- aller voir l'historique d'une seule question
- heatmap des zones les plus durs pour les maps
- trouver un meilleur agencement pour les aliases dans map preview
- mettre des groupes en favoris pour les faire réapparaître plus souvent (qui se met sur toutes les questions du groupe)
- supprimer une question appelle le rebalancing ?
- permettre d'accepter une réponse fausse si faute de frappe
- ajouter une barre de progression qui montre la maîtrise d'une question dans manage (et éventuellement un historique de la progression en fonction du temps)
- fine tune les difficultés des modes en fonction des prédictions des reviews en prenant type_all en ref
- qcm de maps : choisir des zones proches pour les réponses
- uniformiser le style partout
- augmenter la difficulté des qcm en proposant des réponses plus proches
- essayer de deviner la mode_difficulty (je sais pas comment ça s'appelle) d'un qcm en fonction des propals
- make the network of tags lively by moving them around very slightly
- faire les modes en fonctions des gaps dans le calendrier ?
- faire un truc automatique pour importer les maps svg (data-code, les shapes pour les zones trop petites)

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