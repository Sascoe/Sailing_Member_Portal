import { FormEvent, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../app/firebase";
import { Link, useNavigate } from "react-router-dom";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/app");
    } catch (err: any) {
      setError(err?.message ?? "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow"
      >
        <h1 className="text-2xl font-bold">Log in</h1>

        <label className="block">
          <div className="text-sm font-medium">Email</div>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="block">
          <div className="text-sm font-medium">Password</div>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          className="w-full rounded-lg bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="text-sm text-slate-600">
          Don’t have an account?{" "}
          <Link to="/signup" className="font-medium underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
