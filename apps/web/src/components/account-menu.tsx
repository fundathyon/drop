"use client";

import { useTranslations } from "next-intl";
import { UserMenu } from "@foundathyon/community-ui";
import { logoutAction } from "@/lib/actions/auth";
import type { UserInfo } from "@/lib/types";

// No `trigger` prop on purpose. UserMenu renders whatever it gets as the
// CHILDREN of its own Base UI trigger button — it is not a `render`
// substitution like DialogTrigger's — so passing a Button nests a <button>
// inside a <button>, which is invalid HTML and breaks hydration.
//
// Left alone, the library draws the initials avatar the shell is supposed to
// have (§12: an avatar-like trigger) and labels the button with the user's
// name itself. The name and email still appear in the menu's own header, which
// is where they belong: the trigger is an identity mark, not a nameplate.
export function AccountMenu({ user }: { user: UserInfo }) {
  const t = useTranslations("nav");
  const role = t(user.role === "admin" ? "roleAdmin" : "roleUser");

  return (
    <UserMenu
      name={user.name}
      email={t("accountRoleLabel", { email: user.email, role })}
      signOutLabel={t("signOut")}
      // logoutAction is a Server Action that clears the session cookie and
      // redirects; calling it directly is enough — there is no <form> here
      // because UserMenu owns the item's markup.
      onSignOut={() => void logoutAction()}
    />
  );
}
