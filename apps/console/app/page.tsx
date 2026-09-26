import { redirect } from 'next/navigation';

/** Root route — this app's only real content lives under /invoices. */
export default function HomePage(): never {
  redirect('/invoices');
}
