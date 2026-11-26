"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ApiKeyCard } from "@/components/settings/api-key-card";

/**
 * The three install keys as Settings shows them (RFC-023 §4.4), each with
 * where the key comes from. One place for the words and links, so Settings
 * and the setup wizard say the same thing.
 */

const OPENWEATHERMAP_SIGNUP = "https://home.openweathermap.org/users/sign_up";
const GOOGLE_GUIDE = "https://github.com/svenger87/kinboard/wiki/Google-Calendar#1-create-a-google-cloud-oauth-client";
const PRESENCE_GUIDE = "https://github.com/svenger87/kinboard/wiki/Presence-Sensor";

function external(href: string) {
  function ExternalLink(chunks: ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {chunks}
      </a>
    );
  }
  return ExternalLink;
}

export function WeatherKeyCard({ id }: { id?: string }) {
  const t = useTranslations("settings.apiKeys");
  return (
    <ApiKeyCard
      id={id}
      name="openweathermap"
      title={t("weatherTitle")}
      description={t.rich("weatherDescription", { link: external(OPENWEATHERMAP_SIGNUP) })}
      noneNote={t("weatherNone")}
      fields={[{ field: "api_key", label: t("weatherKeyLabel"), placeholder: t("weatherKeyPlaceholder"), secret: true }]}
    />
  );
}

export function GoogleClientCard({ id }: { id?: string }) {
  const t = useTranslations("settings.apiKeys");
  return (
    <ApiKeyCard
      id={id}
      name="google_oauth_client"
      title={t("googleTitle")}
      description={t.rich("googleDescription", { link: external(GOOGLE_GUIDE) })}
      noneNote={t("googleNone")}
      footnote={t("googleFootnote")}
      fields={[
        { field: "client_id", label: t("googleIdLabel"), placeholder: t("googleIdPlaceholder") },
        { field: "client_secret", label: t("googleSecretLabel"), placeholder: t("googleSecretPlaceholder"), secret: true },
      ]}
    />
  );
}

export function PresenceTokenCard({ id }: { id?: string }) {
  const t = useTranslations("settings.apiKeys");
  return (
    <ApiKeyCard
      id={id}
      name="presence_sensor"
      title={t("presenceTitle")}
      description={t.rich("presenceDescription", { link: external(PRESENCE_GUIDE) })}
      noneNote={t("presenceNone")}
      generate
      fields={[{ field: "token", label: t("presenceTokenLabel"), placeholder: t("presenceTokenPlaceholder"), secret: true }]}
    />
  );
}
