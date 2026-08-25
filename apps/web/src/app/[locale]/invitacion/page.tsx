import { api, ApiError } from "@/lib/api";
import type { InvitationInfo } from "@/lib/types";
import { InviteForm } from "./invite-form";

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // invitationByToken throws ApiError (status 410) for a missing, invalid,
  // expired, accepted or revoked token — any of those falls through to
  // InviteForm's "not acceptable" branch. A non-ApiError failure is a real
  // bug, not a bad invitation, so it is left to bubble up.
  let invitation: InvitationInfo | null = null;
  try {
    invitation = await api.invitationByToken(token ?? "");
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }

  return <InviteForm token={token ?? ""} invitation={invitation} />;
}
