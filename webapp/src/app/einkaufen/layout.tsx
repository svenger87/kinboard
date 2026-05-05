import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Einkaufsliste",
  description: "Familien-Einkaufsliste für den Supermarkt",
  manifest: "/manifest-shopping.json",
  icons: {
    icon: [
      { url: "/icons/icon-shopping-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-shopping-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-shopping-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Einkauf",
    startupImage: "/icons/icon-shopping-512.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#22c55e",
};

export default function EinkaufenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
