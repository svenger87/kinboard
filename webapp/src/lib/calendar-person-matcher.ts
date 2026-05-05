export type MatchType = "contains" | "starts_with" | "ends_with" | "regex";

export interface PersonMappingRule {
  id: string;
  person_id: string;
  match_type: MatchType;
  pattern: string;
  priority: number; // Higher = checked first
}

/**
 * Match an event title against a single rule
 */
export function matchesRule(title: string, rule: PersonMappingRule): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedPattern = rule.pattern.toLowerCase();

  switch (rule.match_type) {
    case "contains":
      return normalizedTitle.includes(normalizedPattern);
    case "starts_with":
      return normalizedTitle.startsWith(normalizedPattern);
    case "ends_with":
      return normalizedTitle.endsWith(normalizedPattern);
    case "regex":
      try {
        const regex = new RegExp(rule.pattern, "i");
        return regex.test(title);
      } catch {
        // Invalid regex - treat as no match
        return false;
      }
    default:
      return false;
  }
}

/**
 * Find the person_id for an event title using mapping rules
 * Returns null if no rule matches
 */
export function matchPersonForEvent(
  eventTitle: string,
  rules: PersonMappingRule[]
): string | null {
  // Sort rules by priority (highest first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (matchesRule(eventTitle, rule)) {
      return rule.person_id;
    }
  }

  return null;
}

/**
 * Test multiple event titles against rules and return results
 */
export function testRules(
  eventTitles: string[],
  rules: PersonMappingRule[]
): { title: string; person_id: string | null; matchedRule: PersonMappingRule | null }[] {
  return eventTitles.map((title) => {
    const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
    for (const rule of sortedRules) {
      if (matchesRule(title, rule)) {
        return { title, person_id: rule.person_id, matchedRule: rule };
      }
    }
    return { title, person_id: null, matchedRule: null };
  });
}

// Match type labels (German)
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "Enthält",
  starts_with: "Beginnt mit",
  ends_with: "Endet mit",
  regex: "Regex",
};
