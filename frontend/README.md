# TODO

## bugs
- bug des images
- le scroll de manage devrait se faire sur les questions et pas sur le début de la page
- bug des ??? quand on clique sur la liste de droite
- recentrer les svg

## features
- arborescence des thèmes pour pouvoir grouper les questions par thème (géographie > pays > capitales par exemple)
- améliorer le design de manage (bouton pour modifier maps, plus lisible, etc)
- questions avec tag date : frise temporelle et on fait toutes les questions date du jour en même temps sur la même frise
- ajouter un timer pour les questions
- auto accepter la réponse si c'est correct
- intégrer les questions maps à la review (chaque question indépendante)
- mode entrainement

## refactors
- il faudrait que chaque pays soit sa propre question dans la db plutôt que une seule question ait plein de pays


# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
