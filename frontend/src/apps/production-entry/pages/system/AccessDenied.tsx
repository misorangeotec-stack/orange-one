import Card from "@/shared/components/ui/Card";

export default function AccessDenied() {
  return (
    <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
      <h1 className="text-[18px] font-bold text-navy">No access</h1>
      <p className="text-[13.5px] text-grey-2 mt-2">You don't have access to this page. Ask an admin if you think you should.</p>
    </Card>
  );
}
