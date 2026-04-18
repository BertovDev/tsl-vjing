export function Fallback() {
  return (
    <div className="fallback">
      <h1>WebGPU not available</h1>
      <p>
        This lab needs a WebGPU-capable browser (Chrome/Edge 113+, Safari 18+,
        Firefox Nightly with the flag enabled).
      </p>
    </div>
  );
}
