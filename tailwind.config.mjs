/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
    content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,mjs}"],
    darkMode: "class", // allows toggling dark mode manually
    theme: {
        extend: {
            fontFamily: {
                sans: ["var(--font-sans)"],
                mono: ["var(--font-mono)"],
            },
            screens: {
                md: "768px", // 原默认值: 768px, 增大后navbar会更早坍缩
                lg: "1280px", // 原默认值: 1024px, 保持与md一致以确保统一的响应式行为
            },
        },
    },
    plugins: [typography],
};
