import {
  defineConfig,
  presetWind4,
  presetIcons,
  transformerVariantGroup, transformerDirectives,
} from 'unocss'

export default defineConfig({
  presets: [
    presetWind4(),
    presetIcons(),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})