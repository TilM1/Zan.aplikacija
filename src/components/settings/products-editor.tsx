"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useSubmit } from "@/components/shared/use-submit";
import { saveProduct } from "@/server/actions/products";

type Product = { id: string | null; name: string; is_active: boolean; sort_order: number };

export function ProductsEditor({ products }: { products: Product[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col divide-y divide-line">
      {products.map((p) => (
        <ProductRow key={p.id} product={p} />
      ))}
      {adding ? (
        <ProductRow product={{ id: null, name: "", is_active: true, sort_order: (products.at(-1)?.sort_order ?? 0) + 10 }} onDone={() => setAdding(false)} />
      ) : (
        <div className="px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Dodaj produkt
          </Button>
        </div>
      )}
    </div>
  );
}

function ProductRow({ product, onDone }: { product: Product; onDone?: () => void }) {
  const router = useRouter();
  const { submit, pending, error } = useSubmit();
  const [v, setV] = useState(product);
  const dirty = v.name !== product.name || v.is_active !== product.is_active || v.sort_order !== product.sort_order || !product.id;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="min-w-48 flex-1" placeholder="Ime produkta" autoFocus={!product.id} />
        <Input type="number" value={v.sort_order} onChange={(e) => setV({ ...v, sort_order: Number(e.target.value) })} className="w-24" title="Vrstni red" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /> Aktiven
        </label>
        {!v.is_active && <Badge>Skrit pri vnosu</Badge>}
        <Button
          size="sm"
          disabled={!dirty}
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
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Prekliči
          </Button>
        )}
      </div>
    </div>
  );
}
