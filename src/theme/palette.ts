/** Shared by CSS, the 3D views, neural legend and saved images/videos. */
export const palette = {
  paper: '#F6F6EF',
  ink: '#243B2B',
  muted: '#62715F',
  line: '#D9DFD1',
  wash: '#EBF0E3',
  controlLine: '#7A8877',
  forestHover: '#38533A',
  lime: '#D9EF78',
  limeHover: '#E5FC8D',
  limeEdge: '#A2B954',
  lilac: '#BFB0FF',
  lilacWash: '#EAE4FF',
  lilacInk: '#624A87',
  coral: '#F78965',
  coralInk: '#AF4F33',
  coralWash: '#FFF0E8',
  coralShade: '#D86C4D',
  success: '#526C2B',
  successWash: '#E8F0CF',
  focus: '#7955B4',
  textHover: '#526C2B',
  brain: '#15281F',
  brainRaised: '#243B2B',
  onBrain: '#EDF2DF',
  onBrainMuted: '#A9BDA5',
  brainLine: '#45604D',
  nodeRest: '#8CA69A',
  nodeDisabled: '#45604D',
  scene: '#EFF1FC',
  sky: '#E4F2FC',
  skyLow: '#DED9F7',
  stageFrame: '#FAFAFF',
  stageLine: '#C4C8E3',
  floor: '#E2E0F1',
  body: '#344E36',
  bodyHighlight: '#56754B',
  wingVein: '#9B93C5',
} as const;

export const neuralColors = {
  vision: palette.coral,
  network: palette.lilac,
  escape: palette.lime,
} as const;

export function applyPalette(style: Pick<CSSStyleDeclaration, 'setProperty'>): void {
  for (const [key, value] of Object.entries(palette)) {
    style.setProperty(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
  }
}
