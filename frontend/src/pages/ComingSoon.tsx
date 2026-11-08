import { Construction } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/translations";

/** Stand-in for a page that has a sidebar link and a route but isn't built
 * yet (the accessory pages, until their work items replace it). Shows the
 * page's name and one line saying what it will do. */
const ComingSoon = ({ title, description }: { title: TranslationKey; description: TranslationKey }) => {
  const { t } = useTranslation();

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <h1 className="text-2xl font-bold mb-4">{t(title)}</h1>
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Construction className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("pageComingSoonTitle")}</h2>
            <p className="text-muted-foreground max-w-md">{t(description)}</p>
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default ComingSoon;
