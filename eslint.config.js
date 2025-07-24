import neostandard from 'neostandard'

export default [
  ...neostandard({
    ts: true
  }),
  {
    // 🔧 Override explícito para deshabilitar naming rules
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'stylistic/space-before-function-paren': ['error', 'always'],

      // 🚫 CRÍTICO: Desactivar la regla camelcase específicamente
      camelcase: 'off', // ← Esta es la regla que está causando el problema

      // 🚫 Otras reglas de naming por si acaso
      '@typescript-eslint/camelcase': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@stylistic/naming-convention': 'off',
      'n/naming-convention': 'off',
      'id-match': 'off',
      'no-underscore-dangle': 'off'
    }
  }
]
