# TODO

## vérifier
- premier clique pour les intervalles timeline : date de début

## quick fixes
- montrer un équivalent de recap quand je regarde un groupe fait dans le passé dans le calendrier
- faire un bouton toggle pour l'era dans la preview
- pouvoir trier les réponses dans le recap de map
- ajouter une recherche dans calender
- mettre des tags sur les groupes les propage aux questions
- ajouter un timer pour les questions
- enlever le type modifiable dans les questions maps

## bugs
- bug des images + trouver comment afficher l'image dans les cards de manage
- recentrer les svg
- les ids des questions ne se recalculent pas après une suppression (attention à l'id de progress)
- le texte des cards est décalé vers la droite (à cause du MAP)
- empêcher la map de faire des minizooms quand j'ajoute un tag ou que je fais apparaître les inputs en bas
- l'autozoom dans recap devrait considérer la taille de la zone pour adapter le zoom

## features
- arborescence des thèmes pour pouvoir grouper les questions par tags (usa toujours inclus dans amérique et monde par exemple)
- mode entrainement
- mode difficile (similaire à jetpunk : on ne voit pas les réponses possibles, pas le droit à l'erreur...)
- dans manage, afficher toutes les stats d'une question
- ajouter une section "stats" pour voir les stats globales (nombre de questions, nombre de thèmes, etc...) et par thème (nombre de questions, progression, etc...)
- mettre les différents modes de jetpunk pour les maps et alterner selon les jours
- dans le recap, afficher toutes les stats intéressantes des questions pour voir les progrès
- mettre en évidence les zones trop petites (c.f. jetpunk)
- mettre un truc addictif de day streaks
- scraper le site de émilien
- faire des propositions existantes pour le média et pous les tags
- le nombre de questions par jour devrait dépendre du type parce que les questions map sont plus rapides et les timeline très longues
- agrandir un peu le recap ?
- aller voir l'historique d'une seule question

## refactors
- refactor général des styles redondants, des noms, des fichiers inutiles, mal placés, etc...
- stocker uniquement l'id des groupes dans les questions pour alléger

## ideas
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

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
