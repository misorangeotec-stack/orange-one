export default function AccessDenied() {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h1 className="text-[18px] font-bold text-navy">You do not have access to this screen</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        Ask an admin if you need it — everything else in Asset Maintenance is still open to you.
      </p>
    </div>
  );
}
