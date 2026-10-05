export const BIRD_DISPLAY_CONFIG = [
  { index: 0, code: "forest", role: "Explorer", landName: "Whisper Forest" },
  { index: 1, code: "wind", role: "Pilot", landName: "Sky Port" },
  { index: 2, code: "wizard", role: "Wizard", landName: "Crystal Academy" },
  { index: 3, code: "artist", role: "Artist", landName: "Volcano Peak" },
  { index: 4, code: "king", role: "King", landName: "Golden Castle" },
] as const;

export type BirdCode = (typeof BIRD_DISPLAY_CONFIG)[number]["code"];
type BirdReference = BirdCode | number;

const fallbackDisplay = BIRD_DISPLAY_CONFIG[2];

const getDisplayConfig = (reference: BirdReference) => {
  if (typeof reference === "number") {
    return BIRD_DISPLAY_CONFIG[reference] ?? fallbackDisplay;
  }

  return BIRD_DISPLAY_CONFIG.find(({ code }) => code === reference) ?? fallbackDisplay;
};

export const getRole = (reference: BirdReference) => getDisplayConfig(reference).role;

export const getLandName = (reference: BirdReference) => getDisplayConfig(reference).landName;

export const getBirdLabel = (reference: BirdReference) => `${getRole(reference)} Bird`;
