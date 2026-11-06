import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '@/shared/i18n'

const LABEL: Record<(typeof LANGUAGES)[number], string> = { 'pt-BR': 'PT', 'en-US': 'EN' }

export function LanguageSwitch() {
  const { i18n } = useTranslation()
  return (
    <div className="segmented" role="group" aria-label="Idioma / Language">
      {LANGUAGES.map((lng) => (
        <button key={lng} type="button" aria-pressed={i18n.language === lng} onClick={() => void i18n.changeLanguage(lng)}>
          {LABEL[lng]}
        </button>
      ))}
    </div>
  )
}
