import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageToggle from "@/components/LanguageToggle";

const Index = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();

  return (
    <div className={`flex min-h-screen items-center justify-center bg-background ltr`}>
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">{t('welcomeToApp')}</h1>
        <p className="text-xl text-muted-foreground">{t('startBuilding')}</p>
      </div>
    </div>
  );
};

export default Index;