import { Suspense } from "react";
import type { Metadata } from "next";
import AcceptInviteClient from "./AcceptInviteClient";

export const metadata: Metadata = {
  title: "Accept Invite"
};

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteClient />
    </Suspense>
  );
}
