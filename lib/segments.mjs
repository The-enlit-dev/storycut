// Segment catalogue: section types a video can use. Episodes pick the ones that fit the week.
export const SEGMENT_TYPES = {
  hook: { label: "Opening", kicker: "COLD OPEN", mood: "punchy", card: false, keywords: ["cold open", "hook", "opening", "teaser"] },
  intro: { label: "Introduction", kicker: "WELCOME", mood: "bright", card: false, keywords: ["intro", "welcome"] },
  "main-tech": { label: "Main Technology News", kicker: "TECH NEWS", mood: "curious", card: true, keywords: ["tech", "gadget", "phone", "chip", "hardware", "software"] },
  ai: { label: "AI Developments", kicker: "AI", mood: "curious", card: true, keywords: ["ai ", " ai", "model", "agent", "gpt", "llm", "openai", "anthropic", "metr"] },
  business: { label: "Business & Startups", kicker: "BUSINESS", mood: "confident", card: true, keywords: ["business", "startup", "acquisition", "acquire", "earnings", "deal", "buys", "funding", "toolbox"] },
  events: { label: "Tech Events Around the World", kicker: "EVENTS RADAR", mood: "travel", card: true, keywords: ["events radar", "tech events", "around the world", "conference"] },
  "upcoming-events": { label: "Upcoming Tech Events", kicker: "COMING UP", mood: "travel", card: true, keywords: ["upcoming", "coming up", "next week"] },
  "fun-facts": { label: "Fun Facts", kicker: "FUN FACT", mood: "playful", card: true, keywords: ["fun fact"] },
  discoveries: { label: "Interesting Discoveries", kicker: "DISCOVERY", mood: "wonder", card: true, keywords: ["discover", "research", "science", "space"] },
  "quick-updates": { label: "Quick Updates", kicker: "QUICK UPDATES", mood: "punchy", card: true, keywords: ["quick", "rapid", "briefly", "in brief"] },
  sponsor: { label: "Sponsor", kicker: "SPONSOR", mood: "warm", card: false, keywords: ["sponsor", "a word from", "ad break"] },
  outro: { label: "Closing", kicker: "THAT'S THE WEEK", mood: "bright", card: false, keywords: ["outro", "closing", "wrap", "sign off", "sign-off"] },
};

export const MOODS = {
  punchy: { energy: "high", query: ["upbeat electronic loop", "funky beat instrumental", "energetic drum loop", "upbeat"], fallback: ["bright", "confident"] },
  bright: { energy: "medium", query: ["happy upbeat instrumental", "bright pop instrumental", "cheerful", "happy"], fallback: ["punchy", "warm"] },
  curious: { energy: "medium", query: ["curious playful electronic", "pizzicato", "light electronic loop", "electronic loop"], fallback: ["bright", "wonder"] },
  confident: { energy: "medium", query: ["corporate upbeat instrumental", "groovy bass loop", "funk loop", "groove"], fallback: ["punchy", "bright"] },
  travel: { energy: "medium", query: ["world percussion loop", "adventure", "acoustic guitar loop"], fallback: ["bright", "curious"] },
  playful: { energy: "medium", query: ["quirky", "funny background music", "whimsical", "cartoon music", "ukulele", "comedy"], fallback: ["curious", "bright"] },
  wonder: { energy: "low", query: ["ambient wonder", "dreamy ambient pad", "space ambient"], fallback: ["warm"] },
  warm: { energy: "low", query: ["warm lofi loop", "lofi", "chill hip hop", "soft acoustic"], fallback: ["wonder", "bright"] },
  serious: { energy: "low", query: ["serious ambient", "documentary ambient", "tension ambient"] },
  dramatic: { energy: "high", query: ["cinematic tension", "dramatic percussion", "suspense"] },
};

export function inferType(title, index, total) {
  const t = ` ${title.toLowerCase()} `;
  if (index === 0 && /(cold open|hook|opening|teaser)/.test(t)) return "hook";
  if (/sponsor/.test(t)) return "sponsor";
  if (/(outro|closing|sign[- ]off|wrap[- ]up)/.test(t)) return "outro";
  if (/(upcoming|coming up|next week)/.test(t)) return "upcoming-events";
  if (/(events radar|tech events|around the world|events)/.test(t)) return "events";
  if (/(^| )intro(duction)?( |$)|welcome/.test(t)) return "intro";
  if (/(fun fact)/.test(t)) return "fun-facts";
  if (/(quick update|rapid fire|in brief)/.test(t)) return "quick-updates";
  for (const id of ["business", "ai", "discoveries", "main-tech"]) {
    if (SEGMENT_TYPES[id].keywords.some((k) => t.includes(k))) return id;
  }
  if (index === 0) return "hook";
  if (index === total - 1) return "outro";
  return "main-tech";
}
