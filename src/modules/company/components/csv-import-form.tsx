'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { importCsvAction } from '../integrations-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const PLACEHOLDER = `title,price,sku
T-Shirt,19.99,TS-001
Mug,9.50,MG-002`;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Importing…' : 'Import CSV'}
    </Button>
  );
}

export function CsvImportForm() {
  const [state, action] = useFormState(importCsvAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="entity">Import into</Label>
        <select id="entity" name="entity" className={selectCls} defaultValue="products">
          <option value="products">Products</option>
          <option value="orders">Orders</option>
          <option value="customers">Customers</option>
          <option value="inventory">Inventory</option>
          <option value="menu">Menu items</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="csv">CSV data</Label>
        <Textarea
          id="csv"
          name="csv"
          rows={10}
          className="font-mono"
          placeholder={PLACEHOLDER}
          required
        />
        <p className="text-xs text-muted-foreground">
          Paste a header row followed by your data. Columns are matched by name.
        </p>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Import complete.</p> : null}
      <Submit />
    </form>
  );
}
