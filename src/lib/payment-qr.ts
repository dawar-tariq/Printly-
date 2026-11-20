import QRCode from 'qrcode';

/**
 * A centre logo needs high error correction and enough pixels per module on a
 * phone. For unusually dense UPI links, keep the QR unobstructed and use the
 * previous medium correction level; the interface shows the brand alongside it.
 */
export function paymentQrPlan(link: string) {
  const highCorrection = QRCode.create(link, { errorCorrectionLevel: 'H' });
  const brandInside = highCorrection.modules.size <= 65;
  return {
    brandInside,
    options: { width: 1024, margin: 4, errorCorrectionLevel: brandInside ? 'H' as const : 'M' as const },
  };
}
