"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";

// Shared by the setup wizard and the invitation-accept form: a plain shadcn
// Input with a show/hide toggle. Translated copy for the toggle's aria-label
// is supplied by the caller (showLabel/hideLabel) so this file stays
// language-agnostic; id/name are required so two instances (password +
// confirm) can sit on the same form without colliding.
export function PasswordInput({
  id,
  name,
  autoComplete,
  required,
  defaultValue,
  showLabel,
  hideLabel,
}: {
  id: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        className="pr-8"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
      >
        <Icon name={visible ? "eye-off" : "eye"} className="size-4" />
      </button>
    </div>
  );
}
