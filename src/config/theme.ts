/**
 * ZenCabs brand + visual theme (from ZenCabs Brand Guidelines).
 *
 *   Primary colours   #07C0EB (sky)  ·  #27EBCD (aqua)
 *   Secondary colours #FFFFFF        ·  #BDBDBD
 *   Gradient          #27EBCD → #07C0EB
 *   Typography        Poppins (primary / headings) · Montserrat (secondary / body)
 *
 * Every colour used by the UI and the 3D scene comes from here, so a re-brand or a
 * dark/night variant is a change to this file only.
 */
export const BRAND = {
  sky: '#07C0EB',
  aqua: '#27EBCD',
  white: '#FFFFFF',
  grey: '#BDBDBD',
  ink: '#121826', // logo wordmark
  navy: '#0B1033', // stacked-logo wordmark
  tagline: '#1E63C4', // "RIDE THE FUTURE"
  /** Darker tints of the primaries for text on white (WCAG-legible). */
  skyDeep: '#0287AA',
  aquaDeep: '#0E9F8A',
  gradient: 'linear-gradient(90deg, #27EBCD 0%, #07C0EB 100%)',
  fontHeading: "'Poppins', 'Montserrat', system-ui, sans-serif",
  fontBody: "'Montserrat', 'Poppins', system-ui, sans-serif",
} as const;

/** Daylight palette for the 3D city and parking twin. */
export const SCENE = {
  sky: '#EAF4F8',
  fog: '#EAF4F8',
  fogNear: 2600,
  fogFar: 11000,
  ground: '#DCE3EA',
  blocks: {
    URBAN: '#F6F8FA',
    DENSE: '#F1F4F7',
    PARK: '#C6E6CC',
    AIRPORT: '#D3E8CF',
    BASE: '#F3F6F9',
    RAIL: '#E1E5EA',
    CAMPUS: '#CFE9D4',
  },
  road: { ARTERIAL: '#B3BDC8', BRIDGE: '#A9B4C0', LOCAL: '#C8D0D9', ACCESS: '#C8D0D9' },
  roadMarking: '#FFFFFF',
  bridgeRail: '#8796A8',
  river: '#7FCFE6',
  riverDeep: '#4FB8D8',
  building: ['#FFFFFF', '#F4F6F9', '#ECEFF3', '#E6EAF0'],
  buildingWarm: '#F3EDE4',
  buildingGlass: '#8FB2C8',
  buildingGlassHigh: '#C9E4F1',
  tree: '#5DB075',
  trunk: '#8A6A4F',
  pole: '#9AA6B4',
  lampHead: '#F8FAFC',
  runway: '#7E8894',
  runwayLight: '#07C0EB',
  rail: '#7C8796',
  landmarkBeam: BRAND.sky,
  // parking lot
  lotAsphalt: '#8E99A6',
  lotLine: '#FFFFFF',
  lotFence: '#7D8A99',
  lotOffice: '#FFFFFF',
  lotGlass: BRAND.sky,
  bayEmpty: '#5F6B78',
  bayEV: '#16A34A',
  bayService: '#F59E0B',
  bayReserved: BRAND.aqua,
  // vehicles + overlays
  carBody: '#FFFFFF',
  carStripe: BRAND.sky,
  carStripeEV: BRAND.aqua,
  carGlass: '#1C2A3A',
  selection: BRAND.sky,
  routeToPickup: BRAND.sky,
  routeTrip: BRAND.tagline,
  trail: BRAND.aquaDeep,
  pickupPin: '#EC4899',
  dropPin: BRAND.tagline,
  request: '#EC4899',
  zoneOk: '#16A34A',
  zoneTight: '#F59E0B',
  zoneShort: '#DC2626',
} as const;
