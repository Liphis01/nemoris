# TODO

- setup github pour tout automatiser

## Product Suggestions
Add training mode separate from scheduled review: browse a collection/tag/map/timeline without affecting progress unless explicitly chosen.
Add question history view from Manage: answer history, lapses, interval, next review, manual reschedule.
Add settings UI for scheduler targets, per-type daily weights, theme/display preferences, backup location, import behavior.
Improve content ingestion: CSV import/export UI, “import from URL”, local media copy, duplicate detection, and batch tag/collection editing.
Add map review mode variants: visible answer list, hidden answer list, strict JetPunk-style mode, small-zone emphasis.

## Long term improvements
Knowledge graph / tag hierarchy: tags like USA belonging to Amérique and Monde, with inherited filtering and stats.
Per-type scheduling policy: maps are fast, timelines are slower; daily load should account for estimated effort, not just item count.
Desktop hardening: automatic backups, restore flow, portable data location chooser, startup health checks.
AI-assisted authoring: generate draft questions, aliases, distractors, timeline entries, or map labels from selected text/URLs, but keep review data user-verifiable.
Challenge modes: timed runs, streaks, personal records, “hard mode”, but keep them separate from normal FSRS progress so they do not distort memory scheduling.
Optional sync later: only after local data/migrations/backups are strong. Sync will multiply edge cases.

## vérifier


## quick fixes
- ajouter un chip reconnaissable pour le type image au dessus du titre dans la preview de groupe
- enlever le type modifiable dans les questions maps (remplacer par quel mode de jetpunk on veut)
- faire un bouton toggle pour l'era dans la preview
- enlever l'id des questions dans les cards de manage (pour laisser la place au bouton fav)
- bloquer le bouton annuler dans manage si on n'a pas fait de changement (peut être changer le rouge parce que trop agressif pour un simple annuler)
- dans recap, cliquer sur une zone ne doit pas zoomer dessus

## bugs
- recentrer les svg
- le texte des cards est décalé vers la droite (à cause du MAP)
- empêcher la map de faire des minizooms quand j'ajoute un tag ou que je fais apparaître les inputs en bas
- l'autozoom dans recap devrait considérer la taille de la zone pour adapter le zoom
- timeline sépare les zones en deux (il suffit de décaler d'une demi zone)

## features
- mettre un truc addictif de day streaks
- arborescence des thèmes pour pouvoir grouper les questions par tags (usa toujours inclus dans amérique et monde par exemple)
- mode entrainement
- mode difficile (similaire à jetpunk : on ne voit pas les réponses possibles, pas le droit à l'erreur...)
- dans manage, afficher toutes les stats d'une question
- ajouter une section "stats" pour voir les stats globales (nombre de questions, nombre de thèmes, etc...) et par thème (nombre de questions, progression, etc...)
- mettre les différents modes de jetpunk pour les maps et alterner selon les jours
- mettre en évidence les zones trop petites (c.f. jetpunk)
- scraper le site de émilien
- le nombre de questions par jour devrait dépendre du type parce que les questions map sont plus rapides et les timeline très longues
- agrandir un peu le recap ?
- aller voir l'historique d'une seule question
- heatmap des questions les plus durs pour les maps
- bloquer les questions nouvelles tant qu'on décide pas de les mettre dans la review (genre brouillon)
- un mode pour renforcer les points faibles
- importer/exporter db
- ajouter une recherche dans calendar
- ajouter un timer pour les questions
- trouver un meilleur agencement pour les aliases dans map preview

## refactors
- refactor général des styles redondants, des noms, des fichiers inutiles, mal placés, etc...
- stocker uniquement l'id des groupes dans les questions pour alléger

## ideas
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
