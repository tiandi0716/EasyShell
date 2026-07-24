import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

const platform = window.easyshell?.platform || 'darwin'
document.documentElement.dataset.platform = platform
document.body.classList.add(`platform-${platform}`)

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
