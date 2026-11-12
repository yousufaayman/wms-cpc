import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

export interface ComboItem<T extends number | string = number> {
  id: T;
  label: string;
  /** Optional heading; items with the same group are listed under it, in order of first appearance. */
  group?: string;
}

/** Searchable single-select combobox — same UX as the roll-ingestion pages. */
export function Combobox<T extends number | string = number>({
  items, value, onSelect, placeholder, disabled = false, onCreate,
}: Readonly<{
  items: ComboItem<T>[];
  value: NoInfer<T> | null;
  onSelect: (id: NoInfer<T>) => void;
  placeholder: string;
  disabled?: boolean;
  /** When provided, typing a name with no exact match offers to create it. */
  onCreate?: (name: string) => Promise<void> | void;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { t } = useTranslation();
  const selected = items.find((i) => i.id === value);
  const trimmed = query.trim();
  const canCreate = !!onCreate && trimmed !== "" &&
    !items.some((i) => i.label.trim().toLowerCase() === trimmed.toLowerCase());
  const groups = [...new Set(items.map((i) => i.group))];
  const renderItem = (item: ComboItem<T>) => (
    <CommandItem
      key={String(item.id)}
      value={`${item.label}\u200b${item.id}`} // unique even when two labels are equal
      onSelect={() => { onSelect(item.id); setOpen(false); }}
    >
      <Check className={`mr-2 h-4 w-4 ${value === item.id ? "opacity-100" : "opacity-0"}`} />
      {item.label}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          {selected ? selected.label : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            {groups.filter((g) => g !== undefined).map((g) => (
              <CommandGroup key={g} heading={g}>
                {items.filter((i) => i.group === g).map(renderItem)}
              </CommandGroup>
            ))}
            <CommandGroup>
              {items.filter((i) => i.group === undefined).map(renderItem)}
              {canCreate && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={async () => { await onCreate!(trimmed); setOpen(false); setQuery(""); }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('createNamed')} "{trimmed}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
