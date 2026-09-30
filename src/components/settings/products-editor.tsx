"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useSubmit } from "@/components/shared/use-submit";
import { reorderProducts, saveProduct } from "@/server/actions/products";

type Model = "standard" | "agent_multiplier";
type Product = { id: string | null; name: string; is_active: boolean; sort_order: number; commission_model: Model; agency_rate_percent?: number | null; agency_multiplier?: number | null };
type SavedProduct = Product & { id: string };

export function ProductsEditor({ products }: { products: SavedProduct[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const { submit, pending, error } = useSubmit();

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...products];
    [next[index], next[index + dir]] = [next[index + dir], next[index]];
    const res = await submit(() => reorderProducts(next), { toastOnSuccess: false });
    if (res?.ok) router.refresh();
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="px-4 pt-3">
          <FormError message={error} />
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 border-b border-line px-4 py-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">
        <span>Vrstni red</span>
        <span>Ime produkta</span>
        <span>Aktiven</span>
        <span />
      </div>
      <div className="flex flex-col divide-y divide-line">
        {products.map((p, i) => (
          <ProductRow
            key={p.id}
            product={p}
            position={i + 1}
            onUp={i > 0 ? () => move(i, -1) : undefined}
            onDown={i < products.length - 1 ? () => move(i, 1) : undefined}
            busy={pending}
          />
        ))}
        {adding && (
          <ProductRow
            product={{ id: null, name: "", is_active: true, sort_order: (products.length + 1) * 10, commission_model: "standard" }}
            position={products.length + 1}
            onDone={() => setAdding(false)}
          />
        )}
      </div>
      {!adding && (
        <div className="border-t border-line px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Dodaj produkt
          </Button>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  position,
  onUp,
  onDown,
  onDone,
  busy,
}: {
  product: Product;
  position: number;
  onUp?: () => void;
  onDown?: () => void;
  onDone?: () => void;
  busy?: boolean;
}) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [v, setV] = useState(product);
  const agencyValue = v.commission_model === "agent_multiplier" ? v.agency_multiplier : v.agency_rate_percent;
  const initialAgency = product.commission_model === "agent_multiplier" ? product.agency_multiplier : product.agency_rate_percent;
  const dirty =
    v.name !== product.name || v.is_active !== product.is_active || v.commission_model !== product.commission_model || Number(agencyValue ?? 0) !== Number(initialAgency ?? 0) || !product.id;
  const arrow = "grid size-8 place-items-center rounded-md border border-line text-ink-2 hover:border-gold hover:bg-gold-soft disabled:opacity-25 disabled:hover:bg-transparent";

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <FormError message={error} />
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3">
        <div className="flex items-center gap-1">
          <span className="w-5 text-center text-sm font-semibold text-ink-3 tabular">{position}.</span>
          {product.id && (
            <>
              <button type="button" className={arrow} onClick={onUp} disabled={!onUp || busy} aria-label="Premakni gor" title="Premakni gor">
                <ArrowUp className="size-4" />
              </button>
              <button type="button" className={arrow} onClick={onDown} disabled={!onDown || busy} aria-label="Premakni dol" title="Premakni dol">
                <ArrowDown className="size-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ime produkta" autoFocus={!product.id} />
          {!v.is_active && <Badge>Skrit</Badge>}
          <select
            value={v.commission_model}
            onChange={(e) => setV({ ...v, commission_model: e.target.value as Model })}
            className="h-10 shrink-0 rounded-lg border border-line-strong bg-surface px-2 text-xs"
            title="Kako se izračuna provizija zastopnika"
          >
            <option value="standard">Provizija: premija × 12 × leta × %</option>
            <option value="agent_multiplier">Provizija: premija × število zastopnika</option>
          </select>
          <label className="flex shrink-0 items-center gap-1 text-xs text-ink-2" title="Koliko agenciji plača zavarovalnica (vidi samo lastnik)">
            Agencija:
            {v.commission_model === "agent_multiplier" && <span>×</span>}
            <input
              type="number"
              step="0.01"
              min={0}
              value={agencyValue ?? ""}
              onChange={(e) =>
                setV(
                  v.commission_model === "agent_multiplier"
                    ? { ...v, agency_multiplier: e.target.value === "" ? null : Number(e.target.value) }
                    : { ...v, agency_rate_percent: e.target.value === "" ? null : Number(e.target.value) },
                )
              }
              className="h-10 w-20 rounded-lg border border-line-strong px-2 text-sm"
            />
            {v.commission_model !== "agent_multiplier" && <span>%</span>}
          </label>
        </div>
        <label className="flex items-center justify-center" title="Aktiven produkt se ponuja pri vnosu police">
          <input type="checkbox" className="size-4 accent-[#c6a24b]" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} aria-label="Aktiven" />
        </label>
        <div className="flex gap-1">
          {dirty && (
            <Button
              size="sm"
              variant="gold"
              loading={pending}
              onClick={async () => {
                const res = await submit(() => saveProduct(v));
                if (res?.ok) {
                  router.refresh();
                  onDone?.();
                }
              }}
            >
              Shrani
            </Button>
          )}
          {onDone && (
            <Button size="sm" variant="ghost" onClick={onDone}>
              Prekliči
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
