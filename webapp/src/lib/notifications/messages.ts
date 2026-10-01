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

/** The same, for another namespace a push borrows its wording from. */
export function getTranslator(locale: string, namespace: "assistantActions") {
  const messages = MESSAGES[locale] ?? MESSAGES.de;
  return createTranslator({ locale, messages, namespace });
}
