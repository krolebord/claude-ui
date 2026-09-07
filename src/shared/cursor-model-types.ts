export interface CursorModelVariant {
  value: string;
  variantLabel: string;
  displayLabel: string;
}

export interface CursorModelFamily {
  id: string;
  label: string;
  variants: CursorModelVariant[];
}
