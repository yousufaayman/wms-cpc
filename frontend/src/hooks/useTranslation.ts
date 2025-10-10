import { useLanguage } from '@/contexts/LanguageContext';
import { translations, TranslationKey } from '@/lib/translations';

export const useTranslation = () => {
  const { language } = useLanguage();
  
  const t = (key: TranslationKey, params?: Record<string, any>): string => {
    let translation = translations[language][key] || key;
    
    // Handle parameter interpolation
    if (params) {
      Object.keys(params).forEach(param => {
        const placeholder = `{{${param}}}`;
        translation = translation.replace(new RegExp(placeholder, 'g'), params[param]);
      });
    }
    
    return translation;
  };

  return { t, language };
};
