export const FEATURED_DREAM_GUIDE_SCHEMA = 'visualizer-featured-dream-guide-v1';

const guides = Object.freeze({
  klangfiguren: Object.freeze({
    schema: FEATURED_DREAM_GUIDE_SCHEMA,
    id: 'klangfiguren',
    description: 'Sand gathers into evolving figures on an artistic vibrating-plate interpretation as the low end agitates the grains.',
    interactionHint: 'Optional: move a pointer to stir the sand; press to strike the plate.',
    explanation: 'Normalized bass, transients, and spectral movement influence agitation and changing figure families. This is Chladni-inspired artwork, not a scientifically exact simulation or a pitch detector.',
  }),
  'nexus-beam': Object.freeze({
    schema: FEATURED_DREAM_GUIDE_SCHEMA,
    id: 'nexus-beam',
    description: 'Geometric rings surround a waveform ribbon, spectrum structure, and bass-reactive central core.',
    interactionHint: 'Optional: drag across the artwork to inspect its rotation.',
    explanation: 'Its immutable original title is Kinetic Harmonic Astrolabe. The waveform and spectrum shape separate structures while low frequencies animate the core; the host editorial name remains Nexus Beam.',
  }),
  'calibration-bloom': Object.freeze({
    schema: FEATURED_DREAM_GUIDE_SCHEMA,
    id: 'calibration-bloom',
    description: 'Waveform ribbons, transient echoes, and a bass-reactive glow make the built-in startup respond immediately.',
    interactionHint: '',
    explanation: 'Calibration Bloom is host-created, not AI-generated. Waveform samples draw the ribbons, transients create echoes, and bass changes line weight and glow size.',
  }),
});

export function featuredDreamGuide(id) {
  const guide = guides[String(id || '')];
  return guide ? structuredClone(guide) : null;
}

export function listFeaturedDreamGuides() {
  return Object.values(guides).map(guide => structuredClone(guide));
}
