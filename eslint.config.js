import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import nodePlugin from 'eslint-plugin-n';
import promisePlugin from 'eslint-plugin-promise';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-plugin-prettier';
import eslintConfigLove from 'eslint-config-love';

export default [
  js.configs.recommended,

  ...tseslint.configs.recommended,

  eslintConfigLove,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      import: importPlugin,
      n: nodePlugin,
      promise: promisePlugin,
      'unused-imports': unusedImports,
      prettier,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
    rules: {
      // import порядок
      'import/order': [
        'error',
        {
          groups: [
            'builtin', // fs, path
            'external', // express, sequelize
            'internal', // @/...
            ['parent', 'sibling', 'index'], // ./ ../
            'object',
            'type',
          ],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],

      // проверяет, чтобы импорты типов (interface, type) всегда писались в явном виде import type
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],

      'import/no-duplicates': 'error',
      'import/no-named-as-default-member': 'off', // обращение к именованному экспорту через default-импорт (много ложных срабатываний)
      'import/no-unresolved': 'off', // импортируемый модуль реально существует (конфликтует с TypeScript path aliases)

      'unused-imports/no-unused-imports': 'error', // нельзя импортировать неиспользуемые модули

      'linebreak-style': 'off', // обеспечивает единообразие окончаний строк независимо от операционной системы (!реализует prettier!)

      'global-require': 2, // require() в глобальном контексте

      'no-unused-vars': 'warn', // нельзя объявлять неиспользуемые переменные
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }, // не проверять названия параметров функции наличием _ в начале
      ], // нельзя объявлять неиспользуемые переменные (дополняет typescript)

      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn', // нельзя присваивать any или unknown переменной с другим типом
      '@typescript-eslint/no-unsafe-member-access': 'warn', // нельзя обращаться к свойствам у значения с типом any или unknown
      '@typescript-eslint/no-unsafe-call': 'warn', // нельзя вызывать значение типа any или unknown как функцию

      '@typescript-eslint/strict-boolean-expressions': 'warn', // запрещает использовать в условии значения, которые не гарантированно boolean
      '@typescript-eslint/method-signature-style': 'off', // какой стиль сигнатуры использовать в интерфейсах/типах
      '@typescript-eslint/no-floating-promises': 'error', // проверяет, чтобы у промисов не было «потерянных» вызовов без await или .then()

      'no-named-as-default-member': 'off', // запрещает использовать именованные экспорты по умолчанию

      'no-param-reassign': 'warn', // запрещает изменять аргументы функции

      'prettier/prettier': 'error',
    },
  },
];
