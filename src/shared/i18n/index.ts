import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { enUS } from './locales/en-US'
import { ptBR } from './locales/pt-BR'

export const LANGUAGES = ['pt-BR', 'en-US'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'solar-twin:lang'

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (LANGUAGES as readonly string[]).includes(saved)) return saved as Language
  } catch {
    /* sem storage */
  }
  return navigator.language?.toLowerCase().startsWith('en') ? 'en-US' : 'pt-BR'
}

void i18n.use(initReactI18next).init({
  resources: { 'pt-BR': { translation: ptBR }, 'en-US': { translation: enUS } },
  lng: initialLanguage(),
  fallbackLng: 'pt-BR',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* sem storage */
  }
})

export { i18n }
