// Canvas world view, controls, and render loop land in Phase 2. For now this is a placeholder
// so `npm run dev` has something to load while the headless sim (src/sim/) is exercised via
// `npm run sim` and `npm test`.
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem;">
    <h1>Evolution Simulator</h1>
    <p>Phase 1 (headless sim) is in place. Run it with:</p>
    <pre>npm run sim</pre>
    <pre>npm test</pre>
    <p>The canvas world view arrives in Phase 2.</p>
  </div>
`;
