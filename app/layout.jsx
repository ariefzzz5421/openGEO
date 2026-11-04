import "./globals.css";
export const metadata = {
  title: "OpenGEO Studio — Search Visibility Intelligence",
  description: "Inspect technical search readiness, investigate findings, and compare website audits with an open-source engine.",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  applicationName: "OpenGEO Intelligence Console",
  robots: { index: false, follow: false }
};
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
