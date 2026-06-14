import { env } from "@/env";
import { HomePageClient } from "./home-page-client";

export default function HomePage() {
  return <HomePageClient botUsername={env.BOT_USERNAME} />;
}
