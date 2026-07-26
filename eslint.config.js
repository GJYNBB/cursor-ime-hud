// ESLint v9 flat config. Keep this file small and predictable: the goal is
// a low-friction gate, not a re-architecture of the project's style. New
// rules should be added incrementally and only after running them across
// the codebase to surface real issues.
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");
const globals = require("globals");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  {
    ignores: [
      "out/**",
      "node_modules/**",
      ".claude/**",
      ".vscode-test/**",
      "coverage/**",
      "work/**",
      "resources/bin/**",
      "native/**",
      "**/*.js.bak"
    ]
  },
  {
    files: ["src/**/*.ts", "src/test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json"
      },
      globals: {
        // VS Code Extension Host globals used throughout the project.
        vscode: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      // Surface undefined globals and dangerous patterns; keep stylistic
      // enforcement in Prettier so the two tools do not fight.
      "no-undef": "off", // TypeScript already enforces this with `noImplicitAny` etc.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "warn",
      "no-var": "error"
    }
  },
  // Layer gates. Encodes the dependency rules from ARCHITECTURE.md as
  // per-directory `no-restricted-imports` blocks: lower layers must not
  // import from higher layers, and `contracts/` may not import any
  // implementation layer. Test code (`src/test/**`) is intentionally
  // exempt — tests may reach into any layer.
  {
    files: ["src/model/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*"],
              message: "model/ must not import from any other project layer."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "!../model"],
              message: "contracts/ may only import from model/ — never an implementation layer."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/detector/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "!../model"],
              message: "detector/ may only import from model/ and the standard library."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // Two-step carve-out: gitignore-style negation cannot re-include
            // a file whose parent directory is excluded, so un-exclude the
            // controller directory first and then restrict its contents.
            {
              group: ["../*", "!../model", "!../controller"],
              message:
                "services/ may only import from model/ and the port interfaces in controller/ports."
            },
            {
              group: ["../controller/*", "!../controller/ports"],
              message:
                "services/ may only import from model/ and the port interfaces in controller/ports."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/controller/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "!../model", "!../detector", "!../services", "!../contracts"],
              message:
                "controller/ may only import from model/, detector/, services/, and contracts/."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/renderer/**/*.ts", "src/presenters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "!../model", "!../contracts"],
              message: "renderer/ and presenters/ may only import from model/ and contracts/."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/commands/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../extension"],
              message: "commands/ must not import extension.ts directly."
            }
          ]
        }
      ]
    }
  },
  {
    // The composition root, scripts, and config files use a different
    // module flavor. Lint them with the same parser but without the
    // strict project-aware rules so we can keep the rule set consistent.
    files: ["scripts/**/*.js", "*.config.js", "eslint.config.js"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "script"
      },
      // These files run under Node and use built-in modules and CommonJS
      // require(); without declaring the Node globals, `no-undef: error`
      // flags `process`, `Buffer`, `__dirname`, `__filename`, etc.
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  },
  // Disable stylistic rules that overlap with Prettier.
  prettierConfig
];
