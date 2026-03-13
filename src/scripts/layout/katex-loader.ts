export function checkKatex(): void {
    if (document.querySelector(".katex")) {
        void import("katex/dist/katex.css");
    }
}
