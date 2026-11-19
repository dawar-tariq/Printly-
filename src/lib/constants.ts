export const SERVICES = [
  { id: 'print', label: 'Print', icon: 'printer', blurb: 'Documents & PDFs' },
  { id: 'photocopy', label: 'Photocopy', icon: 'copy', blurb: 'Class notes & forms' },
  { id: 'scan', label: 'Scan to Email', icon: 'scan', blurb: 'Physical → PDF' },
  { id: 'bind', label: 'Binding', icon: 'book', blurb: 'Staple / spiral / hard' },
  { id: 'laminate', label: 'Lamination', icon: 'layers', blurb: 'Cards & certificates' },
] as const;
export type ServiceId = (typeof SERVICES)[number]['id'];

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'Legal'] as const;
export const GSM_OPTIONS = [70, 75, 80, 90, 100] as const;
export const SERVICE_LABEL: Record<string, string> = {
  print: 'Print', photocopy: 'Photocopy', scan: 'Scan', bind: 'Binding', laminate: 'Lamination',
};
