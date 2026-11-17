/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import ur from '../i18n/ur'

// Screen language: English or Urdu. A per-device preference (like the theme),
// stored in localStorage. The layout stays left-to-right; Urdu labels render
// right-to-left inside their own element (lang="ur", dir="auto") and use an
// Urdu (Nastaliq) font where the device has one. Numbers stay in 0-9 digits.

const LANG_KEY = 'edgex_ui_lang'
const DICTS = { ur }

const readLang = () => { try { return localStorage.getItem(LANG_KEY) === 'ur' ? 'ur' : 'en' } catch { return 'en' } }

const LanguageContext = createContext({ lang: 'en', setLang: () => {}, t: (s) => s })

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readLang)

  useEffect(() => {
    document.documentElement.setAttribute('data-lang', lang)
  }, [lang])

  const setLang = useCallback((next) => {
    const v = next === 'ur' ? 'ur' : 'en'
    setLangState(v)
    try { localStorage.setItem(LANG_KEY, v) } catch { /* storage unavailable */ }
  }, [])

  // t('English text') → translated text (or the English text when there is none)
  const t = useCallback((text) => (lang !== 'en' && DICTS[lang]?.[text]) || text, [lang])

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
}

export const useLang = () => useContext(LanguageContext)
