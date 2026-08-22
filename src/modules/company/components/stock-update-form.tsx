'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateLocalStockAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

export function StockUpdateForm({ productId, currentQuantity }: { productId: string; currentQuantity: number }) {
  const [state, action] = useFormState(updateLocalStockAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-wrap items-end gap-2">
        {/* Not `FormField`: this row runs a compact `text-xs` label against a
            `space-y-1` rhythm, and `FormField` styles its label at `text-sm`
            with no override. */}
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
        <SubmitButton size="sm" pendingLabel="Updating...">
          Update stock
        </SubmitButton>
      </div>
      <FormMessage state={state} okText="Stock updated and audit logged." className="text-xs" />
    </form>
  );
}
