import { FormEvent, useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../app/firebase";

function isNorthwesternU(email: string) {
  return email.toLowerCase().endsWith("@u.northwestern.edu");
}

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isNorthwesternU(email)) {
      setError("Please use your @u.northwestern.edu email address.");
      return;
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Create users/{uid} doc (role defaults to prospie)
      await setDoc(doc(db, "users", cred.user.uid), {
        role: "prospie",
        email: cred.user.email,
        createdAt: serverTimestamp(),
      });

      // Optional: create minimal prospie profile doc now (or later)
      await setDoc(doc(db, "prospies", cred.user.uid), {
        uid: cred.user.uid,
        createdAt: serverTimestamp(),
        email: cred.user.email,
        name: name,
        stage: 0,
        status: "active",
      });

    } catch (err: any) {
      setError(err?.message ?? "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

return (
  <div className="min-h-screen flex items-center justify-center p-6">
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-slate-900 shadow"
    >
      <h1 className="text-2xl font-bold">Create account</h1>

      <input
        type="text"
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
        required
      />

      <label className="block">
        <div className="text-sm font-medium text-slate-700">Email</div>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          type="email"
          required
        />
      </label>

      <label className="block">
        <div className="text-sm font-medium text-slate-700">Password</div>
        <input
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          type="password"
          required
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
        {loading ? "Creating..." : "Sign up"}
      </button>
    </form>
  </div>
);
}
