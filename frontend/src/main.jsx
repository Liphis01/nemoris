import { StrictMode, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const appModule = (
  import.meta.env.MODE === "mobile" ||
  import.meta.env.VITE_NEMORIS_MOBILE === "true"
)
  ? import("./mobile/MobileApp.jsx")
  : import("./App.jsx")

appModule.then(({ default: RootApp }) => {
  createRoot(document.getElementById('root')).render(
    createElement(StrictMode, null, createElement(RootApp)),
  )
})
