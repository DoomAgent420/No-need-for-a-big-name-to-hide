// app.mjs
// Simple JS replacement for main.cpp -> app.wasm/app.mjs
// Exports a default async factory so your existing loader works unchanged.

export default async function createModule() {
  // Simulate async initialization that a real WASM module would do
  await new Promise(resolve => setTimeout(resolve, 0));

  // The Module object: expose the same function name your C++ exported
  const Module = {
    my_exported: function() {
      return 42;
    }
  };

  return Module;
}
