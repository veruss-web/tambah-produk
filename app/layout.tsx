import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MIEFLOW — Run your noodle business beautifully',
  description: 'A modern operating system for noodle businesses.',
  openGraph: {
    images: [{ url: 'https://bolt.new/static/og_default.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['https://bolt.new/static/og_default.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
