import type { MetadataRoute } from "next";

// Lets owners "Add to Home Screen": own icon, opens full-screen without the browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "555 Buku",
    short_name: "555 Buku",
    description: "Your buku 555 on your phone. Scan tabs, send PayPal invoices, see who owes you.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f1ec",
    theme_color: "#f3f1ec",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
