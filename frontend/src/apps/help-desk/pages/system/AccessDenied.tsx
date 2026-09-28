export default function AccessDenied() {
  return (
    <div className="rounded-xl border border-line bg-white p-6">
      <h1 className="text-[18px] font-bold text-navy">You do not have access to this screen</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        Raising a ticket and tracking your own are still open to you. This screen belongs to the
        people who answer them.
      </p>
    </div>
  );
}
