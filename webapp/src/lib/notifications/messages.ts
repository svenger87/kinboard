import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import de from "../../../messages/de.json";
import fr from "../../../messages/fr.json";

const MESSAGES: Record<string, typeof de> = { en, de, fr };

/** Translator for server-generated push payloads (namespace `push`). */
export function getPushTranslator(locale: string) {
  const messages = MESSAGES[locale] ?? MESSAGES.de;
  return createTranslator({ locale, messages, namespace: "push" });
}

/**
 * The same, for another namespace a server-side text borrows its wording
 * from — a push, or the Heute-Motor's hints as the Integration API reports
 * them. `onError` is passed through, so a caller with its own fallback can
 * keep a missing value from being logged as a failure.
 */
export function getTranslator(
  locale: string,
  namespace: "assistantActions" | "attention.hints" | "holidays" | "pocketMoney",
  onError?: (error: unknown) => void,
) {
  const messages = MESSAGES[locale] ?? MESSAGES.de;
  return createTranslator({ locale, messages, namespace, ...(onError ? { onError } : {}) });
}
