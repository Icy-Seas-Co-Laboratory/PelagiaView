export type LiveFilterOption = {
  id: string;
  label: string;
  detail?: string | null;
  count?: number | null;
  countLabel?: string | null;
  keywords?: string[];
  disabled?: boolean;
};
