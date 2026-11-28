import { OwnerAppDownload } from '@/components/OwnerAppDownload';
import styles from '../billing-pages.module.css';

export default function ShopAndroidAppPage() {
  return <div className="mx-auto max-w-3xl space-y-4">
    <div className={styles.hero}><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-orange-700">YOUR PHONE</p><h1 className="mt-1 text-2xl font-black tracking-[-.04em]">Android app</h1><p className="mt-1 text-sm text-neutral-500">Keep your shop close, wherever you are.</p></div></div>
    <OwnerAppDownload />
  </div>;
}
