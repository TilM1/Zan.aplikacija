export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Nalaganje">
      <div className="mb-5 h-7 w-56 rounded bg-line" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-4 h-80 rounded-lg border border-line bg-surface" />
    </div>
  );
}
