import js from "@eslint/js";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXAttribute[name.name="style"]',
          message: "禁止在业务组件中使用内联 style，请改用统一样式体系。"
        }
      ]
    }
  },
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "no-restricted-syntax": "off"
    }
  }
);
