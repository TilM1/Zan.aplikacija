import type { MetadataRoute } from "next";

/** Installable app ("Dodaj na začetni zaslon"): opens full-screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CoreMark CRM",
    short_name: "CoreMark",
    description: "CoreMark – celovita zavarovanja · interni CRM",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f6f2",
    theme_color: "#ffffff",
    lang: "sl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
