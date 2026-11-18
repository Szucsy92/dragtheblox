import { createFileRoute } from "@tanstack/react-router";
import Playroom from "@/components/game/Playroom";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Kockavár – színes építőkockák 3D-ben" },
      { name: "description", content: "Pakolj meseszerű színes építőkockákat toronnyá, dobd, borítsd és rázd meg a telefont!" },
      { property: "og:title", content: "Kockavár – színes építőkockák 3D-ben" },
      { property: "og:description", content: "Építs tornyot, dobáld és borítsd a kockákat valósághű fizikával." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Playroom,
});
