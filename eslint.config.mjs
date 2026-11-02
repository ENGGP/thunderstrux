import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Bug rules only: no style rules, and no recommended preset that would bring them in.
export default [
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "scripts/**/*.ts"
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // React drops what a handler returns, so async onClick and onSubmit are the normal form here.
      // shortcut: an async JSX handler with no catch goes unseen, turn attributes on if one ships a stuck button.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "react-hooks/rules-of-hooks": "error"
    }
  }
];
