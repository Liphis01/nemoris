# TODO


## couleurs pour les types des cards
background: "#145c46",
color: "#6ff0c2",

background: "#5a1d3d",
color: "#ff85c2",


## bugs
- bug des images + trouver comment afficher l'image dans les cards de manage
- recentrer les svg
- les ids des questions ne se recalculent pas après une suppression (attention à l'id de progress)
- créer un groupe fait une alerte moche
- le texte des cards est décalé vers la droite (à cause du MAP)
- vérifier que supprimer une question supprime aussi le progress associé
- vérifier que supprimer un groupe supprime aussi les questions associées
- les intervalles affichés sur les cards sont douteux (ou les dates)
- quand on modifie le nom d'une zone ça ajoute une question au lieu de modifier celle existante (fixed ?)
- bouton "ajouter" des tags n'est pas aligné avec le champ de texte
- on peut ajouter des tags vides ("")
- à la fin de review on doit boucler sur les questions ratées (donc le schedule doit mettre 0 jours de délai pour les questions ratées)
- quand on créé une question texte, il faudrait afficher la preview de la question après la création au lieu de rester sur la page de création (et quand on supprime la question il faut fermer la preview au lieu de revenir sur la création de question)
- empêcher la map de faire des minizooms quand j'ajoute un tag ou que je fais apparaître les inputs en bas

## features
- filtrer les groupes dans manage
- quand on essaye de créer une question map, ça met sur la création de groupe de map à la place
- arborescence des thèmes pour pouvoir grouper les questions par thème (géographie > pays > capitales par exemple)
- questions type timeline (en groupe comme maps)
- ajouter un timer pour les questions
- auto accepter la réponse si c'est correct
- mode entrainement
- mode difficile (similaire à jetpunk : on ne voit pas les réponses possibles, pas le droit à l'erreur...)
- étaler les questions sur plusieurs jours au maximum (éviter d'avoir un jour à 0 puis un jour à 10 questions)
- dans manage, afficher toutes les stats d'une question
- ajouter une section "stats" pour voir les stats globales (nombre de questions, nombre de thèmes, etc...) et par thème (nombre de questions, progression, etc...)
- trier les questions dans manage par thème, par groupe, par progression, etc...
- mettre les différents modes de jetpunk pour les maps
- en review : les plus durs d'abord
- dans le recap, afficher toutes les stats intéressantes des questions pour voir les progrès
- dans le recap, cliquer sur une question fait un zoom sur la zone et inversement
- mettre des tags sur les groupes les propage aux questions
- mettre en évidence les zones trop petites (c.f. jetpunk) (+ dans la review, ajouter un bouton qui zoom sur les zones restantes l'une après l'autre)
- hiérarchiser les questions dans manage (on rassemble celles de même groupe avec un truc pour les écraser et les faire réapparaître (le zoom automatique doit savoir gérer ça))
- ajouter une recherche dans calender
- eventuellement afficher les jours passés dans le calendrier pour voir les questions déjà révisées
- feedback visuel quand on créé ou update une question (et enlever l'alerte moche de création de groupe)
- proposer les fichiers .svg quand on commence à taper le nom d'une map dans la création de question map
- pouvoir sort les questions dans manage
- mettre un truc addictif de day streaks

## refactors
- refactor général des styles redondants, des noms, des fichiers inutiles, mal placés, etc...
- stocker uniquement l'id des groupes dans les questions pour alléger

## ideas
- mettre une option de priorité sur les questions pour les faire apparaître plus souvent / favoris
- faire un mode "challenge" où on a une question et on doit répondre le plus vite possible
- faire un mode "compétition" où on peut jouer contre d'autres personnes en temps réel
- pouvoir manuellement modifier les dates des questions
- ia pour proposer des qcm si on a pas la réponse (à la TLMVPSP)
- faire un executable
- faire une extension pour chrome pour facilement créer des questions à partir de n'importe quelle page web (ex : pour faire une question sur une ville, aller sur la page wikipedia de la ville et créer la question à partir de là en sélectionnant la zone de la carte) (avec de l'ia éventuellement pour suggérer la question et les réponses à partir du contenu de la page)
  

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
