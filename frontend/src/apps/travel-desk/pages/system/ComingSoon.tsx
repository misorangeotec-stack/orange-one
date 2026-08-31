/**
 * A destination the nav already offers but the phase that builds it has not
 * landed yet.
 *
 * It exists so the sidebar can be built ONCE, in phase 1, against the real
 * shape of the module — rather than growing a link per phase and leaving the
 * navigation half-true in between. Each of these names the phase that fills it,
 * so a reader knows it is scheduled rather than broken.
 */
export default function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white p-6">
      <h1 className="text-[18px] font-bold text-navy">{title}</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-grey-2">{detail}</p>
    </div>
  );
}
