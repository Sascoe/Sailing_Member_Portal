import { useUserRole } from "../auth/useUserRole.ts";
export default function RecruitmentPage() {

    const {positions} = useUserRole(); //get the user's positions 
    const isRecruitmentChair = positions.includes("recruitment_chair"); //check if recruitment chair

    console.log("positions:", positions);
    console.log("isRecruitmentChair:", isRecruitmentChair);

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Recruitment</h1>
        <p className="text-slate-700">
          Next we’ll build the Stage 1 queue + “Pull next” here.
        </p>
        {isRecruitmentChair && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-semibold">Recruitment Chair Controls</h2>
                <p className="mt-1 text-sm text-slate-600">
                Additional tools available to recruitment chairs.
                </p>

                <div className="mt-4 flex flex-wrap gap-3">
                <button
                    className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => {
                    // placeholder — we’ll wire this later
                    console.log("Navigate to prospies list");
                    }}
                >
                    See prospies
                </button>

                <button
                    disabled
                    className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
                >
                    Close recruitment
                </button>

                <button
                    disabled
                    className="rounded-lg bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
                >
                    Advance stage
                </button>
                </div>
            </div>
            )}

      </div>
    </div>
  );
}
