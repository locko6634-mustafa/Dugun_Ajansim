export default [
  {
    ignores: ["node_modules/**", "playwright-report/**", "test-results/**"]
  },
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        HTMLElement: "readonly",
        HTMLDialogElement: "readonly",
        IntersectionObserver: "readonly",
        matchMedia: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Node: "readonly",
        URL: "readonly",
        FormData: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        getComputedStyle: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-unreachable": "error"
    }
  }
];
