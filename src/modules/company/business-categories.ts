export const SERVICE_CATEGORY_OPTIONS = [
  { value: 'service', label: 'Service' },
  { value: 'product', label: 'Product' },
  { value: 'package', label: 'Package' },
  { value: 'installation', label: 'Installation' },
  { value: 'repair', label: 'Repair' },
  { value: 'support', label: 'Support' },
  { value: 'demo', label: 'Demo' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'finance', label: 'Finance' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'training', label: 'Training' },
  { value: 'other', label: 'Other' },
] as const;

export const POLICY_CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'refund', label: 'Refund' },
  { value: 'returns', label: 'Returns' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'payment', label: 'Payment' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'support', label: 'Support' },
] as const;

export const FAQ_CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'products', label: 'Products' },
  { value: 'services', label: 'Services' },
  { value: 'demo', label: 'Demo' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'returns', label: 'Returns' },
  { value: 'support', label: 'Support' },
  { value: 'finance', label: 'Finance' },
  { value: 'contact', label: 'Contact' },
  { value: 'location', label: 'Location' },
  { value: 'hours', label: 'Hours' },
  { value: 'features', label: 'Features' },
  { value: 'trust', label: 'Trust' },
  { value: 'other', label: 'Other' },
] as const;

export const SERVICE_CATEGORY_VALUES = SERVICE_CATEGORY_OPTIONS.map((option) => option.value);
export const POLICY_CATEGORY_VALUES = POLICY_CATEGORY_OPTIONS.map((option) => option.value);
export const FAQ_CATEGORY_VALUES = FAQ_CATEGORY_OPTIONS.map((option) => option.value);

const ALL_CATEGORY_OPTIONS = [
  ...SERVICE_CATEGORY_OPTIONS,
  ...POLICY_CATEGORY_OPTIONS,
  ...FAQ_CATEGORY_OPTIONS,
];

export function categoryLabel(value: string | null | undefined): string {
  if (!value) return '-';
  return ALL_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
