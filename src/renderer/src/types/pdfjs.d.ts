// Vite ?url import for the pdf.js worker (the package doesn't declare this specifier).
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string
  export default src
}
