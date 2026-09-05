import { Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface LoadingSpinnerProps {
  message?: string;
}

const LoadingSpinner = ({ message }: LoadingSpinnerProps) => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-primary mb-2">{message ?? t("loading")}</h2>
        <p className="text-muted-foreground">{t("pleaseWaitLoadingContent")}</p>
      </div>
    </div>
  );
};

export default LoadingSpinner;
