import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WidgetCardProps {
  title: string;
  icon?: ReactNode;
  /** Optional element rendered on the far side of the header (e.g. a "view all" link). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shared shell for all dashboard widgets: owns the card chrome so widgets
 * only supply their body. Visual changes to widgets happen here, once.
 */
const WidgetCard = ({ title, icon, action, children, className }: WidgetCardProps) => (
  <Card className={`h-full flex flex-col ${className ?? ""}`}>
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {action}
      </div>
    </CardHeader>
    <CardContent className="flex-1 min-h-0 overflow-y-auto">{children}</CardContent>
  </Card>
);

export default WidgetCard;
