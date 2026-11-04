export default function manifest() {
  return {
    name: "OpenGEO Intelligence Console",
    short_name: "OpenGEO",
    description: "Technical SEO & GEO analysis with evidence-based remediation.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a1119",
    theme_color: "#b7f779",
    icons: [
      { src: "/icon.png", sizes: "64x64", type: "image/png", purpose: "any" }
    ]
  };
}
