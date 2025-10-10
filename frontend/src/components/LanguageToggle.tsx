import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTranslation } from "@/hooks/useTranslation";

const LanguageToggle = () => {
  const { toggleLanguage, language } = useLanguage();
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={toggleLanguage}
    >
      <Languages className="h-4 w-4 mr-2" />
      {language === 'en' ? t('arabic') : t('english')}
    </Button>
  );
};

export default LanguageToggle;
