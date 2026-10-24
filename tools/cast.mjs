// Character cast built from the Microsoft Rocketbox avatar library (MIT licence).
// `variants` recolours clothing regions of the body texture (null = original texture).
const ORANGE = [200, 92, 34];
const ORANGE_FADED = [186, 104, 58];
const KHAKI = [150, 128, 88];

const inmate = (id, src, color = ORANGE) => ({
  id, src, sex: 'm', role: 'inmate', tex: 512, default: 'prison',
  variants: { prison: { clothes: color, hands: src.includes('Construction') ? 'SKIN' : undefined } },
});

export const CAST = [
  // Leads
  { id: 'elias', src: 'Avatars/Professions/Gardener_Male_01', sex: 'm', role: 'lead', tex: 1024, default: 'prison',
    variants: { prison: { clothes: ORANGE, hands: 'SKIN', shoes: [58, 50, 42],
      keys: [{ hue: [30, 75], sat: [0.35, 1], val: [0.25, 1], to: 3 }] }, civil: null } },
  { id: 'jax', src: 'Avatars/Adults/Male_Adult_20', sex: 'm', role: 'lead', tex: 1024, default: 'prison',
    variants: { prison: { clothes: [206, 98, 38] }, civil: null } },
  // Story characters
  { id: 'crane', src: 'Avatars/Professions/Business_Male_04', sex: 'm', role: 'villain', tex: 1024 },
  { id: 'marsh', src: 'Avatars/Professions/Business_Female_03', sex: 'f', role: 'detective', tex: 1024 },
  { id: 'mia', src: 'Avatars/Adults/Female_Adult_08', sex: 'f', role: 'sister', tex: 512 },
  { id: 'mo', src: 'Avatars/Adults/Male_Adult_03', sex: 'm', role: 'inmate', tex: 1024, default: 'prison',
    variants: { prison: { clothes: ORANGE_FADED } } },
  // Prison guards
  { id: 'guard1', src: 'Avatars/Professions/Security_Male_01', sex: 'm', role: 'guard', tex: 512 },
  { id: 'guard2', src: 'Avatars/Professions/Police_Male_01', sex: 'm', role: 'guard', tex: 512 },
  // Police
  { id: 'cop1', src: 'Avatars/Professions/Police_Male_03', sex: 'm', role: 'police', tex: 512 },
  { id: 'cop2', src: 'Avatars/Professions/Police_Male_06', sex: 'm', role: 'police', tex: 512 },
  { id: 'cop3', src: 'Avatars/Professions/Police_Male_07', sex: 'm', role: 'police', tex: 512 },
  { id: 'swat', src: 'Avatars/Professions/Police_Male_02', sex: 'm', role: 'police', tex: 512 },
  // Crane's crew
  { id: 'thug1', src: 'Avatars/Adults/Male_Adult_04', sex: 'm', role: 'thug', tex: 512 },
  { id: 'thug2', src: 'Avatars/Adults/Male_Adult_17', sex: 'm', role: 'thug', tex: 512 },
  { id: 'thug3', src: 'Avatars/Adults/Male_Adult_18', sex: 'm', role: 'thug', tex: 512 },
  { id: 'bodyguard', src: 'Avatars/Professions/Business_Male_01', sex: 'm', role: 'thug', tex: 512 },
  // Inmates
  inmate('inmate1', 'Avatars/Adults/Male_Adult_07'),
  inmate('inmate2', 'Avatars/Adults/Male_Adult_09', ORANGE_FADED),
  inmate('inmate3', 'Avatars/Adults/Male_Adult_12'),
  inmate('inmate4', 'Avatars/Adults/Male_Adult_16', KHAKI),
  inmate('inmate5', 'Avatars/Professions/Construction_Male_03', ORANGE_FADED),
  inmate('inmate6', 'Avatars/Professions/Construction_Male_05'),
];
