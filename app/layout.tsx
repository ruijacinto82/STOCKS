import './globals.css';
export const metadata = { title: 'Dashboard de Ações', description: 'Dashboard global gratuito' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt"><body>{children}</body></html>;
}
