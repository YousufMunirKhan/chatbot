'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateLocalStockAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Updating...' : 'Update stock'}
    </Button>
  );
}

export function StockUpdateForm({ productId, currentQuantity }: { productId: string; currentQuantity: number }) {
  const [state, action] = useFormState(updateLocalStockAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28 space-y-1">
          <Label htmlFor={`quantity-${productId}`} className="text-xs">
            Quantity
          </Label>
          <Input id={`quantity-${productId}`} name="quantity" type="number" min={0} defaultValue={currentQuantity} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input name="confirm" type="checkbox" className="h-4 w-4" />
          Confirm
        </label>
        <Submit />
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-xs text-emerald-600">Stock updated and audit logged.</p> : null}
    </form>
  );
}
