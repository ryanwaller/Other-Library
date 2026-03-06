import { redirect } from "next/navigation";

export default function AppAdminFeedbackRedirect() {
  redirect("/admin?tab=feedback");
}

