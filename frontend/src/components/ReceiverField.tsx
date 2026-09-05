import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/Combobox";
import { useTranslation } from "@/hooks/useTranslation";
import type { Client } from "@/lib/api";

/** External-receipt receiver picker — a client from the list or a free-text
 *  name. Either way the resolved receiver name string is reported via
 *  onChange; the receipt stores only the name. */
export function ReceiverField({
  clients, value, onChange,
}: Readonly<{
  clients: Client[];
  value: string;
  onChange: (name: string) => void;
}>) {
  const { t } = useTranslation();
  const [source, setSource] = useState<"client" | "other">(
    () => (value && !clients.some(c => c.name === value) ? "other" : "client"),
  );
  const selectedClientId = clients.find(c => c.name === value)?.id ?? null;

  return (
    <div className="space-y-2">
      <Label>{t("receiverName")} *</Label>
      <div className="flex gap-2">
        <Button size="sm" type="button" variant={source === "client" ? "default" : "outline"}
          onClick={() => { setSource("client"); onChange(""); }}>
          {t("client")}
        </Button>
        <Button size="sm" type="button" variant={source === "other" ? "default" : "outline"}
          onClick={() => { setSource("other"); onChange(""); }}>
          {t("other")}
        </Button>
      </div>
      {source === "client" ? (
        <Combobox
          items={clients.map(c => ({ id: c.id, label: c.name }))}
          value={selectedClientId}
          onSelect={id => onChange(clients.find(c => c.id === id)?.name ?? "")}
          placeholder={t("selectClient")}
        />
      ) : (
        <Input
          placeholder={t("enterReceiverName")}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
