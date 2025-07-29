import neostandard, { plugins } from 'neostandard'

export default [
  ...neostandard({
    ts: true,
    semi: false
  }),
  ...plugins['typescript-eslint'].configs.recommended,
  {
    rules: {
      // Desactiva camelCase para JavaScript/ESLint
      camelcase: 'off',
      // Desactiva camelCase para TypeScript
      '@typescript-eslint/naming-convention': 'off',
      // Permite el uso de 'any'
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
]
