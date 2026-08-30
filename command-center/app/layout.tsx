import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Financial Command Center',
  description: 'Personal and business finances in one view, kept separate underneath.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Follows the viewer's system setting; both palettes are defined in globals.css.
  colorScheme: 'light dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
