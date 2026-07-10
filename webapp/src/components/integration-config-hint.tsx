"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

interface IntegrationConfigHintProps {
  /** Short headline — e.g. "OpenWeatherMap API key not set" */
  title: string;
  /** Plain explanation of what's missing and what to do */
  description: string;
  /** The .env key the user needs to set, e.g. "OPENWEATHERMAP_API_KEY". Optional. */
  envKey?: string;
  /** Path to the .env file, defaults to webapp/docker/.env */
  envPath?: string;
  /** Optional link to the wiki page that walks them through it */
  docsHref?: string;
  /** Optional label for the docs link */
  docsLabel?: string;
}

// Reusable warning card for integration settings pages where the
// integration is gated on env vars set in webapp/docker/.env.
// Shipped as a standalone component so every integration page can adopt
// the same UX without copy-pasting markup.
export function IntegrationConfigHint({
  title,
  description,
  envKey,
  envPath = "webapp/docker/.env",
  docsHref,
  docsLabel,
}: IntegrationConfigHintProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6"
    >
      <Card className="p-4 border-warning/30 bg-warning/5">
        <div className="flex gap-3">
          <AlertCircle
            className="size-5 shrink-0 text-amber-500 mt-0.5"
            strokeWidth={1.5}
          />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
            {envKey && (
              <p className="text-xs">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {envKey}=…
                </code>{" "}
                in <code className="font-mono">{envPath}</code>, then
                restart the webapp container.
              </p>
            )}
            {docsHref && (
              <p className="text-xs">
                <a
                  href={docsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {docsLabel ?? "Setup guide →"}
                </a>
              </p>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
