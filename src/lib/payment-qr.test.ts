import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { buildUpiIntent } from '@/lib/upi';
import { paymentQrPlan } from './payment-qr';
import { qrBrandBadgeSvg } from './qr-brand';

function decode(bytes: Buffer) {
  const png = PNG.sync.read(bytes);
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
}

function intent(name: string, upi = 'brightprints@upi') {
  return buildUpiIntent({ upiId: upi, payeeName: name, amountPaise: 12345, note: 'Printly abcd1234' }).link;
}

async function displayedCode(link: string, width: number) {
  const plan = paymentQrPlan(link);
  const fullSize = await QRCode.toBuffer(link, { ...plan.options, type: 'png' });
  let display = await sharp(fullSize).resize(width, width).png().toBuffer();
  if (plan.brandInside) {
    const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}">${qrBrandBadgeSvg(0, 0, width)}</svg>`;
    display = await sharp(display).composite([{ input: Buffer.from(badge) }]).png().toBuffer();
  }
  return { plan, fullSize, display };
}

describe('payment QR branding', () => {
  it.each(['Bright Prints', 'दिव्या', 'مكتبة كشمير'])('keeps a branded UPI QR decodable for %s', async (name) => {
    const link = intent(name);
    const { plan, display } = await displayedCode(link, 224);
    expect(plan.brandInside).toBe(true);
    expect(plan.options.errorCorrectionLevel).toBe('H');
    expect(plan.options.margin).toBe(4);
    expect(decode(display)).toBe(link);
    expect(decode(await sharp(display).greyscale().png().toBuffer())).toBe(link);
  });

  it('keeps a denser local-language code readable without an obstruction', async () => {
    const link = intent('दिव्या प्रिंट्स');
    const { plan, display } = await displayedCode(link, 224);
    expect(plan.brandInside).toBe(false);
    expect(decode(display)).toBe(link);
  });

  it('leaves unusually dense UPI codes unobstructed rather than risking a payment scan', async () => {
    const link = intent('क'.repeat(50), `${'x'.repeat(70)}@okbank`);
    const { plan, fullSize } = await displayedCode(link, 224);
    expect(plan.brandInside).toBe(false);
    expect(plan.options.errorCorrectionLevel).toBe('M');
    expect(plan.options.margin).toBe(4);
    expect(decode(fullSize)).toBe(link);
  });
});
