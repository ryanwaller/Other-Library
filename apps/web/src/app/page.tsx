import { Suspense } from "react";
import HomeClient from "./HomeClient";

export default function HomePage() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}

