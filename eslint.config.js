// eslint.config.js
import antfu from '@antfu/eslint-config'

// https://github.com/antfu/eslint-config
export default antfu(
  {
    stylistic: {
      overrides: {
        // 'style/js/array-element-newline': ['error', 'never'],
        // 'style/js/array-bracket-newline': ['error', 'never'],
      },
    },
  },
)
