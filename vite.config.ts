import { defineConfig } from "vite";

// Served as a GitHub Pages project site at https://danjpark.github.io/critterbranch/,
// not from the domain root, so asset URLs need this prefix.
export default defineConfig({
  base: "/critterbranch/",
});
