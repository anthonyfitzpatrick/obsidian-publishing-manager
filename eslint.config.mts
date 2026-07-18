import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

const prohibitedImports = ['electron', 'fs', 'fs/promises', 'child_process'];
const prohibitedPatterns = ['node:*'];

export default defineConfig(
  globalIgnores(['node_modules', 'coverage', 'main.js', 'esbuild.config.mjs', 'scripts/**/*.mjs']),
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts']
        },
        // Node 24 provides import.meta.dirname; TypeScript 5.8 does not type it yet.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Node 24 runtime property.
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
      'no-restricted-imports': [
        'error',
        {
          paths: prohibitedImports,
          patterns: prohibitedPatterns
        }
      ]
    }
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...prohibitedImports, 'obsidian'],
          patterns: [...prohibitedPatterns, '**/application/**', '**/infrastructure/**', '**/ui/**']
        }
      ]
    }
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...prohibitedImports, 'obsidian'],
          patterns: [...prohibitedPatterns, '**/infrastructure/**', '**/ui/**']
        }
      ]
    }
  },
  ...obsidianmd.configs.recommended
);
