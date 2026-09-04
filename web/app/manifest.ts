import type { MetadataRoute } from "next";

/**
 * Turns the site into something worth keeping on a home screen.
 *
 * ``standalone`` is the point: launched from the home screen the app opens
 * without Safari's address bar and tab strip, which is most of what makes a
 * pinned site feel like an app rather than a bookmark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NewsWithFriends",
    // What actually fits under a home screen icon; the long name is
    // truncated with an ellipsis there.
    short_name: "NWF",
    description:
      "Read the news with your friends. Sources, feeds, stars, and comments.",
    start_url: "/",
    display: "standalone",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // "maskable" lets Android crop to its own shape without clipping the
      // quill; the tile is already inset for exactly that.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
