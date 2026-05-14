







chatgpt: Toujours dans le même style, améliore l'ui de la review pour que ce soit clair, propre, agréable à utiliser, et joli. Actuellement le code c'est ça :










# TODO


## couleurs pour les types des cards
background: "#145c46",
color: "#6ff0c2",

background: "#5a1d3d",
color: "#ff85c2",


## bugs
- bug des images
- recentrer les svg
- ouvrir le map editor depuis une question map le fait buguer
- les aliases ne fonctionnent pas bien (la sauvegarde)
- les ids des questions ne se recalculent pas après une suppression (attention à l'id de progress)
- créer un groupe fait une alerte moche
- le texte des cards est décalé vers la droite (à cause du MAP)
- vérifier que supprimer une question supprime aussi le progress associé

## features
- filtrer les groupes dans manage
- arborescence des thèmes pour pouvoir grouper les questions par thème (géographie > pays > capitales par exemple)
- questions type timeline (en groupe comme maps)
- ajouter un timer pour les questions
- auto accepter la réponse si c'est correct
- intégrer les questions maps à la review (chaque question indépendante)
- mode entrainement
- mode difficile (similaire à jetpunk : on ne voit pas les réponses possibles, pas le droit à l'erreur...)
- étaler les questions sur plusieurs jours au maximum (éviter d'avoir un jour à 0 puis un jour à 10 questions)
- dans manage, afficher toutes les stats d'une question
- ajouter une section "stats" pour voir les stats globales (nombre de questions, nombre de thèmes, etc...) et par thème (nombre de questions, progression, etc...)
- Afficher un calendrier pour voir les jours où on a joué et combien de questions on a fait chaque jour + futures questions

## refactors
- refactor général des styles redondants, etc...
- déplacer la gestion de progress pour les nouvelle questions directement dans create_question (backend)
- stocker uniquement l'id des groupes dans les questions

## ideas
- mettre une option de priorité sur les questions pour les faire apparaître plus souvent
- faire un mode "challenge" où on a une question et on doit répondre le plus vite possible
- faire un mode "compétition" où on peut jouer contre d'autres personnes en temps réel
- pouvoir manuellement modifier les dates des questions
  

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
