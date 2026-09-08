'use client';

import { useFormState } from 'react-dom';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { importCsvAction } from '../integrations-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

const PLACEHOLDER = `title,price,sku
T-Shirt,19.99,TS-001
Mug,9.50,MG-002`;

export function CsvImportForm() {
  const [state, action] = useFormState(importCsvAction, initial);

  return (
    <form action={action} className="space-y-4">
      {/* This select decides which columns the paste below is read as, so it is
          not an afterthought — and it had no hint at all, on a form whose only
          other field is a wall of text. */}
      <FormField
        label="Import into"
        htmlFor="entity"
        hint="Pick this first — it decides which column names are looked for in what you paste."
      >
        <Select name="entity" defaultValue="products">
          <option value="products">Products</option>
          <option value="orders">Orders</option>
          <option value="customers">Customers</option>
          <option value="inventory">Inventory</option>
          <option value="menu">Menu items</option>
        </Select>
      </FormField>
      <FormField
        label="CSV data"
        htmlFor="csv"
        hint="Paste a header row followed by your data. Columns are matched by name."
        required
      >
        <Textarea name="csv" rows={10} className="font-mono" placeholder={PLACEHOLDER} required />
      </FormField>
      <FormMessage state={state} okText="Import complete." />
      <SubmitButton pendingLabel="Importing…">Import CSV</SubmitButton>
    </form>
  );
}
