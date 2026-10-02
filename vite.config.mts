import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteInlineSource from "vite-plugin-inline-source";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), viteInlineSource(), viteSingleFile()],
});
