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
      ".vscode-test/**",
      "coverage/**",
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
